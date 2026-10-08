# cashbid-widget
Cash bid embed widgets.

| Page | Files | What it is |
|---|---|---|
| [`example.html`](example.html) | `sg-cashbid-widget.js/.css` | Production cash bid table |
| [`index.html`](index.html) | `sg-cashbid-widget-dev.js/.css` | Dev cash bid table and tiles (sorting, grouping, settings, rounding, tile view) |
| [`cashbidquoteboard.html`](cashbidquoteboard.html) | `sg-quoteboard.js/.css` + dev widget, ticker, futures, weather | Drag-and-drop quote screen of cash bid, futures, weather, announcement and video/web embed panels |
| [`ticker.html`](ticker.html) | `sg-ticker.js/.css` | Standalone scrolling price ticker — demo, embed code and options |
| [`futures.html`](futures.html) | `sg-futures.js/.css` | Futures quotes table and ticker (Barchart OnDemand API key) — demo, embed code and options |
| [`announce.html`](announce.html) | `sg-announce.js/.css` | Announcements / ads widget (rotating slides, images, hosted JSON) — demo, format and options |
| [`embed.html`](embed.html) | `sg-embed.js/.css` | Video & web embed: IP cameras (MJPEG/snapshots), MP4, HLS, web pages, sandboxed custom HTML |
| [`weather.html`](weather.html) | `sg-weather.js/.css` | Standalone National Weather Service widget (U.S., no API key) — demo, embed code and options |

## Cash bid tiles

The dev widget (`sg-cashbid-widget-dev.js`) can show bids as tiles instead of a table: one card per bid with the cash price, change, delivery, basis and futures price.

```html
<div id="sg-cashbid-widget"
     data-json="https://stonegrain.agricharts.com/inc/cashbids/cashbids-json.php"
     data-view="tiles"
     data-tiles='[{"loc":"Main Elevator","com":"Corn","nearby":1},
                  {"loc":"Main Elevator","com":"Soybeans","start":"11/01/2026","end":"11/30/2026"}]'
     data-tile-size="m"></div>
```

- `"nearby": 1` is the nearest delivery (2 = second nearest…). It rolls forward on its own when a delivery period drops off the feed.
- `"start"` / `"end"` pin one exact delivery period, written as the feed writes it.
- With no `data-tiles`, the widget shows the nearest delivery of every commodity at every location.
- Viewers can switch Table/Tiles, add, remove and reorder tiles, and change the size in the ⚙ menu. Their choices are saved in their browser and override the site defaults until they press "Reset to site default".
- "Copy embed settings" in the ⚙ → Tiles menu copies the attributes for the current picks, so a site owner can set the tiles up by clicking and paste the result into the embed.
- On the quoteboard, choose **Show As → Tiles** when adding a Cash Bids panel, or switch any cash bid panel in its ⚙ menu.

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

## Futures embed

```html
<div data-sg-futures data-symbols="ZCZ26,ZSX26,ZWZ26"></div>
<div data-sg-futures-ticker data-symbols="ZCZ26,ZSX26,ZWZ26"></div>
<script src="https://cgermain45.github.io/cashbid-widget/sg-futures.js"></script>
```

Viewers enter a Barchart OnDemand API key inside the widget; it's kept in their browser (session, or "remember on this device") and isn't part of the embed code. A site owner can build a key in with `data-apikey`, but it's then visible in the page source. See `futures.html` for all options.
