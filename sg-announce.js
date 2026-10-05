(function () {
  /* ============================================================
     ANNOUNCEMENTS — rotating slides for messages and ads
     ------------------------------------------------------------
     Each slide: headline, message, optional image (beside the text
     or filling the panel) and an optional background color.

     Embed with slides from a hosted JSON file:
       <div data-sg-announce data-feed="https://…/announcements.json"></div>
       <script src="sg-announce.js"></script>

     …or inline:
       <div data-sg-announce>
         <script type="application/json">
           { "interval": 10, "slides": [ { "title": "Harvest hours", "text": "Open 6am–10pm" } ] }
         </script>
       </div>

     JSON format (an object, or just the slides array):
       {
         "interval": 10,                     // seconds per slide
         "slides": [
           {
             "title": "Headline",
             "text": "Message text\nLine breaks are kept",
             "image": "https://…/ad.jpg",      // optional
             "imageMode": "side" | "fill",     // beside text, or fill the panel
             "background": "#14532d"           // optional
           }
         ]
       }

     Optional attributes: data-interval (seconds), data-theme
     (light | dark | none), data-refresh (minutes, for data-feed; default 5).

     JavaScript:
       SGAnnounce.mount(el, { slides, feed, interval, editable, theme })
         → { refresh, destroy, edit }
       editable: true adds an editor (see edit()) and fires
       "sg:config" with { source, feed, slides, interval } on save.
     ============================================================ */

  (function ensureCss() {
    if (document.querySelector('link[href*="sg-announce.css"], [data-sg-announce-css]')) return;
    const me = document.currentScript;
    const base = me && me.src
      ? me.src.replace(/[^\/]*(\?.*)?$/, "")
      : "https://cgermain45.github.io/cashbid-widget/";
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = base + "sg-announce.css";
    link.setAttribute("data-sg-announce-css", "");
    document.head.appendChild(link);
  })();

  const INTERVALS = [5, 8, 10, 15, 20, 30, 60];
  const MAX_SLIDES = 30;

  /* ============================================================
     HELPERS
     ============================================================ */

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /* Web images only: absolute http(s) URLs, or paths relative to the
     page (resolved to absolute). Anything else (javascript:, data:…) is dropped. */
  function safeUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    try {
      const abs = new URL(u, document.baseURI);
      return /^https?:$/.test(abs.protocol) ? abs.href : "";
    } catch (e) {
      return "";
    }
  }

  function safeColor(c) {
    const v = String(c || "").trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : "";
  }

  // Readable text color for a background
  function inkFor(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "";
    const n = parseInt(m[1], 16);
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.36 ? "#111827" : "#ffffff";
  }

  function cleanSlide(s) {
    s = s || {};
    return {
      title: String(s.title || "").slice(0, 200),
      text: String(s.text || "").slice(0, 2000),
      image: safeUrl(s.image),
      imageMode: s.imageMode === "fill" ? "fill" : "side",
      background: safeColor(s.background)
    };
  }

  function parseConfig(json) {
    const obj = Array.isArray(json) ? { slides: json } : (json || {});
    const slides = Array.isArray(obj.slides) ? obj.slides.slice(0, MAX_SLIDES).map(cleanSlide) : null;
    if (!slides) throw new Error("No \"slides\" list found in the file.");
    const interval = Number(obj.interval);
    return { slides, interval: isFinite(interval) && interval >= 3 ? interval : null };
  }

  function clampInterval(v, fallback) {
    const n = Number(v);
    return isFinite(n) && n >= 3 ? Math.min(600, Math.round(n)) : fallback;
  }

  /* ============================================================
     WIDGET
     ============================================================ */

  let count = 0;

  function mount(el, options) {
    if (!el) return null;
    if (el.sgAnnounce) return el.sgAnnounce;

    const d = el.dataset;
    const o = options || {};
    const uid = "sga" + (++count);

    // Inline JSON inside the element (standalone embeds)
    let inline = null;
    const inlineScript = el.querySelector('script[type="application/json"]');
    if (inlineScript) {
      try { inline = parseConfig(JSON.parse(inlineScript.textContent)); } catch (e) { console.error("sg-announce: invalid inline JSON", e); }
    }

    const state = {
      source: o.source || ((o.feed || d.feed) ? "feed" : "local"),
      feed: o.feed || d.feed || "",
      slides: (o.slides || (inline && inline.slides) || []).map(cleanSlide),
      interval: clampInterval(o.interval ?? d.interval ?? (inline && inline.interval), 10),
      feedSlides: null,
      feedError: ""
    };
    const editable = !!o.editable;
    const theme = o.theme || d.theme || "light";
    const refreshMin = Number(o.refresh ?? d.refresh ?? 5);

    el.classList.add("sga", "sga-theme-" + theme);
    el.setAttribute("role", "region");
    el.setAttribute("aria-roledescription", "carousel");
    el.setAttribute("aria-label", "Announcements");

    let index = 0;
    let rotateTimer = null;
    let refreshTimer = null;
    let paused = false;
    let editing = false;

    function activeSlides() {
      return state.source === "feed" ? (state.feedSlides || []) : state.slides;
    }

    /* ---------- data ---------- */

    function loadFeed() {
      if (state.source !== "feed" || !state.feed) return Promise.resolve();
      return fetch(state.feed, { cache: "no-cache" })
        .then(r => {
          if (!r.ok) throw new Error(`The announcements file returned an error (${r.status}).`);
          return r.json().catch(() => { throw new Error("The announcements file isn't valid JSON."); });
        })
        .then(json => {
          const cfg = parseConfig(json);
          state.feedSlides = cfg.slides;
          if (cfg.interval) state.interval = clampInterval(cfg.interval, state.interval);
          state.feedError = "";
          el.dispatchEvent(new CustomEvent("sg:updated", { detail: { updated: new Date() } }));
        })
        .catch(err => {
          state.feedError = err instanceof TypeError
            ? "Couldn't load the announcements file. Check the URL (the host must allow access from this site)."
            : err.message;
          el.dispatchEvent(new CustomEvent("sg:error", { detail: err }));
        })
        .then(() => { if (!editing) render(); });
    }

    /* ---------- view ---------- */

    function slideHtml(s, i, total) {
      const bg = s.background;
      const ink = inkFor(bg);
      const style = bg ? ` style="--sga-slide-bg:${bg};--sga-slide-ink:${ink}"` : "";
      const hasText = s.title || s.text;
      const mode = s.image ? (s.imageMode === "fill" ? "fill" : "side") : "text";
      const textHtml = hasText ? `
        <div class="sga-text">
          ${s.title ? `<h3 class="sga-title">${escapeHtml(s.title)}</h3>` : ""}
          ${s.text ? `<p class="sga-body">${escapeHtml(s.text)}</p>` : ""}
        </div>` : "";
      const imgHtml = s.image
        ? `<div class="sga-media"><img src="${escapeHtml(s.image)}" alt="${escapeHtml(s.title || "Announcement image")}" loading="lazy" decoding="async"></div>`
        : "";

      return `
        <div class="sga-slide sga-mode-${mode}${bg ? " sga-has-bg" : ""}${hasText ? "" : " sga-image-only"}"
             role="group" aria-roledescription="slide" aria-label="${i + 1} of ${total}"${style}
             ${i === index ? "" : "hidden"}>
          ${imgHtml}${textHtml}
        </div>`;
    }

    function render() {
      clearTimeout(rotateTimer);
      if (editing) return;

      const slides = activeSlides();
      if (index >= slides.length) index = 0;

      let body;
      if (state.source === "feed" && state.feedError && !slides.length) {
        body = `<div class="sga-empty sga-error">${escapeHtml(state.feedError)}</div>`;
      } else if (state.source === "feed" && !state.feedSlides && !state.feedError) {
        body = `<div class="sga-empty">Loading announcements…</div>`;
      } else if (!slides.length) {
        body = `<div class="sga-empty">${editable
          ? "No announcements yet. Use ✏️ to add a slide."
          : "No announcements right now."}</div>`;
      } else {
        body = `
          <div class="sga-track" aria-live="${paused ? "polite" : "off"}">
            ${slides.map((s, i) => slideHtml(s, i, slides.length)).join("")}
          </div>
          ${slides.length > 1 ? `
            <div class="sga-dots" role="tablist" aria-label="Choose slide">
              ${slides.map((s, i) => `
                <button type="button" class="sga-dot${i === index ? " sga-dot-on" : ""}" role="tab"
                        aria-selected="${i === index}" aria-label="Slide ${i + 1}${s.title ? ": " + escapeHtml(s.title) : ""}"
                        data-i="${i}"></button>`).join("")}
            </div>` : ""}`;
      }

      el.innerHTML = body;
      schedule();
    }

    function show(i) {
      const slides = el.querySelectorAll(".sga-slide");
      if (!slides.length) return;
      index = (i + slides.length) % slides.length;
      slides.forEach((s, n) => { s.hidden = n !== index; });
      el.querySelectorAll(".sga-dot").forEach((dot, n) => {
        dot.classList.toggle("sga-dot-on", n === index);
        dot.setAttribute("aria-selected", String(n === index));
      });
      schedule();
    }

    function schedule() {
      clearTimeout(rotateTimer);
      if (paused || editing || activeSlides().length < 2) return;
      rotateTimer = setTimeout(() => show(index + 1), state.interval * 1000);
    }

    // Pause while someone is pointing at or tabbing through the slides
    el.addEventListener("mouseenter", () => { paused = true; clearTimeout(rotateTimer); });
    el.addEventListener("mouseleave", () => { paused = false; schedule(); });
    el.addEventListener("focusin", e => { if (e.target.closest(".sga-dots")) { paused = true; clearTimeout(rotateTimer); } });
    el.addEventListener("focusout", e => { if (e.target.closest(".sga-dots")) { paused = false; schedule(); } });

    el.addEventListener("click", e => {
      const dot = e.target.closest(".sga-dot");
      if (dot) show(Number(dot.dataset.i));
    });

    /* ---------- editor ---------- */

    function slideEditorHtml(s, i, all) {
      const total = all.length;
      return `
        <fieldset class="sga-ed-slide" data-i="${i}">
          <legend>
            Slide ${i + 1}
            <span class="sga-ed-tools">
              <button type="button" class="sga-ed-btn" data-act="up" ${i === 0 ? "disabled" : ""} aria-label="Move slide ${i + 1} up" title="Move up">↑</button>
              <button type="button" class="sga-ed-btn" data-act="down" ${i === total - 1 ? "disabled" : ""} aria-label="Move slide ${i + 1} down" title="Move down">↓</button>
              <button type="button" class="sga-ed-btn sga-ed-del" data-act="del" aria-label="Delete slide ${i + 1}" title="Delete">✕</button>
            </span>
          </legend>
          <label>Headline <input name="title" type="text" maxlength="200" value="${escapeHtml(s.title)}"></label>
          <label>Message <textarea name="text" rows="3" maxlength="2000">${escapeHtml(s.text)}</textarea></label>
          <label>Image URL <span class="sga-ed-opt">(optional)</span>
            <input name="image" type="url" spellcheck="false" placeholder="https://…/image.jpg" value="${escapeHtml(s.image)}">
          </label>
          <div class="sga-ed-row">
            <label>Image layout
              <select name="imageMode">
                <option value="side"${s.imageMode !== "fill" ? " selected" : ""}>Beside the text</option>
                <option value="fill"${s.imageMode === "fill" ? " selected" : ""}>Fill the panel</option>
              </select>
            </label>
            <label class="sga-ed-color">Background
              <span>
                <input name="useBg" type="checkbox" ${s.background ? "checked" : ""} aria-label="Use a custom background color">
                <input name="background" type="color" value="${escapeHtml(s.background || "#1f6f43")}">
              </span>
            </label>
          </div>
        </fieldset>`;
    }

    function readEditorSlides(form) {
      return [...form.querySelectorAll(".sga-ed-slide")].map(fs => cleanSlide({
        title: fs.querySelector('[name="title"]').value.trim(),
        text: fs.querySelector('[name="text"]').value.trim(),
        image: fs.querySelector('[name="image"]').value.trim(),
        imageMode: fs.querySelector('[name="imageMode"]').value,
        background: fs.querySelector('[name="useBg"]').checked ? fs.querySelector('[name="background"]').value : ""
      }));
    }

    function edit() {
      if (!editable) return;
      editing = true;
      clearTimeout(rotateTimer);

      let draft = state.slides.length ? state.slides.map(s => Object.assign({}, s)) : [cleanSlide({})];
      let source = state.source;
      let draftInterval = state.interval;
      let draftFeed = state.feed;

      // Keep unsaved choices when the editor redraws (add/move/delete/source)
      function remember(form) {
        draftInterval = clampInterval(form.elements.interval.value, draftInterval);
        if (form.elements.feed) draftFeed = form.elements.feed.value.trim();
        if (source === "local") draft = readEditorSlides(form);
      }

      function draw() {
        el.innerHTML = `
          <form class="sga-editor" novalidate>
            <div class="sga-ed-head">
              <strong>Edit announcements</strong>
            </div>
            <div class="sga-ed-source" role="radiogroup" aria-label="Where slides come from">
              <label><input type="radio" name="${uid}-src" value="local" ${source === "local" ? "checked" : ""}> Edit slides here</label>
              <label><input type="radio" name="${uid}-src" value="feed" ${source === "feed" ? "checked" : ""}> Load from a hosted file</label>
            </div>

            ${source === "feed" ? `
              <label>Announcements file URL (JSON)
                <input name="feed" type="url" spellcheck="false" placeholder="https://yourcompany.com/announcements.json"
                       value="${escapeHtml(draftFeed)}">
              </label>
              <p class="sga-ed-note">Every screen pointed at this file shows the same slides; edit the file and they all update within a few minutes.
                Format: <code>{ "interval": 10, "slides": [ { "title": "…", "text": "…", "image": "https://…", "imageMode": "side" } ] }</code></p>
            ` : `
              <div class="sga-ed-slides">${draft.map(slideEditorHtml).join("")}</div>
              <button type="button" class="sga-ed-btn sga-ed-add" ${draft.length >= MAX_SLIDES ? "disabled" : ""}>+ Add slide</button>
              <p class="sga-ed-note">Slides are saved on this device. Images are web addresses (https://…).</p>
            `}

            <label class="sga-ed-interval">Show each slide for
              <select name="interval">
                ${(INTERVALS.includes(draftInterval) ? INTERVALS : INTERVALS.concat([draftInterval]).sort((a, b) => a - b))
                  .map(n => `<option value="${n}"${n === draftInterval ? " selected" : ""}>${n} seconds</option>`).join("")}
              </select>
            </label>

            <p class="sga-ed-msg" role="alert"></p>
            <div class="sga-ed-actions">
              <button type="button" class="sga-ed-btn sga-ed-cancel">Cancel</button>
              <button type="submit" class="sga-ed-btn sga-ed-save">Save</button>
            </div>
          </form>`;
        wire();
      }

      function wire() {
        const form = el.querySelector(".sga-editor");
        const msg = form.querySelector(".sga-ed-msg");

        form.querySelectorAll(`input[name="${uid}-src"]`).forEach(r => r.addEventListener("change", () => {
          remember(form);
          source = r.value;
          draw();
        }));

        form.addEventListener("click", e => {
          const btn = e.target.closest("[data-act]");
          if (btn) {
            remember(form);
            const i = Number(btn.closest(".sga-ed-slide").dataset.i);
            if (btn.dataset.act === "del") draft.splice(i, 1);
            if (btn.dataset.act === "up" && i > 0) [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]];
            if (btn.dataset.act === "down" && i < draft.length - 1) [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]];
            draw();
            return;
          }
          if (e.target.closest(".sga-ed-add")) {
            remember(form);
            draft.push(cleanSlide({}));
            draw();
            const last = el.querySelector(".sga-ed-slide:last-of-type input[name=title]");
            if (last) last.focus();
            return;
          }
          if (e.target.closest(".sga-ed-cancel")) {
            editing = false;
            render();
          }
        });

        // Picking a color turns the custom background on
        form.addEventListener("input", e => {
          if (e.target.name === "background") {
            e.target.closest(".sga-ed-color").querySelector('[name="useBg"]').checked = true;
          }
        });

        form.addEventListener("submit", e => {
          e.preventDefault();
          msg.textContent = "";
          const interval = clampInterval(form.elements.interval.value, 10);

          if (source === "feed") {
            const url = form.elements.feed.value.trim();
            if (!/^https?:\/\/\S+$/i.test(url)) {
              msg.textContent = "Enter the full file address, starting with https://";
              return;
            }
            const save = form.querySelector(".sga-ed-save");
            save.disabled = true;
            save.textContent = "Checking…";
            fetch(url, { cache: "no-cache" })
              .then(r => {
                if (!r.ok) throw new Error(`That file returned an error (${r.status}).`);
                return r.json().catch(() => { throw new Error("That file isn't valid JSON."); });
              })
              .then(json => {
                const cfg = parseConfig(json);
                Object.assign(state, { source: "feed", feed: url, feedSlides: cfg.slides, feedError: "", interval: cfg.interval ? clampInterval(cfg.interval, interval) : interval });
                finish();
              })
              .catch(err => {
                save.disabled = false;
                save.textContent = "Save";
                msg.textContent = err instanceof TypeError
                  ? "Couldn't load that file. Check the URL — the host must allow access from this site."
                  : err.message;
              });
            return;
          }

          const slides = readEditorSlides(form);
          const rawImages = [...form.querySelectorAll('.sga-ed-slide [name="image"]')].map(i => i.value.trim());
          const badImage = rawImages.findIndex(v => v && !safeUrl(v));
          if (badImage !== -1) {
            msg.textContent = `Slide ${badImage + 1}: the image needs a web address (https://…) or a path on this site.`;
            return;
          }
          const kept = slides.filter(s => s.title || s.text || s.image);
          Object.assign(state, { source: "local", slides: kept, interval });
          finish();
        });
      }

      function finish() {
        editing = false;
        index = 0;
        el.dispatchEvent(new CustomEvent("sg:config", {
          detail: { source: state.source, feed: state.feed, slides: state.slides.slice(), interval: state.interval }
        }));
        startRefresh();
        render();
      }

      draw();
      const first = el.querySelector(".sga-editor input[name=title], .sga-editor input[name=feed]");
      if (first) first.focus({ preventScroll: true });
    }

    /* ---------- lifecycle ---------- */

    function startRefresh() {
      clearInterval(refreshTimer);
      if (state.source === "feed" && refreshMin > 0) {
        refreshTimer = setInterval(loadFeed, refreshMin * 60 * 1000);
      }
    }

    render();
    loadFeed();
    startRefresh();

    function destroy() {
      clearTimeout(rotateTimer);
      clearInterval(refreshTimer);
      el.innerHTML = "";
      el.classList.remove("sga", "sga-theme-" + theme);
      delete el.sgAnnounce;
    }

    const api = {
      el,
      refresh: () => (state.source === "feed" ? loadFeed() : Promise.resolve()),
      destroy,
      edit,
      isEditing: () => editing
    };
    el.sgAnnounce = api;
    return api;
  }

  window.SGAnnounce = { mount };

  function autoMount() {
    document.querySelectorAll("[data-sg-announce]").forEach(el => mount(el));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
