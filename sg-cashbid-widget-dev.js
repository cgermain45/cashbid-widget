(function () {
  /* ============================================================
     CASH BID WIDGET — SUPER DELUXE VERSION
     ============================================================ */

  const widget = document.getElementById("sg-cashbid-widget");
  if (!widget) return;

  const sg_url =
    widget.dataset.json ||
    "https://stonegrain.agricharts.com/inc/cashbids/cashbids-json.php";

  let sg_locations = [];
  let sg_allCommodities = new Set();
  let renderTimer = null;

  const sg_columns = [
    { key: "commodity", label: "Commodity" },
    { key: "delivery", label: "Delivery" },
    { key: "futures", label: "Futures" },
    { key: "basis", label: "Basis" },
    { key: "cashprice", label: "Cash Price" },
    { key: "change", label: "Change" }
  ];

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
     BUILD FILTERS
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
       COLUMN CHECKBOXES + RESET BUTTON
       ------------------------------ */

    const savedCols = JSON.parse(localStorage.getItem("sg-col-state") || "null");

    sg_columns.forEach((col, index) => {
      const checked = savedCols ? savedCols[index] : true;

      colContainer.insertAdjacentHTML(
        "beforeend",
        `
        <label>
          <input type="checkbox" class="sg-col-check" data-col="${index}" ${checked ? "checked" : ""}>
          ${col.label}
        </label>
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
  }

  /* ============================================================
     SAVE COLUMN STATE
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

          rows += `
            <tr>
              ${selectedColumns.includes(0) ? `<td>${bid.name}</td>` : ""}
              ${selectedColumns.includes(1) ? `<td>${sg_formatDelivery(bid.delivery_start_raw, bid.delivery_end_raw)}</td>` : ""}
              ${selectedColumns.includes(2) ? `<td>${bid.futures || "-"}</td>` : ""}
              ${selectedColumns.includes(3) ? `<td>${bid.basis || "-"}</td>` : ""}
              ${selectedColumns.includes(4) ? `<td>${bid.cashprice || "-"}</td>` : ""}
              ${selectedColumns.includes(5) ? `<td class="${changeClass}">${changeVal}</td>` : ""}
            </tr>
          `;
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

})();
