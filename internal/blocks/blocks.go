// Пакет blocks держит договор между панелью и теми, кто даёт ей данные.
//
// Панель умеет десять заготовок и не знает, кто именно их наполняет: ядро,
// модуль дохода или чужой плагин — для неё это адрес вида «владелец:ключ».
// Ядро рисует себя тем же способом, что достаётся модулям, поэтому договор
// проверяется на себе с первого дня, а не выясняется на третьем плагине.
package blocks

// Block — то, что панель получает в раскладке вкладки.
type Block struct {
	Type  string `json:"type"`  // заготовка: stat, columns, raster, table, map, funnel, heat, shelf, list, note
	Title string `json:"title"` // заголовок панели
	Span  int    `json:"span"`  // ширина в колонках двенадцатиколоночной сетки
	Src   string `json:"src"`   // адрес данных, «владелец:ключ»
	Unit  string `json:"unit,omitempty"`
}

// Source отдаёт данные одного блока за диапазон дней включительно.
type Source func(app, from, to string) (any, error)

// ── формы данных под каждую заготовку ────────────────────────────────────────

type Part struct {
	V     float64 `json:"v"`
	Style string  `json:"style,omitempty"` // пусто — сплошной, "hatch" — штриховка
}

type Item struct {
	Label string `json:"label"`
	Parts []Part `json:"parts"`
}

type ColumnsData struct {
	Items []Item `json:"items"`
	Unit  string `json:"unit"`
}

type Row struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
}

type RasterData struct {
	Rows      []Row   `json:"rows"`
	Unit      float64 `json:"unit"`      // сколько величины в одном кусочке
	UnitLabel string  `json:"unitLabel"` // как подписать кусочек
}

type StatData struct {
	Value float64   `json:"value"`
	Sub   string    `json:"sub"`
	Spark []float64 `json:"spark,omitempty"`
}

type TableData struct {
	Cols   []string `json:"cols"`
	Rows   [][]any  `json:"rows"`
	BarCol int      `json:"barCol"` // по какой колонке рисовать полосу
}
