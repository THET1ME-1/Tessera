// Пакет modules запускает сторонние программы и читает то, что они напечатали.
//
// Встроенного движка JS здесь нет намеренно. Модуль — обычная программа на
// любом языке: его можно запустить руками в терминале и увидеть ровно тот же
// json, что видит панель. Плата за это одна: модулю нужен свой рантайм на
// сервере.
package modules

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/THET1ME-1/Tessera/internal/blocks"
)

// Tab — вкладка, которую модуль просит показать.
type Tab struct {
	ID     string         `json:"id"`
	Title  string         `json:"title"`
	Blocks []blocks.Block `json:"blocks"`
}

// Manifest — всё, что модуль сообщает о себе.
type Manifest struct {
	ID      string         `json:"id"`
	Name    string         `json:"name"`
	Version string         `json:"version"`
	Run     []string       `json:"run"`   // как запускать: ["python3", "main.py"]
	Every   string         `json:"every"` // как часто собирать: "20m"
	Tabs    []Tab          `json:"tabs"`
	Tiles   []blocks.Block `json:"tiles"` // что предлагает положить на обзор
}

// Load читает все папки внутри dir.
//
// Битый манифест не роняет остальные: панель обязана подняться даже с одним
// испорченным модулем. Отсутствие самой папки — тоже норма, а не ошибка:
// установка без модулей полностью рабочая.
func Load(dir string) ([]Manifest, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("читать %s: %w", dir, err)
	}

	var out []Manifest
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name(), "module.json"))
		if err != nil {
			continue
		}
		var m Manifest
		if err := json.Unmarshal(raw, &m); err != nil {
			continue
		}
		if m.ID == "" || len(m.Run) == 0 {
			continue
		}
		out = append(out, m)
	}
	return out, nil
}
