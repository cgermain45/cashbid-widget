(function () {
  /* ============================================================
     CASH BID WIDGET — DELUXE + COLUMN REORDER + DATE FORMATS
     ============================================================ */

  const widget = document.getElementById("sg-cashbid-widget");
  if (!widget) return;

  const sg_url =
    widget.dataset.json ||
    "https://stonegrain.agricharts.com/inc/cashbids/cashbids-json.php";

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
  let sg_lastUpdated = null;
  let sg_lastRefreshFailed = false;

  /* ============================================================
     WIDGET SHELL
     ============================================================ */

  widget.innerHTML = `
    <div id="sg-filter-bar">

      <div class="sg-filter-section">
        <div class="sg-filter-title sg-collapsible"
             data-target="sg-filter-locations">
          Locations
        </div>
        <div id="sg-filter-locations" class="sg-filter-content"></div>
      </div>

      <div class="sg-filter-section">
        <div class="sg-filter-title sg-collapsible"
             data-target="sg-filter-commodities">
          Commodities
        </div>
        <div id="sg-filter-commodities" class="sg-filter-content"></div>
      </div>

      <div class="sg-filter-section">
        <div class="sg-filter-title sg-collapsible"
             data-target="sg-filter-columns">
          Columns
        </div>
        <div id="sg-filter-columns" class="sg-filter-content"></div>
      </div>

      <div class="sg-filter-section">
        <div class="sg-filter-title sg-collapsible"
             data-target="sg-filter-dateformat">
          Date Format
        </div>
        <div id="sg-filter-dateformat" class="sg-filter-content"></div>
      </div>

      <div class="sg-filter-section">
        <div class="sg-filter-title sg-collapsible"
             data-target="sg-filter-sort">
          Sort
        </div>
        <div id="sg-filter-sort" class="sg-filter-content"></div>
      </div>

    </div>

    <div id="sg-last-updated" aria-live="polite"></div>

    <div id="sg-location-tables"></div>
  `;

  const locContainer = widget.querySelector("#sg-filter-locations");
  const comContainer = widget.querySelector("#sg-filter-commodities");
  const colContainer = widget.querySelector("#sg-filter-columns");
  const dateContainer = widget.querySelector("#sg-filter-dateformat");
  const sortContainer = widget.querySelector("#sg-filter-sort");
  const updatedContainer = widget.querySelector("#sg-last-updated");
  const tablesContainer = widget.querySelector("#sg-location-tables");

  widget.querySelectorAll(".sg-filter-content").forEach(c => {
    c.style.display = "none";
  });

  /* ============================================================
     FETCH DATA
     ============================================================ */

  fetch(sg_url)
    .then(r => {
      if (!r.ok) throw new Error("Cash bid data unavailable");
      return r.json();
    })
    .then(data => {
      if (!data || !Array.isArray(data.bids)) {
        throw new Error("Invalid cash bid format");
      }

      sg_locations = data.bids;
      sg_lastUpdated = new Date();
      sg_lastRefreshFailed = false;

      buildFilters();
      autoMobileColumns();
      renderTables();
      renderLastUpdated();
    })
    .catch(error => {
      console.error(error);
      widget.innerHTML =
        "<p class='sg-error'>Cash bid data unavailable.</p>";
    });

  /* ============================================================
     COLLAPSIBLE FILTERS
     ============================================================ */

  widget.addEventListener("click", (e) => {
    const title = e.target.closest(".sg-collapsible");
    if (!title) return;

    const targetId = title.dataset.target;
    const content = widget.querySelector("#" + targetId);
    const isOpen = content.style.display === "block";

    widget.querySelectorAll(".sg-filter-content").forEach(c => {
      c.style.display = "none";
    });

    widget.querySelectorAll(".sg-collapsible").forEach(t => {
      t.classList.remove("sg-open");
    });

    if (!isOpen) {
      content.style.display = "block";
      title.classList.add("sg-open");
    }
  });

  document.addEventListener("click", (e) => {
    // composedPath() still includes the widget when the clicked node was
    // removed by a re-render (e.g. Sort panel buttons)
    if (!e.composedPath().includes(widget)) {
      widget.querySelectorAll(".sg-filter-content").forEach(c => {
        c.style.display = "none";
      });
      widget.querySelectorAll(".sg-collapsible").forEach(t => {
        t.classList.remove("sg-open");
      });
    }
  });

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
          <input type="checkbox" class="sg-loc-check" value="${loc.name}" checked>
          ${loc.name}
        </label>
        `
      );
    });

    const savedLoc = JSON.parse(localStorage.getItem("sg-loc-selected") || "null");
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
          <input type="checkbox" class="sg-com-check" value="${com}" checked>
          ${com}
        </label>
        `
      );
    });

    const savedCom = JSON.parse(localStorage.getItem("sg-com-selected") || "null");
    if (savedCom) {
      widget.querySelectorAll(".sg-com-check").forEach(cb => {
        cb.checked = savedCom.includes(cb.value);
      });
    }

    /* Columns (draggable, key-based) */
    const savedCols = JSON.parse(localStorage.getItem("sg-col-state") || "null");

    sg_columns.forEach(col => {
      const checked = savedCols ? !!savedCols[col.key] : true;

      colContainer.insertAdjacentHTML(
        "beforeend",
        `
        <div class="sg-col-item" draggable="true" data-key="${col.key}">
          <span class="sg-col-handle">≡</span>
          <label>
            <input type="checkbox" class="sg-col-check" data-key="${col.key}" ${checked ? "checked" : ""}>
            ${col.label}
          </label>
        </div>
        `
      );
    });

    colContainer.insertAdjacentHTML(
      "beforeend",
      `<button id="sg-reset-columns" class="sg-reset-btn">Reset Columns</button>`
    );

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

    const savedFormat = localStorage.getItem("sg-date-format") || "mdy_slash";

    dateFormats.forEach(fmt => {
      dateContainer.insertAdjacentHTML(
        "beforeend",
        `
        <label>
          <input type="radio" name="sg-date-format" value="${fmt.id}"
                 ${fmt.id === savedFormat ? "checked" : ""}>
          ${fmt.label}
        </label>
        `
      );
    });

    widget.querySelectorAll("input[name='sg-date-format']")
      .forEach(r => r.addEventListener("change", () => {
        localStorage.setItem("sg-date-format", r.value);
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

    widget.querySelector("#sg-reset-columns")
      .addEventListener("click", () => {
        localStorage.removeItem("sg-col-order");
        localStorage.removeItem("sg-col-state");
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
      const saved = JSON.parse(localStorage.getItem("sg-sort") || "[]");
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
    localStorage.setItem("sg-sort", JSON.stringify(sg_sort));
  }

  function isMultiSortMode() {
    return localStorage.getItem("sg-multisort") === "1";
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
              <span class="sg-sort-name">${col.label}</span>
              <button type="button" class="sg-sort-dir" data-key="${s.key}"
                      title="Toggle direction">
                ${s.dir === "asc" ? "▲ Asc" : "▼ Desc"}
              </button>
              <button type="button" class="sg-sort-remove" data-key="${s.key}"
                      title="Remove" aria-label="Remove ${col.label} sort">×</button>
            </div>`;
        }).join("")
      : `<div class="sg-sort-empty">Click a column header to sort.</div>`;

    sortContainer.innerHTML = `
      ${levels}
      <label class="sg-sort-multi">
        <input type="checkbox" id="sg-multisort" ${multi ? "checked" : ""}>
        Multi-sort (header clicks add sort levels)
      </label>
      <div class="sg-sort-hint">Tip: Shift + click a header to add a sort level.</div>
      <button type="button" id="sg-clear-sort" class="sg-reset-btn">Clear Sort</button>
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

    sortContainer.querySelector("#sg-multisort")
      .addEventListener("change", e => {
        localStorage.setItem("sg-multisort", e.target.checked ? "1" : "0");
      });

    sortContainer.querySelector("#sg-clear-sort")
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

  function sg_parseNum(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    const str = String(v).trim();
    if (/^unch/i.test(str)) return 0;
    const cleaned = str.replace(/[^0-9.+-]/g, "");
    if (!cleaned) return NaN;
    return parseFloat(cleaned);
  }

  function sg_changeValue(bid) {
    const v = bid.futures_change ?? bid.change;
    return v === null || v === undefined || v === "" ? "-" : v;
  }

  function sortValue(bid, key) {
    switch (key) {
      case "commodity":
        return (bid.name || "").toLowerCase();
      case "delivery": {
        const d = new Date(normalize(bid.delivery_start_raw));
        return isNaN(d) ? NaN : d.getTime();
      }
      case "futures":
        return sg_parseNum(bid.futures);
      case "basis":
        return sg_parseNum(bid.basis);
      case "cashprice":
        return sg_parseNum(bid.cashprice);
      case "change":
        return sg_parseNum(sg_changeValue(bid));
      default:
        return NaN;
    }
  }

  function isMissing(v) {
    return v === "" || (typeof v === "number" && isNaN(v));
  }

  function sortBids(bids) {
    if (!sg_sort.length) return bids;

    return bids
      .map((bid, i) => ({ bid, i }))
      .sort((a, b) => {
        for (const s of sg_sort) {
          const va = sortValue(a.bid, s.key);
          const vb = sortValue(b.bid, s.key);
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
      .map(x => x.bid);
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

  setInterval(renderLastUpdated, 60 * 1000);

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

    localStorage.setItem("sg-col-order", JSON.stringify(orderKeys));

    sg_columns = orderKeys.map(k =>
      sg_defaultColumns.find(c => c.key === k)
    );
  }

  function loadColumnOrder() {
    const saved = JSON.parse(localStorage.getItem("sg-col-order") || "null");
    if (!saved) return;

    sg_columns = saved.map(k =>
      sg_defaultColumns.find(c => c.key === k)
    ).filter(Boolean);
  }

  function saveColumnState() {
    const state = {};
    widget.querySelectorAll(".sg-col-check").forEach(cb => {
      state[cb.dataset.key] = cb.checked;
    });
    localStorage.setItem("sg-col-state", JSON.stringify(state));
  }

  function saveFilterState() {
    const locSelected =
      [...widget.querySelectorAll(".sg-loc-check:checked")]
        .map(cb => cb.value);

    const comSelected =
      [...widget.querySelectorAll(".sg-com-check:checked")]
        .map(cb => cb.value);

    localStorage.setItem("sg-loc-selected", JSON.stringify(locSelected));
    localStorage.setItem("sg-com-selected", JSON.stringify(comSelected));
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

    const fmtSetting = localStorage.getItem("sg-date-format") || "mdy_slash";

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

    const selectedLocations =
      [...widget.querySelectorAll(".sg-loc-check:checked")]
        .map(cb => cb.value);

    const selectedCommodities =
      [...widget.querySelectorAll(".sg-com-check:checked")]
        .map(cb => cb.value);

    const selectedColumnKeys =
      [...widget.querySelectorAll(".sg-col-check:checked")]
        .map(cb => cb.dataset.key);

    sg_locations.forEach(loc => {
      if (!selectedLocations.includes(loc.name)) return;

      let rows = "";

      if (Array.isArray(loc.cashbids)) {
        const bids = sortBids(
          loc.cashbids.filter(bid => selectedCommodities.includes(bid.name))
        );

        bids.forEach(bid => {
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
                value = bid.name;
                break;
              case "delivery":
                value = sg_formatDelivery(bid.delivery_start_raw, bid.delivery_end_raw);
                break;
              case "futures":
                value = bid.futures || "-";
                break;
              case "basis":
                value = bid.basis || "-";
                break;
              case "cashprice":
                value = bid.cashprice || "-";
                break;
              case "change":
                value = changeArrow
                  ? `<span class="sg-change-arrow" aria-label="${changeLabel}">${changeArrow}</span> ${changeVal}`
                  : changeVal;
                extraClass = changeClass;
                break;
            }

            rowCells += `<td class="${extraClass}">${value}</td>`;
          });

          rows += `<tr>${rowCells}</tr>`;
        });
      }

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

          return `<th class="sg-sortable${s ? " sg-sorted" : ""}"
                      data-sort-key="${col.key}" tabindex="0"
                      aria-sort="${ariaSort}"
                      title="Click to sort · Shift+click to add a sort level">
                    ${col.label} ${indicator}
                  </th>`;
        })
        .join("");

      tablesContainer.insertAdjacentHTML(
        "beforeend",
        `
        <div class="sg-card">
          <div class="sg-location">${loc.name}</div>
          <table>
            <thead><tr>${headerRow}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        `
      );
    });
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

    setTimeout(() => {
      refreshWidget();
      setInterval(refreshWidget, 60 * 60 * 1000);
    }, msUntilNextHour);
  }

  function refreshWidget() {
    fetch(sg_url)
      .then(r => {
        if (!r.ok) throw new Error("Cash bid data unavailable");
        return r.json();
      })
      .then(data => {
        if (!data || !Array.isArray(data.bids)) {
          throw new Error("Invalid cash bid format");
        }

        sg_locations = data.bids;
        sg_lastUpdated = new Date();
        sg_lastRefreshFailed = false;

        buildFilters();
        renderTables();
        renderLastUpdated();
      })
      .catch(err => {
        console.error("Refresh failed:", err);
        sg_lastRefreshFailed = true;
        renderLastUpdated();
      });
  }

  scheduleHourlyRefresh();

})();
