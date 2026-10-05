(function () {
  /* ============================================================
     WEATHER WIDGET — National Weather Service (api.weather.gov)
     ------------------------------------------------------------
     Free, no API key, US locations only.

     Embed:
       <div data-sg-weather data-lat="41.5868" data-lon="-93.6250"></div>
       <script src="sg-weather.js"></script>

     Optional attributes (all data-*):
       name     Location label (defaults to the NWS city, state)
       units    us (°F, mph) | si (°C, km/h)        default us
       theme    dark | light | none (inherit site colors)  default light
       days     Days in the forecast list (1–7)    default 7
       hours    Hours in the hourly strip (0–24)   default 12
       alerts   true | false — show active alerts  default true
       refresh  Minutes between refreshes (0 = off)  default 15

     JavaScript:
       SGWeather.mount(el, { lat, lon, ... }) → { refresh, destroy }
     ============================================================ */

  /* Load sg-weather.css automatically (from the same folder as this
     script) unless the page already includes it. Lets the widget work
     in CMSs that strip <link> tags from page content. */
  (function ensureCss() {
    if (document.querySelector('link[href*="sg-weather.css"], [data-sg-weather-css]')) return;
    const me = document.currentScript;
    const base = me && me.src
      ? me.src.replace(/[^\/]*(\?.*)?$/, "")
      : "https://cgermain45.github.io/cashbid-widget/";
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = base + "sg-weather.css";
    link.setAttribute("data-sg-weather-css", "");
    document.head.appendChild(link);
  })();

  const API = "https://api.weather.gov";
  const POINT_CACHE_KEY = "sg-weather-points";
  const POINT_CACHE_DAYS = 7;
  const MIN_AUTO_REFRESH_MS = 5 * 60 * 1000; // NWS updates hourly at most

  /* ============================================================
     HELPERS
     ============================================================ */

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function toBool(v, fallback) {
    if (v === undefined || v === null || v === "") return fallback;
    if (typeof v === "boolean") return v;
    return !/^(false|0|no|off)$/i.test(String(v));
  }

  function clamp(n, lo, hi, fallback) {
    n = Number(n);
    if (!isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  function getJSON(url) {
    return fetch(url, { headers: { Accept: "application/geo+json" } })
      .then(r => {
        if (!r.ok) {
          return r.json().catch(() => ({})).then(body => {
            const err = new Error(body.detail || body.title || `Weather service error (${r.status})`);
            err.status = r.status;
            throw err;
          });
        }
        return r.json();
      });
  }

  /* NWS sometimes returns a transient 500 for gridpoint forecasts */
  function getJSONRetry(url) {
    return getJSON(url).catch(err => {
      if (err.status >= 500) {
        return new Promise(res => setTimeout(res, 1500)).then(() => getJSON(url));
      }
      throw err;
    });
  }

  /* The /points lookup (forecast URLs, station, time zone) rarely
     changes, so it's cached in localStorage for a week. */
  function readPointCache(key) {
    try {
      const all = JSON.parse(localStorage.getItem(POINT_CACHE_KEY) || "{}");
      const hit = all[key];
      if (hit && Date.now() - hit.saved < POINT_CACHE_DAYS * 864e5) return hit.data;
    } catch (e) { /* ignore */ }
    return null;
  }

  function writePointCache(key, data) {
    try {
      const all = JSON.parse(localStorage.getItem(POINT_CACHE_KEY) || "{}");
      all[key] = { saved: Date.now(), data };
      localStorage.setItem(POINT_CACHE_KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }

  function lookupPoint(lat, lon) {
    const key = `${lat},${lon}`;
    const cached = readPointCache(key);
    if (cached) return Promise.resolve(cached);

    return getJSON(`${API}/points/${key}`)
      .then(pt => {
        const p = pt.properties || {};
        const rel = (p.relativeLocation && p.relativeLocation.properties) || {};
        const data = {
          forecast: p.forecast,
          hourly: p.forecastHourly,
          stations: p.observationStations,
          timeZone: p.timeZone,
          place: [rel.city, rel.state].filter(Boolean).join(", "),
          station: null
        };
        if (!data.forecast) throw new Error("No NWS forecast for this location");

        // First (closest) observation station
        return getJSON(data.stations)
          .then(st => {
            const f = st.features && st.features[0];
            data.station = f && f.properties
              ? { id: f.properties.stationIdentifier, name: f.properties.name }
              : null;
          })
          .catch(() => { /* current conditions will fall back to the hourly forecast */ })
          .then(() => {
            writePointCache(key, data);
            return data;
          });
      })
      .catch(err => {
        if (err.status === 404) {
          throw new Error("NWS covers U.S. locations only — check the latitude/longitude");
        }
        throw err;
      });
  }

  /* ---------- units ---------- */

  const cToF = c => c * 9 / 5 + 32;
  const kmhToMph = k => k * 0.621371;

  function qv(q) {
    return q && typeof q.value === "number" ? q.value : null;
  }

  function cardinal(deg) {
    if (deg === null || deg === undefined) return "";
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }

  /* ---------- icons (inline SVG, colored with CSS) ---------- */

  function iconKind(text, isDay) {
    const t = String(text || "").toLowerCase();
    if (/thunder|t-storm|tstorm/.test(t)) return "storm";
    if (/snow|flurr|blizzard|sleet|ice|freezing/.test(t)) return "snow";
    if (/rain|shower|drizzle/.test(t)) return "rain";
    if (/fog|haze|smoke|mist|dust/.test(t)) return "fog";
    if (/mostly cloudy|considerable cloud/.test(t)) return "cloud";
    if (/partly|mostly sunny|mostly clear|few clouds/.test(t)) return isDay ? "partly-day" : "partly-night";
    if (/cloud|overcast/.test(t)) return "cloud";
    if (/wind|breez|blust|gust/.test(t)) return "wind";
    if (/sunny|clear|fair|hot/.test(t)) return isDay ? "sun" : "moon";
    return isDay ? "partly-day" : "partly-night";
  }

  const CLOUD = '<path class="sgw-i-cloud" d="M7 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 9.1 4.2 4.2 0 0 1 17.5 19Z"/>';
  const SUN_RAYS = '<g class="sgw-i-sun-ray"><path d="M12 1.5v2.2M12 20.3v2.2M1.5 12h2.2M20.3 12h2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></g>';

  const ICONS = {
    sun: `<circle class="sgw-i-sun" cx="12" cy="12" r="5"/>${SUN_RAYS}`,
    moon: '<path class="sgw-i-moon" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    "partly-day": '<circle class="sgw-i-sun" cx="8.5" cy="8" r="4"/><g class="sgw-i-sun-ray"><path d="M8.5 1v1.6M1.5 8h1.6M3.6 3.1l1.1 1.1M13.4 3.1l-1.1 1.1"/></g>' +
      '<path class="sgw-i-cloud" d="M9 21a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 19 12.1 3.8 3.8 0 0 1 18.8 21Z"/>',
    "partly-night": '<path class="sgw-i-moon" d="M13 9.5A6 6 0 0 1 5.5 2a6 6 0 1 0 7.5 7.5Z"/>' +
      '<path class="sgw-i-cloud" d="M9 21a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 19 12.1 3.8 3.8 0 0 1 18.8 21Z"/>',
    cloud: CLOUD,
    rain: '<path class="sgw-i-cloud" d="M7 15a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 5.1 4.2 4.2 0 0 1 17.5 15Z"/>' +
      '<g class="sgw-i-rain"><path d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3"/></g>',
    storm: '<path class="sgw-i-cloud" d="M7 15a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 5.1 4.2 4.2 0 0 1 17.5 15Z"/>' +
      '<path class="sgw-i-bolt" d="M12.5 13.5 9.5 18h3l-1.5 4.5 4.5-6h-3l1.5-3Z"/>',
    snow: '<path class="sgw-i-cloud" d="M7 15a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 5.1 4.2 4.2 0 0 1 17.5 15Z"/>' +
      '<g class="sgw-i-snow"><circle cx="8" cy="18.5" r="1"/><circle cx="12" cy="20.5" r="1"/><circle cx="16" cy="18.5" r="1"/></g>',
    fog: '<path class="sgw-i-cloud" d="M7 13a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 3.1 4.2 4.2 0 0 1 17.5 13Z"/>' +
      '<g class="sgw-i-fog"><path d="M4 16.5h16M6 19.5h12M8 22.5h8"/></g>',
    wind: '<g class="sgw-i-wind"><path d="M3 9h11.5a3 3 0 1 0-3-3M3 13h16.5a3 3 0 1 1-3 3M3 17h8"/></g>'
  };

  function icon(text, isDay, size) {
    const kind = iconKind(text, isDay);
    return `<svg class="sgw-icon sgw-icon-${kind}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[kind]}</svg>`;
  }

  /* ============================================================
     WIDGET INSTANCE
     ============================================================ */

  function mount(el, options) {
    if (!el) return null;
    if (el.sgWeather) return el.sgWeather;

    const d = el.dataset;
    const o = options || {};
    const pick = key => (o[key] !== undefined ? o[key] : d[key]);

    const lat = Number(pick("lat"));
    const lon = Number(pick("lon"));

    const cfg = {
      lat: isFinite(lat) ? Number(lat.toFixed(4)) : NaN,
      lon: isFinite(lon) ? Number(lon.toFixed(4)) : NaN,
      name: pick("name") || "",
      units: pick("units") === "si" ? "si" : "us",
      theme: pick("theme") || "light",
      days: clamp(pick("days"), 1, 7, 7),
      hours: clamp(pick("hours"), 0, 24, 12),
      alerts: toBool(pick("alerts"), true),
      refresh: pick("refresh") !== undefined && pick("refresh") !== ""
        ? Math.max(0, Number(pick("refresh")) || 0)
        : 15
    };

    el.classList.add("sgw", "sgw-theme-" + cfg.theme);
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Weather" + (cfg.name ? " for " + cfg.name : ""));
    el.innerHTML = `<div class="sgw-status">Loading weather…</div>`;

    const U = cfg.units === "si"
      ? { temp: "°C", wind: "km/h", deg: c => c, speed: k => k, pressure: pa => (pa / 100).toFixed(0) + " hPa" }
      : { temp: "°F", wind: "mph", deg: cToF, speed: kmhToMph, pressure: pa => (pa / 3386.39).toFixed(2) + " inHg" };

    let point = null;
    let lastUpdated = null;
    let lastData = null;
    let timer = null;
    let inFlight = null;

    /* ---------- data ---------- */

    function load(opts) {
      if (!isFinite(cfg.lat) || !isFinite(cfg.lon)) {
        el.innerHTML = `<div class="sgw-status sgw-error">Set a latitude and longitude for this weather panel.</div>`;
        return Promise.resolve();
      }

      // Board-wide auto refreshes are throttled; the panel button is not
      if (opts && opts.auto && lastUpdated && Date.now() - lastUpdated < MIN_AUTO_REFRESH_MS) {
        return Promise.resolve();
      }
      if (inFlight) return inFlight;

      const unitsParam = "units=" + cfg.units;

      inFlight = lookupPoint(cfg.lat, cfg.lon)
        .then(pt => {
          point = pt;
          return Promise.all([
            getJSONRetry(`${pt.forecast}?${unitsParam}`),
            getJSONRetry(`${pt.hourly}?${unitsParam}`).catch(() => null),
            pt.station
              ? getJSON(`${API}/stations/${pt.station.id}/observations/latest`).catch(() => null)
              : Promise.resolve(null),
            cfg.alerts
              ? getJSON(`${API}/alerts/active?point=${cfg.lat},${cfg.lon}`).catch(() => null)
              : Promise.resolve(null)
          ]);
        })
        .then(([forecast, hourly, obs, alerts]) => {
          lastData = {
            periods: (forecast.properties && forecast.properties.periods) || [],
            hourly: (hourly && hourly.properties && hourly.properties.periods) || [],
            obs: obs && obs.properties,
            alerts: ((alerts && alerts.features) || []).map(f => f.properties)
          };
          lastUpdated = new Date();
          render(false);
          el.dispatchEvent(new CustomEvent("sg:updated", { detail: { updated: lastUpdated } }));
        })
        .catch(err => {
          console.error("Weather load failed:", err);
          if (lastData) {
            render(true);
          } else {
            el.innerHTML = `<div class="sgw-status sgw-error">${escapeHtml(err.message || "Weather unavailable")}</div>`;
          }
          el.dispatchEvent(new CustomEvent("sg:error", { detail: err }));
        })
        .then(() => { inFlight = null; });

      return inFlight;
    }

    /* ---------- formatting ---------- */

    function fmtTime(iso, opts) {
      try {
        return new Date(iso).toLocaleString(undefined, Object.assign({ timeZone: point.timeZone }, opts));
      } catch (e) {
        return new Date(iso).toLocaleString(undefined, opts);
      }
    }

    function fmtTemp(v) {
      return v === null || v === undefined || isNaN(v) ? "–" : Math.round(v) + "°";
    }

    function pop(period) {
      const v = qv(period && period.probabilityOfPrecipitation);
      return v === null ? 0 : v;
    }

    /* Current conditions from the latest observation, with the first
       hourly period filling any gaps (stations often omit fields). */
    function current() {
      const obs = lastData.obs || {};
      const h = lastData.hourly[0] || lastData.periods[0] || {};
      const obsFresh = obs.timestamp && Date.now() - new Date(obs.timestamp) < 3 * 3600e3;

      const tC = obsFresh ? qv(obs.temperature) : null;
      const temp = tC !== null ? U.deg(tC) : h.temperature;

      const feelsC = obsFresh ? (qv(obs.windChill) ?? qv(obs.heatIndex)) : null;
      const windK = obsFresh ? qv(obs.windSpeed) : null;
      const gustK = obsFresh ? qv(obs.windGust) : null;
      const dirDeg = obsFresh ? qv(obs.windDirection) : null;
      const dewC = obsFresh ? qv(obs.dewpoint) : qv(h.dewpoint);
      const rh = obsFresh ? qv(obs.relativeHumidity) : qv(h.relativeHumidity);
      const pa = obsFresh ? qv(obs.barometricPressure) : null;

      let wind = "";
      if (windK !== null) {
        wind = windK < 1 ? "Calm" : `${cardinal(dirDeg)} ${Math.round(U.speed(windK))} ${U.wind}`;
        if (gustK) wind += `, gusts ${Math.round(U.speed(gustK))}`;
      } else if (h.windSpeed) {
        wind = `${h.windDirection || ""} ${h.windSpeed}`.trim();
      }

      // Hourly dewpoint is reported in °C even with units=us
      const dewUnit = obsFresh ? "c" : ((h.dewpoint && /degF/.test(h.dewpoint.unitCode)) ? "f" : "c");
      const dew = dewC === null ? null : (dewUnit === "c" ? U.deg(dewC) : dewC);

      return {
        temp,
        text: (obsFresh && obs.textDescription) || h.shortForecast || "",
        isDay: h.isDaytime !== undefined ? h.isDaytime : true,
        feels: feelsC !== null ? U.deg(feelsC) : null,
        wind,
        humidity: rh,
        dew,
        pressure: pa !== null ? U.pressure(pa) : null,
        precip: pop(h),
        observedAt: obsFresh ? obs.timestamp : null
      };
    }

    /* Pair NWS day/night periods into one row per day */
    function days() {
      const out = [];
      lastData.periods.forEach(p => {
        if (p.isDaytime) {
          out.push({ name: p.name, day: p, night: null });
        } else {
          const last = out[out.length - 1];
          if (last && !last.night && last.day) last.night = p;
          else out.push({ name: p.name, day: null, night: p });
        }
      });
      return out.slice(0, cfg.days);
    }

    function shortDayName(row, i) {
      const p = row.day || row.night;
      if (i === 0) return row.day ? "Today" : "Tonight";
      return fmtTime(p.startTime, { weekday: "short" });
    }

    /* ---------- render ---------- */

    function render(stale) {
      const c = current();
      const place = cfg.name || point.place || `${cfg.lat}, ${cfg.lon}`;
      const updated = lastUpdated
        ? lastUpdated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : "";

      /* Alerts */
      const alertsHtml = lastData.alerts.length
        ? `<div class="sgw-alerts">${lastData.alerts.map(a => `
            <details class="sgw-alert sgw-sev-${escapeHtml(String(a.severity || "unknown").toLowerCase())}">
              <summary>
                <span class="sgw-alert-event">⚠ ${escapeHtml(a.event || "Weather alert")}</span>
                ${a.ends || a.expires
                  ? `<span class="sgw-alert-until">until ${escapeHtml(fmtTime(a.ends || a.expires, { weekday: "short", hour: "numeric", minute: "2-digit" }))}</span>`
                  : ""}
              </summary>
              ${a.headline ? `<p class="sgw-alert-headline">${escapeHtml(a.headline)}</p>` : ""}
              ${a.description ? `<p>${escapeHtml(a.description)}</p>` : ""}
              ${a.instruction ? `<p class="sgw-alert-instruction">${escapeHtml(a.instruction)}</p>` : ""}
            </details>`).join("")}</div>`
        : "";

      /* Current */
      const stats = [
        c.feels !== null && Math.round(c.feels) !== Math.round(c.temp) ? ["Feels like", fmtTemp(c.feels)] : null,
        c.wind ? ["Wind", c.wind] : null,
        c.humidity !== null ? ["Humidity", Math.round(c.humidity) + "%"] : null,
        c.dew !== null ? ["Dew point", fmtTemp(c.dew)] : null,
        ["Precip", c.precip + "%"],
        c.pressure ? ["Pressure", c.pressure] : null
      ].filter(Boolean);

      const currentHtml = `
        <div class="sgw-current">
          <div class="sgw-now">
            ${icon(c.text, c.isDay, 56)}
            <div>
              <div class="sgw-temp">${fmtTemp(c.temp)}<span class="sgw-unit">${U.temp.slice(1)}</span></div>
              <div class="sgw-desc">${escapeHtml(c.text)}</div>
            </div>
          </div>
          <dl class="sgw-stats">
            ${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")}
          </dl>
        </div>`;

      /* Hourly */
      const hours = lastData.hourly.slice(0, cfg.hours);
      const hourlyHtml = hours.length
        ? `<div class="sgw-hourly" role="list" aria-label="Hourly forecast">
            ${hours.map(h => `
              <div class="sgw-hour" role="listitem">
                <div class="sgw-hour-time">${escapeHtml(fmtTime(h.startTime, { hour: "numeric" }))}</div>
                ${icon(h.shortForecast, h.isDaytime, 24)}
                <div class="sgw-hour-temp">${fmtTemp(h.temperature)}</div>
                <div class="sgw-hour-pop${pop(h) >= 30 ? " sgw-wet" : ""}">${pop(h) ? pop(h) + "%" : ""}</div>
              </div>`).join("")}
          </div>`
        : "";

      /* Daily */
      const dayRows = days();
      const all = dayRows.flatMap(r => [r.day && r.day.temperature, r.night && r.night.temperature])
        .filter(v => typeof v === "number");
      const min = Math.min(...all);
      const max = Math.max(...all);
      const span = Math.max(1, max - min);

      const dailyHtml = `
        <ol class="sgw-days" aria-label="${dayRows.length}-day forecast">
          ${dayRows.map((r, i) => {
            const main = r.day || r.night;
            const hi = r.day ? r.day.temperature : null;
            const lo = r.night ? r.night.temperature : null;
            const p = Math.max(pop(r.day), pop(r.night));
            const left = ((lo ?? hi) - min) / span * 100;
            const right = 100 - ((hi ?? lo) - min) / span * 100;
            return `
              <li class="sgw-day" title="${escapeHtml(main.detailedForecast || main.shortForecast || "")}">
                <span class="sgw-day-name">${escapeHtml(shortDayName(r, i))}</span>
                ${icon(main.shortForecast, !!r.day, 26)}
                <span class="sgw-day-text">${escapeHtml(main.shortForecast || "")}</span>
                <span class="sgw-day-pop${p >= 30 ? " sgw-wet" : ""}">${p ? p + "%" : ""}</span>
                <span class="sgw-day-lo">${lo !== null ? fmtTemp(lo) : ""}</span>
                <span class="sgw-day-bar" aria-hidden="true"><span style="left:${left.toFixed(1)}%;right:${right.toFixed(1)}%"></span></span>
                <span class="sgw-day-hi">${hi !== null ? fmtTemp(hi) : ""}</span>
              </li>`;
          }).join("")}
        </ol>`;

      el.innerHTML = `
        <div class="sgw-head">
          <div class="sgw-place">${escapeHtml(place)}</div>
          <div class="sgw-updated${stale ? " sgw-stale" : ""}">
            ${stale ? "Refresh failed · " : ""}${updated ? "Updated " + escapeHtml(updated) : ""}
          </div>
        </div>
        ${alertsHtml}
        <div class="sgw-body">
          ${currentHtml}
          ${hourlyHtml}
          ${dailyHtml}
        </div>
        <div class="sgw-credit">Source: <a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a></div>
      `;
    }

    /* ---------- lifecycle ---------- */

    load();
    if (cfg.refresh > 0) timer = setInterval(load, cfg.refresh * 60 * 1000);

    function destroy() {
      clearInterval(timer);
      el.innerHTML = "";
      el.classList.remove("sgw", "sgw-theme-" + cfg.theme);
      delete el.sgWeather;
    }

    const api = { el, refresh: load, destroy };
    el.sgWeather = api;
    return api;
  }

  /* ============================================================
     GLOBAL ENTRY POINT + AUTO-MOUNT
     ============================================================ */

  window.SGWeather = { mount };

  function autoMount() {
    document.querySelectorAll("[data-sg-weather]").forEach(el => mount(el));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
