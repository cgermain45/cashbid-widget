(function () {
  /* ============================================================
     QUOTEBOARD EMBED — put the whole quoteboard on any website with
     one tag. The board runs in an iframe this script builds, so the
     host site's styles and the board's can't affect each other.

     Easiest: open the quoteboard, set it up, click "Embed" and copy
     the code. Or write it by hand:

       <div data-sg-quoteboard
            data-height="720"
            data-json="https://yourco.agricharts.com/inc/cashbids/cashbids-json.php"
            data-title="Your Company Bids"
            data-theme="dark" data-style="harvest"
            data-locked="true"></div>
       <script src="https://cgermain45.github.io/cashbid-widget/sg-quoteboard-embed.js"></script>

     Attributes (all optional):
       data-height          720 (px), any CSS height ("100vh"), or "auto"
                            (frame grows with the board; use with Fit off)
       data-json            Cash bid feed URL
       data-title           Board title
       data-theme           dark | light
       data-style           floor | modern | harvest
       data-locked          true = visitors can't change the layout
       data-fit             false = panels can grow past the frame
       data-refresh         Minutes between refreshes: 1, 5, 15, 30, 60
       data-ticker          Cash bid ticker            (default on)
       data-futures-ticker  Futures ticker             (default off)
       data-news-ticker     News headline ticker       (default off)
       data-board           The board itself (layout, panels, colors),
                            written by the quoteboard's Embed button
       data-futures-apikey  Built-in Barchart OnDemand key for futures
                            and news. Anyone can read it in your page
                            source; leave it out and visitors enter
                            their own key in the board.
       data-futures-feed, data-news-sources, data-news-feed
                            Same as on the quoteboard page

     The owner's settings are applied in each visitor's browser the
     first time, and again whenever the embed code changes.

     API: SGQuoteboardEmbed.mount(el, options) → { el, frame, destroy }
     ============================================================ */

  const SCRIPT_BASE = (function () {
    const me = document.currentScript;
    return me && me.src
      ? me.src.replace(/[^\/]*(\?.*)?$/, "")
      : "https://cgermain45.github.io/cashbid-widget/";
  })();

  const BOARD_PAGE = "cashbidquoteboard.html";

  function toBool(v) {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v === "boolean") return v;
    return !/^(false|0|no|off)$/i.test(String(v).trim());
  }

  function parseBoard(v) {
    if (!v) return undefined;
    if (typeof v === "object") return v;
    try {
      const board = JSON.parse(v);
      return board && typeof board === "object" ? board : undefined;
    } catch (e) {
      console.warn("Quoteboard embed: data-board isn't valid JSON; ignoring it.");
      return undefined;
    }
  }

  function cssHeight(v) {
    const s = String(v == null || v === "" ? "720" : v).trim();
    if (s === "auto") return "auto";
    if (/^\d+(\.\d+)?$/.test(s)) return s + "px";
    if (/^\d+(\.\d+)?(px|vh|dvh|svh|em|rem|%)$/.test(s)) return s;
    return "720px";
  }

  function mount(el, options) {
    if (!el) return null;
    if (el.sgQuoteboardEmbed) return el.sgQuoteboardEmbed;

    const d = el.dataset;
    const o = options || {};
    const pick = key => (o[key] !== undefined ? o[key] : d[key]);

    const prefs = {};
    const set = (k, v) => { if (v !== undefined && v !== "") prefs[k] = v; };
    set("title", pick("title"));
    set("theme", pick("theme"));
    set("style", pick("style"));
    set("refreshMin", pick("refresh") !== undefined ? Number(pick("refresh")) : undefined);
    set("locked", toBool(pick("locked")));
    set("fit", toBool(pick("fit")));
    set("ticker", toBool(pick("ticker")));
    set("futuresTicker", toBool(pick("futuresTicker")));
    set("newsTicker", toBool(pick("newsTicker")));

    const config = { prefs };
    ["json", "futuresApikey", "futuresFeed", "newsSources", "newsFeed"].forEach(k => {
      if (pick(k)) config[k] = String(pick(k));
    });
    const board = parseBoard(pick("board"));
    if (board) config.board = board;

    const height = cssHeight(pick("height"));
    const src = (o.src || SCRIPT_BASE + BOARD_PAGE) + "#sgqb=" + encodeURIComponent(JSON.stringify(config));

    const frame = document.createElement("iframe");
    frame.src = src;
    frame.title = String(pick("title") || (board && board.prefs && board.prefs.title) || "Cash bid quoteboard");
    frame.setAttribute("allow", "fullscreen; geolocation; clipboard-write");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.style.cssText = "display:block;width:100%;border:0;background:transparent;"
      + "height:" + (height === "auto" ? "720px" : height) + ";";

    el.innerHTML = "";
    el.appendChild(frame);

    // data-height="auto": the board reports its height
    function onMessage(e) {
      if (height !== "auto" || e.source !== frame.contentWindow) return;
      const data = e.data;
      if (!data || data.type !== "sg-qb:height") return;
      const h = Number(data.height);
      if (isFinite(h) && h >= 200 && h <= 20000) frame.style.height = Math.ceil(h) + "px";
    }
    window.addEventListener("message", onMessage);

    function destroy() {
      window.removeEventListener("message", onMessage);
      el.innerHTML = "";
      delete el.sgQuoteboardEmbed;
    }

    const api = { el, frame, destroy };
    el.sgQuoteboardEmbed = api;
    return api;
  }

  window.SGQuoteboardEmbed = { mount };

  function autoMount() {
    document.querySelectorAll("[data-sg-quoteboard]").forEach(el => mount(el));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
