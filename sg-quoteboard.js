(function () {
  /* ============================================================
     CASH BID QUOTEBOARD
     A grid of cash bid widgets you can add, drag, resize and remove.
     Requires sg-cashbid-widget-dev.js (window.SGCashBid).
     ============================================================ */

  const root = document.getElementById("sg-quoteboard");
  if (!root || !window.SGCashBid) return;

  const DEFAULT_FEED =
    root.dataset.json ||
    "https://stonegrain.agricharts.com/inc/cashbids/cashbids-json.php";

  const LAYOUT_KEY = "sg-qb-layout";
  const PREFS_KEY = "sg-qb-prefs";
  const PANEL_PREFIX = id => `sg-qb:${id}:`;

  const GRID_COLS = 12;
  const MIN_SPAN = 3;
  const MIN_HEIGHT = 180;
  const MAX_HEIGHT = 1600;

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

  function defaultLayout() {
    return [
      { id: newId(), title: "Bids by Location", json: DEFAULT_FEED, span: 6, height: 520, groupBy: "location" },
      { id: newId(), title: "Bids by Commodity", json: DEFAULT_FEED, span: 6, height: 520, groupBy: "commodity" }
    ];
  }

  let layout = readJSON(LAYOUT_KEY, null);
  if (!Array.isArray(layout)) layout = defaultLayout();

  const prefs = Object.assign(
    { theme: "dark", refreshMin: 5, locked: false, ticker: true },
    readJSON(PREFS_KEY, {})
  );

  function saveLayout() {
    // groupBy is only a seed for new panels; the widget owns it afterwards
    writeJSON(LAYOUT_KEY, layout.map(({ id, title, json, span, height }) =>
      ({ id, title, json, span, height })));
  }

  function savePrefs() {
    writeJSON(PREFS_KEY, prefs);
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
        <span class="qb-brand-name">Cash Bid Quoteboard</span>
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
        <button type="button" class="qb-btn qb-toggle-ticker" aria-pressed="false" title="Show or hide the ticker">
          Ticker
        </button>
        <button type="button" class="qb-btn qb-toggle-lock" aria-pressed="false" title="Lock layout">
          <span class="qb-lock-icon">🔓</span> <span class="qb-btn-label">Unlocked</span>
        </button>
        <button type="button" class="qb-btn qb-toggle-theme" title="Switch light/dark" aria-label="Switch light/dark theme">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <path d="M8 1.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor"/>
          </svg>
        </button>
        <button type="button" class="qb-btn qb-reset" title="Reset to the default layout">
          Reset
        </button>
        <button type="button" class="qb-btn qb-btn-primary qb-add">
          + <span class="qb-btn-label">Add Panel</span>
        </button>
      </div>
    </header>

    <div class="qb-ticker"></div>

    <main class="qb-board" aria-label="Quoteboard panels"></main>

    <dialog class="qb-dialog">
      <form method="dialog" class="qb-dialog-form">
        <h2>Add Panel</h2>
        <label>
          Title
          <input name="title" type="text" value="Cash Bids" required>
        </label>
        <label>
          Feed URL
          <input name="json" type="url" value="${escapeHtml(DEFAULT_FEED)}" required>
        </label>
        <label>
          Group By
          <select name="groupBy">
            <option value="location">Location</option>
            <option value="commodity">Commodity</option>
          </select>
        </label>
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
  const tickerEl = root.querySelector(".qb-ticker");
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
  }

  function createPanel(p) {
    const el = document.createElement("section");
    el.className = "qb-panel";
    el.dataset.id = p.id;
    applySize(el, p);

    el.innerHTML = `
      <header class="qb-panel-head">
        <span class="qb-grip" title="Drag to move" aria-hidden="true">⠿</span>
        <span class="qb-live" title="Waiting for data"></span>
        <h2 class="qb-panel-title" title="Double-click to rename">${escapeHtml(p.title)}</h2>
        <span class="qb-panel-time"></span>
        <button type="button" class="qb-icon-btn qb-panel-refresh" title="Refresh panel" aria-label="Refresh ${escapeHtml(p.title)}">⟳</button>
        <button type="button" class="qb-icon-btn qb-panel-close" title="Remove panel" aria-label="Remove ${escapeHtml(p.title)}">×</button>
      </header>
      <div class="qb-panel-body">
        <div class="qb-widget"></div>
      </div>
      <div class="qb-resize" title="Drag to resize" aria-hidden="true"></div>
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

    const api = window.SGCashBid.mount(widgetEl, {
      json: p.json,
      storagePrefix: PANEL_PREFIX(p.id),
      autoRefresh: false
    });
    instances.set(p.id, api);

    return el;
  }

  function applySize(el, p) {
    el.style.setProperty("--qb-span", p.span);
    el.style.setProperty("--qb-height", p.height + "px");
  }

  function panelById(id) {
    return layout.find(p => p.id === id);
  }

  function addPanel(p) {
    layout.push(p);
    saveLayout();
    const el = createPanel(p);
    board.appendChild(el);
    updateEmptyState();
    loadTicker(true);
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
    loadTicker(true);
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

    if (e.target.closest(".qb-panel-close")) {
      const p = panelById(panel.dataset.id);
      if (confirm(`Remove "${p ? p.title : "this panel"}"?`)) {
        removePanel(panel.dataset.id);
      }
    } else if (e.target.closest(".qb-panel-refresh")) {
      const api = instances.get(panel.dataset.id);
      if (api) api.refresh();
    }
  });

  board.addEventListener("dblclick", e => {
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
     DRAG TO MOVE (pointer events — works with mouse and touch)
     ============================================================ */

  board.addEventListener("pointerdown", e => {
    if (prefs.locked || e.button !== 0) return;

    const head = e.target.closest(".qb-panel-head");
    if (head && !e.target.closest("button, [contenteditable='true']")) {
      startDrag(e, head.closest(".qb-panel"));
      return;
    }

    const handle = e.target.closest(".qb-resize");
    if (handle) startResize(e, handle.closest(".qb-panel"));
  });

  function startDrag(e, panel) {
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;
    let placeholder = null;
    let dragging = false;

    function begin() {
      dragging = true;
      placeholder = document.createElement("div");
      placeholder.className = "qb-placeholder";
      placeholder.style.setProperty("--qb-span", panel.style.getPropertyValue("--qb-span"));
      placeholder.style.setProperty("--qb-height", rect.height + "px");
      panel.after(placeholder);

      panel.classList.add("qb-dragging");
      panel.style.width = rect.width + "px";
      panel.style.height = rect.height + "px";
      root.classList.add("qb-is-dragging");
    }

    function onMove(ev) {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        begin();
      }
      ev.preventDefault();
      panel.style.left = ev.clientX - offsetX + "px";
      panel.style.top = ev.clientY - offsetY + "px";

      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const over = target && target.closest(".qb-panel:not(.qb-dragging)");
      if (!over || !board.contains(over)) return;

      const r = over.getBoundingClientRect();
      // Same row → decide by horizontal midpoint, otherwise vertical
      const sameRow = ev.clientY > r.top && ev.clientY < r.bottom;
      const before = sameRow
        ? ev.clientX < r.left + r.width / 2
        : ev.clientY < r.top + r.height / 2;

      if (before) {
        if (over.previousElementSibling !== placeholder) over.before(placeholder);
      } else if (over.nextElementSibling !== placeholder) {
        over.after(placeholder);
      }
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      if (!dragging) return;

      placeholder.replaceWith(panel);
      panel.classList.remove("qb-dragging");
      panel.style.left = panel.style.top = panel.style.width = panel.style.height = "";
      root.classList.remove("qb-is-dragging");

      const order = [...board.querySelectorAll(".qb-panel")].map(el => el.dataset.id);
      layout.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      saveLayout();
      loadTicker(true);
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  /* ============================================================
     RESIZE (width snaps to the 12-column grid, height is free)
     ============================================================ */

  function startResize(e, panel) {
    e.preventDefault();
    const p = panelById(panel.dataset.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const startRect = panel.getBoundingClientRect();

    const styles = getComputedStyle(board);
    const gap = parseFloat(styles.columnGap) || 0;
    const colWidth = (board.clientWidth - parseFloat(styles.paddingLeft) -
      parseFloat(styles.paddingRight) - gap * (GRID_COLS - 1)) / GRID_COLS;

    panel.classList.add("qb-resizing");
    root.classList.add("qb-is-resizing");

    function onMove(ev) {
      const width = startRect.width + (ev.clientX - startX);
      const span = Math.round((width + gap) / (colWidth + gap));
      p.span = Math.max(MIN_SPAN, Math.min(GRID_COLS, span));
      p.height = Math.round(Math.max(MIN_HEIGHT,
        Math.min(MAX_HEIGHT, startRect.height + (ev.clientY - startY))));
      applySize(panel, p);
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      panel.classList.remove("qb-resizing");
      root.classList.remove("qb-is-resizing");
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
    const url = (layout[0] && layout[0].json) || DEFAULT_FEED;

    if (ticker && tickerUrl === url) {
      if (!onlyIfFeedChanged) ticker.refresh();
      return;
    }

    if (ticker) ticker.destroy();
    tickerUrl = url;
    ticker = window.SGTicker.mount(tickerEl, { json: url, refresh: 0 });
  }

  /* ============================================================
     TOOLBAR
     ============================================================ */

  const intervalSelect = root.querySelector(".qb-refresh-interval");
  const lockBtn = root.querySelector(".qb-toggle-lock");
  const tickerBtn = root.querySelector(".qb-toggle-ticker");

  function applyPrefs() {
    document.documentElement.dataset.theme = prefs.theme;
    root.dataset.theme = prefs.theme;

    intervalSelect.value = String(prefs.refreshMin);

    root.classList.toggle("qb-locked", prefs.locked);
    lockBtn.setAttribute("aria-pressed", String(prefs.locked));
    lockBtn.querySelector(".qb-lock-icon").textContent = prefs.locked ? "🔒" : "🔓";
    lockBtn.querySelector(".qb-btn-label").textContent = prefs.locked ? "Locked" : "Unlocked";

    tickerEl.hidden = !prefs.ticker || !window.SGTicker;
    tickerBtn.setAttribute("aria-pressed", String(prefs.ticker));
  }

  function refreshAll() {
    instances.forEach(api => api.refresh());
    loadTicker();
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

  root.querySelector(".qb-refresh-all").addEventListener("click", refreshAll);

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

  root.querySelector(".qb-toggle-theme").addEventListener("click", () => {
    prefs.theme = prefs.theme === "dark" ? "light" : "dark";
    savePrefs();
    applyPrefs();
  });

  root.querySelector(".qb-reset").addEventListener("click", () => {
    if (!confirm("Reset the board to the default layout? Panel settings will be cleared.")) return;
    layout.forEach(p => clearPanelStorage(p.id));
    layout = defaultLayout();
    saveLayout();
    renderBoard();
    loadTicker();
  });

  root.querySelector(".qb-topbar .qb-add").addEventListener("click", openAddDialog);

  /* Add panel dialog */

  function openAddDialog() {
    const form = dialog.querySelector("form");
    form.reset();
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      // Very old browsers: fall back to a quick default panel
      addPanel({ id: newId(), title: "Cash Bids", json: DEFAULT_FEED, span: 6, height: 480 });
    }
  }

  dialog.querySelector(".qb-dialog-cancel").addEventListener("click", () => dialog.close());

  dialog.querySelector("form").addEventListener("submit", e => {
    const form = e.target;
    const data = new FormData(form);
    addPanel({
      id: newId(),
      title: String(data.get("title") || "Cash Bids").trim(),
      json: String(data.get("json") || DEFAULT_FEED).trim(),
      span: Number(data.get("span")) || 6,
      height: 480,
      groupBy: data.get("groupBy") === "commodity" ? "commodity" : "location"
    });
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
  scheduleRefresh();
  tick();
  setInterval(tick, 1000);

})();
