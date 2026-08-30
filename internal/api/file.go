package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/THET1ME-1/Tessera/internal/modules"
)

// file отдаёт файл, который назвал модуль.
//
// Картинку в json не завернёшь, а держать в модуле свой http-сервер — значит
// раздать ему порт, права и заботу о доступе. Поэтому договор такой: модуль
// печатает путь к файлу на диске, ядро проверяет путь и отдаёт содержимое сам.
//
//	GET /api/file?src=moderation:thumb&id=…&w=512
//
// Модуль отвечает {"path": "...", "type": "image/webp"}.
//
// Проверка пути обязательна. Модуль и так работает с правами процесса, но
// «мне велели отдать /etc/shadow» — не та ошибка, которую стоит допускать по
// невнимательности: путь обязан лежать внутри корня, объявленного модулем в
// манифесте полем "root".
func (a *API) file(w http.ResponseWriter, r *http.Request) {
	владелец, ключ, ok := strings.Cut(r.URL.Query().Get("src"), ":")
	if !ok || владелец == "core" {
		http.Error(w, "адрес файла вида модуль:ключ", http.StatusBadRequest)
		return
	}

	ms, err := modules.Load(a.modulesDir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var m *modules.Manifest
	for i := range ms {
		if ms[i].ID == владелец {
			m = &ms[i]
		}
	}
	if m == nil {
		http.Error(w, "нет такого модуля", http.StatusNotFound)
		return
	}
	if m.Root == "" {
		http.Error(w, "модуль не объявил корень файлов", http.StatusForbidden)
		return
	}

	// Параметры запроса уходят модулю как есть: он сам знает, что такое id и w.
	параметры := map[string]string{}
	for k, v := range r.URL.Query() {
		if k != "src" && len(v) > 0 {
			параметры[k] = v[0]
		}
	}

	var ответ struct {
		Path string `json:"path"`
		Type string `json:"type"`
		// Имя, под которым файл сохранится у модератора. Файл на диске зовётся
		// как придётся — временной копией из бакета, миниатюрой с размером в
		// имени, — а человеку нужно исходное имя загрузки.
		Name string `json:"name"`
	}

	// Готовый путь модуль может назвать заранее — прямо в ленте, вместе с
	// кадрами. Тогда за файлом лезть к нему незачем.
	//
	// Это не мелочь: страница ленты — шестьдесят кадров, и каждый поднимал
	// отдельный процесс модуля. Даже с ограничителем в четыре штуки открытие
	// вкладки превращалось в шестьдесят запусков питона, а при холодном кэше
	// миниатюр упиралось в таймаут запроса и часть кадров не приезжала вовсе.
	// Путь всё равно проверяется на принадлежность объявленному корню, так что
	// подсунуть чужой файл через адрес нельзя.
	if готовый := r.URL.Query().Get("path"); готовый != "" {
		ответ.Path = готовый
		ответ.Type = r.URL.Query().Get("type")
		ответ.Name = r.URL.Query().Get("name")
	} else {
		raw, err := modules.Query(*m, filepath.Join(a.modulesDir, m.ID), ключ, параметры)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		if err := json.Unmarshal(raw, &ответ); err != nil || ответ.Path == "" {
			http.Error(w, "модуль не назвал файл", http.StatusBadGateway)
			return
		}
	}

	корень, err := filepath.Abs(m.Root)
	if err != nil {
		http.Error(w, "корень модуля не разбирается", http.StatusInternalServerError)
		return
	}
	путь, err := filepath.Abs(ответ.Path)
	if err != nil || !strings.HasPrefix(путь+string(filepath.Separator),
		корень+string(filepath.Separator)) {
		http.Error(w, "файл вне корня модуля", http.StatusForbidden)
		return
	}

	f, err := os.Open(путь)
	if err != nil {
		http.Error(w, "файла нет", http.StatusNotFound)
		return
	}
	defer f.Close()
	св, err := f.Stat()
	if err != nil || св.IsDir() {
		http.Error(w, "это не файл", http.StatusNotFound)
		return
	}

	if ответ.Type != "" {
		w.Header().Set("Content-Type", ответ.Type)
	}
	// Просьба скачать: браузер сохранит файл, а не откроет его во вкладке.
	// Имя приходит из чужого хранилища, поэтому в заголовок оно попадает
	// только процеженным — кавычка или перевод строки иначе разорвали бы его.
	if r.URL.Query().Get("download") != "" {
		имя := ответ.Name
		if имя == "" {
			имя = св.Name()
		}
		w.Header().Set("Content-Disposition",
			"attachment; filename*=UTF-8''"+url.PathEscape(имя))
	}
	// Кадры не меняются, поэтому браузеру можно их держать; приватность
	// бережёт private — общий кэш чужие снимки хранить не должен.
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeContent(w, r, св.Name(), св.ModTime(), f)
}
