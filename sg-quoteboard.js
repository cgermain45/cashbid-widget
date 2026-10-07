(function () {
  /* ============================================================
     CASH BID QUOTEBOARD
     A grid of cash bid widgets you can add, drag, resize and remove.
     Requires sg-cashbid-widget-dev.js (window.SGCashBid).
     Weather panels need sg-weather.js (window.SGWeather) — optional.
     Futures panels need sg-futures.js (window.SGFutures) — optional.
     Announcement panels need sg-announce.js (window.SGAnnounce) — optional.
     Video / web embed panels need sg-embed.js (window.SGEmbed) — optional.
     ============================================================ */

  const root = document.getElementById("sg-quoteboard");
  if (!root || !window.SGCashBid) return;

  // Optional site-wide cash bid feed (data-json on #sg-quoteboard). When
  // it isn't set, Cash Bids panels ask for a feed URL the first time.
  const DEFAULT_FEED = (root.dataset.json || "").trim();

  const LAYOUT_KEY = "sg-qb-layout";
  const DEFAULT_TITLE = "Cash Bid Quoteboard";

  const THEMES = [
    { id: "floor", name: "Trading Floor", desc: "Slate and amber, monospace numbers",
      swatch: ["#0b0f14", "#1b2430", "#f5b301"] },
    { id: "modern", name: "Modern", desc: "Clean blue, rounded panels",
      swatch: ["#f1f5f9", "#ffffff", "#2563eb"] },
    { id: "harvest", name: "Harvest", desc: "Field green and wheat gold",
      swatch: ["#142019", "#d9a930", "#2f6b3a"] }
  ];
  const PREFS_KEY = "sg-qb-prefs";
  const PANEL_PREFIX = id => `sg-qb:${id}:`;

  /* Layout grid: 12 columns. Heights are in rows — in "Fit to screen"
     mode the board is always FIT_ROWS rows tall and fills the window;
     in scroll mode each row is SCROLL_ROW_PX and the board can grow. */
  const GRID_COLS = 12;
  const FIT_ROWS = 24;
  const MIN_SPAN = 3;
  const MIN_ROWS = 4;
  const MAX_SCROLL_ROWS = 60;
  const SCROLL_ROW_PX = 36;
  const MIN_ROW_PX = 18;      // grid row incl. gap; below this, fit mode lets the board scroll
  const STACK_BELOW_PX = 900; // narrower screens stack panels in one column

  const REFRESH_OPTIONS = [1, 5, 15, 30, 60];

  const instances = new Map(); // panel id → widget api
  let refreshTimer = null;

  /* ============================================================
     STORAGE
     ============================================================ */

  function readJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  /* Starter board: cash bids by location (left, full height), futures
     (asks for an API key) and weather (asks for a location). */
  function defaultLayout() {
    return [
      { id: newId(), type: "cashbids", title: "Cash Bids", json: rememberedFeed(),
        span: 6, rows: FIT_ROWS, groupBy: "location" },
      { id: newId(), type: "futures", title: "Futures", symbols: defaultSymbolList(),
        format: "decimal", span: 6, rows: FIT_ROWS / 2 },
      Object.assign({ id: newId(), type: "weather", title: "Weather", units: "us",
        span: 6, rows: FIT_ROWS / 2 }, rememberedLocation())
    ];
  }

  function rememberedFeed() {
    return prefs.cashFeed || DEFAULT_FEED || "";
  }

  function rememberedLocation() {
    return isFinite(prefs.weatherLat) && isFinite(prefs.weatherLon) && prefs.weatherLat !== null
      ? { lat: prefs.weatherLat, lon: prefs.weatherLon }
      : {};
  }

  function defaultSymbolList() {
    return window.SGFutures
      ? ["ZC", "ZS", "ZW"].flatMap(root => window.SGFutures.frontMonths(root, 2))
      : [];
  }

  const prefs = Object.assign(
    {
      theme: "dark",          // mode: dark | light
      style: "floor",         // theme: floor | modern | harvest
      accent: "",             // custom company colors ("" = theme default)
      barColor: "",
      title: DEFAULT_TITLE,
      refreshMin: 5,
      locked: false,
      ticker: true,
      futuresTicker: false,
      fit: true,
      cashFeed: "",           // last cash bid feed URL entered (reused by new panels)
      weatherLat: null,       // last weather location entered
      weatherLon: null
    },
    readJSON(PREFS_KEY, {})
  );

  let layout = readJSON(LAYOUT_KEY, null);
  if (!Array.isArray(layout)) layout = defaultLayout();

  // Older layouts stored pixel heights; convert them to grid rows
  layout.forEach(p => {
    if (!p.rows) {
      p.rows = Math.max(MIN_ROWS, Math.min(FIT_ROWS, Math.round((p.height || 480) / SCROLL_ROW_PX)));
    }
    delete p.height;
    p.span = Math.max(MIN_SPAN, Math.min(GRID_COLS, Number(p.span) || 6));
  });


  function saveLayout() {
    // groupBy is only a seed for new panels; the widget owns it afterwards
    writeJSON(LAYOUT_KEY, layout.map(p => {
      const base = { id: p.id, type: panelType(p), title: p.title, span: p.span, rows: p.rows };
      switch (panelType(p)) {
        case "weather": return Object.assign(base, { lat: p.lat, lon: p.lon, units: p.units });
        case "futures": return Object.assign(base, { symbols: p.symbols, format: p.format });
        case "embed": return Object.assign(base, {
          mode: p.mode || "auto", url: p.url || "", html: p.html || "", fit: p.fit || "contain", every: p.every || 2
        });
        case "announce": return Object.assign(base, {
          source: p.source || "local", feed: p.feed || "", slides: p.slides || [], interval: p.interval || 10
        });
        default: return Object.assign(base, { json: p.json });
      }
    }));
  }

  function panelType(p) {
    return ["weather", "futures", "announce", "embed"].includes(p.type) ? p.type : "cashbids";
  }

  function savePrefs() {
    writeJSON(PREFS_KEY, prefs);
  }

  function defaultFuturesSymbols() {
    if (!window.SGFutures) return "";
    return defaultSymbolList().join(", ");
  }

  function newId() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function clearPanelStorage(id) {
    const prefix = PANEL_PREFIX(id);
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(prefix))
        .forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /* ============================================================
     SHELL
     ============================================================ */

  root.classList.add("qb-root");

  root.innerHTML = `
    <header class="qb-topbar">
      <div class="qb-brand">
        <span class="qb-logo" aria-hidden="true"></span>
        <span class="qb-brand-name" title="Double-click to rename"></span>
      </div>

      <div class="qb-clock" aria-label="Current time">
        <span class="qb-clock-date"></span>
        <span class="qb-clock-time"></span>
      </div>

      <div class="qb-actions">
        <label class="qb-select">
          <span>Refresh</span>
          <select class="qb-refresh-interval" aria-label="Refresh interval">
            ${REFRESH_OPTIONS.map(m =>
              `<option value="${m}">${m} min</option>`).join("")}
          </select>
        </label>
        <button type="button" class="qb-btn qb-refresh-all" title="Refresh all panels">
          ⟳ <span class="qb-btn-label">Refresh</span>
        </button>
        <button type="button" class="qb-btn qb-toggle-ticker" aria-pressed="false" title="Show or hide the cash bid ticker">
          Cash Ticker
        </button>
        ${window.SGFutures ? `
        <button type="button" class="qb-btn qb-toggle-futures-ticker" aria-pressed="false" title="Show or hide the futures ticker">
          Futures Ticker
        </button>` : ""}
        <button type="button" class="qb-btn qb-toggle-fit" aria-pressed="true"
                title="Fit to screen: the board always fills the window with no scrolling. Turn off to let panels grow past the window.">
          <span class="qb-fit-icon" aria-hidden="true">⤢</span> <span class="qb-btn-label">Fit to screen</span>
        </button>
        <span class="qb-overfull-note" hidden title="There are more panels than fit at full size, so everything is scaled down. Make some panels smaller or turn off Fit to screen.">Scaled to fit</span>
        <div class="qb-appearance">
          <button type="button" class="qb-btn qb-appearance-btn" aria-expanded="false" aria-haspopup="true"
                  title="Theme and colors">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path fill="currentColor" d="M8 1a7 7 0 0 0 0 14c.9 0 1.5-.6 1.5-1.4 0-.4-.1-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.6-1.4 1.4-1.4H11.6A3.4 3.4 0 0 0 15 6.8C15 3.6 11.9 1 8 1Zm-4 7.2a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Zm2-3.4a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Zm4 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Zm2.4 2.5a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z"/>
            </svg>
            <span class="qb-btn-label">Appearance</span>
          </button>
          <div class="qb-appearance-panel" hidden role="dialog" aria-label="Appearance">
            <div>
              <p class="qb-ap-title">Theme</p>
              <div class="qb-theme-cards">
                ${THEMES.map(t => `
                  <label class="qb-theme-card">
                    <input type="radio" name="qb-style" value="${t.id}">
                    <span class="qb-theme-swatch" aria-hidden="true">${t.swatch.map(c => `<span style="background:${c}"></span>`).join("")}</span>
                    <span><span class="qb-theme-name">${t.name}</span><span class="qb-theme-desc">${t.desc}</span></span>
                  </label>`).join("")}
              </div>
            </div>
            <div>
              <p class="qb-ap-title">Mode</p>
              <div class="qb-segmented">
                <label><input type="radio" name="qb-mode" value="dark"> Dark</label>
                <label><input type="radio" name="qb-mode" value="light"> Light</label>
              </div>
            </div>
            <div>
              <p class="qb-ap-title">Company colors</p>
              <label class="qb-color-row">
                <span>Accent</span>
                <button type="button" class="qb-color-default" data-for="accent">Default</button>
                <input type="color" name="accent" aria-label="Accent color">
              </label>
              <label class="qb-color-row">
                <span>Top bar</span>
                <button type="button" class="qb-color-default" data-for="barColor">Default</button>
                <input type="color" name="barColor" aria-label="Top bar color">
              </label>
              <p class="qb-ap-note">Accent colors buttons, badges and highlights. Up/down prices stay green and red.</p>
            </div>
          </div>
        </div>
        <button type="button" class="qb-btn qb-reset" title="Reset to the default layout">
          Reset
        </button>
        <button type="button" class="qb-btn qb-btn-primary qb-add">
          + <span class="qb-btn-label">Add Panel</span>
        </button>
        <button type="button" class="qb-btn qb-toggle-lock" aria-pressed="false"
                title="Lock the layout and hide the toolbar">
          <span class="qb-lock-icon">🔓</span> <span class="qb-btn-label">Lock</span>
        </button>
      </div>
    </header>

    <div class="qb-ticker"></div>
    <div class="qb-ticker qb-ticker-futures" hidden></div>

    <main class="qb-board" aria-label="Quoteboard panels"></main>

    <dialog class="qb-dialog">
      <form method="dialog" class="qb-dialog-form">
        <h2>Add Panel</h2>
        <label>
          Panel Type
          <select name="type">
            <option value="cashbids">Cash Bids</option>
            ${window.SGFutures ? `<option value="futures">Futures quotes (Barchart OnDemand)</option>` : ""}
            ${window.SGWeather ? `<option value="weather">Weather (National Weather Service)</option>` : ""}
            ${window.SGAnnounce ? `<option value="announce">Announcements / ads</option>` : ""}
            ${window.SGEmbed ? `<option value="embed">Video / web embed (cameras, pages, HTML)</option>` : ""}
          </select>
        </label>
        <label>
          Title
          <input name="title" type="text" value="Cash Bids" required>
        </label>

        <fieldset class="qb-fields" data-type="cashbids">
          <label>
            Group By
            <select name="groupBy">
              <option value="location">Location</option>
              <option value="commodity">Commodity</option>
            </select>
          </label>
          <p class="qb-hint">Uses your saved cash bid feed. If there isn't one yet, the panel will ask for the URL.</p>
        </fieldset>

        <fieldset class="qb-fields" data-type="futures" hidden disabled>
          <label>
            Symbols
            <input name="symbols" type="text" required spellcheck="false" autocapitalize="characters"
                   value="${escapeHtml(defaultFuturesSymbols())}">
          </label>
          <label>
            Price Format
            <select name="format">
              <option value="decimal">Decimal (497.25)</option>
              <option value="fraction">Fraction (497'2)</option>
            </select>
          </label>
          <p class="qb-hint">Comma-separated contracts, e.g. ZCZ26 = Corn Dec 26. You'll enter your Barchart OnDemand API key inside the panel.</p>
        </fieldset>

        <fieldset class="qb-fields" data-type="embed" hidden disabled>
          <p class="qb-hint">Show a live camera (e.g. the truck scale), a video or .m3u8 stream, a web page, or custom HTML. Paste the address in the panel and it works out the type. Web pages and HTML run in a sandbox so they can't reach the board's saved settings.</p>
        </fieldset>

        <fieldset class="qb-fields" data-type="announce" hidden disabled>
          <p class="qb-hint">Rotating slides for messages and ads, with optional images. You'll write the slides in the panel, or point it at a hosted JSON file so several screens share the same slides.</p>
        </fieldset>

        <fieldset class="qb-fields" data-type="weather" hidden disabled>
          <label>
            Units
            <select name="units">
              <option value="us">°F, mph</option>
              <option value="si">°C, km/h</option>
            </select>
          </label>
          <p class="qb-hint">Uses your saved location, or the panel will ask for one (you can use your current location).</p>
        </fieldset>
        <label>
          Width
          <select name="span">
            <option value="3">Quarter</option>
            <option value="4">Third</option>
            <option value="6" selected>Half</option>
            <option value="8">Two-thirds</option>
            <option value="12">Full</option>
          </select>
        </label>
        <div class="qb-dialog-actions">
          <button type="button" class="qb-btn qb-dialog-cancel">Cancel</button>
          <button type="submit" class="qb-btn qb-btn-primary" value="add">Add</button>
        </div>
      </form>
    </dialog>
  `;

  const board = root.querySelector(".qb-board");
  const tickerEl = root.querySelector(".qb-ticker:not(.qb-ticker-futures)");
  const futuresTickerEl = root.querySelector(".qb-ticker-futures");
  const dialog = root.querySelector(".qb-dialog");

  /* ============================================================
     PANELS
     ============================================================ */

  function renderBoard() {
    instances.forEach(api => api.destroy());
    instances.clear();
    board.innerHTML = "";
    layout.forEach(p => board.appendChild(createPanel(p)));
    updateEmptyState();
    relayout();
  }

  function createPanel(p) {
    const el = document.createElement("section");
    el.className = "qb-panel qb-panel-" + panelType(p);
    el.dataset.id = p.id;

    el.innerHTML = `
      <header class="qb-panel-head">
        <span class="qb-grip" title="Drag to move" aria-hidden="true">⠿</span>
        <span class="qb-live" title="Waiting for data"></span>
        <h2 class="qb-panel-title" title="Double-click to rename">${escapeHtml(p.title)}</h2>
        <span class="qb-panel-time"></span>
        ${panelType(p) === "cashbids" ? `<button type="button" class="qb-icon-btn qb-panel-setup" title="Change feed URL" aria-label="Change cash bid feed URL for ${escapeHtml(p.title)}">🔗</button>` : ""}
        ${panelType(p) === "weather" ? `<button type="button" class="qb-icon-btn qb-panel-setup" title="Change location" aria-label="Change weather location for ${escapeHtml(p.title)}">📍</button>` : ""}
        ${panelType(p) === "announce" ? `<button type="button" class="qb-icon-btn qb-panel-setup" title="Edit announcements" aria-label="Edit ${escapeHtml(p.title)}">✏️</button>` : ""}
        ${panelType(p) === "embed" ? `<button type="button" class="qb-icon-btn qb-panel-setup" title="Edit what this panel shows" aria-label="Edit ${escapeHtml(p.title)}">✏️</button>` : ""}
        <button type="button" class="qb-icon-btn qb-panel-refresh" title="Refresh panel" aria-label="Refresh ${escapeHtml(p.title)}">⟳</button>
        <button type="button" class="qb-icon-btn qb-panel-close" title="Remove panel" aria-label="Remove ${escapeHtml(p.title)}">×</button>
      </header>
      <div class="qb-panel-body">
        <div class="qb-widget"></div>
      </div>
      <div class="qb-resize-edge qb-resize-e" data-axis="x" title="Drag to change width" aria-hidden="true"></div>
      <div class="qb-resize-edge qb-resize-s" data-axis="y" title="Drag to change height" aria-hidden="true"></div>
      <div class="qb-resize" data-axis="xy" title="Drag to resize" aria-hidden="true"></div>
    `;

    // Seed a new panel's grouping before the widget reads its settings
    if (p.groupBy) {
      try { localStorage.setItem(PANEL_PREFIX(p.id) + "sg-group-by", p.groupBy); } catch (e) { /* ignore */ }
      delete p.groupBy;
    }

    const widgetEl = el.querySelector(".qb-widget");
    const live = el.querySelector(".qb-live");
    const time = el.querySelector(".qb-panel-time");

    widgetEl.addEventListener("sg:updated", e => {
      live.className = "qb-live qb-live-ok qb-pulse";
      live.title = "Live";
      time.textContent = formatTime(e.detail.updated);
      time.title = "Last updated " + e.detail.updated.toLocaleString();
      setTimeout(() => live.classList.remove("qb-pulse"), 1200);
    });

    widgetEl.addEventListener("sg:error", () => {
      live.className = "qb-live qb-live-error";
      live.title = "Last refresh failed";
    });

    if (needsSetup(p)) renderSetup(p, el);
    else mountWidget(p, el);

    return el;
  }

  /* ---------- mount the panel's widget ---------- */

  function mountWidget(p, el) {
    const widgetEl = el.querySelector(".qb-widget");
    let api = null;
    if (panelType(p) === "futures") {
      api = window.SGFutures
        ? window.SGFutures.mount(widgetEl, {
            symbols: p.symbols,
            format: p.format,
            theme: "dark",
            refresh: 30,
            storagePrefix: PANEL_PREFIX(p.id),
            editable: true,
            // Optional board-wide settings on #sg-quoteboard
            apikey: root.dataset.futuresApikey || undefined,
            feed: root.dataset.futuresFeed || undefined
          })
        : null;
      if (!api) widgetEl.innerHTML = `<p class="qb-missing">Futures need sg-futures.js on this page.</p>`;

      // Symbols added/removed in the panel are saved with the layout
      widgetEl.addEventListener("sg:symbols", e => {
        p.symbols = e.detail.symbols;
        saveLayout();
        loadFuturesTicker();
      });
    } else if (panelType(p) === "embed") {
      api = window.SGEmbed
        ? window.SGEmbed.mount(widgetEl, {
            mode: p.mode,
            url: p.url,
            html: p.html,
            fit: p.fit,
            every: p.every,
            editable: true,
            theme: "dark"
          })
        : null;
      if (!api) widgetEl.innerHTML = `<p class="qb-missing">Embeds need sg-embed.js on this page.</p>`;

      if (api && !widgetEl.dataset.qbConfigBound) {
        widgetEl.dataset.qbConfigBound = "1";
        widgetEl.addEventListener("sg:config", e => {
          Object.assign(p, e.detail);
          saveLayout();
        });
      }
      if (api && p.openEditor) {
        delete p.openEditor;
        api.edit();
      }
    } else if (panelType(p) === "announce") {
      api = window.SGAnnounce
        ? window.SGAnnounce.mount(widgetEl, {
            source: p.source,
            feed: p.feed,
            slides: p.slides || [],
            interval: p.interval,
            editable: true,
            theme: "dark",
            refresh: 5
          })
        : null;
      if (!api) widgetEl.innerHTML = `<p class="qb-missing">Announcements need sg-announce.js on this page.</p>`;

      if (api && !widgetEl.dataset.qbConfigBound) {
        widgetEl.dataset.qbConfigBound = "1";
        widgetEl.addEventListener("sg:config", e => {
          Object.assign(p, e.detail);
          saveLayout();
        });
      }
      if (api && p.openEditor) {
        delete p.openEditor;
        api.edit();
      }
    } else if (panelType(p) === "weather") {
      api = window.SGWeather
        ? window.SGWeather.mount(widgetEl, {
            lat: p.lat,
            lon: p.lon,
            units: p.units,
            theme: "dark",
            refresh: 0
          })
        : null;
      if (!api) widgetEl.innerHTML = `<p class="qb-missing">Weather needs sg-weather.js on this page.</p>`;
    } else {
      api = window.SGCashBid.mount(widgetEl, {
        json: p.json,
        storagePrefix: PANEL_PREFIX(p.id),
        autoRefresh: false
      });
    }
    if (api) instances.set(p.id, api);
  }

  /* ============================================================
     PANEL SETUP — cash bid panels need a feed URL and weather panels
     need a location before they can load. Asked for inside the panel
     and remembered for the next panel of that type.
     ============================================================ */

  function needsSetup(p) {
    if (panelType(p) === "cashbids") return !p.json;
    if (panelType(p) === "weather") {
      return !(isFinite(p.lat) && isFinite(p.lon) && p.lat !== null && p.lon !== null);
    }
    return false;
  }

  function renderSetup(p, el, canCancel) {
    const widgetEl = el.querySelector(".qb-widget");
    const api = instances.get(p.id);
    if (api) api.destroy();
    instances.delete(p.id);

    const live = el.querySelector(".qb-live");
    live.className = "qb-live";
    live.title = "Needs setup";
    el.querySelector(".qb-panel-time").textContent = "";

    const isCash = panelType(p) === "cashbids";
    const loc = rememberedLocation();

    widgetEl.innerHTML = `
      <form class="qb-setup" novalidate>
        <h3>${isCash ? "Connect your cash bids" : "Set the weather location"}</h3>
        ${isCash ? `
          <label>
            Cash bid feed URL
            <input name="url" type="url" required spellcheck="false"
                   placeholder="https://yourcompany.agricharts.com/inc/cashbids/cashbids-json.php"
                   value="${escapeHtml(p.json || rememberedFeed())}">
          </label>
          <p class="qb-hint">The JSON address of your cash bid feed. It's saved on this device and used for new Cash Bids panels too.</p>
        ` : `
          <div class="qb-row">
            <label>
              Latitude
              <input name="lat" type="number" step="any" min="-90" max="90" required placeholder="41.5868"
                     value="${escapeHtml(p.lat ?? loc.lat ?? "")}">
            </label>
            <label>
              Longitude
              <input name="lon" type="number" step="any" min="-180" max="180" required placeholder="-93.6250"
                     value="${escapeHtml(p.lon ?? loc.lon ?? "")}">
            </label>
          </div>
          <button type="button" class="qb-btn qb-setup-geo">📍 Use my current location</button>
          <label>
            Units
            <select name="units">
              <option value="us"${p.units !== "si" ? " selected" : ""}>°F, mph</option>
              <option value="si"${p.units === "si" ? " selected" : ""}>°C, km/h</option>
            </select>
          </label>
          <p class="qb-hint">U.S. locations only (National Weather Service). Tip: right-click a spot in Google Maps to copy its coordinates.</p>
        `}
        <p class="qb-setup-msg" role="alert"></p>
        <div class="qb-setup-actions">
          ${canCancel ? `<button type="button" class="qb-btn qb-setup-cancel">Cancel</button>` : ""}
          <button type="submit" class="qb-btn qb-btn-primary">${isCash ? "Load bids" : "Show weather"}</button>
        </div>
      </form>`;

    const form = widgetEl.querySelector(".qb-setup");
    const msg = form.querySelector(".qb-setup-msg");
    const submit = form.querySelector("button[type=submit]");

    const cancel = form.querySelector(".qb-setup-cancel");
    if (cancel) cancel.addEventListener("click", () => {
      widgetEl.innerHTML = "";
      mountWidget(p, el);
    });

    const geo = form.querySelector(".qb-setup-geo");
    if (geo) geo.addEventListener("click", () => {
      if (!navigator.geolocation) {
        msg.textContent = "Location isn't available in this browser — enter coordinates instead.";
        return;
      }
      msg.textContent = "Finding your location…";
      navigator.geolocation.getCurrentPosition(
        pos => {
          form.elements.lat.value = pos.coords.latitude.toFixed(4);
          form.elements.lon.value = pos.coords.longitude.toFixed(4);
          msg.textContent = "";
          form.requestSubmit ? form.requestSubmit() : submit.click();
        },
        err => {
          msg.textContent = err.code === 1
            ? "Location permission was denied — enter coordinates instead."
            : "Couldn't get your location — enter coordinates instead.";
        },
        { timeout: 10000, maximumAge: 600000 }
      );
    });

    form.addEventListener("submit", e => {
      e.preventDefault();
      msg.textContent = "";

      if (!isCash) {
        const lat = Number(form.elements.lat.value);
        const lon = Number(form.elements.lon.value);
        if (form.elements.lat.value === "" || form.elements.lon.value === ""
            || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          msg.textContent = "Enter a latitude (-90 to 90) and longitude (-180 to 180), or use your current location.";
          return;
        }
        p.lat = Number(lat.toFixed(4));
        p.lon = Number(lon.toFixed(4));
        p.units = form.elements.units.value === "si" ? "si" : "us";
        prefs.weatherLat = p.lat;
        prefs.weatherLon = p.lon;
        savePrefs();
        saveLayout();
        widgetEl.innerHTML = "";
        mountWidget(p, el);
        return;
      }

      const url = form.elements.url.value.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) {
        msg.textContent = "Enter the full feed address, starting with https://";
        return;
      }

      // Check the URL really returns cash bids before saving it
      submit.disabled = true;
      submit.textContent = "Checking…";
      fetch(url, { cache: "no-cache" })
        .then(r => {
          if (!r.ok) throw new Error(`The feed returned an error (${r.status}).`);
          return r.json().catch(() => { throw new Error("That address didn't return cash bid data (JSON)."); });
        })
        .then(data => {
          if (!data || !Array.isArray(data.bids)) {
            throw new Error("That address didn't return cash bids — check that it's your cash bid JSON feed.");
          }
          p.json = url;
          prefs.cashFeed = url;
          savePrefs();
          saveLayout();
          widgetEl.innerHTML = "";
          mountWidget(p, el);
          loadTicker(true);
        })
        .catch(err => {
          submit.disabled = false;
          submit.textContent = "Load bids";
          msg.textContent = err instanceof TypeError
            ? "Couldn't load that address. Check the URL — the feed may also block access from this site."
            : err.message;
        });
    });

    const first = form.querySelector("input");
    if (first && !first.value) setTimeout(() => first.focus({ preventScroll: true }), 0);
  }


  function panelById(id) {
    return layout.find(p => p.id === id);
  }

  function addPanel(p) {
    p.rows = initialRows(p);
    layout.push(p);
    saveLayout();
    const el = createPanel(p);
    board.appendChild(el);
    updateEmptyState();
    relayout();
    loadTicker(true);
    loadFuturesTicker();
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function removePanel(id) {
    const api = instances.get(id);
    if (api) api.destroy();
    instances.delete(id);
    clearPanelStorage(id);
    layout = layout.filter(p => p.id !== id);
    saveLayout();
    const el = board.querySelector(`.qb-panel[data-id="${id}"]`);
    if (el) el.remove();
    updateEmptyState();
    relayout();
    loadTicker(true);
    loadFuturesTicker();
  }

  function updateEmptyState() {
    let empty = board.querySelector(".qb-empty");
    if (layout.length) {
      if (empty) empty.remove();
      return;
    }
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "qb-empty";
      empty.innerHTML = `
        <p>No panels on the board.</p>
        <button type="button" class="qb-btn qb-btn-primary qb-add">+ Add Panel</button>`;
      board.appendChild(empty);
    }
  }

  /* Header buttons + rename (delegated) */
  board.addEventListener("click", e => {
    const panel = e.target.closest(".qb-panel");

    if (e.target.closest(".qb-add")) {
      openAddDialog();
      return;
    }
    if (!panel) return;

    if (e.target.closest(".qb-panel-close") && !prefs.locked) {
      const p = panelById(panel.dataset.id);
      if (confirm(`Remove "${p ? p.title : "this panel"}"?`)) {
        removePanel(panel.dataset.id);
      }
    } else if (e.target.closest(".qb-panel-setup") && !prefs.locked) {
      const p = panelById(panel.dataset.id);
      if (p && (panelType(p) === "announce" || panelType(p) === "embed")) {
        const api = instances.get(p.id);
        if (api && api.edit) api.edit();
      } else if (p) {
        renderSetup(p, panel, !needsSetup(p));
      }
    } else if (e.target.closest(".qb-panel-refresh")) {
      const api = instances.get(panel.dataset.id);
      if (api) api.refresh();
    }
  });

  board.addEventListener("dblclick", e => {
    if (prefs.locked) return;
    const title = e.target.closest(".qb-panel-title");
    if (title) startRename(title);
  });

  function startRename(titleEl) {
    const panel = titleEl.closest(".qb-panel");
    const p = panelById(panel.dataset.id);
    const original = p.title;

    titleEl.contentEditable = "true";
    titleEl.focus();
    document.getSelection().selectAllChildren(titleEl);

    function finish(save) {
      titleEl.contentEditable = "false";
      titleEl.removeEventListener("keydown", onKey);
      titleEl.removeEventListener("blur", onBlur);
      const value = titleEl.textContent.trim();
      if (save && value) {
        p.title = value;
        saveLayout();
      }
      titleEl.textContent = p.title || original;
    }
    function onKey(e) {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
    }
    function onBlur() { finish(true); }

    titleEl.addEventListener("keydown", onKey);
    titleEl.addEventListener("blur", onBlur);
  }

  /* ============================================================
     LAYOUT ENGINE
     Panels are packed in order: each one goes to the highest spot
     where its width fits (leftmost on ties), so a panel sits directly
     under whatever is above it — no row gaps.
     ============================================================ */

  let lastRects = new Map(); // id → { left, top, width, height } in board px
  let metrics = null;        // { pad, gap, colU, rowU } — one grid cell incl. gap

  function pack(list) {
    const sky = new Array(GRID_COLS).fill(0);
    const pos = new Map();
    let bottom = 0;

    list.forEach(p => {
      const w = Math.max(MIN_SPAN, Math.min(GRID_COLS, p.span));
      const h = Math.max(MIN_ROWS, p.rows);
      let bestX = 0;
      let bestY = Infinity;
      for (let x = 0; x <= GRID_COLS - w; x++) {
        const y = Math.max(...sky.slice(x, x + w));
        if (y < bestY) { bestY = y; bestX = x; }
      }
      for (let c = bestX; c < bestX + w; c++) sky[c] = bestY + h;
      pos.set(p.id, { x: bestX, y: bestY, w, h });
      bottom = Math.max(bottom, bestY + h);
    });

    return { pos, bottom };
  }

  function isStacked() {
    return window.innerWidth < STACK_BELOW_PX;
  }

  function fitMode() {
    return prefs.fit && !isStacked();
  }

  /* Position every panel. dragId: that panel follows the pointer and
     the placeholder takes its slot instead. */
  function relayout(dragId) {
    const stacked = isStacked();
    const fit = fitMode();
    root.classList.toggle("qb-stacked", stacked);
    root.classList.toggle("qb-fit", fit);

    const panels = [...board.querySelectorAll(".qb-panel")];
    const overfullNote = root.querySelector(".qb-overfull-note");

    if (stacked) {
      // One column; panels keep a proportional height and the page scrolls
      panels.forEach(el => {
        const p = panelById(el.dataset.id);
        el.style.left = el.style.top = el.style.width = "";
        el.style.height = Math.max(280, Math.min(640, (p ? p.rows : 12) * 26)) + "px";
      });
      board.style.height = "";
      overfullNote.hidden = true;
      metrics = null;
      return;
    }

    const cs = getComputedStyle(board);
    const pad = parseFloat(cs.paddingLeft) || 0;
    const gap = parseFloat(cs.getPropertyValue("--qb-gap")) || 12;
    const { pos, bottom } = pack(layout);

    // One grid unit = cell + gap; a panel spanning n units is n*unit - gap
    const innerW = board.clientWidth - pad * 2;
    const colU = (innerW + gap) / GRID_COLS;

    let rows = Math.max(bottom, 1);
    let rowU = SCROLL_ROW_PX;
    let scaled = false;
    let grows = !fit;

    if (fit) {
      board.style.height = "";
      const innerH = board.clientHeight - pad * 2;
      rows = Math.max(FIT_ROWS, bottom);
      scaled = bottom > FIT_ROWS;
      rowU = (innerH + gap) / rows;
      if (rowU < MIN_ROW_PX) { rowU = MIN_ROW_PX; grows = true; } // very short window
    }

    board.style.height = grows ? (pad * 2 + bottom * rowU - gap) + "px" : "";

    overfullNote.hidden = !scaled;
    metrics = { pad, gap, colU, rowU };
    lastRects = new Map();

    pos.forEach((r, id) => {
      const rect = {
        left: pad + r.x * colU,
        top: pad + r.y * rowU,
        width: r.w * colU - gap,
        height: r.h * rowU - gap
      };
      lastRects.set(id, rect);

      const el = id === dragId
        ? board.querySelector(".qb-placeholder")
        : board.querySelector(`.qb-panel[data-id="${id}"]`);
      if (!el) return;
      el.style.left = rect.left + "px";
      el.style.top = rect.top + "px";
      el.style.width = rect.width + "px";
      el.style.height = rect.height + "px";
    });
  }

  /* New panels in fit mode: use free space if there is enough,
     otherwise make room by shortening the tallest panels in the
     columns the new panel lands in (never below MIN_KEEP_ROWS).
     Only if nothing can give way does the board scale down. */
  const MIN_KEEP_ROWS = 8;

  function initialRows(p) {
    let wanted = panelType(p) === "weather" ? 14 : 10;
    if (!prefs.fit) return wanted;

    for (let guard = 0; guard < 400; guard++) {
      const candidate = { id: "_new", span: p.span, rows: wanted };
      const { pos, bottom } = pack(layout.concat([candidate]));
      if (bottom <= FIT_ROWS) return wanted;

      const spot = pos.get("_new");
      const overlaps = x => {
        const r = pos.get(x.id);
        return r.x < spot.x + spot.w && spot.x < r.x + r.w;
      };
      const touchesBottom = x => {
        const r = pos.get(x.id);
        return r.y + r.h === bottom;
      };

      const giver = layout
        .filter(x => x.rows > MIN_KEEP_ROWS && (overlaps(x) || touchesBottom(x)))
        .sort((a, b) => b.rows - a.rows)[0];

      if (giver) { giver.rows--; continue; }
      if (wanted > MIN_ROWS) { wanted--; continue; }
      return wanted; // everything is at its minimum: board shows "Scaled to fit"
    }
    return MIN_ROWS;
  }

  // Re-fit when the window or the board's space changes
  let relayoutFrame = 0;
  function scheduleRelayout() {
    cancelAnimationFrame(relayoutFrame);
    relayoutFrame = requestAnimationFrame(() => relayout());
  }

  if (typeof ResizeObserver === "function") {
    new ResizeObserver(scheduleRelayout).observe(board);
  }
  window.addEventListener("resize", scheduleRelayout);

  /* ============================================================
     DRAG TO MOVE (pointer events — works with mouse and touch)
     The other panels reflow live while you drag.
     ============================================================ */

  board.addEventListener("pointerdown", e => {
    if (prefs.locked || e.button !== 0 || isStacked()) return;

    const head = e.target.closest(".qb-panel-head");
    if (head && !e.target.closest("button, [contenteditable='true']")) {
      startDrag(e, head.closest(".qb-panel"), head);
      return;
    }

    const handle = e.target.closest(".qb-resize, .qb-resize-edge");
    if (handle) startResize(e, handle.closest(".qb-panel"), handle);
  });

  function boardPoint(ev) {
    const r = board.getBoundingClientRect();
    return { x: ev.clientX - r.left + board.scrollLeft, y: ev.clientY - r.top + board.scrollTop };
  }

  /* Keep receiving pointer events for the whole gesture, even over
     iframes (video/web panels) or outside the window. */
  function capturePointer(el, e) {
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  function samePosition(a, b) {
    return a && b && a.x === b.x && a.y === b.y;
  }

  /* Where a panel would land (center, in board px) for a given order */
  function landingCenter(order, id) {
    const r = pack(order).pos.get(id);
    const { pad, gap, colU, rowU } = metrics;
    return {
      x: pad + r.x * colU + (r.w * colU - gap) / 2,
      y: pad + r.y * rowU + (r.h * rowU - gap) / 2
    };
  }

  function startDrag(e, panel, handle) {
    const id = panel.dataset.id;
    const start = boardPoint(e);
    const startLeft = parseFloat(panel.style.left) || 0;
    const startTop = parseFloat(panel.style.top) || 0;
    const width = parseFloat(panel.style.width) || panel.offsetWidth;
    const height = parseFloat(panel.style.height) || panel.offsetHeight;
    let placeholder = null;
    let dragging = false;
    let frame = 0;
    let lastPt = start;

    function begin() {
      dragging = true;
      capturePointer(handle, e);
      placeholder = document.createElement("div");
      placeholder.className = "qb-placeholder";
      board.appendChild(placeholder);
      panel.classList.add("qb-dragging");
      root.classList.add("qb-is-dragging");
      relayout(id);
    }

    /* Choose the order whose landing slot is nearest the dragged panel.
       Only switch when it's clearly better than the current slot, so
       panels don't flip back and forth while you move. */
    function evaluate() {
      frame = 0;
      if (!metrics) return;
      const cx = startLeft + (lastPt.x - start.x) + width / 2;
      const cy = startTop + (lastPt.y - start.y) + height / 2;
      const dragged = panelById(id);
      const rest = layout.filter(p => p.id !== id);
      const dist = order => {
        const c = landingCenter(order, id);
        return Math.hypot(c.x - cx, c.y - cy);
      };

      const current = dist(layout);
      let best = null;
      let bestDist = Infinity;
      for (let k = 0; k <= rest.length; k++) {
        const order = rest.slice(0, k).concat([dragged], rest.slice(k));
        const d = dist(order);
        if (d < bestDist) { bestDist = d; best = order; }
      }

      const deadZone = Math.max(36, Math.min(metrics.colU, metrics.rowU) * 2);
      if (best && bestDist < current - deadZone
          && best.map(p => p.id).join() !== layout.map(p => p.id).join()) {
        layout = best;
        relayout(id);
      }
    }

    function onMove(ev) {
      const pt = boardPoint(ev);
      if (!dragging) {
        if (Math.hypot(pt.x - start.x, pt.y - start.y) < 6) return;
        begin();
      }
      ev.preventDefault();
      lastPt = pt;
      panel.style.left = startLeft + (pt.x - start.x) + "px";
      panel.style.top = startTop + (pt.y - start.y) + "px";
      if (!frame) frame = requestAnimationFrame(evaluate);
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      cancelAnimationFrame(frame);
      if (!dragging) return;

      placeholder.remove();
      panel.classList.remove("qb-dragging");
      root.classList.remove("qb-is-dragging");
      relayout();
      saveLayout();
      loadTicker(true);
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  /* ============================================================
     RESIZE — corner (width + height), right edge (width) or bottom
     edge (height). Snaps to the grid. The panel being resized stays
     where it is; only neighbors reflow. In fit mode it can't grow
     past the bottom of the screen.
     ============================================================ */

  function startResize(e, panel, handle) {
    e.preventDefault();
    if (!metrics) return;
    capturePointer(handle, e);

    const axis = handle.dataset.axis || "xy";
    const p = panelById(panel.dataset.id);
    const start = boardPoint(e);
    const startW = parseFloat(panel.style.width) || 0;
    const startH = parseFloat(panel.style.height) || 0;
    const { colU, rowU, gap } = metrics;
    const limit = prefs.fit ? Math.max(FIT_ROWS, pack(layout).bottom) : MAX_SCROLL_ROWS;
    const home = pack(layout).pos.get(p.id);

    panel.classList.add("qb-resizing");
    root.classList.add("qb-is-resizing", "qb-resizing-" + axis);

    function ok(span, rows) {
      const trial = layout.map(x => (x.id === p.id ? { id: x.id, span, rows } : x));
      const res = pack(trial);
      return res.bottom <= limit && samePosition(res.pos.get(p.id), home);
    }

    function onMove(ev) {
      const pt = boardPoint(ev);
      let span = p.span;
      let rows = p.rows;
      if (axis !== "y") span = Math.round((startW + (pt.x - start.x) + gap) / colU);
      if (axis !== "x") rows = Math.round((startH + (pt.y - start.y) + gap) / rowU);
      span = Math.max(MIN_SPAN, Math.min(GRID_COLS - home.x, span));
      rows = Math.max(MIN_ROWS, Math.min(limit - home.y, rows));
      if (span === p.span && rows === p.rows) return;

      // Take the change if it fits; otherwise keep whichever dimension does
      if (ok(span, rows)) { /* both */ }
      else if (span !== p.span && ok(span, p.rows)) rows = p.rows;
      else if (rows !== p.rows && ok(p.span, rows)) span = p.span;
      else return;

      p.span = span;
      p.rows = rows;
      relayout();
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      panel.classList.remove("qb-resizing");
      root.classList.remove("qb-is-resizing", "qb-resizing-" + axis);
      saveLayout();
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  /* ============================================================
     TICKER
     The standalone ticker widget (sg-ticker.js), fed from the first
     panel's feed. The board drives its refresh.
     ============================================================ */

  let ticker = null;
  let tickerUrl = null;

  function loadTicker(onlyIfFeedChanged) {
    if (!prefs.ticker || !window.SGTicker) return;
    const first = layout.find(p => panelType(p) === "cashbids" && p.json);
    const url = (first && first.json) || DEFAULT_FEED;

    if (!url) {
      if (ticker) ticker.destroy();
      ticker = null;
      tickerUrl = null;
      tickerEl.innerHTML = `<p class="qb-ticker-hint">Cash bid ticker: connect a feed in a Cash Bids panel to see prices here.</p>`;
      return;
    }
    const hint = tickerEl.querySelector(".qb-ticker-hint");
    if (hint) hint.remove();

    if (ticker && tickerUrl === url) {
      if (!onlyIfFeedChanged) ticker.refresh();
      return;
    }

    if (ticker) ticker.destroy();
    tickerUrl = url;
    ticker = window.SGTicker.mount(tickerEl, { json: url, refresh: 0 });
  }

  /* ============================================================
     FUTURES TICKER
     sg-futures.js ticker showing every contract from the board's
     futures panels (or the front corn/soy/wheat months if there are
     none). It refreshes itself every 30 seconds and shares the
     futures API key with the panels.
     ============================================================ */

  let futuresTicker = null;
  let futuresTickerKey = null;

  function futuresTickerSymbols() {
    const seen = new Set();
    layout.filter(p => panelType(p) === "futures")
      .forEach(p => (p.symbols || []).forEach(sym => seen.add(String(sym).toUpperCase())));
    return seen.size ? [...seen] : defaultFuturesSymbols().split(/[\s,]+/).filter(Boolean);
  }

  function loadFuturesTicker(forceRefresh) {
    if (!window.SGFutures) return;

    if (!prefs.futuresTicker) {
      // Stop polling while hidden
      if (futuresTicker) futuresTicker.destroy();
      futuresTicker = null;
      futuresTickerKey = null;
      return;
    }

    const symbols = futuresTickerSymbols();
    const key = symbols.join(",");

    if (futuresTicker && futuresTickerKey === key) {
      if (forceRefresh) futuresTicker.refresh();
      return;
    }

    if (futuresTicker) futuresTicker.destroy();
    futuresTickerKey = key;
    futuresTicker = window.SGFutures.mountTicker(futuresTickerEl, {
      symbols,
      refresh: 30,
      apikey: root.dataset.futuresApikey || undefined,
      feed: root.dataset.futuresFeed || undefined
    });
  }

  /* ============================================================
     TOOLBAR
     ============================================================ */

  const intervalSelect = root.querySelector(".qb-refresh-interval");
  const lockBtn = root.querySelector(".qb-toggle-lock");
  const fitBtn = root.querySelector(".qb-toggle-fit");
  const tickerBtn = root.querySelector(".qb-toggle-ticker");
  const futuresTickerBtn = root.querySelector(".qb-toggle-futures-ticker");

  function applyPrefs() {
    const html = document.documentElement;
    html.dataset.theme = prefs.theme;
    html.dataset.qbStyle = THEMES.some(t => t.id === prefs.style) ? prefs.style : "floor";
    root.dataset.theme = prefs.theme;
    applyColors();
    applyTitle();

    intervalSelect.value = String(prefs.refreshMin);

    root.classList.toggle("qb-locked", prefs.locked);
    fitBtn.setAttribute("aria-pressed", String(prefs.fit));
    fitBtn.querySelector(".qb-btn-label").textContent = prefs.fit ? "Fit to screen" : "Scrolling";
    lockBtn.setAttribute("aria-pressed", String(prefs.locked));
    lockBtn.querySelector(".qb-lock-icon").textContent = prefs.locked ? "🔒" : "🔓";
    lockBtn.querySelector(".qb-btn-label").textContent = prefs.locked ? "Locked" : "Lock";
    lockBtn.title = prefs.locked
      ? "Locked — click to unlock the layout and show the toolbar"
      : "Lock the layout and hide the toolbar";
    if (prefs.locked) closeAppearance();

    tickerEl.hidden = !prefs.ticker || !window.SGTicker;
    tickerBtn.setAttribute("aria-pressed", String(prefs.ticker));

    futuresTickerEl.hidden = !prefs.futuresTicker || !window.SGFutures;
    if (futuresTickerBtn) futuresTickerBtn.setAttribute("aria-pressed", String(prefs.futuresTicker));
  }

  function refreshAll() {
    // { auto: true } lets weather panels skip refreshes they don't need
    instances.forEach(api => api.refresh({ auto: true }));
    loadTicker();
  }

  function refreshAllNow() {
    refreshAll();
    loadFuturesTicker(true);
  }

  function scheduleRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshAll, prefs.refreshMin * 60 * 1000);
  }

  intervalSelect.addEventListener("change", () => {
    prefs.refreshMin = Number(intervalSelect.value) || 5;
    savePrefs();
    scheduleRefresh();
  });

  root.querySelector(".qb-refresh-all").addEventListener("click", refreshAllNow);

  fitBtn.addEventListener("click", () => {
    prefs.fit = !prefs.fit;
    savePrefs();
    applyPrefs();
    relayout();
  });

  lockBtn.addEventListener("click", () => {
    prefs.locked = !prefs.locked;
    savePrefs();
    applyPrefs();
  });

  tickerBtn.addEventListener("click", () => {
    prefs.ticker = !prefs.ticker;
    savePrefs();
    applyPrefs();
    if (prefs.ticker) loadTicker();
  });

  if (futuresTickerBtn) futuresTickerBtn.addEventListener("click", () => {
    prefs.futuresTicker = !prefs.futuresTicker;
    savePrefs();
    applyPrefs();
    loadFuturesTicker();
  });


  root.querySelector(".qb-reset").addEventListener("click", () => {
    if (!confirm("Reset the board to the default layout? Panel settings will be cleared.")) return;
    layout.forEach(p => clearPanelStorage(p.id));
    layout = defaultLayout();
    saveLayout();
    renderBoard();
    loadTicker();
    loadFuturesTicker();
  });

  root.querySelector(".qb-topbar .qb-add").addEventListener("click", openAddDialog);

  /* Add panel dialog */

  const dialogForm = dialog.querySelector("form");

  function setDialogType(type) {
    dialogForm.querySelectorAll(".qb-fields").forEach(fs => {
      const on = fs.dataset.type === type;
      fs.hidden = !on;
      fs.disabled = !on;   // disabled fieldsets skip validation and FormData
    });
    const title = dialogForm.elements.title;
    if (!title.dataset.touched) {
      title.value = { weather: "Weather", futures: "Futures", announce: "Announcements", embed: "Live Camera" }[type] || "Cash Bids";
    }
    if (!dialogForm.elements.span.dataset.touched) {
      dialogForm.elements.span.value = { weather: "4", futures: "6", announce: "6", embed: "6" }[type] || "6";
    }
  }

  dialogForm.elements.type.addEventListener("change", e => setDialogType(e.target.value));
  dialogForm.elements.title.addEventListener("input", e => { e.target.dataset.touched = "1"; });
  dialogForm.elements.span.addEventListener("change", e => { e.target.dataset.touched = "1"; });

  function openAddDialog() {
    const form = dialogForm;
    form.reset();
    // Front-month defaults move with the calendar
    form.elements.symbols.value = defaultFuturesSymbols();
    delete form.elements.title.dataset.touched;
    delete form.elements.span.dataset.touched;
    setDialogType("cashbids");
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      // Very old browsers: fall back to a quick default panel
      addPanel({ id: newId(), type: "cashbids", title: "Cash Bids", json: rememberedFeed(), span: 6 });
    }
  }

  dialog.querySelector(".qb-dialog-cancel").addEventListener("click", () => dialog.close());

  dialog.querySelector("form").addEventListener("submit", e => {
    const form = e.target;
    const data = new FormData(form);

    if (data.get("type") === "embed") {
      addPanel({
        id: newId(),
        type: "embed",
        title: String(data.get("title") || "Live Camera").trim(),
        mode: "auto",
        url: "",
        html: "",
        fit: "contain",
        span: Number(data.get("span")) || 6,
        openEditor: true
      });
      return;
    }

    if (data.get("type") === "announce") {
      addPanel({
        id: newId(),
        type: "announce",
        title: String(data.get("title") || "Announcements").trim(),
        source: "local",
        slides: [],
        interval: 10,
        span: Number(data.get("span")) || 6,
        openEditor: true
      });
      return;
    }

    if (data.get("type") === "futures") {
      const symbols = String(data.get("symbols") || "")
        .split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
      addPanel({
        id: newId(),
        type: "futures",
        title: String(data.get("title") || "Futures").trim(),
        symbols,
        format: data.get("format") === "fraction" ? "fraction" : "decimal",
        span: Number(data.get("span")) || 6
      });
      return;
    }

    if (data.get("type") === "weather") {
      addPanel({
        id: newId(),
        type: "weather",
        title: String(data.get("title") || "Weather").trim(),
        units: data.get("units") === "si" ? "si" : "us",
        ...rememberedLocation(),
        span: Number(data.get("span")) || 4
      });
      return;
    }

    addPanel({
      id: newId(),
      type: "cashbids",
      title: String(data.get("title") || "Cash Bids").trim(),
      json: rememberedFeed(),
      span: Number(data.get("span")) || 6,
      groupBy: data.get("groupBy") === "commodity" ? "commodity" : "location"
    });
  });

  /* ============================================================
     APPEARANCE — theme, mode and company colors
     ============================================================ */

  const appearanceBtn = root.querySelector(".qb-appearance-btn");
  const appearancePanel = root.querySelector(".qb-appearance-panel");

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // WCAG relative luminance → pick readable text for a background
  function inkFor(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const [r, g, b] = rgb.map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return L > 0.36 ? "#111827" : "#ffffff";
  }

  function applyColors() {
    const st = document.documentElement.style;
    const accent = hexToRgb(prefs.accent) ? prefs.accent : "";
    const bar = hexToRgb(prefs.barColor) ? prefs.barColor : "";

    if (accent) {
      st.setProperty("--qb-accent", accent);
      st.setProperty("--qb-accent-ink", inkFor(accent));
    } else {
      st.removeProperty("--qb-accent");
      st.removeProperty("--qb-accent-ink");
    }

    if (bar) {
      const ink = inkFor(bar);
      st.setProperty("--qb-bar-bg", bar);
      st.setProperty("--qb-bar-text", ink);
      st.setProperty("--qb-bar-muted", ink === "#ffffff" ? "rgba(255,255,255,.72)" : "rgba(17,24,39,.68)");
    } else {
      ["--qb-bar-bg", "--qb-bar-text", "--qb-bar-muted"].forEach(v => st.removeProperty(v));
    }
  }

  function toHex(color) {
    // getComputedStyle gives "#rrggbb" for our tokens; normalise rgb() just in case
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
    if (m) return "#" + [m[1], m[2], m[3]].map(v => Number(v).toString(16).padStart(2, "0")).join("");
    return /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : "#000000";
  }

  function syncAppearanceForm() {
    appearancePanel.querySelectorAll('input[name="qb-style"]').forEach(r => { r.checked = r.value === document.documentElement.dataset.qbStyle; });
    appearancePanel.querySelectorAll('input[name="qb-mode"]').forEach(r => { r.checked = r.value === prefs.theme; });

    const cs = getComputedStyle(document.documentElement);
    const topbar = root.querySelector(".qb-topbar");
    appearancePanel.querySelector('input[name="accent"]').value = toHex(cs.getPropertyValue("--qb-accent"));
    appearancePanel.querySelector('input[name="barColor"]').value = toHex(getComputedStyle(topbar).backgroundColor);
    appearancePanel.querySelectorAll(".qb-color-default").forEach(b => { b.hidden = !prefs[b.dataset.for]; });
  }

  function openAppearance() {
    syncAppearanceForm();
    appearancePanel.hidden = false;
    appearanceBtn.setAttribute("aria-expanded", "true");
  }

  function closeAppearance() {
    appearancePanel.hidden = true;
    appearanceBtn.setAttribute("aria-expanded", "false");
  }

  appearanceBtn.addEventListener("click", () => {
    if (appearancePanel.hidden) openAppearance(); else closeAppearance();
  });

  document.addEventListener("click", e => {
    if (!appearancePanel.hidden && !e.composedPath().includes(root.querySelector(".qb-appearance"))) closeAppearance();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !appearancePanel.hidden) {
      closeAppearance();
      appearanceBtn.focus();
    }
  });

  appearancePanel.addEventListener("change", e => {
    const t = e.target;
    if (t.name === "qb-style") prefs.style = t.value;
    else if (t.name === "qb-mode") prefs.theme = t.value;
    else return;
    savePrefs();
    applyPrefs();
    syncAppearanceForm(); // color pickers show the new theme's defaults
  });

  // Live preview while dragging the color picker; save on change
  appearancePanel.addEventListener("input", e => {
    const t = e.target;
    if (t.type !== "color") return;
    prefs[t.name] = t.value;
    applyColors();
    appearancePanel.querySelector(`.qb-color-default[data-for="${t.name}"]`).hidden = false;
  });

  appearancePanel.addEventListener("change", e => {
    if (e.target.type === "color") savePrefs();
  });

  appearancePanel.querySelectorAll(".qb-color-default").forEach(btn => btn.addEventListener("click", e => {
    e.preventDefault(); // the button sits inside a <label>
    prefs[btn.dataset.for] = "";
    savePrefs();
    applyColors();
    syncAppearanceForm();
  }));

  /* ============================================================
     BOARD TITLE — double-click to rename
     ============================================================ */

  const brandName = root.querySelector(".qb-brand-name");

  function applyTitle() {
    const title = (prefs.title || "").trim() || DEFAULT_TITLE;
    if (brandName.contentEditable !== "true") brandName.textContent = title;
    document.title = title;
  }

  brandName.addEventListener("dblclick", () => {
    if (prefs.locked) return;
    const original = prefs.title || DEFAULT_TITLE;

    brandName.contentEditable = "true";
    brandName.focus();
    document.getSelection().selectAllChildren(brandName);

    function finish(save) {
      brandName.contentEditable = "false";
      brandName.removeEventListener("keydown", onKey);
      brandName.removeEventListener("blur", onBlur);
      const value = brandName.textContent.replace(/\s+/g, " ").trim().slice(0, 80);
      prefs.title = save ? (value || DEFAULT_TITLE) : original;
      savePrefs();
      applyTitle();
    }
    function onKey(e) {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
    }
    function onBlur() { finish(true); }

    brandName.addEventListener("keydown", onKey);
    brandName.addEventListener("blur", onBlur);
  });

  /* ============================================================
     CLOCK
     ============================================================ */

  const clockDate = root.querySelector(".qb-clock-date");
  const clockTime = root.querySelector(".qb-clock-time");

  function formatTime(d) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function tick() {
    const now = new Date();
    clockDate.textContent = now.toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric"
    });
    clockTime.textContent = formatTime(now);
  }

  /* ============================================================
     START
     ============================================================ */

  applyPrefs();
  renderBoard();
  saveLayout();
  loadTicker();
  loadFuturesTicker();
  scheduleRefresh();
  tick();
  setInterval(tick, 1000);

})();
