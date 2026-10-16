// Dock Watch: a static dashboard over the JSON written by app/build.py.
// Every statistic shown here was computed in app/qc.py. This file only
// filters, sorts and draws, except the editable FMEA and reliability panels,
// which recalculate with calc.js (a tested mirror of qc.py).
import { rpn, series, parallel, availability, pareto } from "./calc.js";

// ------------------------------------------------------------------ constants
const PAGES = [
  { id: "map", title: "Live Map", icon: "M10 2a6 6 0 0 0-6 6c0 4.5 6 10 6 10s6-5.5 6-10a6 6 0 0 0-6-6zm0 8.2A2.2 2.2 0 1 1 10 5.8a2.2 2.2 0 0 1 0 4.4z" },
  { id: "stockouts", title: "Stockouts & Heatmap", icon: "M3 3h4v4H3zM8 3h4v4H8zM13 3h4v4h-4zM3 8h4v4H3zM8 8h4v4H8zM13 8h4v4h-4zM3 13h4v4H3zM8 13h4v4H8zM13 13h4v4h-4z" },
  { id: "docks", title: "Dock Health", icon: "M3 4h3v12H3zM8.5 4h3v12h-3zM14 4h3v12h-3z" },
  { id: "forecast", title: "Forecast & At-Risk", icon: "M2 15l5-5 3 3 6-7M12 6h4v4" , stroke: true },
  { id: "dispatch", title: "Dispatch", icon: "M1 6h11v8H1zM12 9h4l3 3v2h-7zM5 16.5a1.5 1.5 0 1 0 0-.01M15 16.5a1.5 1.5 0 1 0 0-.01" },
  { id: "maintenance", title: "Maintenance", icon: "M13.5 2.5a4 4 0 0 0-4.9 5.2L2.5 13.8l3.7 3.7 6.1-6.1a4 4 0 0 0 5.2-4.9l-2.4 2.4-2.5-.6-.6-2.5z" },
  { id: "analysis", title: "Data Analysis", icon: "M3 17V9h3v8zM8.5 17V4h3v13zM14 17v-6h3v6z", analystOnly: true },
];
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
  role: store.get("role", "analyst"), page: "map", selected: null, loading: true, error: null,
  filters: { districts: null, status: "all", updated: "any", minOpen: 0, problemOnly: false },
  heatMetric: "empty", eventKind: "all", eventSort: "start", eventPage: 0,
  analysisTab: "fmea", queueTab: "repair", xbarScope: "district:Northside", pWindow: "off_peak",
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
  const pages = PAGES.filter((p) => !(p.analystOnly && S.role === "dispatcher"));
  $("#nav").innerHTML = pages.map((p) => `<a href="#${p.id}" ${p.id === S.page ? 'aria-current="page"' : ""} title="${p.title}">
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="${p.icon}" ${p.stroke ? 'fill="none" stroke="currentColor" stroke-width="1.8"' : 'fill="currentColor"'} /></svg><span>${p.title}</span></a>`).join("");
}

function renderTop() {
  const page = PAGES.find((p) => p.id === S.page);
  $("#page-title").textContent = page.title;
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
    ({ map: pageMap, stockouts: pageStockouts, docks: pageDocks, forecast: pageForecast, dispatch: pageDispatch,
      maintenance: pageMaintenance, analysis: pageAnalysis })[S.page](el);
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
      S.eventPage = 0;
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

// ------------------------------------------------------------------ Live Map
function pageMap(el) {
  const rows = snapData().stations;
  const keep = new Set(filteredIds());
  const stations = S.data.stations;
  const districts = {};
  stations.forEach((s) => { (districts[s.district] ||= []).push(s); });
  const regions = Object.entries(districts).map(([d, ss]) => {
    const xs = ss.map((s) => s.x), ys = ss.map((s) => s.y);
    const x0 = Math.min(...xs) - 6, x1 = Math.max(...xs) + 6, y0 = Math.min(...ys) - 6, y1 = Math.max(...ys) + 6;
    return `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="4" fill="#eef0f3" stroke="#dfe3e8" stroke-width=".3"/>
      <text x="${x0 + 1.5}" y="${y0 + 3.4}" font-size="2.6" fill="#8a939c" font-weight="600">${d.toUpperCase()}</text>`;
  }).join("");
  const marks = rows.map((r) => {
    const s = stationInfo(r.id);
    const dim = keep.has(r.id) ? 1 : .12;
    const prob = isProblem(r) ? `<circle r="3.3" fill="none" stroke="#1d2125" stroke-width=".25" stroke-dasharray=".8 .6"/>` : "";
    const warn = r.misleading ? `<text x="2.6" y="-2.2" font-size="2.6" fill="#8a5200" font-weight="700">!</text>` : "";
    const oos = r.category === "out_of_service";
    const tipText = `${r.id} ${s.name} (${s.district})\n${CAT_LABEL[r.category]}${r.fill_pct !== null && !oos ? ` · ${fmt(r.fill_pct)}% full` : ""}\n${r.bikes_available} bikes · ${r.docks_available} open docks · ${r.docks_disabled} broken docks${r.status !== "active" ? `\nStatus: ${STATUS_LABEL[r.status]}` : ""}`;
    return `<g class="station ${S.selected === r.id ? "sel" : ""}" transform="translate(${s.x} ${s.y})" opacity="${dim}" data-id="${r.id}" data-tip="${esc(tipText)}" tabindex="0" role="button" aria-label="${esc(tipText.replace(/\n/g, ", "))}">
      ${prob}<g class="mk" fill="${oos ? "none" : CAT_COLOR[r.category]}" stroke="${oos ? CAT_COLOR.out_of_service : "#fff"}" stroke-width="${oos ? 0 : .35}">${oos ? `<g stroke="${CAT_COLOR.out_of_service}">${shapePath("out_of_service", 2)}</g>` : shapePath(r.category, 2)}</g>
      ${warn}<text y="5.2" text-anchor="middle" font-size="2.1" fill="#5d6670">${r.id}</text></g>`;
  }).join("");
  const vans = snapData().vans.map((v) => `<g transform="translate(${v.x + (v.station === "depot" ? 0 : 3.2)} ${v.y - (v.station === "depot" ? 0 : 3.2)})" data-tip="${esc(`${v.name}: ${v.status}${v.station !== "depot" ? ` at ${v.station}` : " at depot"} · load ${v.load}/${v.capacity}`)}">
      <rect x="-2.4" y="-1.3" width="4.8" height="2.6" rx=".6" fill="#fff" stroke="#3a3f45" stroke-width=".3"/><text y=".75" text-anchor="middle" font-size="1.7" fill="#3a3f45" font-weight="700">${v.van}</text></g>`).join("");
  el.innerHTML = `<div class="map-layout">
    ${filtersHtml()}
    <div class="card map-card">
      <div class="card-h"><div>${fillLegend(`<span class="item"><b style="color:#8a5200">!</b> Misleading fill</span><span class="item"><svg width="22" height="14" viewBox="-2.6 -1.5 5.2 3" aria-hidden="true"><rect x="-2.4" y="-1.3" width="4.8" height="2.6" rx=".6" fill="#fff" stroke="#3a3f45" stroke-width=".3"/></svg>Van</span>`)}</div></div>
      <svg class="map-svg" viewBox="${mapBox()}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Schematic map of stations">
        ${regions}${vans}${marks}
      </svg>
      <p class="howto" style="margin:0 14px 12px">Fill % = bikes in docks ÷ effective capacity (total docks − broken docks). Faded stations are hidden by the filters. Hover or click a station for its counts. Schematic map: not to scale.</p>
    </div>
    <div class="card side" id="side">${sidePanel()}</div>
  </div>`;
  bindFilters(el);
  $("#filter-count").textContent = `${keep.size} of ${rows.length} stations shown`;
  el.querySelectorAll(".station").forEach((g) => {
    const pick = () => { S.selected = g.dataset.id; render(); };
    g.addEventListener("click", pick);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  });
  const close = $("#close-side");
  if (close) close.onclick = () => { S.selected = null; render(); };
}
function mapBox() {
  const xs = S.data.stations.map((s) => s.x), ys = S.data.stations.map((s) => s.y);
  const x0 = Math.min(...xs) - 9, y0 = Math.min(...ys) - 9;
  return `${x0} ${y0} ${Math.max(...xs) - x0 + 9} ${Math.max(...ys) - y0 + 9}`;
}
function sidePanel() {
  if (!S.selected) return `<div class="card-b"><h2>Station details</h2><p class="muted" style="margin-top:8px">Click a station on the map to see its fill, bikes, effective capacity and broken docks.</p></div>`;
  const r = rowFor(S.selected), s = stationInfo(S.selected);
  const oos = r.category === "out_of_service";
  const bikes = r.bikes_available + r.bikes_disabled;
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
      <dt>Fill (bikes ÷ effective)</dt><dd>${bikes} ÷ ${r.eff}</dd>
      <dt>Last reported</dt><dd>${esc(r.last_reported.slice(11))} (${fmt(r.feed_age_min)} min ago)</dd>
      <dt>Repair tickets so far</dt><dd>${tickets}</dd>
    </dl>
    ${r.misleading ? `<div class="badge warn" style="white-space:normal">⚠ ${FLAG_LABEL[r.misleading]}</div>` : ""}
    ${r.problems.length ? `<div class="small"><b>Problems:</b> ${r.problems.map((p) => PROBLEM_LABEL[p]).join(", ")}</div>` : `<div class="small muted">No problems at this snapshot.</div>`}
    ${r.feed_age_min > S.data.meta.stale_min ? `<p class="howto">Silent feed: these numbers are ${fmt(r.feed_age_min)} minutes old and may not be true now.</p>` : ""}
    <a href="#docks" class="small">See dock-level health →</a>
  </div>`;
}

// ------------------------------------------------------- Stockouts & Heatmap
const HEAT = {
  empty: { label: "% of polls empty (0 bikes)", num: "empty", den: "active_n" },
  full: { label: "% of polls full (0 open docks)", num: "full", den: "active_n" },
  unusable: { label: "% of polls unusable (empty, full or out of service)", num: "unusable", den: "n" },
  fill: { label: "Average fill %", num: "fill_sum", den: "active_n" },
};
function pageStockouts(el) {
  const ids = filteredIds();
  const m = HEAT[S.heatMetric];
  const cells = Array.from({ length: 168 }, (_, k) => {
    let num = 0, den = 0;
    ids.forEach((id) => { num += S.data.heatmap[id][m.num][k]; den += S.data.heatmap[id][m.den][k]; });
    return den ? (100 * num) / den : null;
  });
  const max = S.heatMetric === "fill" ? 100 : Math.max(5, ...cells.filter((v) => v !== null));
  const cw = 34, ch = 26, left = 40, top = 22;
  const shade = (v) => (v === null ? "#f3f4f6" : `rgba(209,52,44,${0.06 + 0.94 * (v / max)})`);
  const fillShade = (v) => (v === null ? "#f3f4f6" : `rgba(44,111,191,${0.06 + 0.94 * (v / 100)})`);
  let svg = "";
  for (let h = 0; h < 24; h++) svg += `<text x="${left + h * cw + cw / 2}" y="${top - 8}" text-anchor="middle">${h}</text>`;
  for (let d = 0; d < 7; d++) {
    svg += `<text x="${left - 8}" y="${top + d * ch + ch / 2 + 4}" text-anchor="end">${DOW[d]}</text>`;
    for (let h = 0; h < 24; h++) {
      const v = cells[d * 24 + h];
      const rush = d < 5 && ((h >= 7 && h < 9) || (h >= 16 && h < 18));
      svg += `<rect x="${left + h * cw + 1}" y="${top + d * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="${S.heatMetric === "fill" ? fillShade(v) : shade(v)}" ${rush ? 'stroke="#1d2125" stroke-width="1"' : ""}
        data-tip="${DOW[d]} ${String(h).padStart(2, "0")}:00-${String(h).padStart(2, "0")}:59\n${m.label}: ${v === null ? "no data" : v.toFixed(1) + "%"}\n${ids.length} stations"><title>${DOW[d]} ${h}:00 ${v === null ? "no data" : v.toFixed(1) + "%"}</title></rect>`;
      if (v !== null && v >= max * 0.45) svg += `<text x="${left + h * cw + cw / 2}" y="${top + d * ch + ch / 2 + 4}" text-anchor="middle" style="fill:#fff;font-size:9px;pointer-events:none">${Math.round(v)}</text>`;
    }
  }
  const scaleColor = S.heatMetric === "fill" ? "44,111,191" : "209,52,44";
  const now = snapData().time;
  const evs = S.data.events.filter((e) => ids.includes(e.station) && e.start <= now && (S.eventKind === "all" || e.kind === S.eventKind)).map((e) => {
    const end = addMin(e.start, e.duration_min);
    const ongoing = end > now || e.ongoing;
    return { ...e, ongoingNow: ongoing, shown: ongoing ? minsBetween(e.start, now) : e.duration_min };
  });
  evs.sort((a, b) => (S.eventSort === "duration" ? b.shown - a.shown : S.eventSort === "station" ? a.station.localeCompare(b.station) || b.start.localeCompare(a.start) : b.start.localeCompare(a.start)));
  const per = 50, pages = Math.max(1, Math.ceil(evs.length / per));
  S.eventPage = Math.min(S.eventPage, pages - 1);
  const pageRows = evs.slice(S.eventPage * per, S.eventPage * per + per);
  const nStock = evs.filter((e) => e.kind === "stockout").length, nFull = evs.filter((e) => e.kind === "fullout").length;
  const totalMin = evs.reduce((a, e) => a + e.shown, 0);
  el.innerHTML = `<div class="grid with-filters">
    ${filtersHtml()}
    <div class="stack">
      <div class="card">
        <div class="card-h"><h2>Rush-hour heatmap · hour × day of week</h2>
          <label class="row small">Metric <select id="heat-metric">${Object.entries(HEAT).map(([k, v]) => `<option value="${k}" ${k === S.heatMetric ? "selected" : ""}>${v.label}</option>`).join("")}</select></label></div>
        <div class="card-b">
          <svg class="heat" viewBox="0 0 ${left + 24 * cw + 4} ${top + 7 * ch + 4}" role="img" aria-label="Heatmap of ${m.label} by hour and weekday">${svg}</svg>
          <div class="legend" style="margin-top:8px"><span>0%</span><span style="display:inline-block;width:160px;height:10px;border-radius:5px;background:linear-gradient(90deg,rgba(${scaleColor},.06),rgba(${scaleColor},1))"></span><span>${fmt(max)}%</span>
            <span class="item"><span style="display:inline-block;width:14px;height:12px;border:1.5px solid #1d2125;border-radius:3px"></span>Weekday rush hour (7-9, 16-18)</span>
            <span class="item">Numbers show the darker cells</span></div>
          <p class="howto">Each cell pools every 5-minute poll in that hour over the 3 weeks of data for the ${ids.length} filtered stations. Dark weekday 7-9 AM and 4-6 PM cells are the predictable rush-hour pattern. Try one district at a time: Northside and Eastside empty in the morning, Downtown fills.</p>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h2>Stockout and fullout log</h2>
          <div class="row small">
            <label>Type <select id="ev-kind"><option value="all">All</option><option value="stockout" ${S.eventKind === "stockout" ? "selected" : ""}>Stockouts (0 bikes)</option><option value="fullout" ${S.eventKind === "fullout" ? "selected" : ""}>Fullouts (0 docks)</option></select></label>
            <label>Sort <select id="ev-sort"><option value="start">Newest first</option><option value="duration" ${S.eventSort === "duration" ? "selected" : ""}>Longest first</option><option value="station" ${S.eventSort === "station" ? "selected" : ""}>Station</option></select></label>
          </div></div>
        <div class="card-b row small"><span class="badge">${markerSvg("empty", 5)} ${nStock} stockouts</span><span class="badge">${markerSvg("full", 5)} ${nFull} fullouts</span><span class="badge">${dur(totalMin)} unusable in total</span><span class="muted">up to ${esc(shortTime(now))}</span></div>
        <div class="table-wrap"><table><thead><tr><th>Station</th><th>District</th><th>Type</th><th>Start</th><th class="num">Duration</th></tr></thead><tbody>
          ${pageRows.map((e) => `<tr><td>${esc(stName(e.station))}</td><td>${esc(stationInfo(e.station).district)}</td><td>${e.kind === "stockout" ? catBadge("empty").replace(CAT_LABEL.empty, "Stockout") : catBadge("full").replace(CAT_LABEL.full, "Fullout")}</td>
            <td class="mono">${esc(shortTime(e.start))}</td><td class="num">${dur(e.shown)}${e.ongoingNow ? ' <span class="badge warn">ongoing</span>' : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No events for these filters.</td></tr>`}
        </tbody></table></div>
        <div class="card-b row" style="justify-content:space-between"><span class="small muted">${evs.length} events · page ${S.eventPage + 1} of ${pages}</span>
          <span class="row"><button id="ev-prev" ${S.eventPage === 0 ? "disabled" : ""}>Previous</button><button id="ev-next" ${S.eventPage >= pages - 1 ? "disabled" : ""}>Next</button></span></div>
        <p class="howto" style="margin:0 14px 12px">An episode starts at the first poll a station reports 0 rentable bikes (stockout) or 0 open docks (fullout) and ends at the first poll it does not. Durations are in 5-minute steps; "ongoing" means it had not ended by the snapshot time.</p>
      </div>
    </div></div>`;
  bindFilters(el);
  $("#filter-count").textContent = `${ids.length} of ${snapData().stations.length} stations included`;
  $("#heat-metric").onchange = (e) => { S.heatMetric = e.target.value; render(); };
  $("#ev-kind").onchange = (e) => { S.eventKind = e.target.value; S.eventPage = 0; render(); };
  $("#ev-sort").onchange = (e) => { S.eventSort = e.target.value; S.eventPage = 0; render(); };
  $("#ev-prev").onclick = () => { S.eventPage--; render(); };
  $("#ev-next").onclick = () => { S.eventPage++; render(); };
}

// --------------------------------------------------------------- Dock Health
function pageDocks(el) {
  const snap = snapData();
  const rows = snap.stations.map((r) => ({ r, s: stationInfo(r.id), d: snap.docks[r.id] }));
  rows.sort((a, b) => (!!b.r.misleading - !!a.r.misleading) || (b.r.docks_disabled - a.r.docks_disabled) || a.r.id.localeCompare(b.r.id));
  const brokenDocks = rows.reduce((a, x) => a + x.r.docks_disabled, 0);
  const brokenBikes = rows.reduce((a, x) => a + x.r.bikes_disabled, 0);
  const total = rows.reduce((a, x) => a + x.s.total_docks, 0);
  const flagged = rows.filter((x) => x.r.misleading).length;
  const dockLegend = `<div class="legend">${Object.entries(DOCK_STATES).map(([k, [lab, sym]]) => `<span class="item"><span class="dock ${k}" aria-hidden="true">${sym}</span>${lab}</span>`).join("")}</div>`;
  el.innerHTML = `<div class="stack">
    <div class="grid cols-4">
      <div class="card kpi"><div class="v">${brokenDocks}</div><div class="l">broken docks (of ${total})</div></div>
      <div class="card kpi"><div class="v">${brokenBikes}</div><div class="l">broken bikes sitting in docks</div></div>
      <div class="card kpi"><div class="v">${total - brokenDocks}</div><div class="l">effective network capacity (docks)</div></div>
      <div class="card kpi"><div class="v">${flagged}</div><div class="l">stations with misleading fill</div></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Per-dock status at ${esc(shortTime(snap.time))}</h2>${dockLegend}</div>
      <div class="table-wrap" style="max-height:none"><table>
        <thead><tr><th>Station</th><th class="num">Total</th><th class="num">Broken docks</th><th class="num">Effective cap.</th><th class="num">Bikes (broken)</th><th class="num">Fill: total docks</th><th class="num">Fill: effective</th><th>Docks</th><th>Flag</th></tr></thead>
        <tbody>${rows.map(({ r, s, d }) => {
          const bikes = r.bikes_available + r.bikes_disabled;
          const naive = s.total_docks ? (100 * bikes) / s.total_docks : null;
          return `<tr><td><b>${esc(r.id)}</b> ${esc(s.name)}<div class="small muted">${esc(s.district)}${r.status !== "active" ? ` · ${STATUS_LABEL[r.status]}` : ""}</div></td>
            <td class="num">${s.total_docks}</td><td class="num">${r.docks_disabled}</td><td class="num">${r.eff}</td>
            <td class="num">${bikes} (${r.bikes_disabled})</td><td class="num">${fmt(naive)}%</td><td class="num"><b>${fmt(r.fill_pct)}%</b></td>
            <td><div class="docks">${d.grid.map((g, i) => `<span class="dock ${g}" data-tip="Dock ${i + 1}: ${DOCK_STATES[g][0]}" aria-label="Dock ${i + 1}: ${DOCK_STATES[g][0]}">${DOCK_STATES[g][1]}</span>`).join("")}</div>
              ${d.mismatch ? `<div class="small" style="color:#8a5200">Feed reports ${d.feed_broken} broken, dock log shows ${d.fault_log_broken}${r.feed_age_min > S.data.meta.stale_min ? " (feed is stale)" : ""}</div>` : ""}</td>
            <td>${r.misleading ? `<span class="badge warn" data-tip="${esc(FLAG_LABEL[r.misleading])}">⚠ ${esc(FLAG_LABEL[r.misleading])}</span>` : `<span class="muted small">—</span>`}</td></tr>`;
        }).join("")}</tbody></table></div>
      <p class="howto" style="margin:0 14px 12px">Effective capacity = total docks − broken docks. "Fill: total docks" is what a naive count shows; "Fill: effective" is the truth. A flag means broken docks or bikes make the station look fuller or emptier than it really is. Dock order is schematic: broken docks come from the dock fault log, bikes fill the working docks.</p>
    </div></div>`;
}

// ------------------------------------------------------------- Forecast
function pageForecast(el) {
  const fc = snapData().forecast;
  const risky = fc.filter((i) => i.urgency > 0);
  const when = (i) => (i.urgency === 3 ? "Now" : i.urgency === 2 ? "≤ 30 min" : "30-60 min");
  const check = (i) => {
    const pred = i.risk30 || i.risk_now ? (i.risk30 || i.risk_now) : i.risk60;
    const act = i.urgency >= 2 ? i.actual30 : i.actual60;
    if (!act) return "—";
    const hit = act === pred;
    return `<span class="badge ${hit ? "ok" : ""}">${hit ? "✓ happened" : `✗ was ${act}`}</span>`;
  };
  const scored = risky.filter((i) => (i.urgency >= 2 ? i.actual30 : i.actual60));
  const hits = scored.filter((i) => (i.urgency >= 2 ? i.actual30 : i.actual60) === (i.risk_now || i.risk30 || i.risk60)).length;
  el.innerHTML = `<div class="stack">
    <div class="grid cols-4">
      <div class="card kpi"><div class="v">${risky.filter((i) => i.urgency === 3).length}</div><div class="l">empty or full now</div></div>
      <div class="card kpi"><div class="v">${risky.filter((i) => i.urgency === 2).length}</div><div class="l">projected to hit within 30 min</div></div>
      <div class="card kpi"><div class="v">${risky.filter((i) => i.urgency === 1).length}</div><div class="l">projected to hit in 30-60 min</div></div>
      <div class="card kpi"><div class="v">${scored.length ? `${hits}/${scored.length}` : "—"}</div><div class="l">flags that came true (checked against the replay)</div></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>At-risk stations · ranked by urgency, then expected impact</h2>${fillLegend()}</div>
      <div class="table-wrap" style="max-height:none"><table><thead><tr><th class="num">Rank</th><th>Station</th><th>Risk</th><th>When</th><th class="num">Bikes now / eff.</th><th class="num">Projected +30</th><th class="num">Projected +60</th><th class="num">Impact (bikes/h)</th><th>Check</th></tr></thead>
      <tbody>${risky.map((i) => `<tr><td class="num">${i.rank}</td><td>${esc(stName(i.id))}<div class="small muted">${esc(stationInfo(i.id).district)}</div></td>
        <td>${catBadge(i.risk === "empty" ? "empty" : "full")}</td><td>${when(i)}</td><td class="num">${i.bikes} / ${i.eff}</td>
        <td class="num">${fmt(i.p30, 1)}</td><td class="num">${fmt(i.p60, 1)}</td><td class="num">${fmt(i.impact_bikes, 1)}</td><td>${check(i)}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">No station is projected to hit empty or full in the next hour.</td></tr>`}
      </tbody></table></div>
      <div class="card-b">
        <div class="formula">projected bikes(+m) = bikes now + [avg fill at this weekday & time +m − avg fill now] × effective capacity</div>
        <p class="howto">Simple approach: the averages come from the same weekday and time of day (±10 min) in the earlier weeks only, so the forecast never peeks ahead. A station is at risk when the projection comes within 10% of capacity (at least 1) of 0 bikes (empty) or of 0 open docks (full). Impact is how many bikes the average flow moves at that station over the next hour. "Check" compares each flag with what actually happened in the replay.</p>
      </div>
    </div></div>`;
}

// --------------------------------------------------------------- Dispatch
function saveLocal() { store.set("local", S.local); }
function localKey(id) { return `${S.datasetId}|${S.snap}|${id}`; }
function pageDispatch(el) {
  const snap = snapData();
  const orders = Object.fromEntries(S.data.orders.map((o) => [o.id, o]));
  const vans = snap.vans;
  const moveCards = snap.moves.map((m, k) => {
    const key = localKey(`move${k}`);
    const assigned = S.local.assigned[key];
    return `<div class="move">
      <div class="row" style="justify-content:space-between"><b>${m.bikes} bikes</b><span class="small muted">${fmt(m.km, 1)} km</span></div>
      <div class="row small"><span class="badge">${markerSvg("full", 5)} Pick up</span>${esc(stName(m.from))}</div>
      <div class="row small"><span class="badge">${markerSvg("empty", 5)} Drop off</span>${esc(stName(m.to))}</div>
      <div class="small muted">${esc(m.reason)}</div>
      <div class="row">${assigned ? `<span class="badge ok">Assigned to ${esc(assigned)}</span><button data-unassign="${key}">Undo</button>` :
        `<select data-van="${key}" aria-label="Van">${vans.map((v) => `<option value="${v.van}">${v.name} (${v.status})</option>`).join("")}</select><button class="primary" data-assign="${key}">Assign</button>`}</div>
    </div>`;
  }).join("") || `<p class="muted">No moves needed: no station is projected far enough above or below half full.</p>`;
  const repairTasks = snap.tasks.repair.map((id) => orders[id]);
  const rebalTasks = snap.tasks.rebalance.map((id) => orders[id]);
  const assignedMoves = snap.moves.map((m, k) => ({ m, key: localKey(`move${k}`) })).filter((x) => S.local.assigned[x.key]);
  const taskCard = (o) => {
    const key = localKey(o.id);
    const done = S.local.done[key];
    const status = o.arrived <= snap.time ? "on site" : o.assigned <= snap.time ? "en route" : "open";
    return `<div class="task ${done ? "done" : ""}"><div class="row" style="justify-content:space-between"><b>${esc(o.id)} · ${esc(stName(o.station))}</b><span class="badge">${status}</span></div>
      <div class="small muted">${esc(o.fault.replace(/_/g, " "))} · opened ${esc(o.opened.slice(11))} · ${esc(o.van)}${o.bikes_moved ? ` · ${o.bikes_moved} bikes` : ""} · open ${dur(minsBetween(o.opened, snap.time))}</div>
      <div>${done ? `<span class="badge ok">Completed (confirmed)</span> <button data-undone="${key}">Undo</button>` : `<button data-done="${key}">Confirm complete</button>`}</div></div>`;
  };
  const queue = S.queueTab === "repair"
    ? repairTasks.map(taskCard).join("") || `<p class="muted">No open repair tasks.</p>`
    : (rebalTasks.map(taskCard).join("") + assignedMoves.map(({ m, key }) => {
      const done = S.local.done[key];
      return `<div class="task ${done ? "done" : ""}"><div class="row" style="justify-content:space-between"><b>Move ${m.bikes} bikes ${esc(m.from)} → ${esc(m.to)}</b><span class="badge">${esc(S.local.assigned[key])}</span></div>
        <div class="small muted">from the recommendations · ${fmt(m.km, 1)} km</div>
        <div>${done ? `<span class="badge ok">Completed (confirmed)</span> <button data-undone="${key}">Undo</button>` : `<button data-done="${key}">Confirm complete</button>`}</div></div>`;
    }).join("")) || `<p class="muted">No open rebalancing tasks.</p>`;
  const vanCards = vans.map((v) => {
    const extra = assignedMoves.filter((x) => S.local.assigned[x.key] === v.van && !S.local.done[x.key]);
    return `<div class="task"><div class="row" style="justify-content:space-between"><b>${esc(v.name)}</b><span class="badge ${v.status === "idle" ? "" : "ok"}">${esc(v.status)}</span></div>
      <div class="small muted">${v.station === "depot" ? "At depot" : `At / heading to ${esc(stName(v.station))}`}</div>
      <div class="small">Load ${v.load} / ${v.capacity} bikes</div><div class="loadbar" aria-hidden="true"><div style="width:${(100 * v.load) / v.capacity}%"></div></div>
      <div class="small muted">Queue: ${[...v.queue, ...extra.map((x) => "new move")].join(", ") || "empty"}</div></div>`;
  }).join("");
  const res = snap.resolution;
  el.innerHTML = `<div class="stack">
    <div class="grid cols-4">
      <div class="card kpi"><div class="v">${snap.moves.length}</div><div class="l">recommended moves</div></div>
      <div class="card kpi"><div class="v">${repairTasks.length + rebalTasks.length}</div><div class="l">open tasks (${repairTasks.length} repair · ${rebalTasks.length} rebalancing)</div></div>
      <div class="card kpi"><div class="v">${res.rebalance.median_min === null ? "—" : dur(res.rebalance.median_min)}</div><div class="l">median time to resolve a rebalance (${res.rebalance.n} done)</div></div>
      <div class="card kpi"><div class="v">${res.repair.median_min === null ? "—" : dur(res.repair.median_min)}</div><div class="l">median time to resolve a repair (${res.repair.n} done)</div></div>
    </div>
    <div class="grid dispatch">
      <div class="card"><div class="card-h"><h2>Recommended pickup → drop-off</h2></div><div class="card-b">${moveCards}
        <p class="howto">Stations projected above 80% full in an hour give bikes down to half full; stations projected below 20% get bikes up to half full, from the nearest donor first (at most 16 bikes a trip).</p></div></div>
      <div class="card"><div class="card-h"><h2>Task queue</h2></div>
        <div class="tabs" role="tablist"><button role="tab" aria-selected="${S.queueTab === "repair"}" data-qtab="repair">Repair (${repairTasks.length})</button><button role="tab" aria-selected="${S.queueTab === "rebalance"}" data-qtab="rebalance">Rebalancing (${rebalTasks.length + assignedMoves.length})</button></div>
        <div class="card-b list">${queue}</div></div>
      <div class="card"><div class="card-h"><h2>Van status</h2></div><div class="card-b list">${vanCards}
        <p class="howto">Assignments and confirmations are saved in this browser only.</p></div></div>
    </div></div>`;
  el.querySelectorAll("[data-qtab]").forEach((b) => (b.onclick = () => { S.queueTab = b.dataset.qtab; render(); }));
  el.querySelectorAll("[data-assign]").forEach((b) => (b.onclick = () => { const k = b.dataset.assign; S.local.assigned[k] = el.querySelector(`[data-van="${k}"]`).value; saveLocal(); render(); }));
  el.querySelectorAll("[data-unassign]").forEach((b) => (b.onclick = () => { delete S.local.assigned[b.dataset.unassign]; saveLocal(); render(); }));
  el.querySelectorAll("[data-done]").forEach((b) => (b.onclick = () => { S.local.done[b.dataset.done] = true; saveLocal(); render(); }));
  el.querySelectorAll("[data-undone]").forEach((b) => (b.onclick = () => { delete S.local.done[b.dataset.undone]; saveLocal(); render(); }));
}

// ------------------------------------------------------------ Maintenance
function pageMaintenance(el) {
  const snap = snapData();
  const now = snap.time;
  const m = snap.maintenance;
  const station = S.ticketStation || "all";
  const tickets = S.data.orders.filter((o) => o.type === "repair" && o.opened <= now && (station === "all" || o.station === station))
    .map((o) => ({ ...o, status: o.resolved <= now ? "resolved" : o.assigned <= now ? (o.arrived <= now ? "in progress" : "assigned") : "opened" }))
    .sort((a, b) => b.opened.localeCompare(a.opened));
  const maxRep = Math.max(1, ...m.repeat_offenders.map((r) => r.repairs));
  el.innerHTML = `<div class="stack">
    <div class="grid cols-4">
      <div class="card kpi"><div class="v">${m.mttr_min === null ? "—" : dur(m.mttr_min)}</div><div class="l">mean time to repair (opened → resolved, ${m.mttr_n} unplanned repairs)</div></div>
      <div class="card kpi"><div class="v">${m.backlog}</div><div class="l">backlog: repair tickets open now</div></div>
      <div class="card kpi"><div class="v">${m.backlog_unassigned}</div><div class="l">open and not yet assigned</div></div>
      <div class="card kpi"><div class="v">${m.repeat_offenders.length}</div><div class="l">repeat offenders (3+ unplanned repairs)</div></div>
    </div>
    <div class="grid two-one">
      <div class="card"><div class="card-h"><h2>Fault tickets</h2>
        <label class="row small">Station history <select id="tk-station"><option value="all">All stations</option>${S.data.stations.map((s) => `<option value="${s.station_id}" ${station === s.station_id ? "selected" : ""}>${s.station_id} ${esc(s.name)}</option>`).join("")}</select></label></div>
        <div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Station</th><th>Fault</th><th>Opened</th><th>Assigned</th><th>Resolved</th><th>Status</th><th class="num">Time to repair</th></tr></thead><tbody>
          ${tickets.map((o) => `<tr><td class="mono">${o.id}</td><td>${esc(stName(o.station))}</td><td>${esc(o.fault.replace(/_/g, " "))}</td><td class="mono">${shortTime(o.opened)}</td><td class="mono">${o.assigned <= now ? shortTime(o.assigned) : "—"}</td>
            <td class="mono">${o.status === "resolved" ? shortTime(o.resolved) : "—"}</td><td><span class="badge ${o.status === "resolved" ? "ok" : "warn"}">${o.status}</span> <span class="small muted">${esc(o.van)}</span></td><td class="num">${o.status === "resolved" ? dur(o.restore_min) : `${dur(minsBetween(o.opened, now))} so far`}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">No tickets.</td></tr>`}
        </tbody></table></div>
        <p class="howto" style="margin:0 14px 12px">Tickets opened up to the snapshot time. Time to repair = resolved − opened (response plus time on site). Planned maintenance is listed but not counted as a failure.</p></div>
      <div class="card"><div class="card-h"><h2>Repeat-offender report</h2></div><div class="card-b">
        ${m.repeat_offenders.length ? `<table><thead><tr><th>Station</th><th class="num">Repairs</th><th></th></tr></thead><tbody>${m.repeat_offenders.map((r) => `<tr><td><a href="#maintenance" data-st="${r.station}">${esc(stName(r.station))}</a></td><td class="num">${r.repairs}</td>
          <td style="width:40%"><div class="loadbar"><div style="width:${(100 * r.repairs) / maxRep}%"></div></div></td></tr>`).join("")}</tbody></table>` : `<p class="muted">No station has 3 or more unplanned repairs yet.</p>`}
        <p class="howto">Unplanned repair tickets (dock faults, offline or broken kiosks, silent feeds) opened since the start of the data. Click a station for its history.</p></div></div>
    </div></div>`;
  $("#tk-station").onchange = (e) => { S.ticketStation = e.target.value; render(); };
  el.querySelectorAll("[data-st]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); S.ticketStation = a.dataset.st; render(); }));
}

// ------------------------------------------------------------- SVG charts
function lineChart({ points, w = 960, h = 260, yLabel = "", xLabels = [], lines = [], stepLimits = null, phaseSplit = null, yMin = null, yMax = null, pointTip }) {
  const pad = { l: 48, r: 14, t: 12, b: 34 };
  const ys = points.map((p) => p.y).concat(lines.map((l) => l.y)).concat(stepLimits ? stepLimits.flatMap((s) => [s.ucl, s.lcl]).filter((v) => v !== null) : []);
  let y0 = yMin ?? Math.min(...ys), y1 = yMax ?? Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const span = y1 - y0; y0 -= span * .05; y1 += span * .05;
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
  if (S.role === "dispatcher") { el.innerHTML = `<div class="card state">The Data Analysis page is for analysts. Switch "View as" to Analyst.</div>`; return; }
  const tabs = [["fmea", "FMEA"], ["control", "Control Charts"], ["reliability", "Reliability"]];
  el.innerHTML = `<div class="card"><div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.analysisTab === k}" data-atab="${k}">${l}</button>`).join("")}</div><div class="card-b" id="atab"></div></div>`;
  el.querySelectorAll("[data-atab]").forEach((b) => (b.onclick = () => { S.analysisTab = b.dataset.atab; render(); }));
  ({ fmea: tabFmea, control: tabControl, reliability: tabReliability })[S.analysisTab]($("#atab"));
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
  const xLabels = DOW.map((d, i) => [i * 24, d]);
  const scopeLabel = (k) => (k === "network" ? "Whole network" : k.startsWith("district:") ? `District: ${k.slice(9)}` : `Station ${stName(k)}`);
  const ns = [...new Set(xb.points.map((p) => p.n))];
  const xbOut = xb.points.filter((p) => p.out);
  const im = S.data.imr;
  const pc = S.data.pchart[S.pWindow];
  const tueCount = pc.points.filter((p) => p.phase === "baseline").length;
  el.innerHTML = `<div class="stack">
    <div class="card"><div class="card-h"><h2>Hourly averages (X-bar) chart · % of docks open</h2>
      <label class="row small">Scope <select id="xb-scope">${scopes.map((k) => `<option value="${k}" ${k === S.xbarScope ? "selected" : ""}>${esc(scopeLabel(k))}</option>`).join("")}</select></label></div>
      <div class="card-b">
        ${xb.message ? `<p class="badge warn">${esc(xb.message)}</p>` : ""}
        ${lineChart({ points: xb.points.map((p) => ({ ...p, y: p.mean, out: p.out })), stepLimits: xb.points, xLabels, yLabel: "% docks open",
          lines: [{ y: xb.grand_mean, color: "var(--mean)", label: `grand mean ${fmt(xb.grand_mean, 1)}%` }],
          pointTip: (p) => `${p.label}: mean ${fmt(p.mean, 1)}% open (n = ${p.n})\nUCL ${fmt(p.ucl, 1)} · LCL ${fmt(p.lcl, 1)}${p.out ? "\nOUTSIDE LIMITS" : ""}` })}
        ${chartLegend}
        <div class="grid cols-3" style="margin-top:10px">
          <div class="formula">UCL, LCL = X̿ ± 3 · σ_short / √n<br>X̿ = ${fmt(xb.grand_mean, 2)}%<br>σ_short = √(mean of subgroup variances) = ${fmt(xb.sigma_short, 2)}<br>n per subgroup = ${ns.length === 1 ? ns[0] : `${Math.min(...ns)}-${Math.max(...ns)}`}</div>
          <div class="small"><b>${xbOut.length} of ${xb.points.length}</b> hours outside the limits${xbOut.length ? `, e.g. ${xbOut.slice(0, 6).map((p) => p.label).join(", ")}` : ""}.</div>
          <p class="howto" style="margin:0">Subgroup = one hour of the week (Mon 08:00, Mon 09:00, ...). Each observation is one station's average % of open docks during that hour in one week (3 weeks × stations in scope). Fill follows a known daily pattern, so the rush hours signal by design: the points outside the limits are the predictable pattern (every Monday morning), not a one-off fault.</p>
        </div>
      </div></div>
    <div class="card"><div class="card-h"><h2>I-MR chart · van response time (response_min from work_orders.csv)</h2></div>
      <div class="card-b">
        ${im.message ? `<p class="badge warn">${esc(im.message)}</p>` : ""}
        ${lineChart({ points: im.points.map((p) => ({ ...p, y: p.x, out: p.out })), phaseSplit: im.n_baseline, yLabel: "response (min)", yMin: Math.min(0, im.lcl),
          lines: [{ y: im.center, color: "var(--mean)", label: `x̄ ${fmt(im.center, 1)}` }, { y: im.ucl, color: "var(--limit)", label: `UCL ${fmt(im.ucl, 1)}`, dash: "5 3" }, { y: im.lcl, color: "var(--limit)", label: `LCL ${fmt(im.lcl, 1)}`, dash: "5 3" }],
          pointTip: (p) => `${p.id} (${p.type}) opened ${p.opened}\nresponse ${p.x} min${p.out ? "\nOUTSIDE LIMITS" : ""}` })}
        ${lineChart({ points: im.points.slice(1).map((p) => ({ ...p, y: p.mr, out: p.mr_out })), h: 170, phaseSplit: im.n_baseline - 1, yLabel: "moving range", yMin: 0,
          lines: [{ y: im.mrbar, color: "var(--mean)", label: `MR̄ ${fmt(im.mrbar, 1)}` }, { y: im.mr_ucl, color: "var(--limit)", label: `UCL ${fmt(im.mr_ucl, 1)}`, dash: "5 3" }],
          pointTip: (p) => `${p.id}: moving range ${p.mr} min${p.mr_out ? "\nOUTSIDE LIMITS" : ""}` })}
        ${chartLegend}
        <div class="grid cols-3" style="margin-top:10px">
          <div class="formula">σ = MR̄ / d₂ = ${fmt(im.mrbar, 2)} / 1.128 = ${fmt(im.sigma, 2)}<br>UCL, LCL = x̄ ± 3σ = ${fmt(im.ucl, 1)}, ${fmt(im.lcl, 1)}<br>MR UCL = 3.267 · MR̄ = ${fmt(im.mr_ucl, 1)}</div>
          <div class="small">Baseline: ${im.n_baseline} work orders opened on Tuesdays (${im.out_baseline} outside). Monitored: ${im.n_monitor} on Thursdays, <b>${im.out_monitor} outside</b> the Tuesday limits.${im.lcl < 0 ? " The LCL is below 0, so only slow responses can signal." : ""}</div>
          <p class="howto" style="margin:0">All work orders (repair and rebalance) in the order they were opened. Limits come from Tuesday only, then Thursday is plotted against them. Response times have no built-in daily pattern, so a point outside the limits is a real special cause (a van stuck in traffic, a missed ticket).</p>
        </div>
      </div></div>
    <div class="card"><div class="card-h"><h2>p-chart · proportion of stations unusable at each poll</h2>
      <label class="row small">Window <select id="p-window"><option value="off_peak" ${S.pWindow === "off_peak" ? "selected" : ""}>Fixed window 10:00-15:00</option><option value="all_day" ${S.pWindow === "all_day" ? "selected" : ""}>All day (signals at rush by design)</option></select></label></div>
      <div class="card-b">
        ${pc.message ? `<p class="badge warn">${esc(pc.message)}</p>` : ""}
        ${lineChart({ points: pc.points.map((p) => ({ ...p, y: p.p, out: p.out })), phaseSplit: tueCount, yLabel: "proportion unusable", yMin: 0,
          lines: [{ y: pc.pbar, color: "var(--mean)", label: `p̄ ${fmt(pc.pbar, 3)}` }, { y: pc.points[0].ucl, color: "var(--limit)", label: `UCL ${fmt(pc.points[0].ucl, 3)}`, dash: "5 3" }],
          pointTip: (p) => `${p.t}: ${fmt(p.p * pc.n, 0)} of ${pc.n} unusable (p = ${fmt(p.p, 2)})${p.out ? "\nOUTSIDE LIMITS" : ""}` })}
        ${chartLegend}
        <div class="grid cols-3" style="margin-top:10px">
          <div class="formula">UCL, LCL = p̄ ± 3 √(p̄(1 − p̄)/n)<br>p̄ = ${fmt(pc.pbar, 4)} (Tuesdays), n = ${pc.n} stations<br>UCL = ${fmt(pc.points[0].ucl, 4)}, LCL = ${fmt(pc.points[0].lcl, 4)}</div>
          <div class="small">Tuesday polls outside: ${pc.out_baseline}. <b>Thursday polls outside: ${pc.out_monitor}</b>. n·p̄ = ${fmt(pc.np_bar, 2)}${pc.np_bar < 5 ? " (below 5: the normal approximation is rough, read the limits as a guide)" : ""}.</div>
          <p class="howto" style="margin:0">Unusable = out of service, 0 rentable bikes, or 0 open docks. Over a whole day the rush hours push the proportion up by design, so the fixed 10:00-15:00 window is the fair test.</p>
        </div>
      </div></div>
  </div>`;
  $("#xb-scope").onchange = (e) => { S.xbarScope = e.target.value; render(); };
  $("#p-window").onchange = (e) => { S.pWindow = e.target.value; render(); };
}

function tabReliability(el) {
  const R = S.data.reliability;
  const ids = S.data.stations.map((s) => s.station_id);
  const opt = (sel) => ids.map((id) => `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(stName(id))}</option>`).join("");
  const st = S.rel ||= { origin: "S07", dest: "S02", window: "rush", p1: "S07", p2: R.stations.S07.nearest, avail: "network", sys: "S07" };
  const w = st.window === "rush" ? "rush" : "all";
  const ro = R.stations[st.origin][`R_bike_${w}`], rd = R.stations[st.dest][`R_dock_${w}`];
  const r1 = R.stations[st.p1][`R_bike_${w}`], r2 = R.stations[st.p2][`R_bike_${w}`];
  const A = st.avail === "network" ? R.network : R.stations[st.avail];
  const sys = R.stations[st.sys];
  const block = (label, v) => `<div style="border:1.5px solid #5d6670;border-radius:6px;padding:6px 10px;background:#fff;text-align:center;min-width:110px"><div class="small muted">${esc(label)}</div><b>${fmt(v, 3)}</b></div>`;
  const wire = `<div style="width:24px;height:2px;background:#5d6670"></div>`;
  const safe = (f) => { try { return fmt(f(), 4); } catch (e) { return `<span style="color:#a51d16">${esc(e.message)}</span>`; } };
  el.innerHTML = `<div class="stack">
    <div class="row"><label class="row small">Reliability from <select id="rl-window"><option value="rush" ${st.window === "rush" ? "selected" : ""}>Weekday morning rush (7-9 AM)</option><option value="all" ${st.window === "all" ? "selected" : ""}>All hours</option></select></label>
      <span class="small muted">R = share of polls where the station was in service and had a bike (origin) or an open dock (destination).</span></div>
    <div class="grid cols-2">
      <div class="card"><div class="card-h"><h2>Series system · one trip</h2></div><div class="card-b stack" style="gap:10px">
        <div class="row small"><label>Origin <select id="rl-origin">${opt(st.origin)}</select></label><label>Destination <select id="rl-dest">${opt(st.dest)}</select></label></div>
        <div class="blocks">${block("bike at origin", ro)}${wire}${block("dock at destination", rd)}</div>
        <div class="formula">R = R_origin × R_dest = ${fmt(ro, 4)} × ${fmt(rd, 4)}</div>
        <div class="result">R = ${safe(() => series(ro, rd))}</div>
        <p class="howto">A trip needs both, so the weaker station drags the trip down. Try a Northside origin and a Downtown destination at the morning rush.</p></div></div>
      <div class="card"><div class="card-h"><h2>Parallel system · a backup station</h2></div><div class="card-b stack" style="gap:10px">
        <div class="row small"><label>Station 1 <select id="rl-p1">${opt(st.p1)}</select></label><label>Station 2 <select id="rl-p2">${opt(st.p2)}</select></label></div>
        <div style="display:grid;gap:6px;border-left:2px solid #5d6670;border-right:2px solid #5d6670;padding:0 10px;width:max-content">${block("bike at station 1", r1)}${block("bike at station 2", r2)}</div>
        <div class="formula">R = 1 − (1 − R1)(1 − R2) = 1 − (${fmt(1 - r1, 4)})(${fmt(1 - r2, 4)})</div>
        <div class="result">R = ${safe(() => parallel(r1, r2))}</div>
        <p class="howto">A rider who can walk to either station gets a bike unless both are empty. Default station 2 is the nearest one (${fmt(R.stations[st.p1].nearest_km, 2)} km from station 1). Assumes the two stations empty independently; neighbours that empty together make the real gain smaller.</p></div></div>
      <div class="card"><div class="card-h"><h2>Availability · A = MTBF / (MTBF + MTTR)</h2></div><div class="card-b stack" style="gap:10px">
        <label class="row small">Scope <select id="rl-avail"><option value="network">Whole network (per station)</option>${opt(st.avail)}</select></label>
        <div class="calc-in small"><span>Unplanned failures</span><b>${A.failures}</b><span>MTBF (hours)</span><b>${fmt(A.mtbf_h, 1)}</b><span>MTTR (hours)</span><b>${fmt(A.mttr_h, 2)}</b></div>
        <div class="formula">A = ${fmt(A.mtbf_h, 1)} / (${fmt(A.mtbf_h, 1)} + ${fmt(A.mttr_h, 2)})</div>
        <div class="result">A = ${A.mtbf_h ? safe(() => availability(A.mtbf_h, A.mttr_h)) : "— (no failures)"}</div>
        <p class="howto">MTBF = station operating hours ÷ unplanned repair tickets. MTTR = mean of (resolved − opened) over the repair tasks in work_orders.csv. Planned maintenance is not a failure.</p></div></div>
      <div class="card"><div class="card-h"><h2>Station as a system · feed, kiosk and docks in series</h2></div><div class="card-b stack" style="gap:10px">
        <label class="row small">Station <select id="rl-sys">${opt(st.sys)}</select></label>
        <div class="blocks">${block("feed fresh", sys.R_feed)}${wire}${block("kiosk up", sys.R_kiosk)}${wire}${block("all docks work", sys.R_docks)}</div>
        <div class="formula">R = R_feed × R_kiosk × R_docks = ${fmt(sys.R_feed, 4)} × ${fmt(sys.R_kiosk, 4)} × ${fmt(sys.R_docks, 4)}</div>
        <div class="result">R = ${safe(() => series(sys.R_feed, sys.R_kiosk, sys.R_docks))} <span class="small muted">observed all three at once: ${fmt(sys.R_station_observed, 4)}</span></div>
        <p class="howto">Each R is the share of polls that part was working (all hours). The series model assumes the parts fail independently; the observed joint share checks that assumption: close numbers mean it holds.</p></div></div>
    </div></div>`;
  const bind = (id, key) => { $(id).onchange = (e) => { st[key] = e.target.value; render(); }; };
  bind("#rl-window", "window"); bind("#rl-origin", "origin"); bind("#rl-dest", "dest"); bind("#rl-p1", "p1"); bind("#rl-p2", "p2"); bind("#rl-avail", "avail"); bind("#rl-sys", "sys");
  $("#rl-avail").value = st.avail;
}

// -------------------------------------------------------------- loading
async function loadDataset(id) {
  S.loading = true; S.error = null; render();
  try {
    const res = await fetch(`data/${id}.json`);
    if (!res.ok) throw new Error(`data/${id}.json answered HTTP ${res.status}`);
    S.data = await res.json();
    S.datasetId = id; store.set("dataset", id);
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
  const id = location.hash.slice(1) || "map";
  const page = PAGES.find((p) => p.id === id) || PAGES[0];
  S.page = page.analystOnly && S.role === "dispatcher" ? "map" : page.id;
  render();
  $("#page").focus({ preventScroll: true });
}

async function init() {
  $("#role").value = S.role;
  $("#role").onchange = (e) => { S.role = e.target.value; store.set("role", S.role); route(); };
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
