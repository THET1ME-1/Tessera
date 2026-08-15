package blocks

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/THET1ME-1/Tessera/internal/store"
)

// ИзМодуля достаёт величину, которую модуль считает лучше ядра. Объявление
// модуль делает в манифесте (поле provides), ядро кладёт его в настройки при
// сборе — читать сами манифесты отсюда нельзя, пакет модулей импортирует этот.
func ИзМодуля(s *store.Store, величина string) (float64, bool) {
	var адрес string
	if err := s.DB().QueryRow(`SELECT v FROM settings WHERE k=?`,
		"provides."+величина).Scan(&адрес); err != nil || адрес == "" {
		return 0, false
	}
	части := strings.SplitN(адрес, ":", 2)
	if len(части) != 2 {
		return 0, false
	}
	var raw string
	if err := s.DB().QueryRow(`SELECT json FROM module_data WHERE module=? AND key=?`,
		части[0], части[1]).Scan(&raw); err != nil {
		return 0, false
	}
	var d struct {
		Value float64 `json:"value"`
	}
	if err := json.Unmarshal([]byte(raw), &d); err != nil || d.Value == 0 {
		return 0, false
	}
	return d.Value, true
}

// Герой и его спутники — блоки, задающие вид обзора.
//
// Обзор не должен быть решёткой одинаковых коробок: глаз тогда не находит, с
// чего начать. Поэтому на вкладке один блок крупный (число плюс график,
// объясняющие друг друга), один средний рядом и ряд мелких внизу.
func Герой(s *store.Store) map[string]Source {
	return map[string]Source{
		// people_hero — «сколько людей» крупно, а под ним столбики: новые и
		// вернувшиеся стопкой. Разделение важнее суммы: рост из новых и рост
		// из вернувшихся — разные новости.
		"people_hero": func(app, from, to string) (any, error) {
			rows, err := s.DB().Query(`
				SELECT s.day,
				       count(*) AS всего,
				       sum(CASE WHEN п.первый = s.day THEN 1 ELSE 0 END) AS новые
				FROM seen s
				JOIN (SELECT who, min(day) AS первый FROM seen WHERE app=? GROUP BY who) п
				  ON п.who = s.who
				WHERE s.app=? AND s.day BETWEEN ? AND ?
				GROUP BY s.day ORDER BY s.day`, app, app, from, to)
			if err != nil {
				return nil, fmt.Errorf("люди по дням: %w", err)
			}
			defer rows.Close()

			out := HeroData{
				Title: "Всего людей", Unit: "человек",
				Legend: []string{"Новые", "Вернувшиеся"},
			}
			var всегоНовых, прошлаяНеделя float64
			граница := time.Now().UTC().AddDate(0, 0, -7).Format("2006-01-02")
			предел := time.Now().UTC().AddDate(0, 0, -14).Format("2006-01-02")

			for rows.Next() {
				var день string
				var всего, новые float64
				if err := rows.Scan(&день, &всего, &новые); err != nil {
					return nil, err
				}
				out.Items = append(out.Items, Item{Label: день, Parts: []Part{
					{V: новые},
					{V: всего - новые, Style: "hatch"},
				}})
				if день >= граница {
					всегоНовых += новые
				} else if день >= предел {
					прошлаяНеделя += новые
				}
			}
			if err := rows.Err(); err != nil {
				return nil, err
			}

			var людей float64
			if err := s.DB().QueryRow(`SELECT count(DISTINCT who) FROM seen
				WHERE app=? AND day BETWEEN ? AND ?`, app, from, to).Scan(&людей); err != nil {
				return nil, err
			}
			out.Value = людей
			out.Sub = "Уникальные люди за период. Хеш считает сервер, соли приложение не знает."
			out.Note = "Последний день неполный: сутки ещё идут."

			// Ядро видит только тех, кто заходил, пока живут события: на
			// Togetherly это 35 тысяч человек из 72 заведённых. Крупная цифра
			// с подписью «всего людей» так вводила в заблуждение. Если модуль
			// объявил, что знает настоящее число учёток, берём его — а график
			// остаётся про тех, кто заходил.
			if всего, есть := ИзМодуля(s, "people_total"); есть {
				out.Value = всего
				out.Sub = "Учёток в приложении. На графике — кто заходил за период."
			}
			if прошлаяНеделя > 0 {
				д := (всегоНовых - прошлаяНеделя) / прошлаяНеделя * 100
				out.Delta = &д
			}
			return out, nil
		},

		// events_hero — то же, но про события: он встаёт на место героя, когда
		// счёт людей выключен и говорить о людях нечего.
		"events_hero": func(app, from, to string) (any, error) {
			rows, err := s.DB().Query(`
				SELECT day, sum(hits) FROM daily
				WHERE app=? AND day BETWEEN ? AND ?
				GROUP BY day ORDER BY day`, app, from, to)
			if err != nil {
				return nil, fmt.Errorf("события по дням: %w", err)
			}
			defer rows.Close()

			out := HeroData{Title: "Всего событий", Unit: "событий"}
			var сумма float64
			for rows.Next() {
				var день string
				var hits float64
				if err := rows.Scan(&день, &hits); err != nil {
					return nil, err
				}
				сумма += hits
				out.Items = append(out.Items, Item{Label: день, Parts: []Part{{V: hits}}})
			}
			out.Value = сумма
			out.Sub = "События за период. Людей не считаем: в базе одни счётчики."
			return out, rows.Err()
		},

		// hours — ритм суток. Спутник героя: объясняет, когда людям удобно.
		"hours": func(app, from, to string) (any, error) {
			rows, err := s.DB().Query(`
				SELECT cast(strftime('%H', ts, 'unixepoch') AS INTEGER) AS час, count(*)
				FROM events WHERE app=? GROUP BY час ORDER BY час`, app)
			if err != nil {
				return nil, fmt.Errorf("сутки: %w", err)
			}
			defer rows.Close()

			out := ColumnsData{Unit: "событий"}
			var пик, провал float64
			var часПика int
			for rows.Next() {
				var час int
				var n float64
				if err := rows.Scan(&час, &n); err != nil {
					return nil, err
				}
				if n > пик {
					пик, часПика = n, час
				}
				if провал == 0 || n < провал {
					провал = n
				}
				out.Items = append(out.Items, Item{
					Label: fmt.Sprintf("%02d", час),
					Parts: []Part{{V: n}},
				})
			}
			if err := rows.Err(); err != nil {
				return nil, err
			}
			if провал > 0 {
				out.Unit = fmt.Sprintf("событий · пик в %02d:00, разница %.1f раза",
					часПика, пик/провал)
			}
			return out, nil
		},
	}
}
