package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/THET1ME-1/Tessera/internal/store"
)

func базаДляВхода(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestПарольПроверяется(t *testing.T) {
	s := базаДляВхода(t)
	if err := SetPassword(s, "секрет"); err != nil {
		t.Fatal(err)
	}
	if !Check(s, "секрет") {
		t.Fatal("верный пароль отвергнут")
	}
	if Check(s, "не секрет") {
		t.Fatal("неверный пароль принят")
	}
}

func TestБезЗаданногоПароляВходЗакрыт(t *testing.T) {
	if Check(базаДляВхода(t), "") {
		t.Fatal("пустая установка пустила внутрь")
	}
}

func TestКукаПодписанаИПротухает(t *testing.T) {
	секрет := []byte("ключ подписи")
	свежая := Cookie(секрет, time.Now().Add(time.Hour))
	if !Valid(секрет, свежая) {
		t.Fatal("свежая кука отвергнута")
	}
	старая := Cookie(секрет, time.Now().Add(-time.Minute))
	if Valid(секрет, старая) {
		t.Fatal("протухшая кука принята")
	}
	if Valid([]byte("чужой ключ"), свежая) {
		t.Fatal("кука принята с чужой подписью")
	}
	if Valid(секрет, "мусор") {
		t.Fatal("мусор принят за куку")
	}
}

func TestСрокКукиНельзяПодкрутить(t *testing.T) {
	секрет := []byte("ключ подписи")
	кука := Cookie(секрет, time.Now().Add(-time.Hour))
	подпись := кука[len(кука)-43:]
	// Пытаемся выдать протухшую куку за свежую, оставив подпись как была.
	подделка := "9999999999." + подпись
	if Valid(секрет, подделка) {
		t.Fatal("срок подкручен, а подпись всё ещё сошлась")
	}
}

func TestСтражПускаетТолькоСКукой(t *testing.T) {
	секрет := []byte("ключ подписи")
	за := Middleware(секрет, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("внутри"))
	}))

	rec := httptest.NewRecorder()
	за.ServeHTTP(rec, httptest.NewRequest("GET", "/api/что-нибудь", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("без куки код %d, ждали 401", rec.Code)
	}

	req := httptest.NewRequest("GET", "/api/что-нибудь", nil)
	req.AddCookie(&http.Cookie{Name: "tessera", Value: Cookie(секрет, time.Now().Add(time.Hour))})
	rec = httptest.NewRecorder()
	за.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("с кукой код %d, ждали 200", rec.Code)
	}
}
