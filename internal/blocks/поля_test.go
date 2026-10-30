package blocks

import (
	"encoding/json"
	"strings"
	"testing"
)

// Карточка «Доход» рисует сумму месяца, источники и прошлый месяц разом, а
// модуль отдаёт их отдельными ключами: блок просит недостающие полем with.
// Значок и подпись под заголовком модуль тоже задаёт сам. Раскладка идёт к
// панели через Block, и всё, чего в структуре нет, по дороге теряется молча.
func TestБлокНесётДопИсточникиЗначокИПодпись(t *testing.T) {
	var b Block
	манифест := `{"type":"periods","title":"Доход","span":7,"src":"income:month",
		"icon":"coin","sub":"что купили и где","with":{"today":"income:today"}}`
	if err := json.Unmarshal([]byte(манифест), &b); err != nil {
		t.Fatal(err)
	}
	обратно, _ := json.Marshal(b)
	for _, нужно := range []string{`"icon":"coin"`, `"sub":"что купили и где"`, `"with":{"today":"income:today"}`} {
		if !strings.Contains(string(обратно), нужно) {
			t.Fatalf("потерялось %s: %s", нужно, обратно)
		}
	}
}
