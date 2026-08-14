//go:build tools

// Проба заливает события в живой сервер и меряет, сколько он их принимает.
//
// Работает в двух режимах. С флагом -file читает готовую выгрузку (json на
// строку) — так в панель попадают настоящие данные вместо выдуманных. Без
// файла шлёт придуманные события: это чистое измерение пропускной способности.
//
//	go run -tags tools ./tools -url http://localhost:8099 -key КЛЮЧ -file события.jsonl.gz
//	go run -tags tools ./tools -url http://localhost:8099 -key КЛЮЧ -n 200000
package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	url := flag.String("url", "http://localhost:8090", "адрес сервера")
	key := flag.String("key", "", "ключ приёма")
	app := flag.String("app", "app", "приложение")
	file := flag.String("file", "", "выгрузка событий: json на строку, можно .gz")
	n := flag.Int("n", 100000, "сколько придумать событий, если файла нет")
	пачка := flag.Int("batch", 1000, "по сколько событий в пачке")
	flag.Parse()

	if *key == "" {
		fmt.Println("нужен -key: сервер печатает его при первом запуске")
		os.Exit(1)
	}

	начало := time.Now()
	ушло := 0
	send := func(строки []string) {
		var b bytes.Buffer
		fmt.Fprintf(&b, `{"app":%q,"sdk":"проба","events":[%s]}`, *app, strings.Join(строки, ","))
		req, _ := http.NewRequest("POST", *url+"/i", &b)
		req.Header.Set("X-Tessera-Key", *key)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			fmt.Println("отправка не прошла:", err)
			os.Exit(1)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusAccepted {
			fmt.Println("сервер ответил", resp.Status)
			os.Exit(1)
		}
		ушло += len(строки)
		if ушло%100000 == 0 {
			fmt.Printf("  %d событий за %s\n", ушло, time.Since(начало).Round(time.Second))
		}
	}

	if *file != "" {
		f, err := os.Open(*file)
		if err != nil {
			fmt.Println("открыть выгрузку:", err)
			os.Exit(1)
		}
		defer f.Close()

		var r io.Reader = f
		if strings.HasSuffix(*file, ".gz") {
			zr, err := gzip.NewReader(f)
			if err != nil {
				fmt.Println("выгрузка не разжимается:", err)
				os.Exit(1)
			}
			defer zr.Close()
			r = zr
		}

		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		буфер := make([]string, 0, *пачка)
		for sc.Scan() {
			строка := strings.TrimSpace(sc.Text())
			if строка == "" {
				continue
			}
			буфер = append(буфер, строка)
			if len(буфер) >= *пачка {
				send(буфер)
				буфер = буфер[:0]
			}
		}
		if len(буфер) > 0 {
			send(буфер)
		}
		if err := sc.Err(); err != nil {
			fmt.Println("чтение выгрузки:", err)
			os.Exit(1)
		}
	} else {
		экраны := []string{"главная", "лента", "настройки", "профиль", "поиск"}
		буфер := make([]string, 0, *пачка)
		for i := range *n {
			буфер = append(буфер, fmt.Sprintf(
				`{"eid":"проба-%d","ts":%d,"kind":"screen","name":%q,"ms":%d,"platform":"android","version":"1.0.0"}`,
				i, time.Now().Unix(), экраны[i%len(экраны)], 500+i%9000))
			if len(буфер) >= *пачка {
				send(буфер)
				буфер = буфер[:0]
			}
		}
		if len(буфер) > 0 {
			send(буфер)
		}
	}

	прошло := time.Since(начало)
	fmt.Printf("отправлено %d событий за %s — %.0f в секунду\n",
		ушло, прошло.Round(time.Millisecond), float64(ушло)/прошло.Seconds())
}
