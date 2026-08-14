package api

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/THET1ME-1/Tessera/internal/store"
)

// итераций — рекомендация OWASP для PBKDF2-HMAC-SHA256. Проверка пароля бывает
// раз в неделю, поэтому дороговизна тут в плюс.
const итераций = 210_000

// SetPassword задаёт пароль входа в панель. Хранится соль и производный ключ,
// сам пароль нигде не лежит.
func SetPassword(s *store.Store, pass string) error {
	соль := make([]byte, 16)
	if _, err := rand.Read(соль); err != nil {
		return fmt.Errorf("завести соль пароля: %w", err)
	}
	ключ, err := pbkdf2.Key(sha256.New, pass, соль, итераций, 32)
	if err != nil {
		return fmt.Errorf("посчитать ключ пароля: %w", err)
	}
	v := base64.RawStdEncoding.EncodeToString(соль) + ":" +
		base64.RawStdEncoding.EncodeToString(ключ)
	_, err = s.DB().Exec(`INSERT INTO settings (k,v) VALUES ('password',?)
		ON CONFLICT(k) DO UPDATE SET v=excluded.v`, v)
	if err != nil {
		return fmt.Errorf("сохранить пароль: %w", err)
	}
	return nil
}

// Check сверяет пароль. Пока пароль не задан, внутрь не пускает никого.
func Check(s *store.Store, pass string) bool {
	var v string
	if err := s.DB().QueryRow(`SELECT v FROM settings WHERE k='password'`).Scan(&v); err != nil {
		return false
	}
	части := strings.SplitN(v, ":", 2)
	if len(части) != 2 {
		return false
	}
	соль, err := base64.RawStdEncoding.DecodeString(части[0])
	if err != nil {
		return false
	}
	эталон, err := base64.RawStdEncoding.DecodeString(части[1])
	if err != nil {
		return false
	}
	ключ, err := pbkdf2.Key(sha256.New, pass, соль, итераций, 32)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(ключ, эталон) == 1
}

// Cookie собирает куку вида «до-когда.подпись». Хранить в ней нечего, кроме
// срока: пользователь у панели один.
func Cookie(secret []byte, until time.Time) string {
	тело := strconv.FormatInt(until.Unix(), 10)
	return тело + "." + подписать(secret, тело)
}

// Valid проверяет подпись и срок. Подкрутить срок нельзя: подпись считается
// именно от него.
func Valid(secret []byte, cookie string) bool {
	тело, подпись, ok := strings.Cut(cookie, ".")
	if !ok {
		return false
	}
	if subtle.ConstantTimeCompare([]byte(подписать(secret, тело)), []byte(подпись)) != 1 {
		return false
	}
	до, err := strconv.ParseInt(тело, 10, 64)
	if err != nil {
		return false
	}
	return time.Now().Unix() < до
}

func подписать(secret []byte, тело string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(тело))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// Middleware закрывает всё, что за ним, живой кукой.
func Middleware(secret []byte, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("tessera")
		if err != nil || !Valid(secret, c.Value) {
			http.Error(w, "нужен вход", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
