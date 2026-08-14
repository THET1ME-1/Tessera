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
	// Платформа человека за день — та, с которой он слал события чаще всего:
	// один и тот же человек бывает и на телефоне, и на планшете.
	if _, err := tx.Exec(`
		INSERT OR IGNORE INTO seen (app, day, who, platform)
		SELECT app, день, who, platform FROM (
			SELECT app, date(ts,'unixepoch') AS день, who, platform, count(*) AS n,
			       row_number() OVER (PARTITION BY who ORDER BY count(*) DESC) AS место
			FROM events
			WHERE app=? AND date(ts,'unixepoch')=? AND who IS NOT NULL
			GROUP BY who, platform)
		WHERE место = 1`, app, day); err != nil {
		return fmt.Errorf("записать посетителей: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM hourly WHERE app=? AND day=?`, app, day); err != nil {
		return fmt.Errorf("очистить часы: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO hourly (app, day, hour, hits, people)
		SELECT app, date(ts,'unixepoch'),
		       cast(strftime('%H', ts, 'unixepoch') AS INTEGER),
		       count(*), count(DISTINCT who)
		FROM events WHERE app=? AND date(ts,'unixepoch')=?
		GROUP BY 3`, app, day); err != nil {
		return fmt.Errorf("посчитать часы: %w", err)
	}

	if _, err := tx.Exec(`DELETE FROM versions WHERE app=? AND day=?`, app, day); err != nil {
		return fmt.Errorf("очистить версии: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO versions (app, day, version, people)
		SELECT app, date(ts,'unixepoch'),
		       coalesce(nullif(version,''),'неизвестно'),
		       count(DISTINCT coalesce(who, eid))
		FROM events WHERE app=? AND date(ts,'unixepoch')=?
		GROUP BY 3`, app, day); err != nil {
		return fmt.Errorf("посчитать версии: %w", err)
	}

	// Отметка первого дня. INSERT OR IGNORE бережёт уже записанное: человек
	// впервые появляется однажды, и пересчёт вчерашнего дня не должен двигать
	// эту дату вперёд.
	if _, err := tx.Exec(`
		INSERT OR IGNORE INTO first_seen (app, who, day)
		SELECT app, who, day FROM seen WHERE app=? AND day=?`, app, day); err != nil {
		return fmt.Errorf("записать первый день: %w", err)
	}

	return tx.Commit()
}

// ПересчитатьПервыеДни заново собирает отметки первого появления по всей
// таблице посетителей. Нужен один раз после обновления, дальше их ведёт
// обычный пересчёт дня.
func (s *Store) ПересчитатьПервыеДни() error {
	_, err := s.db.Exec(`
		INSERT OR REPLACE INTO first_seen (app, who, day)
		SELECT app, who, min(day) FROM seen GROUP BY app, who`)
	if err != nil {
		return fmt.Errorf("пересобрать первые дни: %w", err)
	}
	return nil
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
