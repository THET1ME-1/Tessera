package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/THET1ME-1/Tessera/internal/blocks"
)

// Готовый ответ живёт полминуты: сводки пересчитываются раз в минуту, а панель
// дёргает этот роут на каждое переключение вкладки. Врать такой кэш не может —
// он отдаёт то, что и так было бы посчитано.
var (
	кэшМу    sync.Mutex
	кэш      = map[string]кэшЗапись{}
	срокКэша = 30 * time.Second
)

type кэшЗапись struct {
	тело  []byte
	когда time.Time
}

// core отдаёт панели весь набор данных разом, в том виде, в каком его ждут
// экраны.
//
// Почему одним куском, а не блоками. Блоки — договор для модулей: чужой плагин
// присылает список заготовок, и панель рисует их своими кирпичами. Но вкладки
// ядра нарисованы в принятом макете до последней подписи, и разбирать их на
// заготовки значило бы рисовать заново и хуже. Поэтому у ядра свой роут, а у
// модулей — блоки; панель умеет и то, и другое.
func (a *API) всеДанные(w http.ResponseWriter, r *http.Request) {
	app := r.URL.Query().Get("app")
	if app == "" {
		app = a.первоеПриложение()
	}
	from, to := диапазон(r.URL.Query().Get("range"))

	ключ := app + "|" + from + "|" + to
	кэшМу.Lock()
	если, есть := кэш[ключ]
	кэшМу.Unlock()
	if есть && time.Since(если.когда) < срокКэша {
		w.Header().Set("Content-Type", "application/json")
		w.Write(если.тело)
		return
	}

	д := map[string]any{}
	var ошибки []string
	собрать := func(имя string, дело func() (any, error)) {
		v, err := дело()
		if err != nil {
			// Один упавший срез не должен уносить всю вкладку: панель покажет
			// остальное, а про этот честно скажет.
			ошибки = append(ошибки, имя+": "+err.Error())
			return
		}
		д[имя] = v
	}

	собрать("totals", func() (any, error) { return a.итоги(app, from, to) })
	собрать("days", func() (any, error) { return a.дни(app, from, to) })
	собрать("hours", func() (any, error) { return a.часы(app) })
	собрать("screens", func() (any, error) { return a.экраны(app, from, to) })
	собрать("actions", func() (any, error) { return a.действия(app, from, to) })
	собрать("versions", func() (any, error) { return a.версии(app, from, to) })
	собрать("platforms", func() (any, error) { return a.платформы(app, from, to) })
	собрать("cohorts", func() (any, error) { return a.когорты(app) })
	собрать("apps", func() (any, error) { return a.приложения() })
	собрать("ads", func() (any, error) { return a.реклама(app, from, to) })
	собрать("funnels", func() (any, error) { return a.воронки(app, from, to) })

	// Данные модулей кладём под их именами: вкладке «Обзор» нужны плитки
	// дохода и модерации, а лезть за ними отдельными запросами незачем.
	собрать("modules", func() (any, error) { return a.данныеМодулей() })

	if len(ошибки) > 0 {
		д["errors"] = ошибки
	}

	тело, err := json.Marshal(д)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	кэшМу.Lock()
	кэш[ключ] = кэшЗапись{тело: тело, когда: time.Now()}
	кэшМу.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.Write(тело)
}

func (a *API) итоги(app, from, to string) (any, error) {
	var события, экранов float64
	err := a.s.DB().QueryRow(`SELECT coalesce(sum(hits),0),
		coalesce(sum(CASE WHEN kind='screen' THEN hits ELSE 0 END),0)
		FROM daily WHERE app=? AND day BETWEEN ? AND ?`, app, from, to).Scan(&события, &экранов)
	if err != nil {
		return nil, err
	}
	var людей, заСутки float64
	a.s.DB().QueryRow(`SELECT count(DISTINCT who) FROM seen WHERE app=? AND day BETWEEN ? AND ?`,
		app, from, to).Scan(&людей)
	a.s.DB().QueryRow(`SELECT count(*) FROM seen WHERE app=? AND day=?`,
		app, time.Now().UTC().Format("2006-01-02")).Scan(&заСутки)

	var дней int
	a.s.DB().QueryRow(`SELECT count(DISTINCT day) FROM daily WHERE app=? AND day BETWEEN ? AND ?`,
		app, from, to).Scan(&дней)

	итог := map[string]any{
		"events": события, "people": людей, "dau": заСутки, "days": дней,
		"screens": экранов, "first": from, "last": to,
	}
	// Ядро знает только тех, кого видело: события живут две недели, хеши три
	// месяца, и человек, не заходивший дольше, отсюда выпадает. Сколько всего
	// учёток заведено, знает само приложение — если его модуль это объявил,
	// отдаём и такое число, чтобы крупная цифра обзора отвечала на вопрос
	// «сколько нас», а не «скольких видел SDK».
	if всего, есть := blocks.ИзМодуля(a.s, "people_total"); есть {
		итог["accounts"] = всего
	}
	return итог, nil
}

// дни — по одной строке на сутки: события, люди, новые, вернувшиеся, экраны.
// Новые считаются по первому дню, когда человека вообще видели.
func (a *API) дни(app, from, to string) (any, error) {
	rows, err := a.s.DB().Query(`
		WITH люди AS (
		       SELECT s.day,
		              count(*) AS всего,
		              sum(CASE WHEN п.day = s.day THEN 1 ELSE 0 END) AS новые
		       FROM seen s JOIN first_seen п ON п.who = s.who AND п.app = s.app
		       WHERE s.app=? AND s.day BETWEEN ? AND ? GROUP BY s.day),
		     событий AS (
		       SELECT day,
		              sum(hits) AS всего,
		              sum(CASE WHEN kind='screen' THEN hits ELSE 0 END) AS экраны,
		              sum(CASE WHEN kind='ad' THEN hits ELSE 0 END) AS реклама,
		              sum(CASE WHEN kind='funnel' THEN hits ELSE 0 END) AS воронка
		       FROM daily WHERE app=? AND day BETWEEN ? AND ? GROUP BY day)
		SELECT e.day, coalesce(l.всего,0), coalesce(l.новые,0),
		       e.всего, e.экраны, e.реклама, e.воронка
		FROM событий e LEFT JOIN люди l ON l.day = e.day
		ORDER BY e.day`, app, from, to, app, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	сегодня := time.Now().UTC().Format("2006-01-02")
	out := []map[string]any{}
	for rows.Next() {
		var день string
		var людей, новые, события, экраны, реклама, воронка float64
		if err := rows.Scan(&день, &людей, &новые, &события, &экраны, &реклама, &воронка); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"d": день, "people": людей, "nw": новые, "ret": людей - новые,
			"events": события, "screens": экраны, "ads": реклама, "pairs": воронка,
			"partial": день == сегодня,
		})
	}
	return out, rows.Err()
}

// часы — ритм суток по сырым событиям: они живут две недели, этого хватает.
func (a *API) часы(app string) (any, error) {
	rows, err := a.s.DB().Query(`
		SELECT hour, sum(hits), sum(people) FROM hourly
		WHERE app=? GROUP BY hour ORDER BY hour`, app)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var час int
		var событий, людей float64
		if err := rows.Scan(&час, &событий, &людей); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"h": час, "e": событий, "u": людей})
	}
	return out, rows.Err()
}

func (a *API) экраны(app, from, to string) (any, error) {
	rows, err := a.s.DB().Query(`
		SELECT name, sum(hits), sum(people), sum(ms)
		FROM daily WHERE app=? AND day BETWEEN ? AND ? AND kind='screen'
		GROUP BY name ORDER BY sum(hits) DESC`, app, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var имя string
		var открытий, людей, мс float64
		if err := rows.Scan(&имя, &открытий, &людей, &мс); err != nil {
			return nil, err
		}
		сек := 0.0
		if открытий > 0 {
			сек = мс / 1000 / открытий
		}
		out = append(out, map[string]any{
			"n": имя, "hits": открытий, "u": людей,
			"sec": сек, "min": мс / 1000 / 60,
		})
	}
	return out, rows.Err()
}

func (a *API) действия(app, from, to string) (any, error) {
	return a.поВиду(app, from, to, "action")
}

func (a *API) поВиду(app, from, to, вид string) (any, error) {
	rows, err := a.s.DB().Query(`
		SELECT name, sum(hits), sum(people) FROM daily
		WHERE app=? AND day BETWEEN ? AND ? AND kind=?
		GROUP BY name ORDER BY sum(hits) DESC`, app, from, to, вид)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var имя string
		var раз, людей float64
		if err := rows.Scan(&имя, &раз, &людей); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"n": имя, "hits": раз, "u": людей})
	}
	return out, rows.Err()
}

// Срез сборок: каждый человек считается один раз, по той сборке, с которой
// его видели в последний раз. Раньше здесь стоял max(people) по дням окна, и
// сборка застревала наверху своим лучшим днём: на проде 04.09.2026 первой
// строкой шла 1.29.6 с 11 669 людьми, набранными 21 августа, а живая 1.31.3 с
// 8 650 стояла пятой. Сумма по дням врёт иначе — она считает одного человека
// столько раз, сколько дней он заходил.
const sqlСрезВерсий = `
	SELECT version, count(*) FROM (
		SELECT version,
		       row_number() OVER (PARTITION BY who ORDER BY day DESC) AS место
		FROM seen
		WHERE app=? AND day BETWEEN ? AND ? AND version IS NOT NULL AND version <> '')
	WHERE место = 1
	GROUP BY version ORDER BY 2 DESC LIMIT 10`

// Запасной путь для установок, где людей не считают: без who связки «человек —
// сборка» нет, и остаётся срез последних посчитанных суток. Текущий день берём
// только если других в окне нет — он неполный и занижает числа.
const sqlСрезВерсийБезЛюдей = `
	SELECT version, people FROM versions
	WHERE app=? AND day = (
		SELECT max(day) FROM versions WHERE app=? AND day BETWEEN ? AND ?
		  AND (day < ? OR NOT EXISTS (
		        SELECT 1 FROM versions WHERE app=? AND day BETWEEN ? AND ? AND day < ?)))
	ORDER BY people DESC LIMIT 10`

func (a *API) версии(app, from, to string) (any, error) {
	out, err := a.срезВерсий(sqlСрезВерсий, app, from, to)
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		сегодня := time.Now().UTC().Format(time.DateOnly)
		out, err = a.срезВерсий(sqlСрезВерсийБезЛюдей,
			app, app, from, to, сегодня, app, from, to, сегодня)
		if err != nil {
			return nil, err
		}
	}
	событий, err := a.событияВерсий(app, from, to)
	if err != nil {
		return nil, err
	}
	for _, строка := range out {
		строка["e"] = событий[строка["v"].(string)]
	}
	return out, nil
}

// События по сборкам суммируются честно: одно событие принадлежит одному дню и
// одной сборке, двойного счёта тут нет — в отличие от людей.
func (a *API) событияВерсий(app, from, to string) (map[string]float64, error) {
	rows, err := a.s.DB().Query(`
		SELECT version, sum(hits) FROM versions
		WHERE app=? AND day BETWEEN ? AND ? GROUP BY version`, app, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	из := map[string]float64{}
	for rows.Next() {
		var версия string
		var раз float64
		if err := rows.Scan(&версия, &раз); err != nil {
			return nil, err
		}
		из[версия] = раз
	}
	return из, rows.Err()
}

func (a *API) срезВерсий(sql string, аргументы ...any) ([]map[string]any, error) {
	rows, err := a.s.DB().Query(sql, аргументы...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var версия string
		var людей float64
		if err := rows.Scan(&версия, &людей); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"v": версия, "u": людей})
	}
	return out, rows.Err()
}

func (a *API) платформы(app, from, to string) (any, error) {
	rows, err := a.s.DB().Query(`
		SELECT coalesce(nullif(platform,''),'неизвестно'), count(DISTINCT who)
		FROM seen WHERE app=? AND day BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC`,
		app, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var имя string
		var людей float64
		if err := rows.Scan(&имя, &людей); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"p": имя, "u": людей})
	}
	return out, rows.Err()
}

// когорты — сколько человек из пришедших в день вернулось на первый, третий и
// седьмой день. У молодых когорт вместо нуля прочерк: неделя, которой три дня,
// не может показать возврат на седьмой.
func (a *API) когорты(app string) (any, error) {
	rows, err := a.s.DB().Query(`
		SELECT п.day AS когорта, count(DISTINCT п.who) AS размер,
		       count(DISTINCT CASE WHEN s.day = date(п.day,'+1 day') THEN s.who END),
		       count(DISTINCT CASE WHEN s.day = date(п.day,'+3 day') THEN s.who END),
		       count(DISTINCT CASE WHEN s.day = date(п.day,'+7 day') THEN s.who END)
		FROM first_seen п
		LEFT JOIN seen s ON s.who = п.who AND s.app = п.app
		     AND s.day IN (date(п.day,'+1 day'), date(п.day,'+3 day'), date(п.day,'+7 day'))
		WHERE п.app=?
		GROUP BY когорта ORDER BY когорта`, app)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	сегодня := time.Now().UTC()
	out := []map[string]any{}
	for rows.Next() {
		var день string
		var размер, d1, d3, d7 float64
		if err := rows.Scan(&день, &размер, &d1, &d3, &d7); err != nil {
			return nil, err
		}
		дата, err := time.Parse("2006-01-02", день)
		if err != nil {
			continue
		}
		возраст := int(сегодня.Sub(дата).Hours() / 24)
		строка := map[string]any{"c": день, "size": размер, "d1": nil, "d3": nil, "d7": nil}
		if возраст >= 1 {
			строка["d1"] = d1
		}
		if возраст >= 3 {
			строка["d3"] = d3
		}
		if возраст >= 7 {
			строка["d7"] = d7
		}
		out = append(out, строка)
	}
	return out, rows.Err()
}

// реклама — самый заметный рекламный блок: сколько показов и скольким людям.
func (a *API) реклама(app, from, to string) (any, error) {
	var имя string
	var показов, людей float64
	err := a.s.DB().QueryRow(`
		SELECT name, sum(hits), sum(people) FROM daily
		WHERE app=? AND day BETWEEN ? AND ? AND kind='ad'
		GROUP BY name ORDER BY sum(hits) DESC LIMIT 1`, app, from, to).Scan(&имя, &показов, &людей)
	if err == sql.ErrNoRows {
		return map[string]any{"n": "", "hits": 0, "u": 0}, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"n": имя, "hits": показов, "u": людей}, nil
}

// воронки — шаги, размеченные в коде приложения. Если шаг не расставлен, он
// сюда не попадёт: панель показывает то, что размечено, и не выдумывает.
func (a *API) воронки(app, from, to string) (any, error) {
	шаги, err := a.поВиду(app, from, to, "funnel")
	if err != nil {
		return nil, err
	}
	список, _ := шаги.([]map[string]any)
	if len(список) == 0 {
		return []any{}, nil
	}
	out := []map[string]any{}
	for _, ш := range список {
		out = append(out, map[string]any{"n": ш["n"], "v": ш["u"]})
	}
	return []map[string]any{{"title": "Размеченные шаги", "steps": out}}, nil
}

func (a *API) данныеМодулей() (any, error) {
	rows, err := a.s.DB().Query(`SELECT module, key, json FROM module_data`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]map[string]json.RawMessage{}
	for rows.Next() {
		var модуль, ключ, сырое string
		if err := rows.Scan(&модуль, &ключ, &сырое); err != nil {
			return nil, err
		}
		if out[модуль] == nil {
			out[модуль] = map[string]json.RawMessage{}
		}
		out[модуль][ключ] = json.RawMessage(сырое)
	}
	return out, rows.Err()
}

// Запросы списка приложений вынесены сюда, чтобы их планы стерёг тест
// TestСписокПриложенийНеЧитаетСырыеСобытия: список собирается на каждый запрос
// ядра, и заглянуть отсюда в сырые события — значит прочитать их все.
const (
	sqlСобытийПриложения = `SELECT coalesce(sum(hits),0) FROM daily WHERE app=?`
	sqlЛюдейПриложения   = `SELECT count(DISTINCT who) FROM seen WHERE app=?`
	sqlЗаСуткиПриложения = `SELECT count(*) FROM seen WHERE app=? AND day=?`
	// Версия сборки — самая ходовая за последний посчитанный день. Раньше
	// бралась версия последнего события, но ради неё SQLite сортировал всю
	// таблицу событий: плана без сортировки для «ORDER BY id DESC» у него нет.
	sqlВерсииПриложения = `SELECT version FROM versions WHERE app=?
		ORDER BY day DESC, people DESC LIMIT 1`
	// Платформы лежат и в seen — по строке на «день, человек», а не на
	// событие. Лимит тут честный: список короткий, и скан кончается вместе с
	// таблицей, а не с двадцатью восемью миллионами строк.
	sqlПлатформПриложения = `SELECT DISTINCT platform FROM seen
		WHERE app=? AND platform IS NOT NULL AND platform<>'' LIMIT 4`
)

func (a *API) приложения() (any, error) {
	apps, err := a.s.Apps()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, app := range apps {
		var события, людей, заСутки float64
		a.s.DB().QueryRow(sqlСобытийПриложения, app.ID).Scan(&события)
		a.s.DB().QueryRow(sqlЛюдейПриложения, app.ID).Scan(&людей)
		a.s.DB().QueryRow(sqlЗаСуткиПриложения,
			app.ID, time.Now().UTC().Format("2006-01-02")).Scan(&заСутки)

		var sdk sql.NullString
		a.s.DB().QueryRow(sqlВерсииПриложения, app.ID).Scan(&sdk)

		out = append(out, map[string]any{
			"id": app.ID, "name": app.Name, "live": события > 0,
			"events": события, "people": людей, "dau": заСутки,
			"sdk": sdk.String, "plat": платформыСтрокой(a, app.ID),
		})
	}
	return out, nil
}

func платформыСтрокой(a *API, app string) string {
	rows, err := a.s.DB().Query(sqlПлатформПриложения, app)
	if err != nil {
		return ""
	}
	defer rows.Close()
	итог := ""
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil || p == "" {
			continue
		}
		if итог != "" {
			итог += " · "
		}
		итог += p
	}
	return итог
}

var _ = fmt.Sprintf
