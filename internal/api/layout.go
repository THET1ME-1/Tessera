package api

import "github.com/THET1ME-1/Tessera/internal/blocks"

// Default — вкладки ядра. Ровно такие же раскладки приносят модули, поэтому
// ядро проверяет договор на себе: если блок неудобно описывать здесь, значит
// он неудобен и чужому плагину.
func Default() map[string][]blocks.Block {
	return map[string][]blocks.Block{
		"overview": {
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
			{Type: "stat", Title: "Людей за период", Span: 4, Src: "core:people_total"},
			{Type: "columns", Title: "Люди по дням", Span: 8, Src: "core:people_daily"},
		},
	}
}
