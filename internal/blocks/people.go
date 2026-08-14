package blocks

import (
	"fmt"
	"time"

	"github.com/THET1ME-1/Tessera/internal/store"
)

// Люди отдаёт источники про живых людей: кто сейчас в приложении, сколько
// заходило за сутки, неделю и месяц, сколько появилось впервые.
//
// Все эти числа считаются по событиям, а не по базе приложения, и разница
// принципиальная: «активны за 30 дней» — это те, кто заходил, а не все, кто
// когда-либо регистрировался. Зарегистрированных знает только само приложение,
// их приносит модуль.
//
// Диапазон эти источники не спрашивают: у каждого своё окно, привязанное к
// текущему моменту. Иначе «онлайн сейчас» зависел бы от кнопки «7 дней».
func Люди(s *store.Store) map[string]Source {
	// поДням считает уникальных за последние n суток с разбивкой по платформе.
	поДням := func(app string, дней int, подпись string) (any, error) {
		от := time.Now().UTC().AddDate(0, 0, -дней+1).Format("2006-01-02")
		до := time.Now().UTC().Format("2006-01-02")

		var всего float64
		err := s.DB().QueryRow(`SELECT count(DISTINCT who) FROM seen
			WHERE app=? AND day BETWEEN ? AND ?`, app, от, до).Scan(&всего)
		if err != nil {
			return nil, fmt.Errorf("активные за %d суток: %w", дней, err)
		}

		части, err := платформы(s, `SELECT coalesce(platform,'неизвестно'), count(DISTINCT who)
			FROM seen WHERE app=? AND day BETWEEN ? AND ? GROUP BY 1 ORDER BY 2 DESC`, app, от, до)
		if err != nil {
			return nil, err
		}
		return StatData{Value: всего, Sub: подпись, Parts: части}, nil
	}

	return map[string]Source{
		"online": func(app, from, to string) (any, error) {
			// Онлайн — те, от кого событие пришло за последние пять минут.
			порог := time.Now().Add(-5 * time.Minute).Unix()
			var всего float64
			err := s.DB().QueryRow(`SELECT count(DISTINCT who) FROM events
				WHERE app=? AND ts >= ? AND who IS NOT NULL`, app, порог).Scan(&всего)
			if err != nil {
				return nil, fmt.Errorf("онлайн: %w", err)
			}
			части, err := платформы(s, `SELECT coalesce(platform,'неизвестно'), count(DISTINCT who)
				FROM events WHERE app=? AND ts >= ? AND who IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
				app, порог)
			if err != nil {
				return nil, err
			}
			return StatData{Value: всего, Sub: "за последние пять минут", Parts: части}, nil
		},

		"active_24h": func(app, from, to string) (any, error) {
			return поДням(app, 1, "заходили за сутки")
		},
		"active_7d": func(app, from, to string) (any, error) {
			return поДням(app, 7, "заходили за неделю")
		},
		"active_30d": func(app, from, to string) (any, error) {
			return поДням(app, 30, "заходили за месяц")
		},

		// people_seen — все, кого панель вообще видела. Это не «всего
		// зарегистрировано»: сырьё живёт две недели, а хеши три месяца, и
		// человек, не заходивший дольше, отсюда выпадает.
		"people_seen": func(app, from, to string) (any, error) {
			var всего float64
			if err := s.DB().QueryRow(`SELECT count(DISTINCT who) FROM seen WHERE app=?`,
				app).Scan(&всего); err != nil {
				return nil, fmt.Errorf("все посетители: %w", err)
			}
			части, err := платформы(s, `SELECT coalesce(platform,'неизвестно'), count(DISTINCT who)
				FROM seen WHERE app=? GROUP BY 1 ORDER BY 2 DESC`, app)
			if err != nil {
				return nil, err
			}
			return StatData{Value: всего, Sub: "всех, кого видела панель", Parts: части}, nil
		},

		// new_24h — те, чьё первое событие пришло за последние сутки.
		"new_24h": func(app, from, to string) (any, error) {
			return новые(s, app, 1)
		},
		"new_7d": func(app, from, to string) (any, error) {
			return новые(s, app, 7)
		},
	}
}

// новые считает людей, впервые появившихся за последние n суток, и сравнивает
// с таким же отрезком до него.
func новые(s *store.Store, app string, дней int) (any, error) {
	граница := time.Now().UTC().AddDate(0, 0, -дней+1).Format("2006-01-02")
	// Прошлый отрезок кончается ЗА день до границы: иначе день границы попадёт
	// в оба, и вчерашние новички посчитаются дважды.
	предКонец := time.Now().UTC().AddDate(0, 0, -дней).Format("2006-01-02")
	пред := time.Now().UTC().AddDate(0, 0, -2*дней+1).Format("2006-01-02")

	считать := func(от, до string) (float64, error) {
		var n float64
		err := s.DB().QueryRow(`
			SELECT count(*) FROM (
				SELECT who, min(day) AS первый FROM seen WHERE app=? GROUP BY who)
			WHERE первый BETWEEN ? AND ?`, app, от, до).Scan(&n)
		return n, err
	}

	сейчас, err := считать(граница, time.Now().UTC().Format("2006-01-02"))
	if err != nil {
		return nil, fmt.Errorf("новые за %d суток: %w", дней, err)
	}
	раньше, err := считать(пред, предКонец)
	if err != nil {
		return nil, fmt.Errorf("новые за прошлый отрезок: %w", err)
	}

	части, err := платформы(s, `
		SELECT coalesce(platform,'неизвестно'), count(*) FROM (
			SELECT who, platform, min(day) AS первый FROM seen WHERE app=? GROUP BY who)
		WHERE первый >= ? GROUP BY 1 ORDER BY 2 DESC`, app, граница)
	if err != nil {
		return nil, err
	}

	подпись := "впервые за сутки"
	if дней > 1 {
		подпись = fmt.Sprintf("впервые за %d суток", дней)
	}
	out := StatData{Value: сейчас, Sub: подпись, Parts: части}
	// Прирост показываем только когда есть с чем сравнивать: «+100%» от нуля
	// ничего не значит.
	if раньше > 0 {
		д := (сейчас - раньше) / раньше * 100
		out.Delta = &д
	}
	return out, nil
}

func платформы(s *store.Store, запрос string, args ...any) ([]Row, error) {
	rows, err := s.DB().Query(запрос, args...)
	if err != nil {
		return nil, fmt.Errorf("разбивка по платформам: %w", err)
	}
	defer rows.Close()

	var out []Row
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.Name, &r.Value); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
