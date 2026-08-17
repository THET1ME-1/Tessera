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
	// Ranged — блок считается за выбранный период, а не отдаётся готовым.
	// Ядро в этом случае спрашивает модуль заново, передавая границы `from` и
	// `to`. Без этого переключатель «7 дней / 30 дней / всё время» не менял на
	// вкладке дохода ни одного числа: сбор идёт командой `collect`, где
	// периода нет, — кнопки жались, сумма оставалась месячной.
	Ranged bool `json:"ranged,omitempty"`
	// Live — период обновления живого блока («20s»). Такой блок не берётся из
	// собранного расписанием: онлайн, посчитанный полчаса назад, — это вчерашняя
	// погода. Панель спрашивает его напрямую и потом переспрашивает по таймеру,
	// перерисовывая только себя: прокрутка и открытые ленты остаются на месте.
	Live string `json:"live,omitempty"`
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
	Format    string  `json:"format,omitempty"`
	Unit      float64 `json:"unit"`      // сколько величины в одном кусочке
	UnitLabel string  `json:"unitLabel"` // как подписать кусочек
}

type StatData struct {
	Value float64 `json:"value"`
	Sub   string  `json:"sub"`
	// Format — как показывать число: пусто (штуки), "money" (два знака и знак
	// валюты), "hours". Панель не догадывается сама: 355 и 355,59 $ — разные
	// вещи, а по самому числу их не различить.
	Format string    `json:"format,omitempty"`
	Spark  []float64 `json:"spark,omitempty"`
	// Parts — разбивка под числом: платформы, источники, что угодно. Панель
	// рисует их мелкой строкой, поэтому больше трёх-четырёх класть незачем.
	Parts []Row `json:"parts,omitempty"`
	// Delta — прирост к прошлому такому же отрезку, в процентах. Пусто, когда
	// сравнивать не с чем: показывать «+0%» на пустоте нечестно.
	Delta *float64 `json:"delta,omitempty"`
}

// HeroData — главный блок вкладки: крупное число с пояснением и график под
// ним. Отдельная форма нужна потому, что герой — это не плитка и не столбики,
// а именно они вместе: число объясняет график, график объясняет число.
type HeroData struct {
	Value  float64  `json:"value"`
	Title  string   `json:"title"`
	Sub    string   `json:"sub"`
	Format string   `json:"format,omitempty"`
	Delta  *float64 `json:"delta,omitempty"`
	Note   string   `json:"note,omitempty"`   // приписка мелким у графика
	Legend []string `json:"legend,omitempty"` // подписи частей столбика
	Items  []Item   `json:"items"`
	Unit   string   `json:"unit"`
}

type TableData struct {
	Cols   []string `json:"cols"`
	Format string   `json:"format,omitempty"`
	Rows   [][]any  `json:"rows"`
	BarCol int      `json:"barCol"` // по какой колонке рисовать полосу
}
