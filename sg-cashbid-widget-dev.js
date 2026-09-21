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

    </div>

    <div id="sg-location-tables"></div>
  `;

  const locContainer = widget.querySelector("#sg-filter-locations");
  const comContainer = widget.querySelector("#sg-filter-commodities");
  const colContainer = widget.querySelector("#sg-filter-columns");
  const dateContainer = widget.querySelector("#sg-filter-dateformat");
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

      buildFilters();
      autoMobileColumns();
      renderTables();
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
    if (!e.target.closest("#sg-cashbid-widget")) {
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

    // Locations
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

    // Commodities
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

    // Columns (draggable)
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

    // Date formats
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

    // Listeners
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
  }

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
        loc.cashbids.forEach(bid => {
          if (!selectedCommodities.includes(bid.name)) return;

          const changeVal = bid.futures_change || bid.change || "-";
          const num = Number(changeVal);
          const changeClass =
            !isNaN(num)
              ? num > 0
                ? "sg-up"
                : num < 0
                  ? "sg-down"
                  : "sg-flat"
              : "";

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
                value = changeVal;
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
        .map(col =>
          selectedColumnKeys.includes(col.key)
            ? `<th>${col.label}</th>`
            : ""
        )
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

        buildFilters();
        renderTables();
      })
      .catch(err => console.error("Refresh failed:", err));
  }

  scheduleHourlyRefresh();

})();   // <—— THIS MUST BE PRESENT
