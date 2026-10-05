# cashbid-widget
Cash bid embed widgets.

| Page | Files | What it is |
|---|---|---|
| [`example.html`](example.html) | `sg-cashbid-widget.js/.css` | Production cash bid table |
| [`index.html`](index.html) | `sg-cashbid-widget-dev.js/.css` | Dev cash bid table (sorting, grouping, settings, rounding) |
| [`quoteboard.html`](quoteboard.html) | `sg-quoteboard.js/.css` + dev widget, ticker, weather | Drag-and-drop quote screen of cash bid and weather panels |
| [`ticker.html`](ticker.html) | `sg-ticker.js/.css` | Standalone scrolling price ticker — demo, embed code and options |
| [`weather.html`](weather.html) | `sg-weather.js/.css` | Standalone National Weather Service widget (U.S., no API key) — demo, embed code and options |

## Ticker embed

```html
<link rel="stylesheet" href="https://cgermain45.github.io/cashbid-widget/sg-ticker.css">
<div data-sg-ticker
     data-json="https://stonegrain.agricharts.com/inc/cashbids/cashbids-json.php"></div>
<script src="https://cgermain45.github.io/cashbid-widget/sg-ticker.js"></script>
```

See `ticker.html` for all options.

## Weather embed

```html
<div data-sg-weather data-lat="41.5868" data-lon="-93.6250"></div>
<script src="https://cgermain45.github.io/cashbid-widget/sg-weather.js"></script>
```

See `weather.html` for all options. Data from [api.weather.gov](https://www.weather.gov/documentation/services-web-api) (public domain, free for commercial use).
