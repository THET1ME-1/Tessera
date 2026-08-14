package blocks

import (
	"fmt"
	"sort"

	"github.com/THET1ME-1/Tessera/internal/store"
)

// Core отдаёт источники, которые ядро наполняет само. Ключи здесь без
// приставки: адрес «core:events_daily» разбирает вызывающий.
//
// Все источники читают только сводки: считать агрегаты в момент запроса
// панели запрещено, это уже стоило соседнему проекту трёх минут на вкладку.
func Core(s *store.Store) map[string]Source {
	all := map[string]Source{
		"events_daily": func(app, from, to string) (any, error) {
			rows, err := s.DB().Query(`
				SELECT day, sum(hits) FROM daily
				WHERE app=? AND day BETWEEN ? AND ?
				GROUP BY day ORDER BY day`, app, from, to)
			if err != nil {
				return nil, fmt.Errorf("события по дням: %w", err)
			}
			defer rows.Close()

			out := ColumnsData{Unit: "событий"}
			for rows.Next() {
				var day string
				var hits float64
				if err := rows.Scan(&day, &hits); err != nil {
					return nil, err
				}
				out.Items = append(out.Items, Item{Label: day, Parts: []Part{{V: hits}}})
			}
			return out, rows.Err()
		},

		"people_daily": func(app, from, to string) (any, error) {
			rows, err := s.DB().Query(`
				SELECT day, count(*) FROM seen
				WHERE app=? AND day BETWEEN ? AND ?
				GROUP BY day ORDER BY day`, app, from, to)
			if err != nil {
				return nil, fmt.Errorf("люди по дням: %w", err)
			}
			defer rows.Close()

			out := ColumnsData{Unit: "человек"}
			for rows.Next() {
				var day string
				var n float64
				if err := rows.Scan(&day, &n); err != nil {
					return nil, err
				}
				out.Items = append(out.Items, Item{Label: day, Parts: []Part{{V: n}}})
			}
			return out, rows.Err()
		},

		"screens": func(app, from, to string) (any, error) {
			rows, err := s.DB().Query(`
				SELECT name, sum(ms)/1000.0/3600.0 FROM daily
				WHERE app=? AND day BETWEEN ? AND ? AND kind='screen'
				GROUP BY name`, app, from, to)
			if err != nil {
				return nil, fmt.Errorf("экраны: %w", err)
			}
			defer rows.Close()

			out := RasterData{Unit: 10, UnitLabel: "часов внимания"}
			for rows.Next() {
				var r Row
				if err := rows.Scan(&r.Name, &r.Value); err != nil {
					return nil, err
				}
				out.Rows = append(out.Rows, r)
			}
			if err := rows.Err(); err != nil {
				return nil, err
			}
			// Лесенкой: самый затратный экран сверху.
			sort.Slice(out.Rows, func(i, j int) bool { return out.Rows[i].Value > out.Rows[j].Value })
			return out, nil
		},

		"actions": func(app, from, to string) (any, error) {
			rows, err := s.DB().Query(`
				SELECT name, sum(hits), sum(people) FROM daily
				WHERE app=? AND day BETWEEN ? AND ? AND kind='action'
				GROUP BY name ORDER BY sum(hits) DESC`, app, from, to)
			if err != nil {
				return nil, fmt.Errorf("действия: %w", err)
			}
			defer rows.Close()

			out := TableData{Cols: []string{"Событие", "Раз", "Людей·дней"}, BarCol: 1}
			for rows.Next() {
				var name string
				var hits, people float64
				if err := rows.Scan(&name, &hits, &people); err != nil {
					return nil, err
				}
				out.Rows = append(out.Rows, []any{name, hits, people})
			}
			return out, rows.Err()
		},

		"events_total": func(app, from, to string) (any, error) {
			var всего float64
			err := s.DB().QueryRow(`SELECT coalesce(sum(hits),0) FROM daily
				WHERE app=? AND day BETWEEN ? AND ?`, app, from, to).Scan(&всего)
			if err != nil {
				return nil, fmt.Errorf("всего событий: %w", err)
			}
			return StatData{Value: всего, Sub: "за выбранный период"}, nil
		},

		"people_total": func(app, from, to string) (any, error) {
			var всего float64
			err := s.DB().QueryRow(`SELECT count(DISTINCT who) FROM seen
				WHERE app=? AND day BETWEEN ? AND ?`, app, from, to).Scan(&всего)
			if err != nil {
				return nil, fmt.Errorf("всего людей: %w", err)
			}
			return StatData{Value: всего, Sub: "уникальных за период"}, nil
		},
	}
	// Источники про живых людей лежат отдельным файлом: у них своё окно,
	// не зависящее от выбранного диапазона.
	for ключ, src := range Люди(s) {
		all[ключ] = src
	}
	return all
}
