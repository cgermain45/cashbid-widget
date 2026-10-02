# cashbid-widget
Cash bid embed widgets.

| Page | Files | What it is |
|---|---|---|
| [`example.html`](example.html) | `sg-cashbid-widget.js/.css` | Production cash bid table |
| [`index.html`](index.html) | `sg-cashbid-widget-dev.js/.css` | Dev cash bid table (sorting, grouping, settings, rounding) |
| [`quoteboard.html`](quoteboard.html) | `sg-quoteboard.js/.css` + dev widget + ticker | Drag-and-drop quote screen of multiple widgets |
| [`ticker.html`](ticker.html) | `sg-ticker.js/.css` | Standalone scrolling price ticker — demo, embed code and options |

## Ticker embed

```html
<link rel="stylesheet" href="https://cgermain45.github.io/cashbid-widget/sg-ticker.css">
<div data-sg-ticker
     data-json="https://stonegrain.agricharts.com/inc/cashbids/cashbids-json.php"></div>
<script src="https://cgermain45.github.io/cashbid-widget/sg-ticker.js"></script>
```

See `ticker.html` for all options.
