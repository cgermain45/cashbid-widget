(function () {
  /* ============================================================
     NEWS TICKER — scrolling headlines from Barchart OnDemand
     (getNews.json). Uses the same API key as the futures widgets:
     a key entered in either one works in both.

     Embed:
       <div data-sg-news-ticker></div>
       <script src="sg-news.js"></script>

     Options (data-* attributes or SGNews.mountTicker(el, opts)):
       data-sources   News source codes            default BRUG
       data-label     Badge text ("" hides it)     default News
       data-theme     dark | light | none          default dark
       data-speed     Scroll speed, px per second  default 50
       data-refresh   Minutes between refreshes    default 5 (0 = off)
       data-max       Most headlines to show       default 20
       data-links     Headlines open the story     default true
       data-apikey    Built-in key (visible in the page source)
       data-feed      Alternate getNews URL (e.g. your own proxy)

     API:
       SGNews.mountTicker(el, opts) → { refresh, destroy }
     ============================================================ */

  const FEED = "https://ondemand.websol.barchart.com/getNews.json";
  // Shared with sg-futures.js so one key covers futures and news
  const AUTH_KEY = "sg-futures-apikey";
  const AUTH_EVENT = "sg-futures:auth";

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

  /* ============================================================
     HELPERS
     ============================================================ */

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function toBool(v, fallback) {
    if (v === undefined || v === null || v === "") return fallback;
    if (typeof v === "boolean") return v;
    return !/^(false|0|no|off)$/i.test(String(v).trim());
  }

  function toList(v) {
    if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
    if (!v) return [];
    return String(v).split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  }

  /* Only Barchart story links on https are made clickable */
  function safeStoryUrl(u) {
    try {
      const url = new URL(String(u || ""));
      return url.protocol === "https:" && /(^|\.)barchart\.com$/i.test(url.hostname) ? url.href : "";
    } catch (e) {
      return "";
    }
  }

  /* ============================================================
     API KEY (same storage as the futures widgets)
     ============================================================ */

  let memoryAuth = null;

  function readStore(store) {
    try {
      const v = JSON.parse(store.getItem(AUTH_KEY) || "null");
      return v && v.apikey ? v : null;
    } catch (e) {
      return null;
    }
  }

  function currentAuth() {
    try {
      return readStore(sessionStorage) || readStore(localStorage) || memoryAuth;
    } catch (e) {
      return memoryAuth;
    }
  }

  function setAuth(apikey, remember) {
    const value = JSON.stringify({ apikey });
    try {
      (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, value);
      (remember ? sessionStorage : localStorage).removeItem(AUTH_KEY);
    } catch (e) { /* storage blocked: works until the page reloads */ }
    memoryAuth = { apikey };
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

  /* ============================================================
     DATA
     ============================================================ */

  class AuthError extends Error {}

  function fetchNews(cfg, apikey) {
    const params = new URLSearchParams({
      apikey,
      sources: cfg.sources.join(","),
      displayType: "full"
    });

    return fetch(`${cfg.feed || FEED}?${params}`, { cache: "no-store", credentials: "omit" })
      .catch(() => {
        // Never include the URL: it contains the API key
        throw new Error("Couldn't load news from Barchart OnDemand.");
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
          if (code === 204 || /no data|no results/i.test(message)) return [];
          throw new Error(message
            ? `News service: ${message}`
            : (ok ? "Unexpected response from the news service." : `News service error (${status}).`));
        }

        // Newest first, one entry per story
        const seen = new Set();
        return json.results
          .filter(r => r && r.headline && String(r.headline).trim())
          .filter(r => {
            const id = r.newsID != null ? String(r.newsID) : r.headline;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          })
          .map(r => ({
            id: r.newsID,
            headline: String(r.headline).trim(),
            time: Date.parse(r.timestamp) || 0,
            url: safeStoryUrl(r.canonicalUrl || r.headlineURL)
          }))
          .sort((a, b) => b.time - a.time);
      });
  }

  /* ============================================================
     TICKER
     ============================================================ */

  let formCount = 0;

  function mountTicker(el, options) {
    if (!el) return null;
    if (el.sgNewsTicker) return el.sgNewsTicker;

    ensureCss("sg-ticker.css");
    ensureCss("sg-futures.css"); // API key form styles

    const d = el.dataset;
    const o = options || {};
    const pick = key => (o[key] !== undefined ? o[key] : d[key]);

    const cfg = {
      sources: toList(pick("sources")).map(s => s.toUpperCase()),
      label: pick("label") !== undefined ? String(pick("label")) : "News",
      theme: pick("theme") || "dark",
      speed: Math.max(5, Number(pick("speed")) || 50),
      refresh: pick("refresh") !== undefined && pick("refresh") !== ""
        ? Math.max(0, Number(pick("refresh")) || 0)
        : 5,
      max: Math.max(1, Math.min(100, Number(pick("max")) || 20)),
      links: toBool(pick("links"), true),
      apikey: pick("apikey") || "",
      feed: pick("feed") || ""
    };
    if (!cfg.sources.length) cfg.sources = ["BRUG"];

    el.classList.add("sgt", "sgf-ticker", "sgn-ticker", "sgt-theme-" + cfg.theme);
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", (cfg.label || "News") + " headlines");

    el.innerHTML = `
      ${cfg.label ? `<div class="sgt-label">${escapeHtml(cfg.label)}</div>` : ""}
      <div class="sgt-viewport">
        <div class="sgt-track"><span class="sgt-item sgt-muted">Loading headlines…</span></div>
      </div>
      <button type="button" class="sgt-toggle" aria-label="Pause ticker" title="Pause">
        <span class="sgt-icon-pause" aria-hidden="true"></span>
      </button>`;

    const viewport = el.querySelector(".sgt-viewport");
    const track = el.querySelector(".sgt-track");
    const toggle = el.querySelector(".sgt-toggle");

    let timer = null;
    let paused = false;
    let hasData = false;
    let lastKey = "";

    function creds() {
      return cfg.apikey ? { apikey: cfg.apikey } : currentAuth();
    }

    function showSignIn(message) {
      track.classList.remove("sgt-moving");
      hasData = false;
      lastKey = "";
      track.innerHTML = `
        <span class="sgt-item sgf-ticker-signin">
          ${message
            ? `<span class="sgf-login-error">${escapeHtml(message)}</span>`
            : `<span class="sgt-muted">Add your Barchart OnDemand API key to see news</span>`}
          ${cfg.apikey ? "" : `<button type="button" class="sgf-btn sgf-btn-primary sgn-open">Enter API key</button>`}
        </span>`;
      const open = track.querySelector(".sgn-open");
      if (open) open.addEventListener("click", showForm);
    }

    function showForm() {
      const id = "sgn-login-" + (++formCount);
      track.innerHTML = `
        <span class="sgt-item sgf-ticker-form">
          <form class="sgf-login sgf-login-compact" autocomplete="off">
            <label for="${id}" class="sgf-sr">Barchart OnDemand API key</label>
            <input id="${id}" name="apikey" type="password" autocomplete="off" spellcheck="false" required placeholder="API key">
            <label class="sgf-remember"><input name="remember" type="checkbox"> Remember on this device</label>
            <button type="submit" class="sgf-btn sgf-btn-primary">Connect</button>
          </form>
        </span>`;
      const form = track.querySelector("form");
      form.elements.apikey.focus();
      form.addEventListener("submit", e => {
        e.preventDefault();
        const key = form.elements.apikey.value.trim();
        const btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.textContent = "Connecting…";
        // Check the key with a real request before saving it
        fetchNews(cfg, key)
          .then(() => setAuth(key, form.elements.remember.checked))
          .catch(err => showSignIn(err.message || "Couldn't connect."));
      });
    }

    function render(stories) {
      const list = stories.slice(0, cfg.max);
      const key = list.map(s => s.id + "|" + s.headline).join("\n");
      if (hasData && key === lastKey) return; // same headlines: don't restart the scroll
      lastKey = key;

      if (!list.length) {
        hasData = false;
        track.classList.remove("sgt-moving");
        track.innerHTML = `<span class="sgt-item sgt-muted">No headlines right now</span>`;
        return;
      }

      const items = list.map(s => {
        const text = `<span class="sgt-sym sgn-headline">${escapeHtml(s.headline)}</span>`;
        return cfg.links && s.url
          ? `<a class="sgt-item sgn-item" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${text}</a>`
          : `<span class="sgt-item sgn-item">${text}</span>`;
      }).join("");

      track.innerHTML = `<div class="sgt-run">${items}</div><div class="sgt-run" aria-hidden="true">${items}</div>`;
      // The copy is only there to make the loop seamless
      track.querySelectorAll(".sgt-run[aria-hidden] a").forEach(a => a.setAttribute("tabindex", "-1"));
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

    function load() {
      const auth = creds();
      if (!auth) {
        showSignIn("");
        return Promise.resolve();
      }
      return fetchNews(cfg, auth.apikey)
        .then(stories => {
          render(stories);
          el.dispatchEvent(new CustomEvent("sg:updated", { detail: { updated: new Date(), count: stories.length } }));
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

    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => hasData && setSpeed()) : null;
    if (resizeObserver) resizeObserver.observe(viewport);

    function onAuthChange() {
      if (cfg.apikey) return;
      if (currentAuth()) load();
      else showSignIn("");
    }
    window.addEventListener(AUTH_EVENT, onAuthChange);

    load();
    if (cfg.refresh > 0) timer = setInterval(() => { if (creds()) load(); }, cfg.refresh * 60 * 1000);

    function destroy() {
      clearInterval(timer);
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener(AUTH_EVENT, onAuthChange);
      el.innerHTML = "";
      el.classList.remove("sgt", "sgf-ticker", "sgn-ticker", "sgt-theme-" + cfg.theme, "sgt-paused", "sgt-focus");
      delete el.sgNewsTicker;
    }

    const api = { el, refresh: load, destroy };
    el.sgNewsTicker = api;
    return api;
  }

  /* ============================================================
     GLOBAL ENTRY POINT + AUTO-MOUNT
     ============================================================ */

  window.SGNews = { mountTicker };

  function autoMount() {
    document.querySelectorAll("[data-sg-news-ticker]").forEach(el => mountTicker(el));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
