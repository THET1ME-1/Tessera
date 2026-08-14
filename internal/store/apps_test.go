package store

import "testing"

func TestКлючОткрываетСвоёПриложение(t *testing.T) {
	s := открыть(t)
	key, err := s.CreateApp("togetherly", "Togetherly")
	if err != nil {
		t.Fatal(err)
	}
	if len(key) < 24 {
		t.Fatalf("ключ короткий: %q", key)
	}
	id, err := s.AppByKey(key)
	if err != nil || id != "togetherly" {
		t.Fatalf("по ключу нашли %q, err=%v", id, err)
	}
	if _, err := s.AppByKey("чужой"); err == nil {
		t.Fatal("чужой ключ принят")
	}
}

func TestДваПриложенияПолучаютРазныеКлючи(t *testing.T) {
	s := открыть(t)
	k1, err := s.CreateApp("togetherly", "Togetherly")
	if err != nil {
		t.Fatal(err)
	}
	k2, err := s.CreateApp("kadr", "Kadr")
	if err != nil {
		t.Fatal(err)
	}
	if k1 == k2 {
		t.Fatal("ключи совпали")
	}
	apps, err := s.Apps()
	if err != nil || len(apps) != 2 {
		t.Fatalf("приложений %d, err=%v", len(apps), err)
	}
}
