package store

import (
	"path/filepath"
	"testing"
)

// Сводки считают count(DISTINCT) и оконные функции, а под них SQLite строит
// временные B-деревья. По умолчанию они уезжают файлами в /var/tmp: на проде
// это давало пятнадцать мегабайт записи в секунду на пустом месте, потому что
// пересчёт идёт каждую минуту.
func TestБазаДержитСортировкиВПамяти(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	var режим int
	if err := s.DB().QueryRow("PRAGMA temp_store").Scan(&режим); err != nil {
		t.Fatal(err)
	}
	if режим != 2 {
		t.Fatalf("temp_store=%d, ждали 2 (память)", режим)
	}
}

// Кэш страниц по умолчанию — два мегабайта. Для базы на несколько гигабайт это
// значит, что один и тот же индекс перечитывается с диска на каждом пересчёте.
func TestКэшаХватаетНаСводки(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	var кэш int
	if err := s.DB().QueryRow("PRAGMA cache_size").Scan(&кэш); err != nil {
		t.Fatal(err)
	}
	// Отрицательное значение SQLite читает как килобайты.
	if кэш > -131072 {
		t.Fatalf("cache_size=%d, ждали не меньше 128 МБ (-131072)", кэш)
	}
}
