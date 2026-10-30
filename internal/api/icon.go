package api

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

// Имя приложения идёт в путь к файлу, поэтому пропускаем только то, чем
// приложения называются: буквы, цифры, дефис и подчёркивание.
var имяПриложения = regexp.MustCompile(`^[a-z0-9_-]+$`)

// WithIcons называет папку значков приложений: <папка>/<app>.png или .webp.
// Значки у каждой установки свои, поэтому живут рядом с базой, а не в
// бинарнике.
func (a *API) WithIcons(dir string) *API {
	a.iconsDir = dir
	return a
}

// icon отдаёт значок приложения для переключателя в боковом меню. Нет
// файла — 404, и панель остаётся при заводском квадратике.
func (a *API) icon(w http.ResponseWriter, r *http.Request) {
	app := r.URL.Query().Get("app")
	if !имяПриложения.MatchString(app) {
		http.Error(w, "имя приложения из букв и цифр", http.StatusBadRequest)
		return
	}
	if a.iconsDir == "" {
		http.NotFound(w, r)
		return
	}
	for _, расширение := range []string{".webp", ".png"} {
		путь := filepath.Join(a.iconsDir, app+расширение)
		if _, err := os.Stat(путь); err == nil {
			w.Header().Set("Cache-Control", "private, max-age=86400")
			http.ServeFile(w, r, путь)
			return
		}
	}
	http.NotFound(w, r)
}
