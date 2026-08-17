package modules

import (
	"database/sql"
	"fmt"
	"log"
	"path/filepath"
	"time"
)

// СобратьВсе обходит модули, запускает у каждого сбор и кладёт ответы в базу.
//
// Зовут это двое: расписание раз в двадцать минут и кнопка «обновить» в
// панели. Раньше сбор жил в main и панели был недоступен — человек видел
// числа получасовой давности и не мог ничего с этим сделать, а по числам
// денег такая задержка читается как ошибка в расчётах.
//
// Пустой `только` означает «все модули»; иначе собирается один, названный по
// id: обновляя вкладку дохода, незачем гонять модерацию с её обходом ленты.
func СобратьВсе(db *sql.DB, dir, только string) error {
	ms, err := Load(dir)
	if err != nil {
		return fmt.Errorf("список модулей: %w", err)
	}
	var последняя error
	собрано := 0
	for _, m := range ms {
		if только != "" && m.ID != только {
			continue
		}
		данные, err := Collect(m, filepath.Join(dir, m.ID))
		if err != nil {
			// Упавший модуль не повод останавливать остальные и уж тем более
			// не повод ронять панель.
			log.Printf("%v", err)
			последняя = err
			continue
		}
		now := time.Now().Unix()
		for ключ, значение := range данные {
			if _, err := db.Exec(`INSERT INTO module_data (module,key,json,updated)
				VALUES (?,?,?,?) ON CONFLICT(module,key)
				DO UPDATE SET json=excluded.json, updated=excluded.updated`,
				m.ID, ключ, string(значение), now); err != nil {
				log.Printf("сохранить данные модуля %s: %v", m.ID, err)
				последняя = err
			}
		}
		// Что модуль считает лучше ядра — записываем в настройки. Читать
		// манифесты из пакета блоков нельзя (он сам импортируется модулями),
		// а так блок берёт объявление из базы и остаётся ни от кого не
		// зависимым.
		for величина, ключ := range m.Provides {
			if _, err := db.Exec(`INSERT INTO settings (k,v) VALUES (?,?)
				ON CONFLICT(k) DO UPDATE SET v=excluded.v`,
				"provides."+величина, m.ID+":"+ключ); err != nil {
				log.Printf("объявление модуля %s: %v", m.ID, err)
				последняя = err
			}
		}
		собрано++
	}
	if собрано == 0 && только != "" {
		return fmt.Errorf("модуля %q нет", только)
	}
	return последняя
}
