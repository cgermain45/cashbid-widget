(function () {
  /* ============================================================
     CASH BID WIDGET — DATA-DRIVEN EMBED VERSION
     ============================================================ */

  /* ------------------------------------------------------------
     Locate widget root
     ------------------------------------------------------------ */
  const widget = document.getElementById("sg-cashbid-widget");
  if (!widget) return;

  /* ------------------------------------------------------------
     Resolve JSON source (client override or default)
     ------------------------------------------------------------ */
  const sg_url =
    widget.dataset.json ||
    "https://stonegrain.agricharts.com/inc/cashbids/cashbids-json.php";

  /* ------------------------------------------------------------
     State
     ------------------------------------------------------------ */
  let sg_locations = [];
  let sg_allCommodities = new Set();

  /* ------------------------------------------------------------
     Build base HTML structure (injected automatically)
     ------------------------------------------------------------ */
  widget.innerHTML = `
    <div id="sg-filter-bar">
      <div class="sg-filter-section">
        <div class="sg-filter-title sg-collapsible" data-target="sg-filter-locations">
          Locations +
        </div>
        <div id="sg-filter-locations" class="sg-filter-content"></div>
      </div>

      <div class="sg-filter-section">
        <div class="sg-filter-title sg-collapsible" data-target="sg-filter-commodities">
          Commodities +
        </div>
        <div id="sg-filter-commodities" class="sg-filter-content"></div>
      </div>
    </div>

    <div id="sg-location-tables"></div>
  `;

  /* ------------------------------------------------------------
     DOM references
     ------------------------------------------------------------ */
  const locContainer = widget.querySelector("#sg-filter-locations");
  const comContainer = widget.querySelector("#sg-filter-commodities");
  const tablesContainer = widget.querySelector("#sg-location-tables");

  /* ------------------------------------------------------------
     Fetch data
     ------------------------------------------------------------ */
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
    .catch(() => {
      widget.innerHTML = "<p class='sg-error'>Cash bid data unavailable.</p>";
    });

  /* ------------------------------------------------------------
     Enable dropdown menus
     ------------------------------------------------------------ */
  widget.addEventListener("click", (e) => {
    const title = e.target.closest(".sg-collapsible");
    if (!title) return;

    const targetId = title.dataset.target;
    const content = widget.querySelector("#" + targetId);
    const isOpen = content.style.display === "block";

    // Close all
    widget.querySelectorAll(".sg-filter-content").forEach(c => c.style.display = "none");
    widget.querySelectorAll(".sg-collapsible").forEach(t => {
      t.textContent = t.textContent.replace("-", "+");
    });

    // Toggle current
    if (!isOpen) {
      content.style.display = "block";
      title.textContent = title.textContent.replace("+", "-");
    }
  });

  /* ------------------------------------------------------------
     Click outside closes filters
     ------------------------------------------------------------ */
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#sg-cashbid-widget")) {
      widget.querySelectorAll(".sg-filter-content").forEach(c => c.style.display = "none");
      widget.querySelectorAll(".sg-collapsible").forEach(t => {
        t.textContent = t.textContent.replace("-", "+");
      });
    }
  });

  /* ------------------------------------------------------------
     Build checkbox filters
     ------------------------------------------------------------ */
  function buildFilters() {
    locContainer.innerHTML = "";
    comContainer.innerHTML = "";
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

    widget
      .querySelectorAll(".sg-loc-check, .sg-com-check")
      .forEach(cb => cb.addEventListener("change", renderTables));
  }

  /* ------------------------------------------------------------
     Format delivery date
     ------------------------------------------------------------ */
  function sg_formatDelivery(start, end) {
    if (!start || !end) return "-";

    const s = new Date(start);
    const e = new Date(end);

    const fmt = d =>
      `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

    return fmt(s) + " - " + fmt(e);
  }

  /* ------------------------------------------------------------
     Render location tables
     ------------------------------------------------------------ */
  function renderTables() {
    tablesContainer.innerHTML = "";

    const selectedLocations = [...widget.querySelectorAll(".sg-loc-check:checked")]
      .map(cb => cb.value);

    const selectedCommodities = [...widget.querySelectorAll(".sg-com-check:checked")]
      .map(cb => cb.value);

    sg_locations.forEach(loc => {
      if (!selectedLocations.includes(loc.name)) return;

      let rows = "";

      if (Array.isArray(loc.cashbids)) {
        loc.cashbids.forEach(bid => {
          if (!selectedCommodities.includes(bid.name)) return;

          const changeVal = bid.futures_change || bid.change || "-";
          const changeNum = parseFloat(changeVal);

          const changeClass =
            !isNaN(changeNum) && changeNum > 0 ? "sg-up" :
            !isNaN(changeNum) && changeNum < 0 ? "sg-down" : "";

          rows += `
            <tr>
              <td>${bid.name}</td>
              <td>${sg_formatDelivery(bid.delivery_start_raw, bid.delivery_end_raw)}</td>
              <td>${bid.futures || "-"}</td>
              <td>${bid.basis || "-"}</td>
              <td>${bid.cashprice || "-"}</td>
              <td class="${changeClass}">${changeVal}</td>
            </tr>
          `;
        });
      }

      if (!rows.trim()) return;

      tablesContainer.insertAdjacentHTML(
        "beforeend",
        `
        <div class="sg-card">
          <div class="sg-location">${loc.name}</div>
          <table>
            <thead>
              <tr>
                <th>Commodity</th>
                <th>Delivery</th>
                <th>Futures</th>
                <th>Basis</th>
                <th>Cash Price</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        `
      );
    });
  }

})();
