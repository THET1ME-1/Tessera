package modules

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const (
	таймаутСбора   = 60 * time.Second
	таймаутЗапроса = 5 * time.Second
)

// Collect запускает модуль с командой collect и разбирает его вывод как
// словарь «ключ → данные блока». Данные потом ложатся в module_data, и панель
// читает уже оттуда: она не ждёт, пока чужая программа сходит в четыре API.
func Collect(m Manifest, dir string) (map[string]json.RawMessage, error) {
	out, err := запустить(m, dir, таймаутСбора, "collect")
	if err != nil {
		return nil, err
	}
	var data map[string]json.RawMessage
	if err := json.Unmarshal(out, &data); err != nil {
		return nil, fmt.Errorf("модуль %s напечатал не json: %w", m.ID, err)
	}
	return data, nil
}

// Query спрашивает у модуля один ключ по требованию: так работают ленты с
// перелистыванием, которые нет смысла собирать заранее.
func Query(m Manifest, dir, key string, args any) (json.RawMessage, error) {
	return QueryWithTimeout(m, dir, key, args, int(таймаутЗапроса/time.Millisecond))
}

// QueryWithTimeout вынесен отдельно ради тестов: ждать пять секунд в прогоне
// незачем.
func QueryWithTimeout(m Manifest, dir, key string, args any, мс int) (json.RawMessage, error) {
	raw, err := json.Marshal(args)
	if err != nil {
		return nil, fmt.Errorf("собрать параметры для %s: %w", m.ID, err)
	}
	out, err := запустить(m, dir, time.Duration(мс)*time.Millisecond, "query", key, string(raw))
	if err != nil {
		return nil, err
	}
	if !json.Valid(out) {
		return nil, fmt.Errorf("модуль %s напечатал не json", m.ID)
	}
	return out, nil
}

func запустить(m Manifest, dir string, срок time.Duration, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), срок)
	defer cancel()

	cmd := exec.CommandContext(ctx, m.Run[0], append(append([]string{}, m.Run[1:]...), args...)...)
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	оборвать(cmd)

	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("модуль %s не ответил за %s", m.ID, срок)
		}
		причина := strings.TrimSpace(stderr.String())
		if причина == "" {
			причина = err.Error()
		}
		return nil, fmt.Errorf("модуль %s упал: %s", m.ID, причина)
	}
	return stdout.Bytes(), nil
}
