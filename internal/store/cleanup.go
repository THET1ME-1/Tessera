package store

import (
	"fmt"
	"time"
)

// Cleanup сносит сырые события старше rawDays и хеши посетителей старше
// seenDays.
//
// Сводки не трогает никогда: они и есть память панели. Сырьё нужно только для
// пересчёта и разбора одиночных случаев, поэтому две недели — щедрый запас.
func (s *Store) Cleanup(rawDays, seenDays int) error {
	порогСырья := time.Now().AddDate(0, 0, -rawDays).Unix()
	if _, err := s.db.Exec(`DELETE FROM events WHERE ts < ?`, порогСырья); err != nil {
		return fmt.Errorf("убрать старые события: %w", err)
	}
	порогХешей := time.Now().AddDate(0, 0, -seenDays).UTC().Format("2006-01-02")
	if _, err := s.db.Exec(`DELETE FROM seen WHERE day < ?`, порогХешей); err != nil {
		return fmt.Errorf("убрать старые хеши: %w", err)
	}
	return nil
}
