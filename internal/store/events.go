package store

import "fmt"

// Event — одно событие так, как оно ложится в базу. Идентификатор человека
// (Who) уже хеширован приёмом: сырых идентификаторов store не видит никогда.
type Event struct {
	EID      string
	TS       int64
	Who      string
	Platform string
	Version  string
	Kind     string
	Name     string
	MS       int64
	Params   string
}

// InsertEvents кладёт пачку одной транзакцией и возвращает число НОВЫХ записей.
//
// Повтор с тем же eid молча отбрасывается: телефон, потерявший ответ, шлёт
// пачку заново, и это не ошибка, а подтверждение доставки. Считать такой отказ
// поломкой — верный способ получить очередь, которая гоняет одно и то же по
// пять раз.
func (s *Store) InsertEvents(app string, evs []Event) (int, error) {
	if len(evs) == 0 {
		return 0, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("начать запись: %w", err)
	}
	defer tx.Rollback()

	st, err := tx.Prepare(`INSERT OR IGNORE INTO events
		(app, eid, ts, who, platform, version, kind, name, ms, params)
		VALUES (?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return 0, fmt.Errorf("подготовить запись: %w", err)
	}
	defer st.Close()

	accepted := 0
	for _, e := range evs {
		res, err := st.Exec(app, e.EID, e.TS, пустоеВNull(e.Who), e.Platform, e.Version,
			e.Kind, e.Name, e.MS, пустоеВNull(e.Params))
		if err != nil {
			return 0, fmt.Errorf("записать событие %s: %w", e.EID, err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			accepted++
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("закрыть запись: %w", err)
	}
	return accepted, nil
}

// пустоеВNull бережёт различие «нет значения» и «пустая строка»: COUNT DISTINCT
// по who должен пропускать анонимные события, а не считать их одним человеком.
func пустоеВNull(s string) any {
	if s == "" {
		return nil
	}
	return s
}
