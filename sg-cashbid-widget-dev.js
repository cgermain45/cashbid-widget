(function () {
  /* ============================================================
     CASH BID WIDGET — DELUXE + COLUMN REORDER + DATE FORMATS
     ============================================================ */

  let sg_instanceCount = 0;

  /* ============================================================
     SHARED HELPERS (pure — no instance state)
     ============================================================ */

  /* Feed text is data, never markup: escape it before it goes into HTML */
  function sg_escape(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function sg_parseNum(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    const str = String(v).trim();
    if (/^unch/i.test(str)) return 0;
    const cleaned = str.replace(/[^0-9.+-]/g, "");
    if (!cleaned) return NaN;
    return parseFloat(cleaned);
  }

  /* ============================================================
     CASH PRICE ROUNDING
     bid.rounding is a round-up threshold on the fraction of a cent:
     .25 → 3.7738 becomes 3.78 (.38¢ ≥ .25); .75 → 3.77; .5 is normal
     rounding. -1 (or missing/invalid) leaves the price as provided.
     ============================================================ */

  function sg_roundCashPrice(bid) {
    const raw = bid.cashprice;
    if (raw === null || raw === undefined || raw === "") return "-";

    const threshold = sg_parseNum(bid.rounding);
    const price = sg_parseNum(raw);
    if (isNaN(price) || isNaN(threshold) || threshold < 0 || threshold > 1) {
      return raw;
    }

    const sign = price < 0 ? -1 : 1;
    // Round to 6 places first so float noise (e.g. 3.77 * 100) doesn't leak in
    const cents = Math.round(Math.abs(price) * 100 * 1e6) / 1e6;
    const whole = Math.floor(cents);
    const frac = Math.round((cents - whole) * 1e6) / 1e6;
    const rounded = frac > 0 && frac >= threshold ? whole + 1 : whole;

    return (sign * rounded / 100).toFixed(2);
  }

  /* ============================================================
     WIDGET FACTORY — one call per widget instance
     ============================================================ */

  function createCashBidWidget(widget, options) {
    if (!widget) return null;
    if (widget.sgCashBid) return widget.sgCashBid;

    const opts = Object.assign(
      { storagePrefix: "", autoRefresh: true, json: null },
      options || {}
    );

    widget.classList.add("sg-cashbid");

    const sg_url =
      opts.json ||
      widget.dataset.json ||
      "https://stonegrain.agricharts.com/inc/cashbids/cashbids-json.php";

    // Unique per instance so radio groups don't collide across widgets
    const uid = "sg" + (++sg_instanceCount);

    // Per-instance settings storage (prefix "" keeps standalone keys as-is)
    const store = {
      get(k) {
        try { return localStorage.getItem(opts.storagePrefix + k); } catch (e) { return null; }
      },
      set(k, v) {
        try { localStorage.setItem(opts.storagePrefix + k, v); } catch (e) { /* ignore */ }
      },
      remove(k) {
        try { localStorage.removeItem(opts.storagePrefix + k); } catch (e) { /* ignore */ }
      }
    };

    const timers = [];
    let sg_flash = new Map();

    let sg_locations = [];
    let sg_allCommodities = new Set();
    let renderTimer = null;

    /* ============================================================
       COLUMN DEFINITIONS (BASE + CURRENT ORDER)
       ============================================================ */

    const sg_defaultColumns = [
      { key: "commodity", label: "Commodity" },
      { key: "delivery", label: "Delivery" },
      { key: "futures", label: "Futures" },
      { key: "basis", label: "Basis" },
      { key: "cashprice", label: "Cash Price" },
      { key: "change", label: "Change" }
    ];

    let sg_columns = sg_defaultColumns.slice();

    loadColumnOrder();

    /* ============================================================
       SORT STATE (MULTI-COLUMN)
       Array of { key, dir } — first entry is the primary sort.
       ============================================================ */

    let sg_sort = loadSortState();
    let sg_groupBy =
      store.get("sg-group-by") === "commodity" ? "commodity" : "location";
    let sg_lastUpdated = null;
    let sg_lastRefreshFailed = false;

    /* ============================================================
       WIDGET SHELL
       ============================================================ */

    widget.innerHTML = `
      <div class="sg-filter-bar">

        <div class="sg-filter-section">
          <div class="sg-filter-title sg-collapsible"
               data-target="sg-filter-locations">
            Locations
          </div>
          <div class="sg-filter-locations sg-filter-content"></div>
        </div>

        <div class="sg-filter-section">
          <div class="sg-filter-title sg-collapsible"
               data-target="sg-filter-commodities">
            Commodities
          </div>
          <div class="sg-filter-commodities sg-filter-content"></div>
        </div>

        <div class="sg-filter-section sg-settings-section">
          <button type="button" class="sg-settings-btn sg-collapsible"
                  data-target="sg-settings-panel"
                  aria-label="Settings" title="Settings" aria-haspopup="true">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="currentColor" d="M19.14 12.94a7.4 7.4 0 0 0 .06-.94 7.4 7.4 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.4 7.4 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/>
            </svg>
          </button>

          <div class="sg-settings-panel sg-filter-content sg-settings-panel">
            <details class="sg-setting" open>
              <summary>Group By</summary>
              <div class="sg-filter-groupby sg-setting-body"></div>
            </details>
            <details class="sg-setting">
              <summary>Columns</summary>
              <div class="sg-filter-columns sg-setting-body"></div>
            </details>
            <details class="sg-setting">
              <summary>Sort</summary>
              <div class="sg-filter-sort sg-setting-body"></div>
            </details>
            <details class="sg-setting">
              <summary>Date Format</summary>
              <div class="sg-filter-dateformat sg-setting-body"></div>
            </details>
          </div>
        </div>

      </div>

      <div class="sg-last-updated" aria-live="polite"></div>

      <div class="sg-location-tables"></div>
    `;

    const locContainer = widget.querySelector(".sg-filter-locations");
    const comContainer = widget.querySelector(".sg-filter-commodities");
    const colContainer = widget.querySelector(".sg-filter-columns");
    const dateContainer = widget.querySelector(".sg-filter-dateformat");
    const sortContainer = widget.querySelector(".sg-filter-sort");
    const groupContainer = widget.querySelector(".sg-filter-groupby");
    const updatedContainer = widget.querySelector(".sg-last-updated");
    const tablesContainer = widget.querySelector(".sg-location-tables");

    widget.querySelectorAll(".sg-filter-content").forEach(c => {
      c.style.display = "none";
    });

    /* ============================================================
       FETCH DATA
       ============================================================ */

    function loadData() {
      return fetch(sg_url, { cache: "no-cache" })
        .then(r => {
          if (!r.ok) throw new Error("Cash bid data unavailable");
          return r.json();
        })
        .then(data => {
          if (!data || !Array.isArray(data.bids)) {
            throw new Error("Invalid cash bid format");
          }

          const isFirstLoad = !sg_lastUpdated;
          sg_flash = isFirstLoad ? new Map() : diffPrices(sg_locations, data.bids);

          sg_locations = data.bids;
          sg_lastUpdated = new Date();
          sg_lastRefreshFailed = false;

          buildFilters();
          if (isFirstLoad) autoMobileColumns();
          renderTables();
          renderLastUpdated();

          widget.dispatchEvent(new CustomEvent("sg:updated", {
            detail: { updated: sg_lastUpdated, changes: sg_flash.size }
          }));
        })
        .catch(err => {
          console.error("Cash bid load failed:", err);
          sg_lastRefreshFailed = true;
          if (!sg_lastUpdated) {
            tablesContainer.innerHTML =
              "<p class='sg-error'>Cash bid data unavailable.</p>";
          }
          renderLastUpdated();
          widget.dispatchEvent(new CustomEvent("sg:error", { detail: err }));
        });
    }

    loadData();

    /* ============================================================
       PRICE CHANGE FLASH (between refreshes)
       ============================================================ */

    function bidKey(loc, bid) {
      return [loc.name, bid.name, bid.delivery_start_raw, bid.delivery_end_raw].join("|");
    }

    function diffPrices(oldLocs, newLocs) {
      const prev = new Map();
      oldLocs.forEach(loc => (loc.cashbids || []).forEach(bid => {
        prev.set(bidKey(loc, bid), sg_parseNum(sg_roundCashPrice(bid)));
      }));

      const flash = new Map();
      newLocs.forEach(loc => (loc.cashbids || []).forEach(bid => {
        const key = bidKey(loc, bid);
        if (!prev.has(key)) return;
        const before = prev.get(key);
        const now = sg_parseNum(sg_roundCashPrice(bid));
        if (isNaN(before) || isNaN(now) || before === now) return;
        flash.set(key, now > before ? "up" : "down");
      }));
      return flash;
    }

    /* ============================================================
       COLLAPSIBLE FILTERS
       ============================================================ */

    widget.addEventListener("click", (e) => {
      const title = e.target.closest(".sg-collapsible");
      if (!title) return;

      const targetId = title.dataset.target;
      const content = widget.querySelector("." + targetId);
      const isOpen = content.style.display === "block";

      widget.querySelectorAll(".sg-filter-content").forEach(c => {
        c.style.display = "none";
      });

      widget.querySelectorAll(".sg-collapsible").forEach(t => {
        t.classList.remove("sg-open");
        t.setAttribute("aria-expanded", "false");
      });

      if (!isOpen) {
        content.style.display = "block";
        title.classList.add("sg-open");
        title.setAttribute("aria-expanded", "true");
      }
    });

    function onDocumentClick(e) {
      // composedPath() still includes the widget when the clicked node was
      // removed by a re-render (e.g. Sort panel buttons)
      if (!e.composedPath().includes(widget)) {
        widget.querySelectorAll(".sg-filter-content").forEach(c => {
          c.style.display = "none";
        });
        widget.querySelectorAll(".sg-collapsible").forEach(t => {
          t.classList.remove("sg-open");
          t.setAttribute("aria-expanded", "false");
        });
      }
    }

    document.addEventListener("click", onDocumentClick);

    /* ============================================================
       BUILD FILTERS
       ============================================================ */

    function buildFilters() {
      locContainer.innerHTML = "";
      comContainer.innerHTML = "";
      colContainer.innerHTML = "";
      dateContainer.innerHTML = "";
      sg_allCommodities.clear();

      /* Locations */
      sg_locations.forEach(loc => {
        locContainer.insertAdjacentHTML(
          "beforeend",
          `
          <label>
            <input type="checkbox" class="sg-loc-check" value="${sg_escape(loc.name)}" checked>
            ${sg_escape(loc.name)}
          </label>
          `
        );
      });

      const savedLoc = JSON.parse(store.get("sg-loc-selected") || "null");
      if (savedLoc) {
        widget.querySelectorAll(".sg-loc-check").forEach(cb => {
          cb.checked = savedLoc.includes(cb.value);
        });
      }

      /* Commodities */
      sg_locations.forEach(loc => {
        if (Array.isArray(loc.cashbids)) {
          loc.cashbids.forEach(bid => sg_allCommodities.add(bid.name));
        }
      });

      [...sg_allCommodities].sort().forEach(com => {
        comContainer.insertAdjacentHTML(
          "beforeend",
          `
          <label>
            <input type="checkbox" class="sg-com-check" value="${sg_escape(com)}" checked>
            ${sg_escape(com)}
          </label>
          `
        );
      });

      const savedCom = JSON.parse(store.get("sg-com-selected") || "null");
      if (savedCom) {
        widget.querySelectorAll(".sg-com-check").forEach(cb => {
          cb.checked = savedCom.includes(cb.value);
        });
      }

      /* Columns (draggable, key-based) */
      const savedCols = JSON.parse(store.get("sg-col-state") || "null");

      sg_columns.forEach(col => {
        const checked = savedCols && col.key in savedCols ? !!savedCols[col.key] : true;

        colContainer.insertAdjacentHTML(
          "beforeend",
          `
          <div class="sg-col-item" draggable="true" data-key="${col.key}">
            <span class="sg-col-handle">≡</span>
            <label>
              <input type="checkbox" class="sg-col-check" data-key="${col.key}" ${checked ? "checked" : ""}>
              ${colLabel(col.key)}
            </label>
          </div>
          `
        );
      });

      colContainer.insertAdjacentHTML(
        "beforeend",
        `<button class="sg-reset-columns sg-reset-btn">Reset Columns</button>`
      );

      /* Group by */
      groupContainer.innerHTML = [
        { id: "location", label: "Location" },
        { id: "commodity", label: "Commodity" }
      ].map(g => `
        <label>
          <input type="radio" name="${uid}-group-by" value="${g.id}"
                 ${g.id === sg_groupBy ? "checked" : ""}>
          ${g.label}
        </label>`).join("");

      groupContainer.querySelectorAll(`input[name='${uid}-group-by']`)
        .forEach(r => r.addEventListener("change", () => {
          sg_groupBy = r.value;
          store.set("sg-group-by", sg_groupBy);
          // The first column swaps between Commodity and Location
          widget.querySelectorAll(".sg-col-item").forEach(item => {
            const label = item.querySelector("label");
            label.lastChild.textContent = " " + colLabel(item.dataset.key);
          });
          buildSortPanel();
          scheduleRender();
        }));

      /* Date formats */
      const dateFormats = [
        { id: "mdy_slash", label: "MM/DD/YYYY" },
        { id: "md_slash", label: "M/D" },
        { id: "mon_d", label: "Mon D" },
        { id: "month_d", label: "Month D" },
        { id: "mon_d_y", label: "Mon D, YYYY" },
        { id: "month_only", label: "Delivery Month (Full)" },
        { id: "month_only_short", label: "Delivery Month (Short)" }
      ];

      const savedFormat = store.get("sg-date-format") || "mdy_slash";

      dateFormats.forEach(fmt => {
        dateContainer.insertAdjacentHTML(
          "beforeend",
          `
          <label>
            <input type="radio" name="${uid}-date-format" value="${fmt.id}"
                   ${fmt.id === savedFormat ? "checked" : ""}>
            ${fmt.label}
          </label>
          `
        );
      });

      widget.querySelectorAll(`input[name='${uid}-date-format']`)
        .forEach(r => r.addEventListener("change", () => {
          store.set("sg-date-format", r.value);
          scheduleRender();
        }));

      /* Listeners */
      widget.querySelectorAll(".sg-loc-check, .sg-com-check")
        .forEach(cb => cb.addEventListener("change", () => {
          saveFilterState();
          scheduleRender();
        }));

      widget.querySelectorAll(".sg-col-check")
        .forEach(cb => cb.addEventListener("change", () => {
          saveColumnState();
          scheduleRender();
        }));

      widget.querySelector(".sg-reset-columns")
        .addEventListener("click", () => {
          store.remove("sg-col-order");
          store.remove("sg-col-state");
          sg_columns = sg_defaultColumns.slice();
          buildFilters();
          scheduleRender();
        });

      enableColumnDrag();
      buildSortPanel();
    }

    /* ============================================================
       SORTING
       - Click a header: sort by that column only (asc → desc → off)
       - Shift/Ctrl/Cmd + click (or "multi-sort" mode): add the column
         as an additional sort level, or toggle/remove it if present
       ============================================================ */

    function loadSortState() {
      try {
        const saved = JSON.parse(store.get("sg-sort") || "[]");
        if (!Array.isArray(saved)) return [];
        return saved.filter(s =>
          s && sg_defaultColumns.some(c => c.key === s.key) &&
          (s.dir === "asc" || s.dir === "desc")
        );
      } catch (e) {
        return [];
      }
    }

    function saveSortState() {
      store.set("sg-sort", JSON.stringify(sg_sort));
    }

    function isMultiSortMode() {
      return store.get("sg-multisort") === "1";
    }

    function toggleSort(key, additive) {
      const idx = sg_sort.findIndex(s => s.key === key);

      if (additive) {
        if (idx === -1) {
          sg_sort.push({ key, dir: "asc" });
        } else if (sg_sort[idx].dir === "asc") {
          sg_sort[idx].dir = "desc";
        } else {
          sg_sort.splice(idx, 1);
        }
      } else {
        const current = idx !== -1 ? sg_sort[idx].dir : null;
        if (sg_sort.length > 1 || current === null) {
          sg_sort = [{ key, dir: "asc" }];
        } else if (current === "asc") {
          sg_sort = [{ key, dir: "desc" }];
        } else {
          sg_sort = [];
        }
      }

      saveSortState();
      buildSortPanel();
      scheduleRender();
    }

    function buildSortPanel() {
      const multi = isMultiSortMode();

      const levels = sg_sort.length
        ? sg_sort.map((s, i) => {
            const col = sg_defaultColumns.find(c => c.key === s.key);
            return `
              <div class="sg-sort-level">
                <span class="sg-sort-rank">${i + 1}.</span>
                <span class="sg-sort-name">${colLabel(col.key)}</span>
                <button type="button" class="sg-sort-dir" data-key="${s.key}"
                        title="Toggle direction">
                  ${s.dir === "asc" ? "▲ Asc" : "▼ Desc"}
                </button>
                <button type="button" class="sg-sort-remove" data-key="${s.key}"
                        title="Remove" aria-label="Remove ${colLabel(col.key)} sort">×</button>
              </div>`;
          }).join("")
        : `<div class="sg-sort-empty">Click a column header to sort.</div>`;

      sortContainer.innerHTML = `
        ${levels}
        <label class="sg-sort-multi">
          <input type="checkbox" class="sg-multisort" ${multi ? "checked" : ""}>
          Multi-sort (header clicks add sort levels)
        </label>
        <div class="sg-sort-hint">Tip: Shift + click a header to add a sort level.</div>
        <button type="button" class="sg-clear-sort sg-reset-btn">Clear Sort</button>
      `;

      sortContainer.querySelectorAll(".sg-sort-dir").forEach(btn =>
        btn.addEventListener("click", () => {
          const s = sg_sort.find(x => x.key === btn.dataset.key);
          if (s) s.dir = s.dir === "asc" ? "desc" : "asc";
          saveSortState();
          buildSortPanel();
          scheduleRender();
        }));

      sortContainer.querySelectorAll(".sg-sort-remove").forEach(btn =>
        btn.addEventListener("click", () => {
          sg_sort = sg_sort.filter(x => x.key !== btn.dataset.key);
          saveSortState();
          buildSortPanel();
          scheduleRender();
        }));

      sortContainer.querySelector(".sg-multisort")
        .addEventListener("change", e => {
          store.set("sg-multisort", e.target.checked ? "1" : "0");
        });

      sortContainer.querySelector(".sg-clear-sort")
        .addEventListener("click", () => {
          sg_sort = [];
          saveSortState();
          buildSortPanel();
          scheduleRender();
        });
    }

    /* Header clicks (delegated — tables are re-rendered) */
    tablesContainer.addEventListener("click", e => {
      const th = e.target.closest("th[data-sort-key]");
      if (!th) return;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey || isMultiSortMode();
      toggleSort(th.dataset.sortKey, additive);
    });

    tablesContainer.addEventListener("keydown", e => {
      const th = e.target.closest("th[data-sort-key]");
      if (!th || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      const additive = e.shiftKey || e.ctrlKey || e.metaKey || isMultiSortMode();
      toggleSort(th.dataset.sortKey, additive);
    });

    function sg_changeValue(bid) {
      const v = bid.futures_change ?? bid.change;
      return v === null || v === undefined || v === "" ? "-" : v;
    }

    function sortValue(row, key) {
      const bid = row.bid;
      switch (key) {
        case "commodity":
          return rowName(row).toLowerCase();
        case "delivery": {
          const d = new Date(normalize(bid.delivery_start_raw));
          return isNaN(d) ? NaN : d.getTime();
        }
        case "futures":
          return sg_parseNum(bid.futures);
        case "basis":
          return sg_parseNum(bid.basis);
        case "cashprice":
          return sg_parseNum(sg_roundCashPrice(bid));
        case "change":
          return sg_parseNum(sg_changeValue(bid));
        default:
          return NaN;
      }
    }

    function isMissing(v) {
      return v === "" || (typeof v === "number" && isNaN(v));
    }

    function sortRows(rows) {
      if (!sg_sort.length) return rows;

      return rows
        .map((row, i) => ({ row, i }))
        .sort((a, b) => {
          for (const s of sg_sort) {
            const va = sortValue(a.row, s.key);
            const vb = sortValue(b.row, s.key);
            const ma = isMissing(va);
            const mb = isMissing(vb);

            // Missing values always sink to the bottom
            if (ma && mb) continue;
            if (ma) return 1;
            if (mb) return -1;

            let cmp = typeof va === "string"
              ? va.localeCompare(vb)
              : va - vb;

            if (cmp !== 0) return s.dir === "asc" ? cmp : -cmp;
          }
          return a.i - b.i;
        })
        .map(x => x.row);
    }

    /* Name shown in the first column: commodity, or location when grouped by commodity */
    function rowName(row) {
      return (sg_groupBy === "commodity" ? row.loc.name : row.bid.name) || "";
    }

    /* ============================================================
       LAST UPDATED
       ============================================================ */

    function renderLastUpdated() {
      if (!sg_lastUpdated) {
        updatedContainer.innerHTML = "";
        return;
      }

      const stamp = sg_lastUpdated.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });

      const mins = Math.floor((Date.now() - sg_lastUpdated) / 60000);
      const ago =
        mins < 1 ? "just now" :
        mins === 1 ? "1 min ago" :
        mins < 60 ? `${mins} mins ago` :
        Math.floor(mins / 60) === 1 ? "1 hr ago" :
        `${Math.floor(mins / 60)} hrs ago`;

      updatedContainer.innerHTML = `
        Last updated: <time datetime="${sg_lastUpdated.toISOString()}">${stamp}</time>
        <span class="sg-updated-ago">(${ago})</span>
        ${sg_lastRefreshFailed
          ? `<span class="sg-updated-failed">· Latest refresh failed</span>`
          : ""}
      `;
    }

    timers.push(setInterval(renderLastUpdated, 60 * 1000));

    /* ============================================================
       DRAG-AND-DROP COLUMN REORDERING
       ============================================================ */

    function enableColumnDrag() {
      const items = widget.querySelectorAll(".sg-col-item");
      let dragSrc = null;

      items.forEach(item => {
        item.addEventListener("dragstart", () => {
          dragSrc = item;
          item.classList.add("sg-dragging");
        });

        item.addEventListener("dragend", () => {
          item.classList.remove("sg-dragging");
        });

        item.addEventListener("dragover", e => {
          e.preventDefault();
          const target = item;
          if (target !== dragSrc) {
            const container = target.parentNode;
            const srcIndex = [...container.children].indexOf(dragSrc);
            const targetIndex = [...container.children].indexOf(target);

            if (srcIndex < targetIndex) {
              container.insertBefore(dragSrc, target.nextSibling);
            } else {
              container.insertBefore(dragSrc, target);
            }
          }
        });

        item.addEventListener("drop", () => {
          saveColumnOrder();
          scheduleRender();
        });
      });
    }

    function saveColumnOrder() {
      const orderKeys = [...widget.querySelectorAll(".sg-col-item")]
        .map(item => item.dataset.key);

      store.set("sg-col-order", JSON.stringify(orderKeys));

      sg_columns = orderKeys.map(k =>
        sg_defaultColumns.find(c => c.key === k)
      );
    }

    function loadColumnOrder() {
      const saved = JSON.parse(store.get("sg-col-order") || "null");
      if (!saved) return;

      sg_columns = saved.map(k =>
        sg_defaultColumns.find(c => c.key === k)
      ).filter(Boolean);

      sg_defaultColumns.forEach(c => {
        if (!sg_columns.includes(c)) sg_columns.push(c);
      });
    }

    /* When grouped by commodity, the "commodity" column shows the location */
    function colLabel(key) {
      if (key === "commodity" && sg_groupBy === "commodity") return "Location";
      return sg_defaultColumns.find(c => c.key === key).label;
    }

    function saveColumnState() {
      const state = {};
      widget.querySelectorAll(".sg-col-check").forEach(cb => {
        state[cb.dataset.key] = cb.checked;
      });
      store.set("sg-col-state", JSON.stringify(state));
    }

    function saveFilterState() {
      const locSelected =
        [...widget.querySelectorAll(".sg-loc-check:checked")]
          .map(cb => cb.value);

      const comSelected =
        [...widget.querySelectorAll(".sg-com-check:checked")]
          .map(cb => cb.value);

      store.set("sg-loc-selected", JSON.stringify(locSelected));
      store.set("sg-com-selected", JSON.stringify(comSelected));
    }

    /* ============================================================
       MOBILE AUTO-COLLAPSE
       ============================================================ */

    function autoMobileColumns() {
      if (window.innerWidth > 600) return;

      const priorityKeys = ["change", "basis", "futures"];
      const checks = widget.querySelectorAll(".sg-col-check");

      priorityKeys.forEach(key => {
        checks.forEach(cb => {
          if (cb.dataset.key === key) cb.checked = false;
        });
      });

      saveColumnState();
    }

    /* ============================================================
       DEBOUNCED RENDER
       ============================================================ */

    function scheduleRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(renderTables, 50);
    }

    /* ============================================================
       DELIVERY FORMATTER
       ============================================================ */

    function normalize(d) {
      if (!d) return null;

      if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
        const [m, dd, yyyy] = d.split("/");
        return `${yyyy}-${m}-${dd}`;
      }

      return d;
    }

    function sg_formatDelivery(start, end) {
      if (!start || !end) return "-";

      const fmtSetting = store.get("sg-date-format") || "mdy_slash";

      const s = new Date(normalize(start));
      const e = new Date(normalize(end));

      const monthNames = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
      ];
      const monthShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

      function format(d) {
        const m = d.getMonth();
        const day = d.getDate();
        const y = d.getFullYear();

        switch (fmtSetting) {
          case "mdy_slash":
            return `${String(m+1).padStart(2,"0")}/${String(day).padStart(2,"0")}/${y}`;

          case "md_slash":
            return `${m+1}/${day}`;

          case "mon_d":
            return `${monthShort[m]} ${day}`;

          case "month_d":
            return `${monthNames[m]} ${day}`;

          case "mon_d_y":
            return `${monthShort[m]} ${day}, ${y}`;

          case "month_only": {
            const sm = s.getMonth();
            const em = e.getMonth();
            if (sm === em) return monthNames[sm];
            return `${monthNames[sm]} - ${monthNames[em]}`;
          }

          case "month_only_short": {
            const sm = s.getMonth();
            const em = e.getMonth();
            if (sm === em) return monthShort[sm];
            return `${monthShort[sm]} - ${monthShort[em]}`;
          }

          default:
            return `${m+1}/${day}/${y}`;
        }
      }

      if (fmtSetting === "month_only" || fmtSetting === "month_only_short") {
        return format(s);
      }

      return `${format(s)} - ${format(e)}`;
    }

    /* ============================================================
       RENDER TABLES
       ============================================================ */

    function renderTables() {
      tablesContainer.innerHTML = "";
      if (!sg_lastUpdated) return;

      const selectedLocations =
        [...widget.querySelectorAll(".sg-loc-check:checked")]
          .map(cb => cb.value);

      const selectedCommodities =
        [...widget.querySelectorAll(".sg-com-check:checked")]
          .map(cb => cb.value);

      const selectedColumnKeys =
        [...widget.querySelectorAll(".sg-col-check:checked")]
          .map(cb => cb.dataset.key);

      /* Build groups of { title, rows: [{ bid, loc }] } */
      const groups = [];
      const visibleLocs = sg_locations.filter(loc =>
        selectedLocations.includes(loc.name) && Array.isArray(loc.cashbids)
      );

      if (sg_groupBy === "commodity") {
        const byCom = new Map();
        [...sg_allCommodities].sort().forEach(com => {
          if (selectedCommodities.includes(com)) byCom.set(com, []);
        });
        visibleLocs.forEach(loc => {
          loc.cashbids.forEach(bid => {
            if (byCom.has(bid.name)) byCom.get(bid.name).push({ bid, loc });
          });
        });
        byCom.forEach((rows, com) => groups.push({ title: com, rows }));
      } else {
        visibleLocs.forEach(loc => {
          groups.push({
            title: loc.name,
            rows: loc.cashbids
              .filter(bid => selectedCommodities.includes(bid.name))
              .map(bid => ({ bid, loc }))
          });
        });
      }

      groups.forEach(group => {
        let rows = "";

        sortRows(group.rows).forEach(row => {
          const bid = row.bid;
          const changeVal = sg_changeValue(bid);
          const num = sg_parseNum(changeVal);
          const changeClass =
            !isNaN(num)
              ? num > 0
                ? "sg-up"
                : num < 0
                  ? "sg-down"
                  : "sg-flat"
              : "";
          const changeArrow =
            changeClass === "sg-up" ? "▲" :
            changeClass === "sg-down" ? "▼" :
            changeClass === "sg-flat" ? "▬" : "";
          const changeLabel =
            changeClass === "sg-up" ? "Up" :
            changeClass === "sg-down" ? "Down" :
            changeClass === "sg-flat" ? "Unchanged" : "";

          let rowCells = "";

          sg_columns.forEach(col => {
            if (!selectedColumnKeys.includes(col.key)) return;

            let value = "-";
            let extraClass = "";

            switch (col.key) {
              case "commodity":
                value = sg_escape(rowName(row) || "-");
                break;
              case "delivery":
                value = sg_escape(sg_formatDelivery(bid.delivery_start_raw, bid.delivery_end_raw));
                break;
              case "futures":
                value = sg_escape(bid.futures || "-");
                break;
              case "basis":
                value = sg_escape(bid.basis || "-");
                break;
              case "cashprice":
                value = sg_escape(sg_roundCashPrice(bid));
                break;
              case "change":
                value = changeArrow
                  ? `<span class="sg-change-arrow" aria-label="${changeLabel}">${changeArrow}</span> ${sg_escape(changeVal)}`
                  : sg_escape(changeVal);
                extraClass = changeClass;
                break;
            }

            rowCells += `<td class="sg-col-${col.key} ${extraClass}">${value}</td>`;
          });

          const flash = sg_flash.get(bidKey(row.loc, bid));
          rows += flash
            ? `<tr class="sg-flash-${flash}">${rowCells}</tr>`
            : `<tr>${rowCells}</tr>`;
        });

        if (!rows.trim()) return;

        const headerRow = sg_columns
          .map(col => {
            if (!selectedColumnKeys.includes(col.key)) return "";

            const idx = sg_sort.findIndex(s => s.key === col.key);
            const s = idx !== -1 ? sg_sort[idx] : null;
            const ariaSort = s
              ? (s.dir === "asc" ? "ascending" : "descending")
              : "none";
            const indicator = s
              ? `<span class="sg-sort-ind">${s.dir === "asc" ? "▲" : "▼"}${
                  sg_sort.length > 1 ? `<sup>${idx + 1}</sup>` : ""
                }</span>`
              : `<span class="sg-sort-ind sg-sort-none">⇅</span>`;

            return `<th class="sg-col-${col.key} sg-sortable${s ? " sg-sorted" : ""}"
                        data-sort-key="${col.key}" tabindex="0"
                        aria-sort="${ariaSort}"
                        title="Click to sort · Shift+click to add a sort level">
                      ${colLabel(col.key)} ${indicator}
                    </th>`;
          })
          .join("");

        tablesContainer.insertAdjacentHTML(
          "beforeend",
          `
          <div class="sg-card">
            <div class="sg-location">${sg_escape(group.title)}</div>
            <table>
              <thead><tr>${headerRow}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          `
        );
      });

      sg_flash = new Map();
    }

    /* ============================================================
       AUTO-REFRESH EVERY HOUR ON THE HOUR
       ============================================================ */

    function scheduleHourlyRefresh() {
      const now = new Date();

      const nextHour = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours() + 1,
        0,
        0,
        0
      );

      const msUntilNextHour = nextHour - now;

      timers.push(setTimeout(() => {
        loadData();
        timers.push(setInterval(loadData, 60 * 60 * 1000));
      }, msUntilNextHour));
    }

    if (opts.autoRefresh) scheduleHourlyRefresh();

    /* ============================================================
       PUBLIC API
       ============================================================ */

    function destroy() {
      timers.forEach(t => { clearTimeout(t); clearInterval(t); });
      clearTimeout(renderTimer);
      document.removeEventListener("click", onDocumentClick);
      widget.innerHTML = "";
      widget.classList.remove("sg-cashbid");
      delete widget.sgCashBid;
    }

    const api = { el: widget, refresh: loadData, destroy };
    widget.sgCashBid = api;
    return api;
  }

  /* ============================================================
     GLOBAL ENTRY POINT + AUTO-MOUNT
     Standalone embeds keep working: <div id="sg-cashbid-widget">
     Multiple instances: SGCashBid.mount(el, { storagePrefix, json })
     ============================================================ */

  window.SGCashBid = {
    mount: createCashBidWidget,
    parseNum: sg_parseNum,
    roundCashPrice: sg_roundCashPrice
  };

  function autoMount() {
    const el = document.getElementById("sg-cashbid-widget");
    if (el) createCashBidWidget(el);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }

})();