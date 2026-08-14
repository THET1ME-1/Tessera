package api

import "github.com/THET1ME-1/Tessera/internal/blocks"

// Default — вкладки ядра. Ровно такие же раскладки приносят модули, поэтому
// ядро проверяет договор на себе: если блок неудобно описывать здесь, значит
// он неудобен и чужому плагину.
func Default() map[string][]blocks.Block {
	return map[string][]blocks.Block{
		"overview": {
			// Верхний ряд — состояние на сейчас, у каждой плитки своё окно и
			// разбивка по платформам.
			{Type: "stat", Title: "Онлайн сейчас", Span: 2, Src: "core:online"},
			{Type: "stat", Title: "Активны за сутки", Span: 2, Src: "core:active_24h"},
			{Type: "stat", Title: "Активны за неделю", Span: 2, Src: "core:active_7d"},
			{Type: "stat", Title: "Активны за месяц", Span: 2, Src: "core:active_30d"},
			{Type: "stat", Title: "Всего в панели", Span: 2, Src: "core:people_seen"},
			{Type: "stat", Title: "Новые за сутки", Span: 2, Src: "core:new_24h"},

			{Type: "columns", Title: "События по дням", Span: 8, Src: "core:events_daily"},
			{Type: "stat", Title: "Событий за период", Span: 4, Src: "core:events_total"},
			{Type: "raster", Title: "Экраны", Span: 7, Src: "core:screens"},
			{Type: "table", Title: "Действия", Span: 5, Src: "core:actions"},
		},
		"screens": {
			{Type: "raster", Title: "Все размеченные экраны", Span: 12, Src: "core:screens"},
			{Type: "table", Title: "Действия", Span: 6, Src: "core:actions"},
		},
		"people": {
			{Type: "stat", Title: "Активны за сутки", Span: 3, Src: "core:active_24h"},
			{Type: "stat", Title: "Активны за неделю", Span: 3, Src: "core:active_7d"},
			{Type: "stat", Title: "Новые за сутки", Span: 3, Src: "core:new_24h"},
			{Type: "stat", Title: "Новые за неделю", Span: 3, Src: "core:new_7d"},
			{Type: "columns", Title: "Люди по дням", Span: 12, Src: "core:people_daily"},
		},
	}
}
