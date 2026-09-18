package modules

import "testing"

// Модуль показывается только своим приложениям: у Wallet нет ни одного файла
// на модерацию, и вкладке «Модерация» в его панели делать нечего.
func TestForApp(t *testing.T) {
	общий := Manifest{ID: "core"}
	свой := Manifest{ID: "moderation", Apps: []string{"app"}}

	if !общий.ForApp("wallet") || !общий.ForApp("app") {
		t.Fatal("модуль без списка приложений показывается всем")
	}
	if !свой.ForApp("app") {
		t.Fatal("свой модуль обязан показываться своему приложению")
	}
	if свой.ForApp("wallet") {
		t.Fatal("чужому приложению модуль не показывается")
	}
}
