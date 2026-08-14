package blocks

// Каталог — то, что ядро предлагает положить на вкладку. Панель показывает
// этот список в кнопке «добавить блок», рядом с тем, что предлагают модули.
//
// Заголовки живут здесь, а не в раскладке: человек, добавляющий блок, должен
// видеть «Активны за сутки», а не «core:active_24h». Переименовать блок у себя
// он сможет и потом.
func Каталог() []Block {
	return []Block{
		{Type: "stat", Title: "Онлайн сейчас", Span: 3, Src: "core:online"},
		{Type: "stat", Title: "Активны за сутки", Span: 3, Src: "core:active_24h"},
		{Type: "stat", Title: "Активны за неделю", Span: 3, Src: "core:active_7d"},
		{Type: "stat", Title: "Активны за месяц", Span: 3, Src: "core:active_30d"},
		{Type: "stat", Title: "Всего в панели", Span: 3, Src: "core:people_seen"},
		{Type: "stat", Title: "Новые за сутки", Span: 3, Src: "core:new_24h"},
		{Type: "stat", Title: "Новые за неделю", Span: 3, Src: "core:new_7d"},
		{Type: "stat", Title: "Событий за период", Span: 3, Src: "core:events_total"},
		{Type: "stat", Title: "Людей за период", Span: 3, Src: "core:people_total"},
		{Type: "columns", Title: "События по дням", Span: 12, Src: "core:events_daily"},
		{Type: "columns", Title: "Люди по дням", Span: 12, Src: "core:people_daily"},
		{Type: "raster", Title: "Экраны", Span: 7, Src: "core:screens"},
		{Type: "table", Title: "Действия", Span: 5, Src: "core:actions"},
	}
}
