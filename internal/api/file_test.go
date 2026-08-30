package api

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/THET1ME-1/Tessera/internal/store"
)

// стендФайлов поднимает модуль, который на любой запрос называет один и тот же
// файл — с настоящим именем, под которым его загрузил человек.
func стендФайлов(t *testing.T, имяФайла string) (*API, string, string) {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })

	корень := t.TempDir()
	файл := filepath.Join(корень, "лежит.bin")
	if err := os.WriteFile(файл, []byte("содержимое"), 0o644); err != nil {
		t.Fatal(err)
	}

	модули := t.TempDir()
	папка := filepath.Join(модули, "moderation")
	os.MkdirAll(папка, 0o755)
	os.WriteFile(filepath.Join(папка, "main.sh"),
		[]byte(`printf '{"path":"`+файл+`","type":"image/jpeg","name":"`+имяФайла+`"}'`), 0o755)
	os.WriteFile(filepath.Join(папка, "module.json"), []byte(`{
		"id":"moderation","name":"Модерация","run":["sh","main.sh"],
		"root":"`+корень+`"}`), 0o644)

	секрет := []byte("подпись")
	return New(s, модули, секрет), Cookie(секрет, time.Now().Add(time.Hour)), файл
}

// Оригинал модератор скачивает, а не разглядывает: файл нужен как есть, с его
// именем, чтобы приложить к жалобе или к письму. Без Content-Disposition
// браузер откроет картинку во вкладке и сохранит её потом под именем вида
// «file.htm».
func TestОригиналОтдаётсяФайломСИменем(t *testing.T) {
	a, кука, _ := стендФайлов(t, "memory_1786968914693_8ilq5wccee.jpg")

	rec := запрос(t, a, "GET", "/api/file?src=moderation:original&id=abc&download=1", кука, "")
	if rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body.String())
	}
	got := rec.Header().Get("Content-Disposition")
	if !strings.HasPrefix(got, "attachment") {
		t.Fatalf("файл отдан для показа, а не для скачивания: %q", got)
	}
	if !strings.Contains(got, "memory_1786968914693_8ilq5wccee.jpg") {
		t.Fatalf("имя загрузки потеряно: %q", got)
	}
}

// Имена приходят из чужого хранилища, и в них бывает что угодно — кавычки,
// перевод строки, кириллица. Заголовок собирается конкатенацией, поэтому
// кавычка в имени иначе разорвала бы его на два.
func TestИмяЗагрузкиНеЛомаетЗаголовок(t *testing.T) {
	a, кука, _ := стендФайлов(t, `злое\"имя.jpg`)

	rec := запрос(t, a, "GET", "/api/file?src=moderation:original&id=abc&download=1", кука, "")
	if rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body.String())
	}
	got := rec.Header().Get("Content-Disposition")
	if strings.ContainsAny(got, "\"\n\r") {
		t.Fatalf("сырое имя попало в заголовок: %q", got)
	}
}

// Тот же файл без просьбы скачать показывается как раньше: лента и лайтбокс
// рисуют картинки прямо в странице.
func TestБезПросьбыСкачатьФайлПоказывается(t *testing.T) {
	a, кука, _ := стендФайлов(t, "кадр.jpg")

	rec := запрос(t, a, "GET", "/api/file?src=moderation:thumb&id=abc", кука, "")
	if rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Disposition"); got != "" {
		t.Fatalf("картинка ленты отдана на скачивание: %q", got)
	}
}
