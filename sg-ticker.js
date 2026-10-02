(function () {
  /* ============================================================
     CASH BID TICKER — standalone scrolling price ticker
     ------------------------------------------------------------
     Embed:
       <link rel="stylesheet" href="sg-ticker.css">
       <div data-sg-ticker
            data-json="https://.../cashbids-json.php"></div>
       <script src="sg-ticker.js"></script>

     Optional attributes (all data-*):
       label        Badge text on the left ("Cash Bids"); "" hides it
       theme        dark | light | none (inherit your site's colors)
       speed        Scroll speed in pixels per second (default 50)
       refresh      Minutes between refreshes (default 5, 0 = off)
       show         nearest (one per location + commodity) | all
       locations    Comma list of location names to include
       commodities  Comma list of commodity names to include
       show-location  true | false (default true)
       show-change    true | false (default true)
       show-delivery  true | false (default true)
       link         URL to open when an item is clicked

     JavaScript:
       SGTicker.mount(el, { json, speed, ... })  → { refresh, destroy }
     ============================================================ */

  const DEFAULT_FEED =
    "https://stonegrain.agricharts.com/inc/cashbids/cashbids-json.php";

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  /* ============================================================
     HELPERS (same rules as the cash bid widget)
     ============================================================ */

  function parseNum(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    const str = String(v).trim();
    if (/^unch/i.test(str)) return 0;
    const cleaned = str.replace(/[^0-9.+-]/g, "");
    if (!cleaned) return NaN;
    return parseFloat(cleaned);
  }

  /* bid.rounding is a round-up threshold on the fraction of a cent;
     -1 (or missing/invalid) leaves the price as provided. */
  function roundCashPrice(bid) {
    const raw = bid.cashprice;
    if (raw === null || raw === undefined || raw === "") return "-";

    const threshold = parseNum(bid.rounding);
    const price = parseNum(raw);
    if (isNaN(price) || isNaN(threshold) || threshold < 0 || threshold > 1) {
      return String(raw);
    }

    const sign = price < 0 ? -1 : 1;
    const cents = Math.round(Math.abs(price) * 100 * 1e6) / 1e6;
    const whole = Math.floor(cents);
    const frac = Math.round((cents - whole) * 1e6) / 1e6;
    const rounded = frac > 0 && frac >= threshold ? whole + 1 : whole;

    return (sign * rounded / 100).toFixed(2);
  }

  function parseDate(d) {
    if (!d) return null;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
    const date = new Date(m ? `${m[3]}-${m[1]}-${m[2]}T00:00:00` : d);
    return isNaN(date) ? null : date;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function toList(v) {
    if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
    if (!v) return [];
    return String(v).split(",").map(s => s.trim()).filter(Boolean);
  }

  function toBool(v, fallback) {
    if (v === undefined || v === null || v === "") return fallback;
    if (typeof v === "boolean") return v;
    return !/^(false|0|no|off)$/i.test(String(v));
  }

  /* ============================================================
     TICKER INSTANCE
     ============================================================ */

  function mount(el, options) {
    if (!el) return null;
    if (el.sgTicker) return el.sgTicker;

    const d = el.dataset;
    const o = options || {};
    const pick = (key, dataKey) => (o[key] !== undefined ? o[key] : d[dataKey || key]);

    const cfg = {
      json: pick("json") || DEFAULT_FEED,
      label: pick("label") !== undefined ? String(pick("label")) : "Cash Bids",
      theme: pick("theme") || "dark",
      speed: Math.max(5, Number(pick("speed")) || 50),
      refresh: pick("refresh") !== undefined && pick("refresh") !== ""
        ? Math.max(0, Number(pick("refresh")) || 0)
        : 5,
      show: pick("show") === "all" ? "all" : "nearest",
      locations: toList(pick("locations")),
      commodities: toList(pick("commodities")),
      showLocation: toBool(pick("showLocation"), true),
      showChange: toBool(pick("showChange"), true),
      showDelivery: toBool(pick("showDelivery"), true),
      link: pick("link") || ""
    };

    el.classList.add("sgt", "sgt-theme-" + cfg.theme);
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", (cfg.label || "Cash bid") + " ticker");

    el.innerHTML = `
      ${cfg.label ? `<div class="sgt-label">${escapeHtml(cfg.label)}</div>` : ""}
      <div class="sgt-viewport">
        <div class="sgt-track"><span class="sgt-item sgt-muted">Loading cash bids…</span></div>
      </div>
      <button type="button" class="sgt-toggle" aria-label="Pause ticker" title="Pause">
        <span class="sgt-icon-pause" aria-hidden="true"></span>
      </button>
    `;

    const viewport = el.querySelector(".sgt-viewport");
    const track = el.querySelector(".sgt-track");
    const toggle = el.querySelector(".sgt-toggle");

    let prices = new Map();       // key → last cash price, for flashing
    let timer = null;
    let paused = false;
    let lastUpdated = null;

    /* ---------- data ---------- */

    function load() {
      return fetch(cfg.json, { cache: "no-cache" })
        .then(r => {
          if (!r.ok) throw new Error("Cash bid data unavailable");
          return r.json();
        })
        .then(data => {
          if (!data || !Array.isArray(data.bids)) throw new Error("Invalid cash bid format");
          lastUpdated = new Date();
          render(data.bids);
          el.dispatchEvent(new CustomEvent("sg:updated", { detail: { updated: lastUpdated } }));
        })
        .catch(err => {
          console.error("Ticker load failed:", err);
          if (!lastUpdated) {
            track.innerHTML = `<span class="sgt-item sgt-muted">Cash bids unavailable</span>`;
            track.classList.remove("sgt-moving");
          }
          el.dispatchEvent(new CustomEvent("sg:error", { detail: err }));
        });
    }

    function selectBids(locations) {
      const locFilter = cfg.locations.map(s => s.toLowerCase());
      const comFilter = cfg.commodities.map(s => s.toLowerCase());
      const out = [];

      locations.forEach(loc => {
        if (locFilter.length && !locFilter.includes(String(loc.name).toLowerCase())) return;

        const bids = (loc.cashbids || []).filter(bid =>
          !comFilter.length || comFilter.includes(String(bid.name).toLowerCase()));

        if (cfg.show === "all") {
          bids.forEach(bid => out.push({ loc, bid }));
          return;
        }

        // Nearest delivery per commodity
        const best = new Map();
        bids.forEach(bid => {
          const t = (parseDate(bid.delivery_start_raw) || { getTime: () => Infinity }).getTime();
          const cur = best.get(bid.name);
          if (!cur || t < cur.t) best.set(bid.name, { t, bid });
        });
        best.forEach(({ bid }) => out.push({ loc, bid }));
      });

      return out;
    }

    function render(locations) {
      const rows = selectBids(locations);

      if (!rows.length) {
        track.innerHTML = `<span class="sgt-item sgt-muted">No cash bids</span>`;
        track.classList.remove("sgt-moving");
        prices = new Map();
        return;
      }

      const next = new Map();
      const tag = cfg.link ? "a" : "span";
      const href = cfg.link ? ` href="${escapeHtml(cfg.link)}"` : "";

      const items = rows.map(({ loc, bid }) => {
        const key = [loc.name, bid.name, bid.delivery_start_raw].join("|");
        const cash = roundCashPrice(bid);
        const cashNum = parseNum(cash);
        next.set(key, cashNum);

        const before = prices.get(key);
        const flash = before !== undefined && !isNaN(before) && !isNaN(cashNum) && before !== cashNum
          ? (cashNum > before ? " sgt-flash-up" : " sgt-flash-down")
          : "";

        const changeRaw = bid.futures_change ?? bid.change;
        const change = parseNum(changeRaw);
        const dir = isNaN(change) ? "" : change > 0 ? "up" : change < 0 ? "down" : "flat";
        const arrow = { up: "▲", down: "▼", flat: "▬" }[dir] || "";
        const dirWord = { up: "up", down: "down", flat: "unchanged" }[dir] || "";

        const start = parseDate(bid.delivery_start_raw);
        const month = cfg.showDelivery && start ? " " + MONTHS[start.getMonth()] : "";

        return `
          <${tag} class="sgt-item${flash}"${href}>
            ${cfg.showLocation ? `<span class="sgt-loc">${escapeHtml(loc.name)}</span>` : ""}
            <span class="sgt-sym">${escapeHtml(bid.name)}${month}</span>
            <span class="sgt-px">${escapeHtml(cash)}</span>
            ${cfg.showChange && changeRaw !== undefined && changeRaw !== null && changeRaw !== ""
              ? `<span class="sgt-chg sgt-${dir}"><span aria-hidden="true">${arrow}</span><span class="sgt-sr">${dirWord}</span> ${escapeHtml(changeRaw)}</span>`
              : ""}
          </${tag}>`;
      }).join("");

      prices = next;

      // Two copies so the loop is seamless; the copy is hidden from screen readers
      track.innerHTML =
        `<div class="sgt-run">${items}</div>` +
        `<div class="sgt-run" aria-hidden="true">${items.replace(/<a /g, '<a tabindex="-1" ')}</div>`;

      if (lastUpdated) {
        el.title = "Last updated " + lastUpdated.toLocaleString();
      }

      setSpeed();
    }

    /* Keep a constant pixels-per-second speed regardless of content length */
    function setSpeed() {
      const run = track.querySelector(".sgt-run");
      if (!run) return;
      const width = run.getBoundingClientRect().width;
      if (!width) return;
      track.style.setProperty("--sgt-duration", (width / cfg.speed).toFixed(2) + "s");
      track.classList.add("sgt-moving");
    }

    /* ---------- controls ---------- */

    function setPaused(value) {
      paused = value;
      el.classList.toggle("sgt-paused", paused);
      toggle.setAttribute("aria-label", paused ? "Play ticker" : "Pause ticker");
      toggle.title = paused ? "Play" : "Pause";
      toggle.firstElementChild.className = paused ? "sgt-icon-play" : "sgt-icon-pause";
    }

    toggle.addEventListener("click", () => setPaused(!paused));

    // Pause while a keyboard user is inside the ticker
    viewport.addEventListener("focusin", () => el.classList.add("sgt-focus"));
    viewport.addEventListener("focusout", () => el.classList.remove("sgt-focus"));

    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => setSpeed())
      : null;
    if (resizeObserver) resizeObserver.observe(viewport);

    // Web fonts can change item widths after first render
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(setSpeed);

    /* ---------- lifecycle ---------- */

    load();
    if (cfg.refresh > 0) timer = setInterval(load, cfg.refresh * 60 * 1000);

    function destroy() {
      clearInterval(timer);
      if (resizeObserver) resizeObserver.disconnect();
      el.innerHTML = "";
      el.classList.remove("sgt", "sgt-theme-" + cfg.theme, "sgt-paused", "sgt-focus");
      delete el.sgTicker;
    }

    const api = { el, refresh: load, destroy, pause: () => setPaused(true), play: () => setPaused(false) };
    el.sgTicker = api;
    return api;
  }

  /* ============================================================
     GLOBAL ENTRY POINT + AUTO-MOUNT
     ============================================================ */

  window.SGTicker = { mount, roundCashPrice, parseNum };

  function autoMount() {
    document.querySelectorAll("[data-sg-ticker]").forEach(el => mount(el));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
