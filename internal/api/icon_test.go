package api

import (
	"os"
	"path/filepath"
	"testing"
)

// Значок приложения лежит в папке данных установки, а не в репозитории:
// у каждой установки свои приложения. Нет файла — 404, и панель рисует
// заводской квадратик. Имя приложения в путь не пролезает.
func TestЗначокПриложенияИзПапкиДанных(t *testing.T) {
	a, кука := стенд(t)
	папка := t.TempDir()
	if err := os.WriteFile(filepath.Join(папка, "togetherly.png"), []byte("\x89PNG\r\n\x1a\nкартинка"), 0o644); err != nil {
		t.Fatal(err)
	}
	a.WithIcons(папка)

	rec := запрос(t, a, "GET", "/api/icon?app=togetherly", кука, "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("значок: код %d, тип %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if rec := запрос(t, a, "GET", "/api/icon?app=wallet", кука, ""); rec.Code != 404 {
		t.Fatalf("нет файла — ждём 404, пришло %d", rec.Code)
	}
	if rec := запрос(t, a, "GET", "/api/icon?app=../togetherly", кука, ""); rec.Code != 400 {
		t.Fatalf("путь в имени — ждём 400, пришло %d", rec.Code)
	}
	if rec := запрос(t, a, "GET", "/api/icon?app=togetherly", "", ""); rec.Code != 401 {
		t.Fatalf("без входа — ждём 401, пришло %d", rec.Code)
	}
}
