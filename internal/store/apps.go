package store

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"time"
)

// App — приложение, чьи события принимает сервер. Ключ показывается владельцу
// один раз при заведении и живёт в коде приложения.
type App struct {
	ID, Name, Key string
	Created       int64
}

func (s *Store) CreateApp(id, name string) (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("выдать ключ: %w", err)
	}
	key := base64.RawURLEncoding.EncodeToString(raw)
	_, err := s.db.Exec(`INSERT INTO apps (id, name, key, created) VALUES (?,?,?,?)`,
		id, name, key, time.Now().Unix())
	if err != nil {
		return "", fmt.Errorf("завести приложение %s: %w", id, err)
	}
	return key, nil
}

func (s *Store) AppByKey(key string) (string, error) {
	var id string
	if err := s.db.QueryRow(`SELECT id FROM apps WHERE key=?`, key).Scan(&id); err != nil {
		return "", fmt.Errorf("ключ не признан: %w", err)
	}
	return id, nil
}

func (s *Store) Apps() ([]App, error) {
	rows, err := s.db.Query(`SELECT id, name, key, created FROM apps ORDER BY created`)
	if err != nil {
		return nil, fmt.Errorf("список приложений: %w", err)
	}
	defer rows.Close()

	var out []App
	for rows.Next() {
		var a App
		if err := rows.Scan(&a.ID, &a.Name, &a.Key, &a.Created); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
