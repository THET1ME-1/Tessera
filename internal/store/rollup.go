package store

import (
	"fmt"
	"time"
)

// RollupDay переписывает сводку дня целиком.
//
// Именно переписывает, а не прибавляет: только так пересчёт можно гонять
// сколько угодно раз, не боясь удвоить числа после перезапуска или доехавшей с
// опозданием пачки. Панель читает потом только эти строки — считать агрегаты в
// момент запроса ей запрещено.
func (s *Store) RollupDay(app, day string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("начать пересчёт: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM daily WHERE app=? AND day=?`, app, day); err != nil {
		return fmt.Errorf("очистить день: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO daily (app, day, kind, name, hits, people, ms)
		SELECT app, date(ts,'unixepoch'), kind, name,
		       count(*), count(DISTINCT who), coalesce(sum(ms),0)
		FROM events WHERE app=? AND date(ts,'unixepoch')=?
		GROUP BY app, kind, name`, app, day); err != nil {
		return fmt.Errorf("посчитать день: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM seen WHERE app=? AND day=?`, app, day); err != nil {
		return fmt.Errorf("очистить посетителей: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT OR IGNORE INTO seen (app, day, who)
		SELECT app, date(ts,'unixepoch'), who FROM events
		WHERE app=? AND date(ts,'unixepoch')=? AND who IS NOT NULL`, app, day); err != nil {
		return fmt.Errorf("записать посетителей: %w", err)
	}
	return tx.Commit()
}

// RollupRecent пересчитывает последние days суток у всех приложений. Раз в
// десять минут хватает двух суток: день позавчерашний уже не меняется.
func (s *Store) RollupRecent(days int) error {
	rows, err := s.db.Query(`SELECT id FROM apps`)
	if err != nil {
		return fmt.Errorf("список приложений: %w", err)
	}
	var apps []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		apps = append(apps, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	now := time.Now().UTC()
	for _, app := range apps {
		for i := range days {
			day := now.AddDate(0, 0, -i).Format("2006-01-02")
			if err := s.RollupDay(app, day); err != nil {
				return err
			}
		}
	}
	return nil
}
