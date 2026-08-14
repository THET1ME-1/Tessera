// Пакет ingest принимает события по HTTP.
//
// Клиент не ждёт записи: его дело — отдать пачку и забыть, поэтому ответ
// уходит раньше, чем данные лягут в базу. Телефон в метро повторит пачку сам, а
// повтор с тем же eid база молча отбросит.
package ingest

import (
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/THET1ME-1/Tessera/internal/store"
)

const (
	пределТела  = 4 << 20 // 4 МБ на пачку
	порогСброса = 1000    // событий в буфере, после которых пишем не дожидаясь паузы
	пауза       = time.Second
)

type входноеСобытие struct {
	EID      string          `json:"eid"`
	TS       int64           `json:"ts"`
	Who      string          `json:"who"`
	Platform string          `json:"platform"`
	Version  string          `json:"version"`
	Kind     string          `json:"kind"`
	Name     string          `json:"name"`
	MS       int64           `json:"ms"`
	Params   json.RawMessage `json:"params"`
}

type пачка struct {
	App    string           `json:"app"`
	SDK    string           `json:"sdk"`
	Events []входноеСобытие `json:"events"`
}

type Ingest struct {
	s      *store.Store
	salt   []byte
	people bool

	mu  sync.Mutex
	buf map[string][]store.Event // приложение → накопленные события
}

// New заводит приём и запускает отложенную запись. salt участвует в хеше
// человека и наружу не отдаётся никогда; people включает счёт людей.
func New(s *store.Store, salt []byte, people bool) *Ingest {
	in := &Ingest{s: s, salt: salt, people: people, buf: map[string][]store.Event{}}
	go in.цикл()
	return in
}

func (in *Ingest) цикл() {
	for range time.Tick(пауза) {
		in.Flush()
	}
}

// Flush уносит буфер в базу одной транзакцией на приложение.
func (in *Ingest) Flush() error {
	in.mu.Lock()
	buf := in.buf
	in.buf = map[string][]store.Event{}
	in.mu.Unlock()

	for app, evs := range buf {
		if _, err := in.s.InsertEvents(app, evs); err != nil {
			return err
		}
	}
	return nil
}

func (in *Ingest) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "только POST", http.StatusMethodNotAllowed)
			return
		}
		app, err := in.s.AppByKey(r.Header.Get("X-Tessera-Key"))
		if err != nil {
			http.Error(w, "ключ не признан", http.StatusUnauthorized)
			return
		}

		var body io.Reader = http.MaxBytesReader(w, r.Body, пределТела)
		if r.Header.Get("Content-Encoding") == "gzip" {
			zr, err := gzip.NewReader(body)
			if err != nil {
				http.Error(w, "тело не разжимается", http.StatusBadRequest)
				return
			}
			defer zr.Close()
			body = zr
		}

		var p пачка
		if err := json.NewDecoder(body).Decode(&p); err != nil {
			http.Error(w, "тело не разбирается", http.StatusBadRequest)
			return
		}

		evs := make([]store.Event, 0, len(p.Events))
		for _, e := range p.Events {
			if e.EID == "" || e.Kind == "" || e.Name == "" {
				continue // без этих полей событие бессмысленно
			}
			ev := store.Event{
				EID: e.EID, TS: e.TS, Platform: e.Platform, Version: e.Version,
				Kind: e.Kind, Name: e.Name, MS: e.MS, Params: string(e.Params),
			}
			// Идентификатор человека хеширует сервер, и только если счёт людей
			// включён. Соль лежит на сервере и наружу не отдаётся.
			if in.people && e.Who != "" {
				sum := sha256.Sum256(append(in.salt, []byte(e.Who)...))
				ev.Who = hex.EncodeToString(sum[:])[:16]
			}
			evs = append(evs, ev)
		}

		in.mu.Lock()
		in.buf[app] = append(in.buf[app], evs...)
		накопилось := len(in.buf[app])
		in.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		// «Принято», а не «записано»: дедупликацию делает база при сбросе
		// буфера, и знать её итог клиенту незачем — повтор для него безопасен.
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "received": len(evs)})

		if накопилось >= порогСброса {
			go in.Flush()
		}
	})
}
