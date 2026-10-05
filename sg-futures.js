(function () {
  /* ============================================================
     FUTURES QUOTES — table + ticker (Barchart OnDemand getQuote)
     ------------------------------------------------------------
     Needs a Barchart OnDemand API key. By default each viewer
     enters the key inside the widget; it's kept in this browser
     only (session, or "remember me"). A site owner can instead
     set data-apikey — but then the key is visible in the page
     source to anyone, so only do that with a key you're happy
     to publish (e.g. one restricted to your domain).

     Table:
       <div data-sg-futures data-symbols="ZCZ26,ZCH27,ZSX26"></div>
       <script src="sg-futures.js"></script>

       data-symbols   Comma list of contracts (required)
       data-columns   Visible columns, in order. Default:
                      name,symbol,month,last,change
                      Also: pctchange,open,high,low,close,volume
       data-format    decimal (497.25) | fraction (497'2)   default decimal
       data-theme     light | dark | none                  default light
       data-refresh   Seconds between refreshes (0 = off)   default 30
       data-apikey    Optional built-in API key (public!)
       data-feed      Optional alternate getQuote URL (e.g. a proxy)
       data-editable  true = viewers can add/remove symbols (default false)
                      Fires "sg:symbols" with { symbols } on every change.

     Ticker:
       <div data-sg-futures-ticker data-symbols="ZCZ26,ZSX26"></div>

       data-label, data-theme (dark), data-speed, data-refresh,
       data-format, data-show-name (true), data-apikey, data-feed.

     JavaScript:
       SGFutures.mount(el, opts)        → { refresh, destroy, getSymbols, setSymbols }
       SGFutures.mountTicker(el, opts)  → { refresh, destroy }
       SGFutures.setApiKey(key, remember) / SGFutures.signOut()
       SGFutures.frontMonths("ZC", 2)   → ["ZCZ26", "ZCH27"]
     ============================================================ */

  const FEED = "https://ondemand.websol.barchart.com/getQuote.json";
  const AUTH_KEY = "sg-futures-apikey";
  const LEGACY_AUTH_KEY = "sg-futures-auth"; // old OpenFeed username/password
  const AUTH_EVENT = "sg-futures:auth";

  const MONTH_CODES = {
    F: "Jan", G: "Feb", H: "Mar", J: "Apr", K: "May", M: "Jun",
    N: "Jul", Q: "Aug", U: "Sep", V: "Oct", X: "Nov", Z: "Dec"
  };
  const CODE_BY_MONTH = "FGHJKMNQUVXZ";

  /* Listed months for common ag contracts (used for default symbols) */
  const CONTRACT_MONTHS = {
    ZC: "HKNUZ", ZS: "FHKNQUX", ZW: "HKNUZ", KE: "HKNUZ", MWE: "HKNUZ",
    ZM: "FHKNQUVZ", ZL: "FHKNQUVZ", ZO: "HKNUZ", LE: "GJMQVZ",
    HE: "GJKMNQVZ", GF: "FHJKQUVX"
  };

  /* ============================================================
     CSS AUTO-LOAD (same folder as this script)
     ============================================================ */

  const SCRIPT_BASE = (function () {
    const me = document.currentScript;
    return me && me.src
      ? me.src.replace(/[^\/]*(\?.*)?$/, "")
      : "https://cgermain45.github.io/cashbid-widget/";
  })();

  function ensureCss(file) {
    if (document.querySelector(`link[href*="${file}"], [data-sg-css="${file}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = SCRIPT_BASE + file;
    link.setAttribute("data-sg-css", file);
    document.head.appendChild(link);
  }

  ensureCss("sg-futures.css");

  /* ============================================================
     HELPERS
     ============================================================ */

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function toList(v) {
    if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
    if (!v) return [];
    return String(v).split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  }

  function toBool(v, fallback) {
    if (v === undefined || v === null || v === "") return fallback;
    if (typeof v === "boolean") return v;
    return !/^(false|0|no|off)$/i.test(String(v));
  }

  function num(v) {
    return typeof v === "number" && isFinite(v) ? v : null;
  }

  /* "ZCZ26" → { root: "ZC", month: "Dec", year: "26", label: "Dec 26" } */
  function parseSymbol(sym) {
    const m = /^(.+?)([FGHJKMNQUVXZ])(\d{1,4})$/.exec(String(sym || "").toUpperCase());
    if (!m) return { root: sym || "", month: "", year: "", label: "" };
    const yr = m[3].length >= 2 ? m[3].slice(-2) : "2" + m[3];
    return { root: m[1], month: MONTH_CODES[m[2]], year: yr, label: `${MONTH_CODES[m[2]]} ${yr}` };
  }

  /* Next n listed contracts for a root, e.g. frontMonths("ZC", 2) */
  function frontMonths(root, n, from) {
    const months = CONTRACT_MONTHS[root] || CODE_BY_MONTH;
    const now = from || new Date();
    const out = [];
    let y = now.getFullYear();
    let m = now.getMonth(); // 0-based

    // Grain contracts stop trading mid-month, so skip the current
    // month once we're past the 14th
    if (now.getDate() > 14) m += 1;

    for (let i = 0; out.length < n && i < 36; i++, m++) {
      if (m > 11) { m = 0; y += 1; }
      const code = CODE_BY_MONTH[m];
      if (months.includes(code)) out.push(`${root}${code}${String(y).slice(-2)}`);
    }
    return out;
  }

  function decimalsOf(v) {
    if (v === null) return 0;
    const s = String(v);
    const i = s.indexOf(".");
    return i === -1 ? 0 : Math.min(4, s.length - i - 1);
  }

  /* Price display. "fraction" shows eighths for grain-style quotes
     (OnDemand unitCode -1): 497.25 → 497'2, 497.5 → 497'4 */
  function makeFormatter(quote, mode) {
    const decimals = Math.max(2,
      decimalsOf(quote.last),
      decimalsOf(quote.change));

    return function (v, signed) {
      if (v === null || v === undefined || isNaN(v)) return "–";
      const sign = signed ? (v > 0 ? "+" : v < 0 ? "-" : "") : (v < 0 ? "-" : "");
      const a = Math.abs(v);

      if (mode === "fraction" && quote.eighths) {
        const whole = Math.floor(a + 1e-9);
        const eighths = Math.round((a - whole) * 8);
        if (Math.abs((a - whole) * 8 - eighths) < 1e-6) {
          return `${sign}${eighths === 8 ? whole + 1 : whole}'${eighths === 8 ? 0 : eighths}`;
        }
      }
      return sign + a.toFixed(decimals);
    };
  }

  function fmtChange(change, fmt) {
    return change === 0 ? "unch" : fmt(change, true);
  }

  function lastPrice(q) {
    return q.last;
  }

  function changeOf(q) {
    return { change: q.change, pct: q.pct };
  }

  function dirOf(v) {
    return v === null ? "" : v > 0 ? "up" : v < 0 ? "down" : "flat";
  }

  const ARROWS = { up: "▲", down: "▼", flat: "▬" };

  /* ============================================================
     API KEY (shared by every futures widget on the page)
     ============================================================ */

  function readStore(store) {
    try {
      const v = JSON.parse(store.getItem(AUTH_KEY) || "null");
      return v && v.apikey ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Remove usernames/passwords saved by the earlier OpenFeed version
  try {
    sessionStorage.removeItem(LEGACY_AUTH_KEY);
    localStorage.removeItem(LEGACY_AUTH_KEY);
  } catch (e) { /* ignore */ }

  function getAuth() {
    try {
      return readStore(sessionStorage) || readStore(localStorage);
    } catch (e) {
      return null;
    }
  }

  function setAuth(creds, remember) {
    const value = JSON.stringify({ apikey: creds.apikey });
    try {
      (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, value);
      (remember ? sessionStorage : localStorage).removeItem(AUTH_KEY);
    } catch (e) { /* storage blocked: works until the page reloads */ }
    memoryAuth = { apikey: creds.apikey };
    window.dispatchEvent(new CustomEvent(AUTH_EVENT));
  }

  function clearAuth() {
    try {
      sessionStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(AUTH_KEY);
    } catch (e) { /* ignore */ }
    memoryAuth = null;
    window.dispatchEvent(new CustomEvent(AUTH_EVENT));
  }

  // Fallback when storage is blocked (private mode, sandboxed iframes)
  let memoryAuth = null;
  function currentAuth() {
    return getAuth() || memoryAuth;
  }

  /* ============================================================
     DATA
     ============================================================ */

  class AuthError extends Error {}

  /* "ZCZ26" and "ZCZ6" refer to the same contract */
  function shortKey(sym) {
    const m = /^(.+?)([FGHJKMNQUVXZ])(\d{1,4})$/.exec(String(sym || "").toUpperCase());
    return m ? m[1] + m[2] + m[3].slice(-1) : String(sym || "").toUpperCase();
  }

  function findQuote(quotes, sym) {
    return quotes[String(sym).toUpperCase()] || quotes["~" + shortKey(sym)];
  }

  /* OnDemand result → the shape the table and ticker render */
  function normalize(r) {
    const last = num(r.lastPrice);
    const change = num(r.netChange);
    const prevClose = last !== null && change !== null
      ? Math.round((last - change) * 1e6) / 1e6
      : null;
    return {
      symbol: String(r.symbol || ""),
      name: r.name || "",
      eighths: String(r.unitCode) === "-1",
      last,
      change,
      pct: num(r.percentChange),
      open: num(r.open),
      high: num(r.high),
      low: num(r.low),
      // Today's close once posted, otherwise the previous close
      close: num(r.close) ?? prevClose,
      volume: num(r.volume),
      tradeTime: r.tradeTimestamp || null
    };
  }

  function fetchQuotes(symbols, creds, feed) {
    const params = new URLSearchParams({
      apikey: creds.apikey,
      symbols: symbols.join(",")
    });

    return fetch(`${feed || FEED}?${params}`, { cache: "no-store", credentials: "omit" })
      .catch(() => {
        // Never include the URL: it contains the API key
        throw new Error("The browser couldn't load quotes from Barchart OnDemand. "
          + "This is usually a network or browser-extension block; the browser console has details.");
      })
      .then(r => r.text().then(text => ({ ok: r.ok, status: r.status, text })))
      .then(({ ok, status, text }) => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }

        const code = json && json.status ? Number(json.status.code) : status;
        const message = String((json && json.status && json.status.message) || "").slice(0, 200);

        if (code === 401 || code === 403 || status === 401 || status === 403
            || /api ?key|unauthori[sz]ed|not authori[sz]ed|forbidden/i.test(message)) {
          throw new AuthError("That API key wasn't accepted.");
        }
        if (!json || !Array.isArray(json.results)) {
          if (code === 204 || /no data|no results/i.test(message)) return { quotes: {} };
          throw new Error(message
            ? `Quote service: ${message}`
            : (ok ? "Unexpected response from the quote service." : `Quote service error (${status}).`));
        }

        const quotes = {};
        json.results.forEach(r => {
          if (!r || !r.symbol) return;
          const q = normalize(r);
          quotes[q.symbol.toUpperCase()] = q;
          quotes["~" + shortKey(q.symbol)] = q;
        });
        return { quotes };
      });
  }

  /* ============================================================
     SIGN-IN FORM (shared markup)
     ============================================================ */

  let formCount = 0;

  function loginFormHtml(compact, message) {
    const id = "sgf-login-" + (++formCount);
    return `
      <form class="sgf-login${compact ? " sgf-login-compact" : ""}" autocomplete="off">
        ${compact ? "" : `<div class="sgf-login-title">Enter your API key for futures quotes</div>`}
        ${message ? `<div class="sgf-login-error" role="alert">${escapeHtml(message)}</div>` : ""}
        <label for="${id}-k" class="${compact ? "sgf-sr" : ""}">Barchart OnDemand API key</label>
        <input id="${id}-k" name="apikey" type="password" autocomplete="off" spellcheck="false" required
               placeholder="${compact ? "API key" : ""}">
        <label class="sgf-remember">
          <input name="remember" type="checkbox"> Remember on this device
        </label>
        <button type="submit" class="sgf-btn sgf-btn-primary">Connect</button>
        ${compact ? "" : `<p class="sgf-login-note">Uses your Barchart OnDemand API key. It stays in this browser.</p>`}
      </form>`;
  }

  /* Wire a form: verify the key with a real request before saving */
  function wireLogin(form, symbols, feed, onError) {
    form.addEventListener("submit", e => {
      e.preventDefault();
      const creds = { apikey: form.elements.apikey.value.trim() };
      const remember = form.elements.remember.checked;
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Connecting…";

      fetchQuotes(symbols.length ? symbols.slice(0, 1) : ["ZCZ26"], creds, feed)
        .then(() => setAuth(creds, remember))
        .catch(err => {
          btn.disabled = false;
          btn.textContent = "Connect";
          onError(err.message || "Couldn't connect.");
        });
    });
  }

  /* ============================================================
     TABLE WIDGET
     ============================================================ */

  const COLUMNS = [
    { key: "name", label: "Name" },
    { key: "symbol", label: "Symbol" },
    { key: "month", label: "Month" },
    { key: "last", label: "Last", num: true },
    { key: "change", label: "Change", num: true },
    { key: "pctchange", label: "% Chg", num: true },
    { key: "open", label: "Open", num: true },
    { key: "high", label: "High", num: true },
    { key: "low", label: "Low", num: true },
    { key: "close", label: "Close", num: true, title: "Today's close once posted, otherwise the previous close" },
    { key: "volume", label: "Volume", num: true }
  ];
  const DEFAULT_COLUMNS = ["name", "symbol", "month", "last", "change"];

  // Barchart symbols: ZCZ26, ZC*1, $SPX, ^EURUSD, ES=F …
  const SYMBOL_RE = /^[A-Z0-9$^][A-Z0-9.*^$=\-]{0,24}$/;
  const MAX_SYMBOLS = 50;

  let widgetCount = 0;

  function mount(el, options) {
    if (!el) return null;
    if (el.sgFutures) return el.sgFutures;

    const d = el.dataset;
    const o = options || {};
    const pick = key => (o[key] !== undefined ? o[key] : d[key]);
    const uid = "sgf" + (++widgetCount);

    const cfg = {
      symbols: toList(pick("symbols")).map(s => s.toUpperCase()),
      theme: pick("theme") || "light",
      refresh: pick("refresh") !== undefined && pick("refresh") !== ""
        ? Math.max(0, Number(pick("refresh")) || 0)
        : 30,
      storagePrefix: o.storagePrefix || "",
      apikey: pick("apikey") || "",
      feed: pick("feed") || "",
      editable: toBool(pick("editable"), false)
    };

    const store = {
      get(k) { try { return localStorage.getItem(cfg.storagePrefix + k); } catch (e) { return null; } },
      set(k, v) { try { localStorage.setItem(cfg.storagePrefix + k, v); } catch (e) { /* ignore */ } }
    };

    // Saved per-instance prefs win over the embed defaults
    let columns = (() => {
      const saved = cfg.storagePrefix ? JSON.parse(store.get("sgf-columns") || "null") : null;
      const list = saved || toList(pick("columns"));
      const valid = list.filter(k => COLUMNS.some(c => c.key === k));
      return valid.length ? valid : DEFAULT_COLUMNS.slice();
    })();
    let format = (cfg.storagePrefix && store.get("sgf-format")) || (pick("format") === "fraction" ? "fraction" : "decimal");

    el.classList.add("sgf", "sgf-theme-" + cfg.theme);
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Futures quotes");

    let quotes = null;
    let prevLast = new Map();
    let lastUpdated = null;
    let timer = null;
    let inFlight = null;
    let loginMessage = "";
    let pending = new Set(); // symbols added but not fetched yet

    /* ---------- shell ---------- */

    function renderShell() {
      el.innerHTML = `
        <div class="sgf-bar">
          <span class="sgf-updated" aria-live="polite"></span>
          ${cfg.editable ? `
          <form class="sgf-add" autocomplete="off">
            <label class="sgf-sr" for="${uid}-add">Add symbol</label>
            <input id="${uid}-add" name="symbol" type="text" spellcheck="false" autocapitalize="characters"
                   placeholder="Add symbol, e.g. ZCK27">
            <button type="submit" class="sgf-btn">Add</button>
            <span class="sgf-add-msg" role="status" aria-live="polite"></span>
          </form>` : ""}
          <details class="sgf-menu">
            <summary class="sgf-btn sgf-icon-btn" title="Columns and format" aria-label="Futures settings">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M19.14 12.94a7.4 7.4 0 0 0 .06-.94 7.4 7.4 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.4 7.4 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg>
            </summary>
            <div class="sgf-menu-body">
              <div class="sgf-menu-title">Columns</div>
              ${COLUMNS.map(c => `
                <label><input type="checkbox" class="sgf-col" value="${c.key}" ${columns.includes(c.key) ? "checked" : ""}> ${c.label}</label>`).join("")}
              <div class="sgf-menu-title">Price format</div>
              <label><input type="radio" name="${uid}-format" value="decimal" ${format === "decimal" ? "checked" : ""}> Decimal (497.25)</label>
              <label><input type="radio" name="${uid}-format" value="fraction" ${format === "fraction" ? "checked" : ""}> Fraction (497'2)</label>
              ${cfg.apikey ? "" : `<button type="button" class="sgf-btn sgf-signout">Forget API key</button>`}
            </div>
          </details>
        </div>
        <div class="sgf-table-wrap"></div>`;

      const menu = el.querySelector(".sgf-menu");

      el.querySelectorAll(".sgf-col").forEach(cb => cb.addEventListener("change", () => {
        // Keep the canonical column order
        columns = COLUMNS.map(c => c.key)
          .filter(k => el.querySelector(`.sgf-col[value="${k}"]`).checked);
        if (!columns.length) columns = ["symbol"];
        if (cfg.storagePrefix) store.set("sgf-columns", JSON.stringify(columns));
        renderTable(false);
      }));

      el.querySelectorAll(`input[name="${uid}-format"]`).forEach(r => r.addEventListener("change", () => {
        format = r.value;
        if (cfg.storagePrefix) store.set("sgf-format", format);
        renderTable(false);
      }));

      const signout = el.querySelector(".sgf-signout");
      if (signout) signout.addEventListener("click", () => {
        menu.open = false;
        clearAuth();
      });

      const addForm = el.querySelector(".sgf-add");
      if (addForm) addForm.addEventListener("submit", e => {
        e.preventDefault();
        const input = addForm.elements.symbol;
        const msg = addForm.querySelector(".sgf-add-msg");
        const wanted = toList(input.value).map(x => x.toUpperCase());
        const added = [];
        const problems = [];

        wanted.forEach(sym => {
          if (!SYMBOL_RE.test(sym)) problems.push(`"${sym}" isn't a valid symbol`);
          else if (cfg.symbols.concat(added).some(x => shortKey(x) === shortKey(sym))) problems.push(`${sym} is already listed`);
          else if (cfg.symbols.length + added.length >= MAX_SYMBOLS) problems.push(`limit is ${MAX_SYMBOLS} symbols`);
          else added.push(sym);
        });

        msg.textContent = problems.join("; ");
        msg.classList.toggle("sgf-add-error", problems.length > 0);
        if (!added.length) return;

        input.value = "";
        setSymbols(cfg.symbols.concat(added));
        if (!problems.length) msg.textContent = `Added ${added.join(", ")}`;
      });

    }

    function renderLogin() {
      el.innerHTML = `<div class="sgf-login-wrap">${loginFormHtml(false, loginMessage)}</div>`;
      wireLogin(el.querySelector("form"), cfg.symbols, cfg.feed, msg => {
        loginMessage = msg;
        renderLogin();
      });
    }

    /* ---------- table ---------- */

    function cell(c, q, fmt, flash) {
      const ch = changeOf(q);
      const dir = dirOf(ch.change);
      const sym = q.symbol;
      switch (c.key) {
        case "name": return escapeHtml(q.name || "");
        case "symbol": return escapeHtml(sym);
        case "month": return escapeHtml(parseSymbol(sym).label);
        case "last": return `<span class="sgf-last${flash ? " sgf-flash-" + flash : ""}">${fmt(lastPrice(q))}</span>`;
        case "change":
          return ch.change === null ? "–"
            : `<span class="sgf-${dir}"><span class="sgf-arrow" aria-hidden="true">${ARROWS[dir]}</span> ${fmtChange(ch.change, fmt)}</span>`;
        case "pctchange":
          return ch.pct === null ? "–"
            : `<span class="sgf-${dir}">${ch.pct > 0 ? "+" : ""}${ch.pct.toFixed(2)}%</span>`;
        case "open": return fmt(q.open);
        case "high": return fmt(q.high);
        case "low": return fmt(q.low);
        case "close": return fmt(q.close);
        case "volume": return q.volume === null ? "–" : q.volume.toLocaleString();
        default: return "";
      }
    }

    function renderTable(withFlash) {
      const wrap = el.querySelector(".sgf-table-wrap");
      if (!wrap || !quotes) return;

      if (!cfg.symbols.length) {
        wrap.innerHTML = `<p class="sgf-status">${cfg.editable
          ? "No symbols yet. Add one above, e.g. ZCZ26 for Corn Dec 26."
          : "No symbols set for this widget."}</p>`;
        return;
      }

      const cols = columns.map(k => COLUMNS.find(c => c.key === k));
      const next = new Map();
      const removeCell = sym => cfg.editable
        ? `<td class="sgf-col-remove"><button type="button" class="sgf-remove" data-symbol="${escapeHtml(sym)}"
              title="Remove ${escapeHtml(sym)}" aria-label="Remove ${escapeHtml(sym)}">×</button></td>`
        : "";

      const rows = cfg.symbols.map(sym => {
        const q = findQuote(quotes, sym);
        if (!q) {
          return `<tr class="sgf-missing"><td colspan="${cols.length}">${escapeHtml(sym)} — ${pending.has(sym) ? "loading…" : "no data"}</td>${removeCell(sym)}</tr>`;
        }
        const last = lastPrice(q);
        next.set(sym, last);
        const before = prevLast.get(sym);
        const flash = withFlash && before !== undefined && before !== null && last !== null && before !== last
          ? (last > before ? "up" : "down") : "";
        const fmt = makeFormatter(q, format);
        return `<tr>${cols.map(c =>
          `<td class="sgf-col-${c.key}${c.num ? " sgf-num" : ""}">${cell(c, q, fmt, flash)}</td>`).join("")}${removeCell(sym)}</tr>`;
      }).join("");

      if (withFlash) prevLast = next;

      wrap.innerHTML = `
        <table>
          <thead><tr>${cols.map(c =>
            `<th class="sgf-col-${c.key}${c.num ? " sgf-num" : ""}"${c.title ? ` title="${escapeHtml(c.title)}"` : ""}>${c.label}</th>`).join("")}${
            cfg.editable ? `<th class="sgf-col-remove"><span class="sgf-sr">Remove</span></th>` : ""}</tr></thead>
          <tbody>${rows}</tbody>
        </table>`;

      const upd = el.querySelector(".sgf-updated");
      if (upd && lastUpdated) {
        upd.textContent = "Updated " + lastUpdated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
        upd.classList.remove("sgf-stale");
      }
    }

    /* ---------- load ---------- */

    function creds() {
      return cfg.apikey ? { apikey: cfg.apikey } : currentAuth();
    }

    function load(opts) {
      const auth = creds();
      if (!auth) {
        quotes = null;
        renderLogin();
        return Promise.resolve();
      }
      if (opts && opts.auto && lastUpdated && Date.now() - lastUpdated < 15000) return Promise.resolve();
      if (inFlight) return inFlight;
      if (!el.querySelector(".sgf-table-wrap")) {
        renderShell();
        el.querySelector(".sgf-table-wrap").innerHTML = `<p class="sgf-status">Loading quotes…</p>`;
      }
      if (!cfg.symbols.length) {
        quotes = quotes || {};
        renderTable(false);
        return Promise.resolve();
      }

      inFlight = fetchQuotes(cfg.symbols, auth, cfg.feed)
        .then(res => {
          quotes = res.quotes;
          lastUpdated = new Date();
          pending = new Set();
          renderTable(true);
          el.dispatchEvent(new CustomEvent("sg:updated", { detail: { updated: lastUpdated } }));
        })
        .catch(err => {
          if (err instanceof AuthError && !cfg.apikey) {
            loginMessage = err.message;
            clearAuth(); // returns every futures widget to the key form
          } else if (quotes) {
            const upd = el.querySelector(".sgf-updated");
            if (upd) { upd.textContent = "Refresh failed · " + upd.textContent.replace(/^Refresh failed · /, ""); upd.classList.add("sgf-stale"); }
          } else {
            const wrap = el.querySelector(".sgf-table-wrap");
            if (wrap) wrap.innerHTML = `<p class="sgf-status sgf-error">${escapeHtml(err.message)}</p>`;
          }
          el.dispatchEvent(new CustomEvent("sg:error", { detail: err }));
        })
        .then(() => { inFlight = null; });

      return inFlight;
    }

    function onAuthChange() {
      if (cfg.apikey) return; // built-in key: shared key changes don't apply
      if (currentAuth()) {
        loginMessage = "";
        if (!el.querySelector(".sgf-table-wrap")) load();
      } else {
        quotes = null;
        lastUpdated = null;
        renderLogin();
      }
    }

    // Close the settings menu when clicking elsewhere
    function onDocumentClick(e) {
      const menu = el.querySelector(".sgf-menu");
      if (menu && menu.open && !e.composedPath().includes(menu)) menu.open = false;
    }

    /* ---------- editing symbols ---------- */

    function setSymbols(list) {
      const before = cfg.symbols;
      cfg.symbols = toList(list).map(x => x.toUpperCase());
      cfg.symbols.filter(x => !before.includes(x)).forEach(x => pending.add(x));
      el.dispatchEvent(new CustomEvent("sg:symbols", { detail: { symbols: cfg.symbols.slice() } }));

      // Removals show instantly; additions need a fetch
      renderTable(false);
      if (cfg.symbols.some(x => !before.includes(x)) && creds()) {
        (inFlight || Promise.resolve()).then(() => load());
      }
    }

    el.addEventListener("click", e => {
      const btn = e.target.closest(".sgf-remove");
      if (!btn || !cfg.editable) return;
      const sym = btn.dataset.symbol;
      setSymbols(cfg.symbols.filter(x => x !== sym));
      const msg = el.querySelector(".sgf-add-msg");
      if (msg) {
        msg.textContent = `Removed ${sym}`;
        msg.classList.remove("sgf-add-error");
      }
    });

    window.addEventListener(AUTH_EVENT, onAuthChange);
    document.addEventListener("click", onDocumentClick);

    load();
    if (cfg.refresh > 0) timer = setInterval(() => load({ auto: true }), cfg.refresh * 1000);

    function destroy() {
      clearInterval(timer);
      window.removeEventListener(AUTH_EVENT, onAuthChange);
      document.removeEventListener("click", onDocumentClick);
      el.innerHTML = "";
      el.classList.remove("sgf", "sgf-theme-" + cfg.theme);
      delete el.sgFutures;
    }

    const api = {
      el,
      refresh: load,
      destroy,
      getSymbols: () => cfg.symbols.slice(),
      setSymbols
    };
    el.sgFutures = api;
    return api;
  }

  /* ============================================================
     TICKER (reuses sg-ticker.css styling)
     ============================================================ */

  function mountTicker(el, options) {
    if (!el) return null;
    if (el.sgFuturesTicker) return el.sgFuturesTicker;

    ensureCss("sg-ticker.css");

    const d = el.dataset;
    const o = options || {};
    const pick = key => (o[key] !== undefined ? o[key] : d[key]);

    const cfg = {
      symbols: toList(pick("symbols")).map(s => s.toUpperCase()),
      label: pick("label") !== undefined ? String(pick("label")) : "Futures",
      theme: pick("theme") || "dark",
      speed: Math.max(5, Number(pick("speed")) || 50),
      refresh: pick("refresh") !== undefined && pick("refresh") !== ""
        ? Math.max(0, Number(pick("refresh")) || 0)
        : 30,
      format: pick("format") === "fraction" ? "fraction" : "decimal",
      showName: toBool(pick("showName"), true),
      apikey: pick("apikey") || "",
      feed: pick("feed") || ""
    };

    el.classList.add("sgt", "sgf-ticker", "sgt-theme-" + cfg.theme);
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", (cfg.label || "Futures") + " ticker");

    el.innerHTML = `
      ${cfg.label ? `<div class="sgt-label">${escapeHtml(cfg.label)}</div>` : ""}
      <div class="sgt-viewport">
        <div class="sgt-track"><span class="sgt-item sgt-muted">Loading futures…</span></div>
      </div>
      <button type="button" class="sgt-toggle" aria-label="Pause ticker" title="Pause">
        <span class="sgt-icon-pause" aria-hidden="true"></span>
      </button>`;

    const viewport = el.querySelector(".sgt-viewport");
    const track = el.querySelector(".sgt-track");
    const toggle = el.querySelector(".sgt-toggle");

    let prevLast = new Map();
    let timer = null;
    let paused = false;
    let hasData = false;

    function showSignIn(message) {
      track.classList.remove("sgt-moving");
      hasData = false;
      track.innerHTML = `
        <span class="sgt-item sgf-ticker-signin">
          ${message ? `<span class="sgf-login-error">${escapeHtml(message)}</span>` : `<span class="sgt-muted">Add your API key to see futures</span>`}
          ${cfg.apikey ? "" : `<button type="button" class="sgf-btn sgf-btn-primary sgf-ticker-open">Enter API key</button>`}
        </span>`;
      const open = track.querySelector(".sgf-ticker-open");
      if (open) open.addEventListener("click", () => {
        track.innerHTML = `<span class="sgt-item sgf-ticker-form">${loginFormHtml(true, "")}</span>`;
        const form = track.querySelector("form");
        form.elements.apikey.focus();
        wireLogin(form, cfg.symbols, cfg.feed, msg => showSignIn(msg));
      });
    }

    function render(quotes) {
      const items = cfg.symbols.map(sym => {
        const q = findQuote(quotes, sym);
        if (!q) return "";
        const fmt = makeFormatter(q, cfg.format);
        const last = lastPrice(q);
        const ch = changeOf(q);
        const dir = dirOf(ch.change);
        const before = prevLast.get(sym);
        const flash = before !== undefined && before !== null && last !== null && before !== last
          ? (last > before ? " sgt-flash-up" : " sgt-flash-down") : "";
        prevLast.set(sym, last);
        const month = parseSymbol(q.symbol).label;

        return `
          <span class="sgt-item${flash}" title="${escapeHtml(q.symbol || sym)}">
            <span class="sgt-sym">${cfg.showName && q.name ? escapeHtml(q.name) + " " : ""}${escapeHtml(month || sym)}</span>
            <span class="sgt-px">${fmt(last)}</span>
            ${ch.change !== null
              ? `<span class="sgt-chg sgt-${dir}"><span aria-hidden="true">${ARROWS[dir]}</span> ${fmtChange(ch.change, fmt)}</span>`
              : ""}
          </span>`;
      }).join("");

      if (!items.trim()) {
        track.innerHTML = `<span class="sgt-item sgt-muted">No futures data</span>`;
        track.classList.remove("sgt-moving");
        return;
      }

      track.innerHTML = `<div class="sgt-run">${items}</div><div class="sgt-run" aria-hidden="true">${items}</div>`;
      hasData = true;
      setSpeed();
    }

    function setSpeed() {
      const run = track.querySelector(".sgt-run");
      if (!run) return;
      const width = run.getBoundingClientRect().width;
      if (!width) return;
      track.style.setProperty("--sgt-duration", (width / cfg.speed).toFixed(2) + "s");
      track.classList.add("sgt-moving");
    }

    function creds() {
      return cfg.apikey ? { apikey: cfg.apikey } : currentAuth();
    }

    function load() {
      const auth = creds();
      if (!auth) {
        showSignIn("");
        return Promise.resolve();
      }
      return fetchQuotes(cfg.symbols, auth, cfg.feed)
        .then(res => {
          render(res.quotes);
          el.dispatchEvent(new CustomEvent("sg:updated", { detail: { updated: new Date() } }));
        })
        .catch(err => {
          if (err instanceof AuthError) {
            if (!cfg.apikey) clearAuth();
            showSignIn(err.message);
          } else if (!hasData) {
            track.innerHTML = `<span class="sgt-item sgt-muted">${escapeHtml(err.message)}</span>`;
          }
          el.dispatchEvent(new CustomEvent("sg:error", { detail: err }));
        });
    }

    function setPaused(value) {
      paused = value;
      el.classList.toggle("sgt-paused", paused);
      toggle.setAttribute("aria-label", paused ? "Play ticker" : "Pause ticker");
      toggle.title = paused ? "Play" : "Pause";
      toggle.firstElementChild.className = paused ? "sgt-icon-play" : "sgt-icon-pause";
    }

    toggle.addEventListener("click", () => setPaused(!paused));
    viewport.addEventListener("focusin", () => el.classList.add("sgt-focus"));
    viewport.addEventListener("focusout", () => el.classList.remove("sgt-focus"));

    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => hasData && setSpeed()) : null;
    if (resizeObserver) resizeObserver.observe(viewport);

    function onAuthChange() {
      if (cfg.apikey) return;
      if (currentAuth()) load();
      else showSignIn("");
    }
    window.addEventListener(AUTH_EVENT, onAuthChange);

    load();
    if (cfg.refresh > 0) timer = setInterval(() => { if (creds()) load(); }, cfg.refresh * 1000);

    function destroy() {
      clearInterval(timer);
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener(AUTH_EVENT, onAuthChange);
      el.innerHTML = "";
      el.classList.remove("sgt", "sgf-ticker", "sgt-theme-" + cfg.theme, "sgt-paused", "sgt-focus");
      delete el.sgFuturesTicker;
    }

    const api = { el, refresh: load, destroy };
    el.sgFuturesTicker = api;
    return api;
  }

  /* ============================================================
     GLOBAL ENTRY POINT + AUTO-MOUNT
     ============================================================ */

  window.SGFutures = {
    mount,
    mountTicker,
    setApiKey: (key, remember) => setAuth({ apikey: String(key || "").trim() }, !!remember),
    signOut: clearAuth,
    isSignedIn: () => !!currentAuth(),
    frontMonths,
    parseSymbol
  };

  function autoMount() {
    document.querySelectorAll("[data-sg-futures]").forEach(el => mount(el));
    document.querySelectorAll("[data-sg-futures-ticker]").forEach(el => mountTicker(el));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
