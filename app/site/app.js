// Dock Watch: a static dashboard over the JSON written by app/build.py.
// Every statistic shown here was computed in app/qc.py. This file only
// filters, sorts and draws, except the editable FMEA table, which recalculates
// with calc.js (a tested mirror of qc.py).
import { rpn, pareto } from "./calc.js";

// ------------------------------------------------------------------ constants
const PAGES = [
  // the landing page: not in the sidebar; reached by opening the site or clicking "Dock Watch"
  { id: "overview", title: "Network Overview", inNav: false, sub: "Track dock availability, find unusable stations, and decide where to send vans.", icon: "M3 3h6v6H3zM11 3h6v4h-6zM11 9h6v8h-6zM3 11h6v6H3z" },
  { id: "map", title: "Map", icon: "M10 2a6 6 0 0 0-6 6c0 4.5 6 10 6 10s6-5.5 6-10a6 6 0 0 0-6-6zm0 8.2A2.2 2.2 0 1 1 10 5.8a2.2 2.2 0 0 1 0 4.4z" },
  { id: "dispatch", title: "Dispatch", icon: "M1 6h11v8H1zM12 9h4l3 3v2h-7zM5 16.5a1.5 1.5 0 1 0 0-.01M15 16.5a1.5 1.5 0 1 0 0-.01" },
  { id: "maintenance", title: "Maintenance", icon: "M13.5 2.5a4 4 0 0 0-4.9 5.2L2.5 13.8l3.7 3.7 6.1-6.1a4 4 0 0 0 5.2-4.9l-2.4 2.4-2.5-.6-.6-2.5z" },
  { id: "analysis", title: "Data Analysis", icon: "M3 17V9h3v8zM8.5 17V4h3v13zM14 17v-6h3v6z" },
];
// old page links land on the page that now holds them
const PAGE_ALIASES = { stockouts: "map", docks: "maintenance", forecast: "dispatch", reliability: "analysis" };
const CATS = ["empty", "low", "medium", "high", "full", "out_of_service"];
const CAT_LABEL = { empty: "Empty (0%)", low: "Low (1-29%)", medium: "Medium (30-69%)", high: "High (70-99%)", full: "Full (100%)", out_of_service: "Out of service" };
const CAT_COLOR = { empty: "var(--empty)", low: "var(--low)", medium: "var(--medium)", high: "var(--high)", full: "var(--full)", out_of_service: "var(--oos)" };
const STATUS_LABEL = { active: "Active", offline: "Offline", broken_kiosk: "Broken kiosk", blocked: "Blocked", maintenance: "Under maintenance" };
const PROBLEM_LABEL = {
  offline: "offline", broken_kiosk: "broken kiosk", blocked: "blocked", maintenance: "under maintenance",
  stale_feed: "stale feed", no_bikes: "no rentable bikes", no_docks: "no open docks",
  broken_docks: "broken docks", broken_bikes: "broken bikes",
};
const FLAG_LABEL = {
  full_due_to_broken_docks: "Looks full only because docks are broken",
  empty_due_to_broken_bikes: "Looks like it has bikes, but none are rentable",
  looks_emptier: "Counting broken docks makes it look emptier than it is",
};
const DOCK_STATES = {
  bike: ["Bike (rentable)", ""], bike_disabled: ["Broken bike in dock", ""], open: ["Open dock", ""],
  faulty: ["Faulty dock", "×"], bike_stuck: ["Bike stuck", "!"], never_locks: ["Never locks", "∅"],
};
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const UPDATED = { any: "Any time", 5: "Within 5 min", 15: "Within 15 min", 60: "Within 60 min", stale: "Stale (over 15 min)" };

// ------------------------------------------------------------------- state
const store = {
  get(k, d) { try { const v = localStorage.getItem("dockwatch:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("dockwatch:" + k, JSON.stringify(v)); } catch { /* storage off */ } },
};
const S = {
  index: [], data: null, datasetId: store.get("dataset", null), snap: store.get("snapshot", null),
  page: "map", selected: null, loading: true, error: null,
  filters: { districts: null, status: "all", updated: "any", minOpen: 0, problemOnly: false },
  heatMetric: "empty",
  analysisTab: "fmea", queueTab: "repair", xbarScope: "network", pWindow: "off_peak",
  fmeaEdits: {}, local: store.get("local", { assigned: {}, done: {} }),
};
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? "—" : Number(x).toFixed(d));
const pct = (x, d = 0) => (x === null || x === undefined ? "—" : `${(100 * x).toFixed(d)}%`);
const minsBetween = (a, b) => (Date.parse(b.replace(" ", "T")) - Date.parse(a.replace(" ", "T"))) / 60000;
const addMin = (a, m) => {
  const d = new Date(Date.parse(a.replace(" ", "T")) + m * 60000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const shortTime = (t) => { const d = new Date(t.replace(" ", "T")); return `${DOW[(d.getDay() + 6) % 7]} ${t.slice(5, 10)} ${t.slice(11)}`; };

function snapData() { return S.data.snapshots[S.snap]; }
function stationInfo(id) { return S.data.stations.find((s) => s.station_id === id); }
function stName(id) { const s = stationInfo(id); return s ? `${id} ${s.name}` : id; }
function rowFor(id) { return snapData().stations.find((r) => r.id === id); }
function isProblem(r) { return r.problems.length > 0 || !!r.misleading; }

// ----------------------------------------------------------- marker shapes
function shapePath(cat, s) {
  const h = s;
  switch (cat) {
    case "empty": return `<path d="M${-h} ${-h * .75}L${h} ${-h * .75}L0 ${h}Z"/>`;
    case "low": return `<path d="M0 ${-h}L${h} 0L0 ${h}L${-h} 0Z"/>`;
    case "medium": return `<circle r="${h * .85}"/>`;
    case "high": return `<rect x="${-h * .78}" y="${-h * .78}" width="${h * 1.56}" height="${h * 1.56}"/>`;
    case "full": return `<path d="M${-h} ${h * .75}L${h} ${h * .75}L0 ${-h}Z"/>`;
    default: return `<path d="M${-h * .8} ${-h * .8}L${h * .8} ${h * .8}M${h * .8} ${-h * .8}L${-h * .8} ${h * .8}" stroke-width="${h * .55}" stroke-linecap="round"/>`;
  }
}
function markerSvg(cat, size = 7) {
  const oos = cat === "out_of_service";
  const w = size * 2 + 4;
  return `<svg width="${w}" height="${w}" viewBox="${-size - 2} ${-size - 2} ${w} ${w}" aria-hidden="true"><g fill="${oos ? "none" : CAT_COLOR[cat]}" stroke="${CAT_COLOR[cat]}">${shapePath(cat, size)}</g></svg>`;
}
function catBadge(cat) {
  return `<span class="badge">${markerSvg(cat, 5)}${esc(CAT_LABEL[cat] || cat)}</span>`;
}
function fillLegend(extra = "") {
  return `<div class="legend" aria-label="Legend">${CATS.map((c) => `<span class="item">${markerSvg(c, 6)}${CAT_LABEL[c]}</span>`).join("")}
    <span class="item"><svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true"><circle r="7" fill="none" stroke="#1d2125" stroke-dasharray="2 2"/></svg>Problem station</span>${extra}</div>`;
}

// ------------------------------------------------------------------- tooltip
const tip = $("#tooltip");
document.addEventListener("mousemove", (e) => {
  const el = e.target.closest?.("[data-tip]");
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.getAttribute("data-tip");
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${e.clientY + 14}px`;
});

// --------------------------------------------------------------------- shell
function renderNav() {
  $("#nav").innerHTML = PAGES.filter((p) => p.inNav !== false).map((p) => `<a href="#${p.id}" ${p.id === S.page ? 'aria-current="page"' : ""} title="${p.title}">
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="${p.icon}" ${p.stroke ? 'fill="none" stroke="currentColor" stroke-width="1.8"' : 'fill="currentColor"'} /></svg><span>${p.title}</span></a>`).join("");
  $("#home").toggleAttribute("aria-current", S.page === "overview");
}

function renderTop() {
  const page = PAGES.find((p) => p.id === S.page);
  $("#page-title").textContent = page.title;
  $("#page-sub").textContent = page.sub || "";
  $("#page-sub").hidden = !page.sub;
  document.title = `${page.title} · Dock Watch`;
  const ds = $("#dataset");
  ds.innerHTML = S.index.map((d) => `<option value="${d.id}" ${d.id === S.datasetId ? "selected" : ""}>${esc(d.label)}</option>`).join("");
  const sn = $("#snapshot");
  if (!S.data) { sn.innerHTML = ""; $("#fresh").innerHTML = S.error ? "Data unavailable" : "Loading..."; return; }
  sn.innerHTML = S.data.meta.snapshots.map((s) => `<option ${s === S.snap ? "selected" : ""}>${esc(s)}</option>`).join("");
  const rows = snapData().stations;
  const fresh = rows.filter((r) => r.feed_age_min <= 5).length;
  const stale = rows.filter((r) => r.feed_age_min > S.data.meta.stale_min).length;
  const color = stale ? "var(--bad)" : fresh < rows.length ? "var(--warn)" : "var(--ok)";
  $("#fresh").innerHTML = `<span class="dot" style="background:${color}"></span>Last updated ${esc(shortTime(snapData().time))} · ${fresh}/${rows.length} feeds fresh${stale ? ` · <b>${stale} stale</b>` : ""}`;
  $("#fresh").title = "Snapshot time of this replay, and how many station feeds reported in the last 5 minutes";
}

function render() {
  renderNav();
  renderTop();
  const el = $("#page");
  if (S.error) {
    el.innerHTML = `<div class="card state error" role="alert"><p><b>Could not load data.</b></p><p>${esc(S.error)}</p><button class="primary" id="retry">Retry</button></div>`;
    $("#retry").onclick = () => loadDataset(S.datasetId);
    return;
  }
  if (S.loading || !S.data) {
    el.innerHTML = `<div class="card state" aria-busy="true"><div class="spinner"></div>Loading station data...</div>`;
    return;
  }
  try {
    ({ overview: pageOverview, map: pageMapAll, dispatch: pageDispatchAll, maintenance: pageMaintenanceAll, analysis: pageAnalysis })[S.page](el);
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="card state error" role="alert"><p><b>This page failed to draw.</b></p><p class="mono">${esc(err.message)}</p></div>`;
  }
}

// ------------------------------------------------------------------ filters
function filtersHtml() {
  const f = S.filters;
  const districts = [...new Set(S.data.stations.map((s) => s.district))];
  const on = f.districts || districts;
  return `<div class="card filters" aria-label="Filters">
    <h2>Filters</h2>
    <fieldset><legend>District</legend>${districts.map((d) => `<label><input type="checkbox" data-f="district" value="${d}" ${on.includes(d) ? "checked" : ""}> ${d}</label>`).join("")}</fieldset>
    <fieldset><legend>Status</legend><select data-f="status" aria-label="Status">
      <option value="all">All statuses</option>${CATS.map((c) => `<option value="${c}" ${f.status === c ? "selected" : ""}>${CAT_LABEL[c]}</option>`).join("")}</select></fieldset>
    <fieldset><legend>Time of last update</legend><select data-f="updated" aria-label="Time of last update">
      ${Object.entries(UPDATED).map(([k, v]) => `<option value="${k}" ${String(f.updated) === k ? "selected" : ""}>${v}</option>`).join("")}</select></fieldset>
    <fieldset><legend>Open docking stations</legend><label>At least <input type="number" min="0" max="20" data-f="minOpen" value="${f.minOpen}" aria-label="Minimum open docks"> open docks</label></fieldset>
    <fieldset><legend>Problems</legend><label><input type="checkbox" data-f="problemOnly" ${f.problemOnly ? "checked" : ""}> Problem stations only</label></fieldset>
    <button data-f="reset">Reset filters</button>
    <p class="small muted" id="filter-count"></p>
  </div>`;
}
function bindFilters(root) {
  root.querySelectorAll("[data-f]").forEach((el) => {
    const k = el.dataset.f;
    const ev = el.tagName === "BUTTON" ? "click" : "change";
    el.addEventListener(ev, () => {
      const f = S.filters;
      if (k === "district") f.districts = [...root.querySelectorAll('[data-f="district"]:checked')].map((x) => x.value);
      else if (k === "problemOnly") f.problemOnly = el.checked;
      else if (k === "minOpen") f.minOpen = Math.max(0, parseInt(el.value || "0", 10));
      else if (k === "reset") Object.assign(f, { districts: null, status: "all", updated: "any", minOpen: 0, problemOnly: false });
      else f[k] = el.value;
      render();
    });
  });
}
function passes(r) {
  const f = S.filters;
  const st = stationInfo(r.id);
  if (f.districts && !f.districts.includes(st.district)) return false;
  if (f.status !== "all" && r.category !== f.status) return false;
  if (f.updated === "stale" && !(r.feed_age_min > S.data.meta.stale_min)) return false;
  if (!["any", "stale"].includes(String(f.updated)) && !(r.feed_age_min <= Number(f.updated))) return false;
  if (r.docks_available < f.minOpen) return false;
  if (f.problemOnly && !isProblem(r)) return false;
  return true;
}
function filteredIds() { return snapData().stations.filter(passes).map((r) => r.id); }

// ------------------------------------------------ shared by Overview + Dispatch
// When the station hits trouble: "Now" for anything already wrong, else the forecast horizon.
function timeUntil(i) {
  if (!i.urgency) return "—";
  return i.urgency === 5 || i.minutes_to_hit === 0 ? "Now" : hLabel(i.minutes_to_hit);
}
function riskBadge(i) {
  if (i.risk === "empty" || i.risk === "full" || i.risk === "out_of_service") return catBadge(i.risk);
  return i.issues && i.issues.length ? `<span class="badge warn">${esc(i.issues.join(" · "))}</span>` : `<span class="muted small">—</span>`;
}
// Rebalancing tasks still open at this snapshot: van jobs in progress plus the
// recommended and manual tasks assigned in this browser and not yet confirmed.
function openRebalanceTasks() {
  const snap = snapData();
  const fromData = snap.tasks.rebalance.filter((id) => !S.local.done[localKey(id)]).length;
  const moves = snap.moves.filter((m, k) => S.local.assigned[localKey(`move${k}`)] && !S.local.done[localKey(`move${k}`)]).length;
  const manual = manualTasks().filter((t) => !S.local.done[localKey(t.id)]).length;
  return fromData + moves + manual;
}
function topFailureMode() {
  const rows = fmeaRows().filter((r) => r.rpn !== null).sort((a, b) => b.rpn - a.rpn);
  return rows[0] || null;
}
function openOnMap(id) {
  const s = stationInfo(id);
  S.selected = id;
  S.mapView = { center: [s.lat, s.lon], zoom: 15 };
  location.hash = "map";
}

// ----------------------------------------------------------------- Overview
function pageOverview(el) {
  const snap = snapData();
  const sm = snap.summary;
  const atRisk = snap.forecast.filter((i) => i.urgency > 0);
  const top = atRisk.slice(0, 5);
  const stat = (value, label, color) => `<div class="card kpi kpi-blue ov-stat"><div class="v" style="color:${color}">${value}</div><div class="l">${label}</div></div>`;
  const issueIcon = (i) => markerSvg(i.status !== "active" ? "out_of_service" : i.risk === "full" ? "full" : i.risk === "empty" ? "empty" : "low", 5);
  const tf = topFailureMode();
  const card = (href, title, line, value) => `<a class="page-card" href="${href}"><div><div class="pc-title">${title}</div><div class="pc-line">${line}</div></div><div class="pc-num">${value}</div><span class="pc-arrow" aria-hidden="true">→</span></a>`;
  el.innerHTML = `<div class="stack overview">
    <div class="grid cols-4 ov-strip">
      ${stat(sm.empty, "empty stations now<br><span>no rentable bikes</span>", CAT_COLOR.empty)}
      ${stat(sm.full, "full stations now<br><span>no open docks</span>", CAT_COLOR.full)}
      ${stat(sm.out_of_service, "out-of-service stations now", CAT_COLOR.out_of_service)}
      ${stat(sm.docks_available_pct === null ? "—" : `${fmt(sm.docks_available_pct, 0)}%`, `of docks available<br><span>${sm.docks_available} of ${sm.docks_total}, network-wide</span>`, CAT_COLOR.medium)}
    </div>
    <div class="card ov-risk">
      <div class="card-h"><h2>Stations at risk<span class="subhead">Top 5, in the same order as Dispatch · click a row to see it on the map</span></h2><a href="#dispatch" class="small">View all ${atRisk.length} →</a></div>
      ${top.length ? `<div class="table-wrap" style="max-height:none"><table class="forecast"><thead><tr><th>Station</th><th>Issue</th><th class="num">Risk %</th><th>Time until event</th></tr></thead><tbody>
        ${top.map((i) => `<tr class="${i.priority === "high" ? "risk-high" : "risk"} clickable" tabindex="0" role="link" data-open="${i.id}" aria-label="Open ${esc(stName(i.id))} on the map">
          <td><b>${esc(stName(i.id))}</b><div class="small muted">${esc(stationInfo(i.id).district)}</div></td>
          <td><span class="row" style="gap:6px;flex-wrap:nowrap">${issueIcon(i)}${esc(i.issues.join(" · "))}</span></td>
          <td class="num"><b>${i.risk_pct === null ? "—" : `${fmt(i.risk_pct, 0)}%`}</b></td>
          <td>${timeUntil(i)}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="howto" style="margin:8px 14px 12px">Risk % = how often the station was empty, full or out of service in the next 2 hours at this weekday and time in earlier weeks (100% when it already is). Red rows are high priority.</p>`
      : `<div class="state">No stations at risk right now.</div>`}
    </div>
    <div class="grid ov-cards">
      ${card("#map", "Map", "stations empty or full now", sm.empty + sm.full)}
      ${card("#dispatch", "Dispatch", "open rebalancing tasks", openRebalanceTasks())}
      ${card("#maintenance", "Dock Health", "stations with broken docks", sm.broken_dock_stations)}
      ${card("#maintenance", "Maintenance", "mean time to repair", snap.maintenance.mttr_min === null ? "—" : dur(snap.maintenance.mttr_min))}
      ${card("#analysis", "Data Analysis", "top failure mode (FMEA)", tf ? `${esc(tf.mode)} <small>RPN ${tf.rpn}</small>` : "—")}
    </div>
  </div>`;
  el.querySelectorAll("[data-open]").forEach((tr) => {
    tr.addEventListener("click", () => openOnMap(tr.dataset.open));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openOnMap(tr.dataset.open); } });
  });
}

// ----------------------------------------------------------------- Map page
// Live map of Boston (Leaflet + the standard OpenStreetMap street layer, a
// key-free equivalent of the Google Maps default layer) with the heatmap below.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function pageMapAll(el) {
  const rows = snapData().stations;
  const ids = filteredIds();
  el.innerHTML = `<div class="grid with-filters">
    ${filtersHtml()}
    <div class="stack">
      <div class="card map-card">
        <div class="card-h"><div>${fillLegend(`<span class="item"><b style="color:#8a5200">!</b> Misleading fill</span><span class="item"><span class="van-badge" aria-hidden="true">V</span>Van</span>`)}</div></div>
        <div class="map-wrap">
          <div class="leaflet-box" id="leaflet" role="region" aria-label="Map of Boston bikeshare stations"><div class="state"><div class="spinner"></div>Loading map...</div></div>
          <div class="side" id="side">${sidePanel()}</div>
        </div>
      </div>
      ${heatmapCard(ids)}
    </div></div>`;
  bindFilters(el);
  $("#filter-count").textContent = `${ids.length} of ${rows.length} stations shown`;
  drawLeaflet(rows, new Set(ids));
  const close = $("#close-side");
  if (close) close.onclick = () => { S.selected = null; render(); };
  $("#heat-metric").onchange = (e) => { S.heatMetric = e.target.value; render(); };
}

function stationIcon(r) {
  const oos = r.category === "out_of_service";
  const shape = oos
    ? `<g stroke="${CAT_COLOR.out_of_service}" fill="none">${shapePath("out_of_service", 7)}</g>`
    : `<g fill="${CAT_COLOR[r.category]}" stroke="#fff" stroke-width="1.6">${shapePath(r.category, 8)}</g>`;
  const ring = isProblem(r) ? `<circle r="12.5" fill="none" stroke="#1d2125" stroke-width="1.2" stroke-dasharray="3 2.4"/>` : "";
  const sel = S.selected === r.id ? `<circle r="15" fill="none" stroke="#1d2125" stroke-width="2"/>` : "";
  const warn = r.misleading ? `<text x="9" y="-8" font-size="12" font-weight="800" fill="#8a5200" stroke="#fff" stroke-width="3" paint-order="stroke">!</text>` : "";
  return L.divIcon({ className: "stn-icon", iconSize: [36, 36], iconAnchor: [18, 18],
    html: `<svg width="36" height="36" viewBox="-18 -18 36 36" aria-hidden="true">${sel}${ring}${shape}${warn}</svg>` });
}

function drawLeaflet(rows, keep) {
  const box = $("#leaflet");
  if (S.leaflet) { S.leaflet.remove(); S.leaflet = null; }
  if (!window.L) {
    box.innerHTML = `<div class="state error" role="alert"><b>The map library did not load.</b><br>Check the internet connection and reload. The filters and heatmap still work.</div>`;
    return;
  }
  box.innerHTML = "";
  const map = L.map(box, { zoomControl: true, scrollWheelZoom: true, minZoom: 11 });
  S.leaflet = map;
  const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
  let tileErrors = 0;
  tiles.on("tileerror", () => {
    if (++tileErrors === 6) box.insertAdjacentHTML("beforeend", `<div class="map-banner" role="alert">Map tiles are not loading (offline?). Stations are still placed correctly.</div>`);
  });
  const pts = S.data.stations.map((s) => [s.lat, s.lon]);
  if (S.mapView) map.setView(S.mapView.center, S.mapView.zoom);
  else map.fitBounds(pts, { padding: [28, 28] });
  map.on("moveend", () => { S.mapView = { center: map.getCenter(), zoom: map.getZoom() }; });

  // neighborhood (district) labels at each district's centre
  const byD = {};
  S.data.stations.forEach((s) => (byD[s.district] ||= []).push(s));
  Object.entries(byD).forEach(([d, ss]) => {
    const lat = ss.reduce((a, s) => a + s.lat, 0) / ss.length, lon = ss.reduce((a, s) => a + s.lon, 0) / ss.length;
    L.marker([lat, lon], { interactive: false, keyboard: false,
      icon: L.divIcon({ className: "district-label", html: `<span>${esc(d)}</span>`, iconSize: [140, 18], iconAnchor: [70, 30] }) }).addTo(map);
  });

  snapData().vans.forEach((v) => {
    const off = v.station === "depot" ? [0, 0] : [0.0009, 0.0011];
    L.marker([v.lat + off[0], v.lon + off[1]], { keyboard: false,
      icon: L.divIcon({ className: "van-icon", html: `<span class="van-badge">${esc(v.van)}</span>`, iconSize: [30, 18], iconAnchor: [15, 9] }) })
      .bindTooltip(`${esc(v.name)}: ${esc(v.status)}${v.station !== "depot" ? ` at ${esc(stName(v.station))}` : " at depot"}<br>load ${v.load}/${v.capacity} bikes`, { direction: "top" })
      .addTo(map);
  });

  rows.forEach((r) => {
    const s = stationInfo(r.id);
    const oos = r.category === "out_of_service";
    const tip = `<b>${esc(r.id)} ${esc(s.name)}</b> (${esc(s.district)})<br>${esc(CAT_LABEL[r.category])}${r.fill_pct !== null && !oos ? ` · ${fmt(r.fill_pct)}% full` : ""}<br>${r.bikes_available} bikes · ${r.docks_available} open docks · ${r.docks_disabled} broken docks${r.status !== "active" ? `<br>Status: ${esc(STATUS_LABEL[r.status])}` : ""}`;
    L.marker([s.lat, s.lon], { icon: stationIcon(r), opacity: keep.has(r.id) ? 1 : 0.2, keyboard: true,
      title: `${r.id} ${s.name}`, alt: `${r.id} ${s.name}, ${CAT_LABEL[r.category]}`, riseOnHover: true,
      zIndexOffset: keep.has(r.id) ? 1000 : 0 })
      .bindTooltip(tip, { direction: "top", offset: [0, -14] })
      .on("click", () => { S.selected = r.id; render(); })
      .addTo(map);
  });
}

function sidePanel() {
  if (!S.selected) return `<div class="card-b"><h2>Station details</h2><p class="muted" style="margin-top:8px">Click a station on the map to see its fill, bikes, effective capacity and broken docks.</p></div>`;
  const r = rowFor(S.selected), s = stationInfo(S.selected);
  const oos = r.category === "out_of_service";
  const tickets = S.data.orders.filter((o) => o.station === r.id && o.type === "repair" && o.opened <= snapData().time).length;
  return `<div class="card-h"><div><h2>${esc(r.id)} ${esc(s.name)}</h2><div class="small muted">${esc(s.district)} · ${s.profile}</div></div><button class="icon-btn" id="close-side" aria-label="Close">✕</button></div>
  <div class="card-b stack" style="gap:12px">
    <div>${catBadge(r.category)} ${r.status !== "active" ? `<span class="badge bad">${STATUS_LABEL[r.status]}</span>` : ""}</div>
    <div><div class="row" style="justify-content:space-between"><span class="muted">Fill</span><b style="font-size:22px">${oos ? "—" : fmt(r.fill_pct) + "%"}</b></div>
      <div class="fillbar" aria-hidden="true"><div style="width:${oos ? 0 : r.fill_pct}%;background:${CAT_COLOR[r.category]}"></div></div></div>
    <dl>
      <dt>Rentable bikes</dt><dd>${r.bikes_available}</dd>
      <dt>Broken bikes in docks</dt><dd>${r.bikes_disabled}</dd>
      <dt>Open docks</dt><dd>${r.docks_available}</dd>
      <dt>Broken docks</dt><dd>${r.docks_disabled}</dd>
      <dt>Total docks</dt><dd>${s.total_docks}</dd>
      <dt>Effective capacity</dt><dd>${r.eff}</dd>
      <dt>Last reported</dt><dd>${esc(r.last_reported.slice(11))} (${fmt(r.feed_age_min)} min ago)</dd>
      <dt>Repair tickets so far</dt><dd>${tickets}</dd>
    </dl>
    ${r.misleading ? `<div class="badge warn" style="white-space:normal">⚠ ${FLAG_LABEL[r.misleading]}</div>` : ""}
    ${r.problems.length ? `<div class="small"><b>Problems:</b> ${r.problems.map((p) => PROBLEM_LABEL[p]).join(", ")}</div>` : `<div class="small muted">No problems at this snapshot.</div>`}
    ${r.feed_age_min > S.data.meta.stale_min ? `<p class="howto">Silent feed: these numbers are ${fmt(r.feed_age_min)} minutes old and may not be true now.</p>` : ""}
    <a href="#maintenance" class="small">See dock-level health →</a>
  </div>`;
}

// ------------------------------------------------------------------ heatmap
const HEAT = {
  empty: { label: "% of polls empty (0 bikes)", num: "empty", den: "active_n" },
  full: { label: "% of polls full (0 open docks)", num: "full", den: "active_n" },
  unusable: { label: "% of polls unusable (empty, full or out of service)", num: "unusable", den: "n" },
  fill: { label: "Average fill %", num: "fill_sum", den: "active_n" },
};
function heatmapCard(ids) {
  const m = HEAT[S.heatMetric];
  const cells = Array.from({ length: 168 }, (_, k) => {
    let num = 0, den = 0;
    ids.forEach((id) => { num += S.data.heatmap[id][m.num][k]; den += S.data.heatmap[id][m.den][k]; });
    return den ? (100 * num) / den : null;
  });
  const max = S.heatMetric === "fill" ? 100 : Math.max(5, ...cells.filter((v) => v !== null));
  const cw = 34, ch = 26, left = 40, top = 26;
  const rgb = S.heatMetric === "fill" ? "44,111,191" : "209,52,44";
  const shade = (v) => (v === null ? "#f3f4f6" : `rgba(${rgb},${0.06 + 0.94 * (v / max)})`);
  let svg = "";
  for (let d = 0; d < 7; d++) {
    svg += `<text x="${left - 8}" y="${top + d * ch + ch / 2 + 4}" text-anchor="end">${DOW[d]}</text>`;
    for (let h = 0; h < 24; h++) {
      const v = cells[d * 24 + h];
      svg += `<rect x="${left + h * cw}" y="${top + d * ch}" width="${cw}" height="${ch}" fill="${shade(v)}" stroke="#fff" stroke-width="1"
        data-tip="${DOW[d]} ${String(h).padStart(2, "0")}:00-${String(h).padStart(2, "0")}:59\n${m.label}: ${v === null ? "no data" : v.toFixed(1) + "%"}\n${ids.length} stations"><title>${DOW[d]} ${h}:00 ${v === null ? "no data" : v.toFixed(1) + "%"}</title></rect>`;
      if (v !== null && v >= max * 0.45) svg += `<text x="${left + h * cw + cw / 2}" y="${top + d * ch + ch / 2 + 4}" text-anchor="middle" style="fill:#fff;font-size:9px;pointer-events:none">${Math.round(v)}</text>`;
    }
  }
  // hour labels sit on the grid lines (the start of each hour), not on the blocks
  for (let h = 0; h <= 24; h++) {
    const x = left + h * cw;
    svg += `<line x1="${x}" x2="${x}" y1="${top - 6}" y2="${top + 7 * ch}" stroke="#b8bfc7" stroke-width="${h % 6 === 0 ? 1.2 : .6}"/>
      <text x="${x}" y="${top - 10}" text-anchor="middle">${h}</text>`;
  }
  return `<div class="card">
    <div class="card-h"><h2>Rush-hour heatmap · hour × day of week</h2>
      <label class="row small">Metric <select id="heat-metric">${Object.entries(HEAT).map(([k, v]) => `<option value="${k}" ${k === S.heatMetric ? "selected" : ""}>${v.label}</option>`).join("")}</select></label></div>
    <div class="card-b">
      <svg class="heat" viewBox="0 0 ${left + 24 * cw + 12} ${top + 7 * ch + 4}" role="img" aria-label="Heatmap of ${m.label} by hour and weekday">${svg}</svg>
      <div class="legend" style="margin-top:8px"><span>0%</span><span style="display:inline-block;width:160px;height:10px;border-radius:5px;background:linear-gradient(90deg,rgba(${rgb},.06),rgba(${rgb},1))"></span><span>${fmt(max)}%</span>
        <span class="item">Hour labels mark where each hour starts · numbers show the darker cells</span></div>
      <p class="howto">Each cell pools every 5-minute poll in that hour over the 3 weeks of data for the ${ids.length} filtered stations. Try one district at a time: South Boston, Jamaica Plain and Charlestown empty in the morning, Downtown and Back Bay fill.</p>
    </div>
  </div>`;
}

// ------------------------------------------- Maintenance (with Dock Health)
function pctKpi(cls, pct, line2, label) {
  return `<div class="card kpi ${cls}"><div class="v">${pct === null ? "—" : `${fmt(pct, 1)}%`}</div><div class="v2">${line2}</div><div class="l">${label}</div></div>`;
}
function pageMaintenanceAll(el) {
  const snap = snapData();
  const m = snap.maintenance;
  const rows = snap.stations.map((r) => ({ r, s: stationInfo(r.id), d: snap.docks[r.id], reps: m.repair_counts[r.id] || 0 }));
  rows.sort((a, b) => (!!b.r.misleading - !!a.r.misleading) || (b.r.docks_disabled - a.r.docks_disabled) || (b.reps - a.reps) || a.r.id.localeCompare(b.r.id));
  const total = rows.reduce((a, x) => a + x.s.total_docks, 0);
  const brokenDocks = rows.reduce((a, x) => a + x.r.docks_disabled, 0);
  const bikes = rows.reduce((a, x) => a + x.r.bikes_available + x.r.bikes_disabled, 0);
  const brokenBikes = rows.reduce((a, x) => a + x.r.bikes_disabled, 0);
  const flagged = rows.filter((x) => x.r.misleading).length;
  const thr = m.repeat_threshold;
  const repeat = rows.filter((x) => x.reps >= thr).length;
  const n = rows.length;
  const p = (a, b) => (b ? (100 * a) / b : null);
  const maxRep = Math.max(1, ...rows.map((x) => x.reps));
  const dockLegend = `<div class="legend">${Object.entries(DOCK_STATES).map(([k, [lab, sym]]) => `<span class="item"><span class="dock ${k}" aria-hidden="true">${sym}</span>${lab}</span>`).join("")}<span class="item"><b style="color:#8a5200">⚠</b> Misleading fill</span></div>`;
  el.innerHTML = `<div class="stack">
    <div class="grid cols-5">
      ${pctKpi("kpi-blue", p(brokenDocks, total), `${brokenDocks} of ${total} docks`, "broken docks")}
      ${pctKpi("kpi-blue", p(brokenBikes, bikes), `${brokenBikes} of ${bikes} docked bikes`, "broken bikes in docks")}
      ${pctKpi("kpi-blue", p(total - brokenDocks, total), `${total - brokenDocks} of ${total} docks`, "effective capacity (usable docks)")}
      ${pctKpi("kpi-blue", p(flagged, n), `${flagged} of ${n} stations`, "stations with misleading fill")}
      ${pctKpi("kpi-blue", p(repeat, n), `${repeat} of ${n} stations`, `repeat offenders (${fmt(thr, 0)}+ unplanned repairs)`)}
    </div>
    <div class="card">
      <div class="card-h"><h2>Dock health at ${esc(shortTime(snap.time))}</h2>${dockLegend}</div>
      <div class="table-wrap" style="max-height:none"><table>
        <thead><tr><th>Station</th><th class="num">Total</th><th class="num">Broken docks</th><th class="num">Effective cap.</th><th class="num">Bikes (broken)</th><th>Docks</th><th>Repeat-offender report<div class="small muted" style="font-weight:400">unplanned repairs so far</div></th></tr></thead>
        <tbody>${rows.map(({ r, s, d, reps }) => `<tr>
            <td><span class="hazard">${r.misleading ? `<span class="warn-icon" data-tip="${esc(FLAG_LABEL[r.misleading])}" aria-label="${esc(FLAG_LABEL[r.misleading])}">⚠</span>` : ""}</span><b>${esc(r.id)}</b> ${esc(s.name)}<div class="small muted indent">${esc(s.district)}${r.status !== "active" ? ` · ${STATUS_LABEL[r.status]}` : ""}</div></td>
            <td class="num">${s.total_docks}</td><td class="num">${r.docks_disabled}</td><td class="num">${r.eff}</td>
            <td class="num">${r.bikes_available + r.bikes_disabled} (${r.bikes_disabled})</td>
            <td><div class="docks">${d.grid.map((g, i) => `<span class="dock ${g}" data-tip="Dock ${i + 1}: ${DOCK_STATES[g][0]}" aria-label="Dock ${i + 1}: ${DOCK_STATES[g][0]}">${DOCK_STATES[g][1]}</span>`).join("")}</div>
              ${d.mismatch ? `<div class="small" style="color:#8a5200">Feed reports ${d.feed_broken} broken, dock log shows ${d.fault_log_broken}${r.feed_age_min > S.data.meta.stale_min ? " (feed is stale)" : ""}</div>` : ""}</td>
            <td class="repeat"><div class="row" style="gap:8px;flex-wrap:nowrap"><b class="num" style="min-width:18px">${reps}</b><div class="loadbar" style="flex:1;min-width:60px"><div style="width:${(100 * reps) / maxRep}%;background:${reps >= thr ? "var(--full)" : "var(--line-2)"}"></div></div>${reps >= thr ? `<span class="badge purple">repeat</span>` : ""}</div></td></tr>`).join("")}</tbody></table></div>
      <p class="howto" style="margin:0 14px 12px">Effective capacity = total docks − broken docks. ⚠ = broken docks or bikes make the station look fuller or emptier than it is (hover for which). Repeat offenders have at least ${fmt(thr, 0)} unplanned repair tickets (dock faults, offline or broken kiosks, silent feeds) since the data began: 3 or more, and at least twice the network median of ${fmt(thr / 2, 1)}. Dock order is schematic: broken docks come from the dock fault log, bikes fill the working docks.</p>
    </div></div>`;
}

// ------------------------------------------------- Dispatch (with Forecast)
const HORIZONS = [30, 60, 90, 120];
const hLabel = (m) => (m === 0 ? "Now" : m < 60 ? `≤ ${m} min` : `≤ ${m / 60} h`);
function saveLocal() { store.set("local", S.local); }
function localKey(id) { return `${S.datasetId}|${S.snap}|${id}`; }
function kmBetween(a, b) {
  const R = 6371, p1 = (a.lat * Math.PI) / 180, p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1, dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function manualTasks() { return (S.local.manual ||= {})[localKey("manual")] ||= []; }
// vans already given a not-yet-confirmed task in this browser
function busyVans(moves) {
  const busy = new Set();
  moves.forEach((m, k) => { const key = localKey(`move${k}`); if (S.local.assigned[key] && !S.local.done[key]) busy.add(S.local.assigned[key]); });
  manualTasks().forEach((t) => { if (!S.local.done[localKey(t.id)]) busy.add(t.van); });
  return busy;
}
// available vans for a pickup: idle (not on a job), not already given a task here,
// with room for the bikes; nearest to the pickup first
function vanChoices(pickupId, bikes, busy) {
  const p = stationInfo(pickupId);
  return snapData().vans.map((v) => ({ v, km: kmBetween(v, p), room: v.capacity - v.load,
    why: v.status !== "idle" ? `${v.status}${v.station !== "depot" ? ` at ${v.station}` : ""}` : busy.has(v.van) ? "already assigned" : v.capacity - v.load < bikes ? `only ${v.capacity - v.load} bikes of room` : "" }))
    .map((c) => ({ ...c, ok: !c.why })).sort((a, b) => b.ok - a.ok || a.km - b.km);
}
function vanSelect(attr, choices) {
  const ok = choices.filter((c) => c.ok);
  if (!ok.length) return `<span class="badge bad">No van available</span>`;
  return `<select ${attr} aria-label="Van">${ok.map((c, i) => `<option value="${c.v.van}" ${i === 0 ? "selected" : ""}>${esc(c.v.name)} · ${fmt(c.km, 1)} km away · room ${c.room}${i === 0 ? " (suggested)" : ""}</option>`).join("")}</select>`;
}

function pageDispatchAll(el) {
  const snap = snapData();
  const fc = snap.forecast;
  const actualAt = (i) => (i.urgency === 5 ? i.actual30 : i.minutes_to_hit ? i[`actual${i.minutes_to_hit}`] : null);
  const check = (i) => {
    const act = actualAt(i);
    if (!i.risk || !act) return "—";
    return act === i.risk ? `<span class="badge ok">✓ happened</span>` : `<span class="badge">✗ was ${esc(act)}</span>`;
  };
  const PRI = { high: ["High", "bad"], medium: ["Medium", "warn"], low: ["Low", ""], none: ["—", ""] };

  const orders = Object.fromEntries(S.data.orders.map((o) => [o.id, o]));
  const vans = snap.vans;
  const busy = busyVans(snap.moves);
  const moveCards = snap.moves.map((m, k) => {
    const key = localKey(`move${k}`);
    const assigned = S.local.assigned[key];
    return `<div class="move">
      <div class="row" style="justify-content:space-between"><b>${m.bikes} bikes</b><span class="small muted">${fmt(m.km, 1)} km</span></div>
      <div class="row small"><span class="badge">${markerSvg("full", 5)} Pick up</span>${esc(stName(m.from))}</div>
      <div class="row small"><span class="badge">${markerSvg("empty", 5)} Drop off</span>${esc(stName(m.to))}</div>
      <div class="small muted">${esc(m.reason)}</div>
      <div class="row">${assigned ? `<span class="badge ok">Assigned to ${esc(assigned)}</span><button data-unassign="${key}">Undo</button>` :
        `${vanSelect(`data-van="${key}"`, vanChoices(m.from, m.bikes, busy))}${vanChoices(m.from, m.bikes, busy).some((c) => c.ok) ? `<button class="primary" data-assign="${key}">Assign</button>` : ""}`}</div>
    </div>`;
  }).join("") || `<p class="muted">No moves needed: no station is projected far enough above or below half full.</p>`;

  // manual rebalancing form
  const active = snap.stations.filter((r) => r.status === "active");
  const D = (S.manualDraft ||= { from: "", to: "", bikes: 1 });
  if (!active.some((r) => r.id === D.from)) D.from = (active.find((r) => r.bikes_available > 0) || active[0] || {}).id || "";
  if (!active.some((r) => r.id === D.to) || D.to === D.from) D.to = (active.find((r) => r.docks_available > 0 && r.id !== D.from) || {}).id || "";
  const fromRow = rowFor(D.from), toRow = rowFor(D.to);
  const maxBikes = Math.max(0, Math.min(fromRow ? fromRow.bikes_available : 0, toRow ? toRow.docks_available : 0));
  const formChoices = D.from ? vanChoices(D.from, D.bikes, busy) : [];
  const problems = [];
  if (D.from && D.from === D.to) problems.push("pick-up and drop-off must be different stations");
  if (fromRow && D.bikes > fromRow.bikes_available) problems.push(`${D.from} has only ${fromRow.bikes_available} rentable bikes`);
  if (toRow && D.bikes > toRow.docks_available) problems.push(`${D.to} has only ${toRow.docks_available} open docks`);
  if (!(D.bikes >= 1)) problems.push("move at least 1 bike");
  if (!formChoices.some((c) => c.ok)) problems.push("no van is free with enough room");
  const stOpt = (sel, fn) => active.map((r) => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${esc(stName(r.id))} · ${fn(r)}</option>`).join("");
  const form = `<div class="card"><div class="card-h"><h2>Create a rebalancing task</h2><span class="small muted">vans offered: idle, not already assigned, with room for the bikes; nearest first</span></div>
    <div class="card-b manual-form">
      <label>Pick-up station<select id="mf-from">${stOpt(D.from, (r) => `${r.bikes_available} bikes`)}</select></label>
      <label>Drop-off station<select id="mf-to">${stOpt(D.to, (r) => `${r.docks_available} open docks`)}</select></label>
      <label>Bikes<input type="number" id="mf-bikes" min="1" max="${Math.max(1, maxBikes)}" value="${D.bikes}"></label>
      <label>Van${vanSelect('id="mf-van"', formChoices)}</label>
      <button class="primary" id="mf-create" ${problems.length ? "disabled" : ""}>Create task</button>
      ${problems.length ? `<p class="small" style="color:#a51d16;grid-column:1/-1;margin:0">Can't create yet: ${esc(problems.join("; "))}.</p>` : `<p class="small muted" style="grid-column:1/-1;margin:0">Up to ${maxBikes} bikes fit (rentable bikes at the pick-up and open docks at the drop-off).</p>`}
    </div></div>`;

  const repairTasks = snap.tasks.repair.map((id) => orders[id]);
  const rebalTasks = snap.tasks.rebalance.map((id) => orders[id]);
  const assignedMoves = snap.moves.map((m, k) => ({ m, key: localKey(`move${k}`) })).filter((x) => S.local.assigned[x.key]);
  const doneBtn = (key) => (S.local.done[key] ? `<span class="badge ok">Completed (confirmed)</span> <button data-undone="${key}">Undo</button>` : `<button data-done="${key}">Confirm complete</button>`);
  const taskCard = (o) => {
    const key = localKey(o.id);
    const status = o.arrived <= snap.time ? "on site" : o.assigned <= snap.time ? "en route" : "open";
    return `<div class="task ${S.local.done[key] ? "done" : ""}"><div class="row" style="justify-content:space-between"><b>${esc(o.id)} · ${esc(stName(o.station))}</b><span class="badge">${status}</span></div>
      <div class="small muted">${esc(o.fault.replace(/_/g, " "))} · opened ${esc(o.opened.slice(11))} · ${esc(o.van)}${o.bikes_moved ? ` · ${o.bikes_moved} bikes` : ""} · open ${dur(minsBetween(o.opened, snap.time))}</div>
      <div>${doneBtn(key)}</div></div>`;
  };
  const localCard = (title, sub, key, van) => `<div class="task ${S.local.done[key] ? "done" : ""}"><div class="row" style="justify-content:space-between"><b>${title}</b><span class="badge">${esc(van)}</span></div>
      <div class="small muted">${sub}</div><div>${doneBtn(key)}</div></div>`;
  const rebalCount = rebalTasks.length + assignedMoves.length + manualTasks().length;
  const queue = S.queueTab === "repair"
    ? repairTasks.map(taskCard).join("") || `<p class="muted">No open repair tasks.</p>`
    : (rebalTasks.map(taskCard).join("")
      + assignedMoves.map(({ m, key }) => localCard(`Move ${m.bikes} bikes ${esc(m.from)} → ${esc(m.to)}`, `recommended move · ${fmt(m.km, 1)} km`, key, S.local.assigned[key])).join("")
      + manualTasks().map((t) => localCard(`Move ${t.bikes} bikes ${esc(t.from)} → ${esc(t.to)}`, `manual task · ${fmt(t.km, 1)} km`, localKey(t.id), t.van)).join(""))
      || `<p class="muted">No open rebalancing tasks.</p>`;
  const vanCards = vans.map((v) => {
    const mine = [...assignedMoves.filter((x) => S.local.assigned[x.key] === v.van && !S.local.done[x.key]).map(() => "new move"),
      ...manualTasks().filter((t) => t.van === v.van && !S.local.done[localKey(t.id)]).map((t) => t.id)];
    const free = v.status === "idle" && !busy.has(v.van);
    return `<div class="task"><div class="row" style="justify-content:space-between"><b>${esc(v.name)}</b><span class="badge ${free ? "ok" : "warn"}">${free ? "available" : busy.has(v.van) && v.status === "idle" ? "assigned" : esc(v.status)}</span></div>
      <div class="small muted">${v.station === "depot" ? "At depot" : `At / heading to ${esc(stName(v.station))}`}</div>
      <div class="small">Load ${v.load} / ${v.capacity} bikes</div><div class="loadbar" aria-hidden="true"><div style="width:${(100 * v.load) / v.capacity}%"></div></div>
      <div class="small muted">Queue: ${[...v.queue, ...mine].join(", ") || "empty"}</div></div>`;
  }).join("");
  const res = snap.resolution;
  const nFree = vans.filter((v) => v.status === "idle" && !busy.has(v.van)).length;

  el.innerHTML = `<div class="stack">
    <div class="card">
      <div class="card-h"><h2>Forecast & at-risk stations<span class="subhead">Ranked by priority, then expected impact</span></h2>
        <div class="legend"><span class="item"><span class="swatch risk-high"></span>High priority (now or ≤ 30 min)</span><span class="item"><span class="swatch risk"></span>At risk within 2 h</span></div></div>
      <div class="table-wrap"><table class="forecast"><thead><tr><th class="num">Rank</th><th>Station</th><th>Priority</th><th>Risk</th><th>When</th><th class="num">Bikes now / eff.</th>${HORIZONS.map((m) => `<th class="num">+${m < 60 ? `${m} min` : `${m / 60} h`}</th>`).join("")}<th class="num">Impact (bikes)</th><th>Check</th></tr></thead>
      <tbody>${fc.map((i) => `<tr class="${i.priority === "high" ? "risk-high" : i.urgency > 0 ? "risk" : ""}"><td class="num">${i.rank}</td><td>${esc(stName(i.id))}<div class="small muted">${esc(stationInfo(i.id).district)}</div></td>
        <td><span class="badge ${PRI[i.priority][1]}">${PRI[i.priority][0]}</span></td><td>${riskBadge(i)}</td><td>${timeUntil(i)}</td><td class="num">${i.bikes} / ${i.eff}</td>
        ${HORIZONS.map((m) => `<td class="num ${i[`risk${m}`] ? "hit" : ""}">${fmt(i[`p${m}`], 1)}</td>`).join("")}<td class="num">${fmt(i.impact_bikes, 1)}</td><td>${check(i)}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="card-b">
        <div class="formula">projected bikes(+m) = bikes now + [avg fill at this weekday & time +m − avg fill now] × effective capacity, for m = 30 min, 1 h, 1.5 h, 2 h</div>
        <p class="howto">Averages come from the same weekday and time (±10 min) in earlier weeks only. A station is at risk when a projection comes within 10% of capacity (at least 1 bike) of empty or full; bold red projections are the ones that trigger it. Rank = priority (sooner first), then impact: how many bikes the average flow moves by then.</p>
      </div>
    </div>
    <div class="grid cols-4">
      <div class="card kpi kpi-blue"><div class="v">${snap.moves.length}</div><div class="l">recommended moves</div></div>
      <div class="card kpi kpi-blue"><div class="v">${repairTasks.length + openRebalanceTasks()}</div><div class="l">open tasks (${repairTasks.length} repair · ${openRebalanceTasks()} rebalancing)</div></div>
      <div class="card kpi kpi-blue"><div class="v">${nFree} / ${vans.length}</div><div class="l">vans available now</div></div>
      <div class="card kpi kpi-blue"><div class="v">${res.rebalance.median_min === null ? "—" : dur(res.rebalance.median_min)}</div><div class="l">median time to resolve a rebalance call (${res.rebalance.n} done)</div></div>
    </div>
    ${form}
    <div class="grid dispatch">
      <div class="card"><div class="card-h"><h2>Recommended pickup → drop-off</h2></div><div class="card-b">${moveCards}
        <p class="howto">Stations projected above 80% full in an hour give bikes down to half full; stations projected below 20% get bikes up to half full, from the nearest donor first (at most 16 bikes a trip). Only available vans are offered, nearest to the pick-up first.</p></div></div>
      <div class="card"><div class="card-h"><h2>Task queue</h2></div>
        <div class="tabs" role="tablist"><button role="tab" aria-selected="${S.queueTab === "repair"}" data-qtab="repair">Repair (${repairTasks.length})</button><button role="tab" aria-selected="${S.queueTab === "rebalance"}" data-qtab="rebalance">Rebalancing (${rebalCount})</button></div>
        <div class="card-b list">${queue}</div></div>
      <div class="card"><div class="card-h"><h2>Van status</h2></div><div class="card-b list">${vanCards}
        <p class="howto">A van is available when it is idle and not already given a task here. Assignments, manual tasks and confirmations are saved in this browser only.</p></div></div>
    </div></div>`;

  el.querySelectorAll("[data-qtab]").forEach((b) => (b.onclick = () => { S.queueTab = b.dataset.qtab; render(); }));
  el.querySelectorAll("[data-assign]").forEach((b) => (b.onclick = () => { const k = b.dataset.assign; S.local.assigned[k] = el.querySelector(`[data-van="${k}"]`).value; saveLocal(); render(); }));
  el.querySelectorAll("[data-unassign]").forEach((b) => (b.onclick = () => { delete S.local.assigned[b.dataset.unassign]; saveLocal(); render(); }));
  el.querySelectorAll("[data-done]").forEach((b) => (b.onclick = () => { S.local.done[b.dataset.done] = true; saveLocal(); render(); }));
  el.querySelectorAll("[data-undone]").forEach((b) => (b.onclick = () => { delete S.local.done[b.dataset.undone]; saveLocal(); render(); }));
  $("#mf-from").onchange = (e) => { D.from = e.target.value; render(); };
  $("#mf-to").onchange = (e) => { D.to = e.target.value; render(); };
  $("#mf-bikes").onchange = (e) => { D.bikes = Math.max(1, parseInt(e.target.value || "1", 10)); render(); };
  $("#mf-create").onclick = () => {
    const van = $("#mf-van")?.value;
    if (!van || problems.length) return;
    const list = manualTasks();
    list.push({ id: `M${String(list.length + 1).padStart(2, "0")}`, from: D.from, to: D.to, bikes: D.bikes, van,
      km: kmBetween(stationInfo(D.from), stationInfo(D.to)) });
    saveLocal(); S.queueTab = "rebalance"; render();
  };
}

// ------------------------------------------------------------- SVG charts
function lineChart({ points, w = 960, h = 260, yLabel = "", xLabels = [], lines = [], stepLimits = null, phaseSplit = null, yMin = null, yMax = null, pointTip }) {
  const pad = { l: 48, r: 14, t: 12, b: 34 };
  const ys = points.map((p) => p.y).concat(lines.map((l) => l.y)).concat(stepLimits ? stepLimits.flatMap((s) => [s.ucl, s.lcl]).filter((v) => v !== null) : []);
  let y0 = yMin ?? Math.min(...ys), y1 = yMax ?? Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const span = y1 - y0; if (yMin === null) y0 -= span * .05; y1 += span * .05;
  const X = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const Y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - y0) / (y1 - y0));
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = y0 + (k * (y1 - y0)) / 4;
    g += `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(Math.abs(y1 - y0) < 2 ? 2 : 0)}</text>`;
  }
  xLabels.forEach(([i, lab]) => { g += `<line class="grid" x1="${X(i)}" x2="${X(i)}" y1="${pad.t}" y2="${h - pad.b}"/><text x="${X(i) + 3}" y="${h - pad.b + 14}">${lab}</text>`; });
  if (phaseSplit !== null) g += `<line x1="${X(phaseSplit - .5)}" x2="${X(phaseSplit - .5)}" y1="${pad.t}" y2="${h - pad.b}" stroke="#1d2125" stroke-dasharray="4 3"/>
    <text x="${X(phaseSplit - .5) - 6}" y="${pad.t + 10}" text-anchor="end" style="font-weight:600">Tuesday: sets limits</text><text x="${X(phaseSplit - .5) + 6}" y="${pad.t + 10}" style="font-weight:600">Thursday: monitored</text>`;
  if (stepLimits) {
    const path = (key) => stepLimits.map((s, i) => (s[key] === null ? "" : `${i === 0 || stepLimits[i - 1][key] === null ? "M" : "L"}${X(i - .5)} ${Y(s[key])}H${X(i + .5)}`)).join("");
    g += `<path d="${path("ucl")}" fill="none" stroke="var(--limit)" stroke-width="1.2" stroke-dasharray="5 3"/><path d="${path("lcl")}" fill="none" stroke="var(--limit)" stroke-width="1.2" stroke-dasharray="5 3"/>`;
  }
  lines.forEach((l) => { g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(l.y)}" y2="${Y(l.y)}" stroke="${l.color}" stroke-width="1.2" ${l.dash ? `stroke-dasharray="${l.dash}"` : ""}/><text x="${w - pad.r - 2}" y="${Y(l.y) - 4}" text-anchor="end" style="fill:${l.color};font-weight:600">${l.label}</text>`; });
  g += `<path d="${points.map((p, i) => `${i ? "L" : "M"}${X(i)} ${Y(p.y)}`).join("")}" fill="none" stroke="#5d6670" stroke-width="1.2"/>`;
  points.forEach((p, i) => {
    const t = esc(pointTip ? pointTip(p, i) : `${p.y}`);
    g += p.out
      ? `<path d="M${X(i)} ${Y(p.y) - 5}L${X(i) + 5} ${Y(p.y)}L${X(i)} ${Y(p.y) + 5}L${X(i) - 5} ${Y(p.y)}Z" fill="var(--limit)" stroke="#fff" stroke-width=".8" data-tip="${t}"><title>${t}</title></path>`
      : `<circle cx="${X(i)}" cy="${Y(p.y)}" r="${points.length > 300 ? 1.6 : 2.6}" fill="#2f3a45" data-tip="${t}"><title>${t}</title></circle>`;
  });
  g += `<text x="12" y="${pad.t + (h - pad.t - pad.b) / 2}" transform="rotate(-90 12 ${pad.t + (h - pad.t - pad.b) / 2})" text-anchor="middle">${esc(yLabel)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(yLabel)} control chart">${g}</svg>`;
}
const chartLegend = `<div class="legend"><span class="item"><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3" fill="#2f3a45"/></svg>In limits</span>
  <span class="item"><svg width="12" height="12" aria-hidden="true"><path d="M6 1L11 6L6 11L1 6Z" fill="#d1342c"/></svg>Outside limits</span>
  <span class="item"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke="#d1342c" stroke-dasharray="5 3" stroke-width="1.5"/></svg>UCL / LCL</span>
  <span class="item"><svg width="22" height="8" aria-hidden="true"><line x1="0" x2="22" y1="4" y2="4" stroke="#2f3a45" stroke-width="1.5"/></svg>Center line</span></div>`;

// ---------------------------------------------------------- Data Analysis
function pageAnalysis(el) {
  const tabs = [["fmea", "FMEA"], ["control", "Control Charts"]];
  el.innerHTML = `<div class="card"><div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.analysisTab === k}" data-atab="${k}">${l}</button>`).join("")}</div><div class="card-b" id="atab"></div></div>`;
  el.querySelectorAll("[data-atab]").forEach((b) => (b.onclick = () => { S.analysisTab = b.dataset.atab; render(); }));
  if (!["fmea", "control"].includes(S.analysisTab)) S.analysisTab = "fmea";
  ({ fmea: tabFmea, control: tabControl })[S.analysisTab]($("#atab"));
}

function fmeaRows() {
  const key = S.datasetId;
  const edits = S.fmeaEdits[key] || {};
  return S.data.fmea.rows.map((r) => {
    const e = edits[r.mode] || {};
    const row = { ...r, S: e.S ?? r.S, O: e.O ?? r.O, D: e.D ?? r.D };
    try { row.rpn = rpn(row.S, row.O, row.D); row.err = null; } catch (err) { row.rpn = null; row.err = err.message; }
    return row;
  });
}
function tabFmea(el) {
  const rows = fmeaRows();
  const valid = rows.filter((r) => r.rpn !== null);
  const par = valid.length ? pareto(valid.map((r) => ({ name: r.mode, value: r.rpn }))) : [];
  const w = 900, h = 300, pad = { l: 46, r: 46, t: 14, b: 54 };
  const maxV = Math.max(1, ...par.map((p) => p.value));
  const bw = (w - pad.l - pad.r) / Math.max(1, par.length);
  const Yb = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / maxV);
  const Yc = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / 100);
  let svg = `<line class="axis" x1="${pad.l}" x2="${w - pad.r}" y1="${h - pad.b}" y2="${h - pad.b}"/>`;
  for (let k = 0; k <= 4; k++) svg += `<text x="${pad.l - 6}" y="${Yb((k * maxV) / 4) + 4}" text-anchor="end">${Math.round((k * maxV) / 4)}</text><text x="${w - pad.r + 6}" y="${Yc(k * 25) + 4}">${k * 25}%</text><line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${Yb((k * maxV) / 4)}" y2="${Yb((k * maxV) / 4)}"/>`;
  svg += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Yc(80)}" y2="${Yc(80)}" stroke="#8a939c" stroke-dasharray="3 3"/><text x="${w - pad.r - 4}" y="${Yc(80) - 4}" text-anchor="end">80%</text>`;
  par.forEach((p, i) => {
    svg += `<rect x="${pad.l + i * bw + bw * .15}" y="${Yb(p.value)}" width="${bw * .7}" height="${h - pad.b - Yb(p.value)}" fill="${i === 0 ? "#d1342c" : "#5d6670"}" rx="2" data-tip="${esc(`${p.name}: RPN ${p.value} (${p.pct.toFixed(0)}%, cumulative ${p.cum_pct.toFixed(0)}%)`)}"/>
      <text x="${pad.l + i * bw + bw / 2}" y="${Yb(p.value) - 4}" text-anchor="middle" style="font-weight:600;fill:#1d2125">${p.value}</text>
      <text x="${pad.l + i * bw + bw / 2}" y="${h - pad.b + 16}" text-anchor="middle">${esc(p.name)}</text>`;
  });
  svg += `<path d="${par.map((p, i) => `${i ? "L" : "M"}${pad.l + i * bw + bw / 2} ${Yc(p.cum_pct)}`).join("")}" fill="none" stroke="#2c6fbf" stroke-width="1.8"/>`;
  par.forEach((p, i) => { svg += `<rect x="${pad.l + i * bw + bw / 2 - 3.5}" y="${Yc(p.cum_pct) - 3.5}" width="7" height="7" fill="#2c6fbf"/>`; });
  svg += `<text x="12" y="${h / 2}" transform="rotate(-90 12 ${h / 2})" text-anchor="middle">RPN</text><text x="${w - 8}" y="${h / 2}" transform="rotate(90 ${w - 8} ${h / 2})" text-anchor="middle">cumulative %</text>`;
  el.innerHTML = `<div class="stack">
    <div><h2>Failure modes and effects · RPN = Severity × Occurrence × Detection</h2>
      <p class="howto">Severity and Detection are the team's 1-10 judgments (10 = worst; for Detection, 10 = hardest to notice). Occurrence starts from the data: the share of opportunities where the failure happened, mapped to 1-10 with the scale below. Edit any score and the RPN and Pareto chart update.</p></div>
    <div class="table-wrap" style="max-height:none"><table><thead><tr><th>Failure mode</th><th>Effect</th><th>Evidence in the data</th><th class="num">Rate</th><th>S</th><th>O</th><th>D</th><th class="num">RPN</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${esc(r.mode)}</b></td><td>${esc(r.effect)}</td><td class="small">${r.count.toLocaleString()} of ${r.opportunities.toLocaleString()} ${esc(r.evidence)}</td><td class="num">${(100 * r.rate).toFixed(2)}%</td>
        ${["S", "O", "D"].map((k) => `<td><input type="number" min="1" max="10" step="1" value="${r[k]}" data-fm="${esc(r.mode)}" data-k="${k}" aria-label="${k} for ${esc(r.mode)}"></td>`).join("")}
        <td class="num"><b>${r.rpn ?? `<span style="color:#a51d16">${esc(r.err)}</span>`}</b></td></tr>`).join("")}
    </tbody></table></div>
    <div class="row"><button id="fm-reset">Reset to data-based scores</button><span class="small muted">Occurrence scale: ${S.data.fmea.scale.map((s) => `≥${(100 * s.min_rate).toString()}% → ${s.score}`).join(", ")}, otherwise 1.</span></div>
    <div class="card"><div class="card-h"><h2>Pareto chart · fix the tallest bar first</h2><div class="legend"><span class="item"><svg width="12" height="12"><rect width="12" height="12" fill="#d1342c" rx="2"/></svg>Top priority</span><span class="item"><svg width="12" height="12"><rect width="12" height="12" fill="#5d6670" rx="2"/></svg>RPN</span><span class="item"><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" fill="#2c6fbf"/></svg>Cumulative %</span></div></div>
      <div class="card-b"><svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Pareto chart of RPN">${svg}</svg>
      <p class="howto">The silent feed scores high on Detection: a stale reading still looks healthy, so nobody is sent until a rider complains.</p></div></div>
  </div>`;
  el.querySelectorAll("[data-fm]").forEach((inp) => (inp.onchange = () => {
    const key = S.datasetId;
    S.fmeaEdits[key] ||= {};
    S.fmeaEdits[key][inp.dataset.fm] ||= {};
    S.fmeaEdits[key][inp.dataset.fm][inp.dataset.k] = Number(inp.value);
    render();
  }));
  $("#fm-reset").onclick = () => { delete S.fmeaEdits[S.datasetId]; render(); };
}

function tabControl(el) {
  const scopes = Object.keys(S.data.xbar);
  const xb = S.data.xbar[S.xbarScope] || S.data.xbar.network;
  const xLabels = xb.points.map((p, i) => [i, p.label.slice(0, 9)]).filter(([i, lab]) => lab.startsWith("Mon") && xb.points[i].label.endsWith("00:01-01:00"));
  const scopeLabel = (k) => (k === "network" ? "Whole network" : k.startsWith("district:") ? `District: ${k.slice(9)}` : `Station ${stName(k)}`);
  const nStations = S.xbarScope === "network" ? S.data.stations.length : S.xbarScope.startsWith("district:") ? S.data.stations.filter((s) => s.district === S.xbarScope.slice(9)).length : 1;
  const xbOut = xb.points.filter((p) => p.out);
  const pc = S.data.pchart[S.pWindow];
  const tueCount = pc.points.filter((p) => p.phase === "baseline").length;
  el.innerHTML = `<div class="stack">
    <div class="card"><div class="card-h"><h2>Averages (X-bar) chart by hourly block · % of docks open</h2>
      <label class="row small">Scope <select id="xb-scope">${scopes.map((k) => `<option value="${k}" ${k === S.xbarScope ? "selected" : ""}>${esc(scopeLabel(k))}</option>`).join("")}</select></label></div>
      <div class="card-b">
        ${xb.message ? `<p class="badge warn">${esc(xb.message)}</p>` : ""}
        ${lineChart({ points: xb.points.map((p) => ({ ...p, y: p.mean, out: p.out })), stepLimits: xb.points, xLabels, yLabel: "% docks open",
          lines: [{ y: xb.grand_mean, color: "var(--mean)", label: `grand mean ${fmt(xb.grand_mean, 1)}%` }],
          pointTip: (p) => `${p.label}: mean ${fmt(p.mean, 1)}% open (n = ${p.n})\nUCL ${fmt(p.ucl, 1)} · LCL ${fmt(p.lcl, 1)}${p.out ? "\nOUTSIDE LIMITS" : ""}` })}
        ${chartLegend}
        <div class="grid cols-3 chart-notes">
          <div class="formula">UCL, LCL = X̿ ± 3 · σ_short / √n<br>X̿ = ${fmt(xb.grand_mean, 2)}%<br>σ_short = √(mean of subgroup variances) = ${fmt(xb.sigma_short, 2)}<br>n = ${xb.n_limits} (most common subgroup size, used for every limit)<br>UCL = ${fmt(xb.points[0].ucl, 2)}, LCL = ${fmt(xb.points[0].lcl, 2)}</div>
          <div class="small"><b>${xbOut.length} of ${xb.points.length}</b> blocks outside the limits.</div>
          <p class="howto" style="margin:0">Subgroup = one hourly block (00:01-01:00, 01:01-02:00, ... 23:01-24:00; 24 a day): % open docks at every 5-minute poll in the hour (${nStations} station${nStations === 1 ? "" : "s"} × 12 polls).</p>
        </div>
      </div></div>
    <div class="card"><div class="card-h"><h2>p-chart · proportion of stations unusable at each poll</h2>
      <label class="row small">Window <select id="p-window"><option value="off_peak" ${S.pWindow === "off_peak" ? "selected" : ""}>Fixed window 10:00-15:00</option><option value="all_day" ${S.pWindow === "all_day" ? "selected" : ""}>All day</option></select></label></div>
      <div class="card-b">
        ${pc.message ? `<p class="badge warn">${esc(pc.message)}</p>` : ""}
        ${lineChart({ points: pc.points.map((p) => ({ ...p, y: p.p, out: p.out })), phaseSplit: tueCount, yLabel: "proportion unusable", yMin: 0,
          lines: [{ y: pc.pbar, color: "var(--mean)", label: `p̄ ${fmt(pc.pbar, 3)}` }, { y: pc.points[0].ucl, color: "var(--limit)", label: `UCL ${fmt(pc.points[0].ucl, 3)}`, dash: "5 3" }],
          pointTip: (p) => `${p.t}: ${fmt(p.p * pc.n, 0)} of ${pc.n} unusable (p = ${fmt(p.p, 2)})${p.out ? "\nOUTSIDE LIMITS" : ""}` })}
        ${chartLegend}
        <div class="grid cols-3 chart-notes">
          <div class="formula">UCL, LCL = p̄ ± 3 √(p̄(1 − p̄)/n)<br>p̄ = ${fmt(pc.pbar, 4)} (Tuesdays), n = ${pc.n_limits} (most common n, every poll)<br>UCL = ${fmt(pc.points[0].ucl, 4)}, LCL = ${fmt(pc.points[0].lcl, 4)}</div>
          <div class="small">Tuesday polls outside: ${pc.out_baseline}. <b>Thursday polls outside: ${pc.out_monitor}</b>.</div>
          <p class="howto" style="margin:0">Subgroup = one 5-minute poll of all ${pc.n} stations (unusable = out of service, 0 bikes or 0 open docks).</p>
        </div>
      </div></div>
  </div>`;
  $("#xb-scope").onchange = (e) => { S.xbarScope = e.target.value; render(); };
  $("#p-window").onchange = (e) => { S.pWindow = e.target.value; render(); };
}

// -------------------------------------------------------------- loading
async function loadDataset(id) {
  S.loading = true; S.error = null; render();
  try {
    const res = await fetch(`data/${id}.json`);
    if (!res.ok) throw new Error(`data/${id}.json answered HTTP ${res.status}`);
    S.data = await res.json();
    S.datasetId = id; store.set("dataset", id);
    S.mapView = null;
    if (!S.data.meta.snapshots.includes(S.snap)) S.snap = S.data.meta.snapshots[0];
    if (S.selected && !S.data.stations.some((s) => s.station_id === S.selected)) S.selected = null;
  } catch (err) {
    S.error = `${err.message}. If you opened index.html from disk, run python3 app/testme.py and use the address it prints.`;
    S.data = null;
  }
  S.loading = false;
  render();
}

function route() {
  const id = location.hash.slice(1) || "overview";
  const page = PAGES.find((p) => p.id === (PAGE_ALIASES[id] || id)) || PAGES[0];  // PAGES[0] = Overview
  S.page = page.id;
  render();
  $("#page").focus({ preventScroll: true });
}

async function init() {
  $("#collapse").onclick = () => { $("#shell").classList.toggle("collapsed"); store.set("collapsed", $("#shell").classList.contains("collapsed")); };
  if (store.get("collapsed", false)) $("#shell").classList.add("collapsed");
  $("#dataset").onchange = (e) => loadDataset(e.target.value);
  $("#snapshot").onchange = (e) => { S.snap = e.target.value; store.set("snapshot", S.snap); render(); };
  window.addEventListener("hashchange", route);
  route();
  try {
    const res = await fetch("data/index.json");
    if (!res.ok) throw new Error(`data/index.json answered HTTP ${res.status}`);
    S.index = await res.json();
  } catch (err) {
    S.error = `${err.message}. Build the data with python3 app/build.py.`; S.loading = false; render(); return;
  }
  if (!S.index.some((d) => d.id === S.datasetId)) S.datasetId = S.index[0].id;
  await loadDataset(S.datasetId);
}
init();
