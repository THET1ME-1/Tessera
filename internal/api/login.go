package api

import (
	"encoding/json"
	"net/http"
	"time"
)

// срокКуки — неделя. Пользователь у панели один, и просить пароль каждый день
// незачем; неделя — компромисс между удобством и чужим забытым ноутбуком.
const срокКуки = 7 * 24 * time.Hour

// login принимает пароль и выдаёт куку. Отдельного пользователя нет: панель
// ставит один человек себе на сервер.
func (a *API) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "только POST", http.StatusMethodNotAllowed)
		return
	}
	var в struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&в); err != nil {
		http.Error(w, "тело не разбирается", http.StatusBadRequest)
		return
	}
	if !Check(a.s, в.Password) {
		// Пароль не подошёл — причину не уточняем: подсказывать подбирающему
		// нечего.
		http.Error(w, "пароль не подошёл", http.StatusUnauthorized)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "tessera",
		Value:    Cookie(a.secret, time.Now().Add(срокКуки)),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(срокКуки.Seconds()),
	})
	отдать(w, map[string]any{"ok": true})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: "tessera", Value: "", Path: "/", HttpOnly: true, MaxAge: -1,
	})
	отдать(w, map[string]any{"ok": true})
}

// state говорит панели, надо ли показывать вход и заведён ли пароль вообще.
// Единственный роут, открытый без куки: иначе панели не с чего начать.
func (a *API) state(w http.ResponseWriter, r *http.Request) {
	var есть int
	a.s.DB().QueryRow(`SELECT count(*) FROM settings WHERE k='password'`).Scan(&есть)
	c, err := r.Cookie("tessera")
	отдать(w, map[string]any{
		"passwordSet": есть > 0,
		"signedIn":    err == nil && Valid(a.secret, c.Value),
	})
}
