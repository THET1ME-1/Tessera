package api

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed all:web
var файлыПанели embed.FS

// Static отдаёт панель. Файлы вшиты в бинарник: рядом с ним не должно лежать
// ничего, кроме базы и папки модулей.
func Static() http.Handler {
	под, err := fs.Sub(файлыПанели, "web")
	if err != nil {
		// Ошибка тут означает сломанную сборку, а не сбой в работе.
		panic(err)
	}
	return http.FileServer(http.FS(под))
}
