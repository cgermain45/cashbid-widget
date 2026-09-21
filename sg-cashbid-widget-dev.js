(function () {
  /* ============================================================
     CASH BID WIDGET — DELUXE VERSION + COLUMN REORDER (FIXED)
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
     COLUMN DEFINITIONS (REORDERABLE)
     ============================================================ */

  let sg_columns = [
    { key: "commodity", label: "Commodity" },
    { key: "delivery", label: "Delivery" },
    { key: "futures", label: "Futures" },
    { key: "basis", label: "Basis" },
    { key: "cashprice", label: "Cash Price" },
    { key: "change", label: "Change" }
  ];

  /* Load saved column order BEFORE building filters */
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

    </div>

    <div id="sg-location-tables"></div>
  `;

  const locContainer = widget.querySelector("#sg-filter-locations");
  const comContainer = widget.querySelector("#sg-filter-commodities");
  const colContainer = widget.querySelector("#sg-filter-columns");
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
     BUILD FILTERS (WITH DRAGGABLE COLUMN ITEMS)
     ============================================================ */

  function buildFilters() {
    locContainer.innerHTML = "";
    comContainer.innerHTML = "";
    colContainer.innerHTML = "";
    sg_allCommodities.clear();

    /* ------------------------------
       LOCATION CHECKBOXES
       ------------------------------ */
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

    /* ------------------------------
       COMMODITY CHECKBOXES
       ------------------------------ */
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

    /* ------------------------------
       COLUMN CHECKBOXES (DRAGGABLE)
       ------------------------------ */

    const savedCols = JSON.parse(localStorage.getItem("sg-col-state") || "null");

    sg_columns.forEach((col, index) => {
      const checked = savedCols ? savedCols[index] : true;

      colContainer.insertAdjacentHTML(
        "beforeend",
        `
        <div class="sg-col-item" draggable="true" data-index="${index}">
          <label>
            <input type="checkbox" class="sg-col-check" data-col="${index}" ${checked ? "checked" : ""}>
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

    /* ------------------------------
       EVENT LISTENERS
       ------------------------------ */

    widget.querySelectorAll(".sg-loc-check, .sg-com-check")
      .forEach(cb => cb.addEventListener("change", scheduleRender));

    widget.querySelectorAll(".sg-col-check")
      .forEach(cb => cb.addEventListener("change", () => {
        saveColumnState();
        scheduleRender();
      }));

    widget.querySelector("#sg-reset-columns")
      .addEventListener("click", () => {
        widget.querySelectorAll(".sg-col-check").forEach(cb => cb.checked = true);
        saveColumnState();
        scheduleRender();
      });

    /* Enable drag-and-drop column reordering */
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

  /* ============================================================
     SAVE COLUMN ORDER
     ============================================================ */

  function saveColumnOrder() {
    const order = [...widget.querySelectorAll(".sg-col-item")]
      .map(item => parseInt(item.dataset.index));

    localStorage.setItem("sg-col-order", JSON.stringify(order));

    sg_columns = order.map(i => sg_columns[i]);
  }

  /* ============================================================
     LOAD COLUMN ORDER
     ============================================================ */

  function loadColumnOrder() {
    const saved = JSON.parse(localStorage.getItem("sg-col-order") || "null");
    if (!saved) return;

    sg_columns = saved.map(i => sg_columns[i]);
  }

  /* ============================================================
     SAVE COLUMN VISIBILITY
     ============================================================ */

  function saveColumnState() {
    const state = [...widget.querySelectorAll(".sg-col-check")]
      .map(cb => cb.checked);
    localStorage.setItem("sg-col-state", JSON.stringify(state));
  }

  /* ============================================================
     MOBILE AUTO-COLLAPSE
     ============================================================ */

  function autoMobileColumns() {
    if (window.innerWidth > 600) return;

    const priority = [5, 3, 2]; // change, basis, futures
    const cols = widget.querySelectorAll(".sg-col-check");

    priority.forEach(index => {
      if (cols[index]) cols[index].checked = false;
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

    const s = new Date(normalize(start));
    const e = new Date(normalize(end));

    const fmt = d =>
      `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

    return fmt(s) + " - " + fmt(e);
  }

  /* ============================================================
     RENDER TABLES (FIXED TO FOLLOW COLUMN ORDER)
     ============================================================ */

  function renderTables() {
    tablesContainer.innerHTML = "";

    const selectedLocations =
      [...widget.querySelectorAll(".sg-loc-check:checked")]
        .map(cb => cb.value);

    const selectedCommodities =
      [...widget.querySelectorAll(".sg-com-check:checked")]
        .map(cb => cb.value);

    const selectedColumns =
      [...widget.querySelectorAll(".sg-col-check:checked")]
        .map(cb => parseInt(cb.dataset.col));

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

          sg_columns.forEach((col, index) => {
            if (!selectedColumns.includes(index)) return;

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
        .map((col, index) =>
          selectedColumns.includes(index)
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

})();
