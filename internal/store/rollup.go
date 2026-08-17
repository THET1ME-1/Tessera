package store

import (
	"fmt"
	"time"
)

// запросСводки — один читающий запрос пересчёта вместе с готовыми аргументами.
// Собран отдельно, чтобы тест проверял план того самого SQL, который потом и
// выполняется, а не своей копии.
type запросСводки struct {
	имя       string
	sql       string
	аргументы []any
}

// границыДня переводит «2026-08-14» в полуинтервал меток времени [начало,
// конец): полночь UTC входит в сутки, полночь следующих — уже нет.
func границыДня(day string) (int64, int64, error) {
	д, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return 0, 0, fmt.Errorf("разобрать день %q: %w", day, err)
	}
	начало := д.UTC().Unix()
	return начало, начало + 24*60*60, nil
}

// запросыСводкиДня отдаёт четыре запроса, которые читают сырьё за сутки.
//
// День задан диапазоном меток времени, а не выражением date(ts,'unixepoch'):
// функция от колонки закрывает индекс, и тогда пересчёт одних суток читает всю
// историю приложения. Индекс events_ts сужает выборку до нужного дня.
func запросыСводкиДня(app, day string) ([]запросСводки, error) {
	начало, конец, err := границыДня(day)
	if err != nil {
		return nil, err
	}
	деньИСутки := []any{day, app, начало, конец}

	return []запросСводки{
		{имя: "сводка дня", аргументы: деньИСутки, sql: `
		INSERT INTO daily (app, day, kind, name, hits, people, ms)
		SELECT app, ?, kind, name,
		       count(*), count(DISTINCT who), coalesce(sum(ms),0)
		FROM events WHERE app=? AND ts>=? AND ts<?
		GROUP BY app, kind, name`},

		// Платформа человека за день — та, с которой он слал события чаще всего:
		// один и тот же человек бывает и на телефоне, и на планшете.
		{имя: "посетители", аргументы: деньИСутки, sql: `
		INSERT OR IGNORE INTO seen (app, day, who, platform)
		SELECT app, день, who, platform FROM (
			SELECT app, ? AS день, who, platform, count(*) AS n,
			       row_number() OVER (PARTITION BY who ORDER BY count(*) DESC) AS место
			FROM events
			WHERE app=? AND ts>=? AND ts<? AND who IS NOT NULL
			GROUP BY who, platform)
		WHERE место = 1`},

		{имя: "часы", аргументы: деньИСутки, sql: `
		INSERT INTO hourly (app, day, hour, hits, people)
		SELECT app, ?,
		       cast(strftime('%H', ts, 'unixepoch') AS INTEGER),
		       count(*), count(DISTINCT who)
		FROM events WHERE app=? AND ts>=? AND ts<?
		GROUP BY 3`},

		{имя: "версии", аргументы: деньИСутки, sql: `
		INSERT INTO versions (app, day, version, people)
		SELECT app, ?,
		       coalesce(nullif(version,''),'неизвестно'),
		       count(DISTINCT coalesce(who, eid))
		FROM events WHERE app=? AND ts>=? AND ts<?
		GROUP BY 3`},
	}, nil
}

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

	for _, таблица := range []string{"daily", "seen", "hourly", "versions"} {
		if _, err := tx.Exec(
			`DELETE FROM `+таблица+` WHERE app=? AND day=?`, app, day); err != nil {
			return fmt.Errorf("очистить %s: %w", таблица, err)
		}
	}
	запросы, err := запросыСводкиДня(app, day)
	if err != nil {
		return err
	}
	for _, запрос := range запросы {
		if _, err := tx.Exec(запрос.sql, запрос.аргументы...); err != nil {
			return fmt.Errorf("посчитать %s: %w", запрос.имя, err)
		}
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
