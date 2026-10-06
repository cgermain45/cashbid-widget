(function () {
  /* ============================================================
     EMBED — camera streams, video, web pages and custom HTML
     ------------------------------------------------------------
     Built for things like a truck-scale camera. Paste a URL and the
     widget works out how to show it:

       mjpeg     IP-camera live view (multipart JPEG) → <img>
       snapshot  still image refreshed every few seconds → <img>
       video     MP4 / WebM file or stream → <video>
       hls       HLS live stream (.m3u8) → <video> (hls.js, sandboxed)
       page      any web page / vendor viewer / YouTube → <iframe>
       html      custom HTML → sandboxed <iframe srcdoc>

     Security: web pages and custom HTML run in sandboxed frames.
     Custom HTML (and the HLS player) get an opaque origin, so they
     can't read this site's storage (e.g. the futures API key), touch
     the page, open pop-ups or navigate the tab. Nothing third-party
     is loaded into the host page itself.

     Embed:
       <div data-sg-embed data-url="https://camera.example.com/mjpg/video.mjpg"></div>
       <script src="sg-embed.js"></script>

       data-url    stream / page URL
       data-mode   auto (default) | mjpeg | snapshot | video | hls | page | html
       data-fit    contain (default, whole picture) | cover (fill, may crop)
       data-every  seconds between snapshot refreshes (default 2)
       Custom HTML: put it in a <template> inside the element.

     JavaScript:
       SGEmbed.mount(el, { mode, url, html, fit, every, editable })
         → { refresh, destroy, edit }
       editable: true adds an editor and fires "sg:config" on save.
     ============================================================ */

  (function ensureCss() {
    if (document.querySelector('link[href*="sg-embed.css"], [data-sg-embed-css]')) return;
    const me = document.currentScript;
    const base = me && me.src
      ? me.src.replace(/[^\/]*(\?.*)?$/, "")
      : "https://cgermain45.github.io/cashbid-widget/";
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = base + "sg-embed.css";
    link.setAttribute("data-sg-embed-css", "");
    document.head.appendChild(link);
  })();

  const HLS_JS = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
  const RETRY_MS = 10000;

  const MODES = [
    { id: "auto", label: "Auto-detect from the URL" },
    { id: "mjpeg", label: "Camera live stream (MJPEG)" },
    { id: "snapshot", label: "Camera still image (refreshes)" },
    { id: "video", label: "Video file or stream (MP4 / WebM)" },
    { id: "hls", label: "HLS live stream (.m3u8)" },
    { id: "page", label: "Web page / camera viewer / YouTube" },
    { id: "html", label: "Custom HTML (sandboxed)" }
  ];

  const MODE_NAMES = Object.fromEntries(MODES.map(m => [m.id, m.label]));

  /* ============================================================
     HELPERS
     ============================================================ */

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function absUrl(u) {
    try {
      const a = new URL(String(u || "").trim(), document.baseURI);
      return /^https?:$/.test(a.protocol) ? a : null;
    } catch (e) {
      return null;
    }
  }

  /* YouTube watch/short/live links → embeddable player URL */
  function youtubeEmbed(u) {
    const host = u.hostname.replace(/^www\./, "");
    let id = null;
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (/youtube\.com$/.test(host)) {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        const m = /^\/(?:live|shorts|embed)\/([\w-]{6,})/.exec(u.pathname);
        if (m) id = m[1];
      }
    }
    return id && /^[\w-]{6,}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`
      : null;
  }

  function detectMode(url) {
    const u = absUrl(url);
    if (!u) return null;
    const path = (u.pathname + u.search).toLowerCase();
    if (/\.m3u8(\b|$)/.test(path)) return "hls";
    if (/\.(mp4|webm|ogv|mov)(\b|$)/.test(path)) return "video";
    if (/(mjpe?g|video\.cgi|videostream|faststream|nphmotionjpeg|axis-cgi\/mjpg|\/stream(\.cgi)?\b|action=stream)/.test(path)) return "mjpeg";
    if (/\.(jpe?g|png|gif|webp)(\b|$)/.test(path) || /(snapshot|image\.cgi|still|action=snapshot|jpg\/image)/.test(path)) return "snapshot";
    return "page";
  }

  function insecure(url) {
    const u = absUrl(url);
    return !!u && u.protocol === "http:" && location.protocol === "https:";
  }

  function withBuster(url) {
    const u = absUrl(url);
    if (!u) return url;
    u.searchParams.set("_sg", Date.now().toString(36));
    return u.href;
  }

  /* ============================================================
     WIDGET
     ============================================================ */

  function mount(el, options) {
    if (!el) return null;
    if (el.sgEmbed) return el.sgEmbed;

    const d = el.dataset;
    const o = options || {};

    let inlineHtml = "";
    const tpl = el.querySelector("template");
    if (tpl) inlineHtml = tpl.innerHTML;

    const state = {
      mode: o.mode || d.mode || (inlineHtml && !(o.url || d.url) ? "html" : "auto"),
      url: o.url || d.url || "",
      html: o.html != null ? o.html : inlineHtml,
      fit: (o.fit || d.fit) === "cover" ? "cover" : "contain",
      every: Math.max(1, Math.min(300, Number(o.every ?? d.every ?? 2) || 2))
    };
    const editable = !!o.editable;
    const theme = o.theme || d.theme || "dark";

    el.classList.add("sge", "sge-theme-" + theme);
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Embedded media");

    let timers = [];
    let editing = false;

    function clearTimers() {
      timers.forEach(t => { clearTimeout(t); clearInterval(t); });
      timers = [];
    }

    function effectiveMode() {
      if (state.mode === "html") return "html";
      return state.mode === "auto" ? detectMode(state.url) : state.mode;
    }

    function message(text, isError) {
      el.innerHTML = `<div class="sge-msg${isError ? " sge-error" : ""}">${text}</div>`;
    }

    function status(text) {
      let badge = el.querySelector(".sge-status");
      if (!text) { if (badge) badge.remove(); return; }
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "sge-status";
        badge.setAttribute("role", "status");
        el.appendChild(badge);
      }
      badge.textContent = text;
    }

    function fired(ok) {
      el.dispatchEvent(new CustomEvent(ok ? "sg:updated" : "sg:error", { detail: ok ? { updated: new Date() } : new Error("Media failed") }));
    }

    /* ---------- render ---------- */

    function render() {
      clearTimers();
      if (editing) return;

      const mode = effectiveMode();

      if (mode === "html") {
        if (!state.html.trim()) {
          message(editable ? "No HTML yet. Use ✏️ to add some." : "Nothing to show.");
          return;
        }
        el.innerHTML = "";
        const frame = document.createElement("iframe");
        frame.className = "sge-frame";
        frame.title = "Custom content";
        // allow-scripts only: opaque origin, no access to this site's storage or page
        frame.setAttribute("sandbox", "allow-scripts allow-presentation");
        frame.setAttribute("referrerpolicy", "no-referrer");
        frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
        frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:transparent;color:#e6edf3;font-family:system-ui,sans-serif}
img,video,iframe{max-width:100%}</style></head><body>${state.html}</body></html>`;
        el.appendChild(frame);
        fired(true);
        return;
      }

      const u = absUrl(state.url);
      if (!u) {
        message(editable ? "Add a camera, video or page address with ✏️." : "No address set.");
        return;
      }

      if (insecure(state.url)) {
        message(`This address starts with <code>http://</code>. Browsers block insecure video and pages inside a secure (https) site.
          Use the camera's <code>https://</code> address or its vendor's cloud viewer.`, true);
        fired(false);
        return;
      }

      const href = u.href;
      const fitClass = "sge-fit-" + state.fit;

      if (mode === "mjpeg" || mode === "snapshot") {
        el.innerHTML = `<img class="sge-media ${fitClass}" alt="Camera" referrerpolicy="no-referrer">`;
        let img = el.querySelector("img");
        let retryTimer = null;

        function onFail() {
          status("Camera unavailable — reconnecting…");
          fired(false);
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => { img.src = mode === "snapshot" ? withBuster(href) : href; }, RETRY_MS);
          timers.push(retryTimer);
        }

        img.addEventListener("load", () => { status(""); fired(true); });
        img.addEventListener("error", onFail);

        if (mode === "snapshot") {
          img.src = withBuster(href);
          timers.push(setInterval(() => {
            // Load the next frame off-screen, then swap it in: no blank flash
            // and no second download of the same frame
            const next = new Image();
            next.className = img.className;
            next.alt = img.alt;
            next.referrerPolicy = "no-referrer";
            next.onload = () => {
              if (!img.isConnected) return;
              img.replaceWith(next);
              img = next;
              next.addEventListener("error", onFail);
              status("");
              fired(true);
            };
            next.onerror = onFail;
            next.src = withBuster(href);
          }, state.every * 1000));
        } else {
          img.src = href;
        }
        return;
      }

      if (mode === "video") {
        el.innerHTML = `<video class="sge-media ${fitClass}" autoplay muted loop playsinline></video>`;
        const video = el.querySelector("video");
        video.addEventListener("playing", () => { status(""); fired(true); });
        video.addEventListener("error", () => {
          status("Video unavailable — reconnecting…");
          fired(false);
          timers.push(setTimeout(() => { video.src = href; video.play().catch(() => {}); }, RETRY_MS));
        });
        video.src = href;
        video.play().catch(() => {});
        return;
      }

      if (mode === "hls") {
        // hls.js runs inside a sandbox so no third-party code touches this page
        el.innerHTML = "";
        const frame = document.createElement("iframe");
        frame.className = "sge-frame";
        frame.title = "Live video";
        frame.setAttribute("sandbox", "allow-scripts");
        frame.setAttribute("allow", "autoplay; fullscreen");
        frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#000}video{width:100%;height:100%;object-fit:${state.fit}}
#m{position:absolute;left:8px;bottom:8px;font:12px system-ui;color:#fff;background:rgba(0,0,0,.6);padding:3px 8px;border-radius:4px}</style>
</head><body><video id="v" autoplay muted playsinline></video><div id="m" hidden></div>
<script src="${HLS_JS}"><\/script><script>
var src=${JSON.stringify(href).replace(/</g, "\\u003c")},v=document.getElementById('v'),m=document.getElementById('m');
function say(t){m.hidden=!t;m.textContent=t||'';}
function start(){
  if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=src;v.play().catch(function(){});return;}
  if(!window.Hls||!Hls.isSupported()){say('This browser can\\'t play HLS streams.');return;}
  var h=new Hls({liveDurationInfinity:true});h.loadSource(src);h.attachMedia(v);
  h.on(Hls.Events.MANIFEST_PARSED,function(){say('');v.play().catch(function(){});});
  h.on(Hls.Events.ERROR,function(e,d){if(d.fatal){say('Stream unavailable — reconnecting…');h.destroy();setTimeout(start,${RETRY_MS});}});
}
start();
<\/script></body></html>`;
        el.appendChild(frame);
        fired(true);
        return;
      }

      // Web page: sandboxed iframe. Same-site pages don't get allow-same-origin,
      // so they can't escape the sandbox and read this site's storage.
      const yt = youtubeEmbed(u);
      const pageUrl = yt || href;
      const sameSite = new URL(pageUrl).origin === location.origin;
      el.innerHTML = "";
      const frame = document.createElement("iframe");
      frame.className = "sge-frame";
      frame.title = "Embedded page";
      frame.setAttribute("sandbox", "allow-scripts allow-forms allow-presentation" + (sameSite ? "" : " allow-same-origin"));
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
      frame.setAttribute("loading", "lazy");
      frame.src = pageUrl;
      frame.addEventListener("load", () => fired(true));
      el.appendChild(frame);
    }

    /* ---------- editor ---------- */

    function edit() {
      if (!editable) return;
      editing = true;
      clearTimers();

      let draft = Object.assign({}, state);

      function draw() {
        const detected = draft.mode === "auto" ? detectMode(draft.url) : null;
        el.innerHTML = `
          <form class="sge-editor" novalidate>
            <strong class="sge-ed-head">Video / web embed</strong>

            <label>What to show
              <select name="mode">
                ${MODES.map(m => `<option value="${m.id}"${m.id === draft.mode ? " selected" : ""}>${m.label}</option>`).join("")}
              </select>
            </label>

            ${draft.mode === "html" ? `
              <label>HTML
                <textarea name="html" rows="7" spellcheck="false" placeholder="&lt;iframe src=&quot;https://…&quot;&gt;&lt;/iframe&gt;">${escapeHtml(draft.html)}</textarea>
              </label>
              <p class="sge-note">Runs in a sandbox: it can show content and run its own scripts, but it can't see this page, its saved settings (like your API key), open pop-ups or redirect the screen.</p>
            ` : `
              <label>Address (URL)
                <input name="url" type="url" spellcheck="false" placeholder="https://camera.example.com/mjpg/video.mjpg" value="${escapeHtml(draft.url)}">
              </label>
              <p class="sge-note sge-detect">${detected ? `Detected: <strong>${escapeHtml(MODE_NAMES[detected])}</strong>` : "Paste the camera's live-view address, a video/.m3u8 stream, or a web page."}</p>
              ${insecure(draft.url) ? `<p class="sge-note sge-warn">⚠ <code>http://</code> addresses are blocked by browsers on secure sites. Use an <code>https://</code> address.</p>` : ""}
              ${(detected || draft.mode) === "snapshot" ? `
                <label class="sge-short">Refresh the image every
                  <select name="every">
                    ${[1, 2, 5, 10, 30, 60].map(n => `<option value="${n}"${n === draft.every ? " selected" : ""}>${n} second${n > 1 ? "s" : ""}</option>`).join("")}
                  </select>
                </label>` : ""}
              <label class="sge-short">Picture
                <select name="fit">
                  <option value="contain"${draft.fit === "contain" ? " selected" : ""}>Show the whole picture</option>
                  <option value="cover"${draft.fit === "cover" ? " selected" : ""}>Fill the panel (may crop edges)</option>
                </select>
              </label>
              <p class="sge-note">Tips: use a view-only camera account. If a web page stays blank, that site doesn't allow being embedded — try its "embed" or "share" link.</p>
            `}

            <p class="sge-ed-msg" role="alert"></p>
            <div class="sge-ed-actions">
              <button type="button" class="sge-btn sge-cancel">Cancel</button>
              <button type="submit" class="sge-btn sge-save">Save</button>
            </div>
          </form>`;
        wire();
      }

      function capture(form) {
        draft.mode = form.elements.mode.value;
        if (form.elements.url) draft.url = form.elements.url.value.trim();
        if (form.elements.html) draft.html = form.elements.html.value;
        if (form.elements.fit) draft.fit = form.elements.fit.value === "cover" ? "cover" : "contain";
        if (form.elements.every) draft.every = Number(form.elements.every.value) || 2;
      }

      function wire() {
        const form = el.querySelector(".sge-editor");
        const msg = form.querySelector(".sge-ed-msg");

        form.elements.mode.addEventListener("change", () => { capture(form); draw(); });

        // Live "Detected: …" hint and http warning while typing
        if (form.elements.url) {
          form.elements.url.addEventListener("input", () => {
            const before = draft.mode === "auto" ? detectMode(draft.url) : null;
            capture(form);
            const after = draft.mode === "auto" ? detectMode(draft.url) : null;
            const warnNow = insecure(draft.url);
            const warnShown = !!form.querySelector(".sge-warn");
            if (before !== after || warnNow !== warnShown) {
              const pos = form.elements.url.selectionStart;
              draw();
              const input = el.querySelector(".sge-editor input[name=url]");
              input.focus();
              try { input.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
            }
          });
        }

        form.querySelector(".sge-cancel").addEventListener("click", () => {
          editing = false;
          render();
        });

        form.addEventListener("submit", e => {
          e.preventDefault();
          capture(form);
          msg.textContent = "";

          if (draft.mode === "html") {
            if (draft.html.length > 50000) { msg.textContent = "That HTML is too long (50,000 characters max)."; return; }
          } else {
            if (!/^https?:\/\/\S+$/i.test(draft.url) || !absUrl(draft.url)) { msg.textContent = "Enter the full address, starting with https://"; return; }
          }

          Object.assign(state, draft);
          editing = false;
          el.dispatchEvent(new CustomEvent("sg:config", {
            detail: { mode: state.mode, url: state.url, html: state.html, fit: state.fit, every: state.every }
          }));
          render();
        });
      }

      draw();
      const first = el.querySelector(".sge-editor input[name=url], .sge-editor textarea");
      if (first) first.focus({ preventScroll: true });
    }

    /* ---------- lifecycle ---------- */

    render();

    function destroy() {
      clearTimers();
      el.innerHTML = "";
      el.classList.remove("sge", "sge-theme-" + theme);
      delete el.sgEmbed;
    }

    const api = {
      el,
      // Board-wide refreshes don't reload live video; the panel button does
      refresh: opts => { if (!(opts && opts.auto) && !editing) render(); return Promise.resolve(); },
      destroy,
      edit
    };
    el.sgEmbed = api;
    return api;
  }

  window.SGEmbed = { mount, detectMode };

  function autoMount() {
    document.querySelectorAll("[data-sg-embed]").forEach(el => mount(el));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
