package ingest

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/THET1ME-1/Tessera/internal/store"
)

func стенд(t *testing.T, people bool) (*store.Store, *Ingest, string) {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	key, err := s.CreateApp("togetherly", "Togetherly")
	if err != nil {
		t.Fatal(err)
	}
	return s, New(s, []byte("соль"), people), key
}

const тело = `{"app":"togetherly","sdk":"flutter 0.4.1","events":[
  {"eid":"a1","ts":1786708800,"kind":"screen","name":"memory_lane","ms":5000,
   "platform":"android","version":"1.28.2"}]}`

func TestПриёмОтвечает202ИЗаписывает(t *testing.T) {
	s, in, key := стенд(t, false)
	req := httptest.NewRequest("POST", "/i", strings.NewReader(тело))
	req.Header.Set("X-Tessera-Key", key)
	rec := httptest.NewRecorder()
	in.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("код %d, ждали 202: %s", rec.Code, rec.Body.String())
	}
	// Буфер уходит в базу отложенно, поэтому сбрасываем руками.
	if err := in.Flush(); err != nil {
		t.Fatal(err)
	}
	var n int
	s.DB().QueryRow(`SELECT count(*) FROM events`).Scan(&n)
	if n != 1 {
		t.Fatalf("записано %d событий, ждали 1", n)
	}
}

func TestЧужойКлючНеПринимается(t *testing.T) {
	_, in, _ := стенд(t, false)
	req := httptest.NewRequest("POST", "/i", strings.NewReader(тело))
	req.Header.Set("X-Tessera-Key", "чужой")
	rec := httptest.NewRecorder()
	in.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("код %d, ждали 401", rec.Code)
	}
}

func TestБезСчётаЛюдейИдентификаторНеСохраняется(t *testing.T) {
	s, in, key := стенд(t, false)
	body := strings.Replace(тело, `"ms":5000`, `"ms":5000,"who":"install-1"`, 1)
	req := httptest.NewRequest("POST", "/i", strings.NewReader(body))
	req.Header.Set("X-Tessera-Key", key)
	in.Handler().ServeHTTP(httptest.NewRecorder(), req)
	in.Flush()

	var n int
	s.DB().QueryRow(`SELECT count(*) FROM events WHERE who IS NOT NULL`).Scan(&n)
	if n != 0 {
		t.Fatalf("при выключенном счёте людей сохранено %d идентификаторов", n)
	}
}

func TestСоСчётомЛюдейСохраняетсяХешАНеИсходник(t *testing.T) {
	s, in, key := стенд(t, true)
	body := strings.Replace(тело, `"ms":5000`, `"ms":5000,"who":"install-1"`, 1)
	req := httptest.NewRequest("POST", "/i", strings.NewReader(body))
	req.Header.Set("X-Tessera-Key", key)
	in.Handler().ServeHTTP(httptest.NewRecorder(), req)
	in.Flush()

	var who string
	if err := s.DB().QueryRow(`SELECT who FROM events`).Scan(&who); err != nil {
		t.Fatal(err)
	}
	if who == "install-1" {
		t.Fatal("идентификатор сохранён как есть, а должен быть хеш")
	}
	if who == "" {
		t.Fatal("при включённом счёте людей идентификатор потерялся")
	}
}

func TestСобытиеБезИмениОтбрасывается(t *testing.T) {
	s, in, key := стенд(t, false)
	body := `{"app":"togetherly","events":[{"eid":"b1","ts":1786708800,"kind":"screen"}]}`
	req := httptest.NewRequest("POST", "/i", strings.NewReader(body))
	req.Header.Set("X-Tessera-Key", key)
	rec := httptest.NewRecorder()
	in.Handler().ServeHTTP(rec, req)
	in.Flush()

	var n int
	s.DB().QueryRow(`SELECT count(*) FROM events`).Scan(&n)
	if n != 0 {
		t.Fatalf("событие без имени записано (%d)", n)
	}
}
