// ===== CONFIG =====
const SHEET_ID = "1fx3FFlAPbF-_nbHEjUtEDrWW8LIwyygfYBZTwSVEVJw";
const GID = "58409945";
const SHIFT_BASELINE = 480;

const COLS = {
  section: "Section",
  shift: "Shift",
  employee: "Employee Name",
  enroll: "Employee Enroll",
  role: "Role",
  taskMin: "Actual Time/ Shift",
  phaseRemarks: "Phase Remarks"
};

// ✅ CHANGED: const → let (so we can update dynamically)
let SECTIONS = ["All"];
const SHIFTS = ["All", "A", "B", "C", "G"];

// ✅ Added colors for new sections
const SECTION_COLORS = {
  "Production SMS":     "bg-blue-100 text-blue-700",
  "Production Rolling": "bg-cyan-100 text-cyan-700",
  "Scrap Management":   "bg-orange-100 text-orange-700",
  "Distribution":       "bg-purple-100 text-purple-700",
  "Inventory":          "bg-green-100 text-green-700",
  "Quality":            "bg-pink-100 text-pink-700",
  "HR-Admin":           "bg-yellow-100 text-yellow-700",
  "Civil":              "bg-stone-100 text-stone-700",
  "Sustainability":     "bg-lime-100 text-lime-700"
};

// ✅ Color palette for any UNKNOWN future section (auto-assigned)
const FALLBACK_COLORS = [
  "bg-red-100 text-red-700",
  "bg-indigo-100 text-indigo-700",
  "bg-teal-100 text-teal-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-violet-100 text-violet-700",
  "bg-sky-100 text-sky-700"
];
let _fallbackIndex = 0;
function ensureSectionColor(name) {
  if (!SECTION_COLORS[name]) {
    SECTION_COLORS[name] = FALLBACK_COLORS[_fallbackIndex % FALLBACK_COLORS.length];
    _fallbackIndex++;
  }
}

const isAllPhase = v => norm(v).toLowerCase() === "all";

let RAW = [];
let state = {
  section: "All",
  shift: "All",
  phase: "",
  roleSort: "fte",
  roleSearch: "",
  empSearch: ""
};
let chartFTE, chartLoad;

function norm(v) {
  return (v === null || v === undefined) ? "" : String(v).trim();
}

function uniqueEnrolls(rows) {
  const set = new Set();
  rows.forEach(r => {
    const e = norm(r[COLS.enroll]);
    if (e) set.add(e);
  });
  return set.size;
}

function uniqueEnrollList(rows) {
  return [...new Set(rows.map(r => norm(r[COLS.enroll])).filter(Boolean))];
}

// ===== STATUS BANNER =====
function setStatus(msg, isError = false) {
  const el = document.getElementById("lastUpdated");
  if (!el) return;
  el.textContent = msg;
  el.className = "text-right text-xs " + (isError ? "text-red-600 font-semibold" : "text-slate-500");
}

// ===== FETCH =====
async function fetchData() {
  setStatus("⏳ Loading data from Google Sheets…");

  const gvizUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${GID}&t=${Date.now()}`;
  try {
    const res = await fetch(gvizUrl);
    const txt = await res.text();
    const startIdx = txt.indexOf("{");
    const endIdx   = txt.lastIndexOf("}");
    if (startIdx === -1 || endIdx === -1) {
      throw new Error("Sheet is NOT publicly shared. Fix: Share → Anyone with link → Viewer.");
    }
    const json = JSON.parse(txt.substring(startIdx, endIdx + 1));
    if (json.status === "error") {
      const msg = (json.errors && json.errors[0] && json.errors[0].detailed_message) || "Unknown sheet error";
      throw new Error("Google API error: " + msg);
    }
    if (!json.table || !json.table.cols) {
      throw new Error("Sheet returned no table. Check the GID is correct (current: " + GID + ").");
    }

    const headers = json.table.cols.map(c => norm(c.label) || norm(c.id));
    RAW = json.table.rows
      .map(r => {
        const obj = {};
        r.c.forEach((cell, i) => {
          obj[headers[i]] = cell ? (cell.v ?? cell.f ?? "") : "";
        });
        return obj;
      })
      .filter(r => norm(r[COLS.employee]) || norm(r[COLS.role]));

    if (RAW.length === 0) {
      const missing = Object.entries(COLS).filter(([k, v]) => !headers.includes(v)).map(([k, v]) => `"${v}"`);
      if (missing.length) {
        throw new Error("Missing columns: " + missing.join(", "));
      }
      throw new Error("Sheet loaded but 0 employee rows found.");
    }

    // ✅ ============================================================
    // ✅ AUTO-GENERATE SECTION LIST FROM GOOGLE SHEET (the main fix)
    // ✅ ============================================================
    const detectedSections = [...new Set(
      RAW.map(r => norm(r[COLS.section])).filter(Boolean)
    )].sort();

    SECTIONS = ["All", ...detectedSections];

    // Auto-assign color to any new section
    detectedSections.forEach(s => ensureSectionColor(s));

    // If current selected section no longer exists, reset to "All"
    if (state.section !== "All" && !detectedSections.includes(state.section)) {
      state.section = "All";
    }
    // ✅ ============================================================

    // Auto-pick first real phase
    const availablePhases = [...new Set(
      RAW.map(r => norm(r[COLS.phaseRemarks])).filter(v => v && !isAllPhase(v))
    )].sort();
    if (!state.phase || !availablePhases.includes(state.phase)) {
      state.phase = availablePhases[0] || "";
    }

    const totalUnique = uniqueEnrolls(RAW);
    setStatus("✅ Last updated: " + new Date().toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    }) + " · " + RAW.length + " task rows · " + totalUnique + " unique employees · " + detectedSections.length + " sections");

    buildFilters();
    render();
  } catch (e) {
    console.error("Fetch error:", e);
    setStatus("⚠️ " + e.message, true);
    buildFilters();
  }
}

// ===== FILTERS =====
function applyFilters() {
  return RAW.filter(r => {
    if (state.section !== "All" && norm(r[COLS.section]) !== state.section) return false;
    if (state.shift   !== "All" && norm(r[COLS.shift])   !== state.shift)   return false;
    if (state.phase && norm(r[COLS.phaseRemarks]) !== state.phase) return false;
    return true;
  });
}

function buildFilters() {
  // ----- SECTION (count = unique enrolls) -----
  const sec = document.getElementById("sectionFilters");
  if (sec) {
    sec.innerHTML = SECTIONS.map(s => {
      const subset = s === "All" ? RAW : RAW.filter(r => norm(r[COLS.section]) === s);
      const count = uniqueEnrolls(subset);
      return `<button data-sec="${s}" class="px-4 py-1 rounded-full text-sm border ${state.section===s?'bg-slate-800 text-white':'bg-white'}">${s} <span class="opacity-70">(${count})</span></button>`;
    }).join("");
    sec.querySelectorAll("button").forEach(b => b.onclick = () => {
      state.section = b.dataset.sec; buildFilters(); render();
    });
  }

  // ----- SHIFT (count = unique enrolls) -----
  const shf = document.getElementById("shiftFilters");
  if (shf) {
    shf.innerHTML = SHIFTS.map(s => {
      const subset = RAW.filter(r =>
        (state.section === "All" || norm(r[COLS.section]) === state.section) &&
        (s === "All" || norm(r[COLS.shift]) === s)
      );
      const count = uniqueEnrolls(subset);
      return `<button data-shf="${s}" class="px-4 py-1 rounded-full text-sm border ${state.shift===s?'bg-purple-600 text-white':'bg-white'}">${s} <span class="opacity-70">(${count})</span></button>`;
    }).join("");
    shf.querySelectorAll("button").forEach(b => b.onclick = () => {
      state.shift = b.dataset.shf; buildFilters(); render();
    });
  }

  // ----- PHASE REMARKS (count = unique enrolls) -----
  const ph = document.getElementById("phaseFilters");
  if (ph) {
    const phases = [...new Set(
      RAW.map(r => norm(r[COLS.phaseRemarks])).filter(v => v && !isAllPhase(v))
    )].sort();

    if (phases.length === 0) {
      ph.innerHTML = `<span class="text-xs text-slate-400 italic">No phase remarks found</span>`;
      return;
    }

    ph.innerHTML = phases.map(p => {
      const subset = RAW.filter(r =>
        (state.section === "All" || norm(r[COLS.section]) === state.section) &&
        (state.shift   === "All" || norm(r[COLS.shift])   === state.shift) &&
        norm(r[COLS.phaseRemarks]) === p
      );
      const count = uniqueEnrolls(subset);
      return `<button data-phase="${p}" class="px-4 py-1 rounded-full text-sm border ${state.phase===p?'bg-emerald-600 text-white':'bg-white'}">${p} <span class="opacity-70">(${count})</span></button>`;
    }).join("");
    ph.querySelectorAll("button").forEach(b => b.onclick = () => {
      state.phase = b.dataset.phase; buildFilters(); render();
    });
  }
}

// ===== UI HELPERS =====
function workloadColor(pct) {
  if (pct > 100) return "bg-red-500";
  if (pct >= 60) return "bg-amber-500";
  return "bg-green-500";
}
function loadBar(pct) {
  const cap = Math.min(pct, 220);
  return `<div class="flex items-center gap-2">
    <div class="flex-1 bg-slate-200 rounded h-1.5">
      <div class="${workloadColor(pct)} h-1.5 rounded" style="width:${(cap/220)*100}%"></div>
    </div>
    <span class="text-xs ${pct>100?'text-red-600':pct<60?'text-green-600':'text-amber-600'} font-mono">${Math.round(pct)}%</span>
  </div>`;
}

// ===== KPI CARDS =====
function renderKPIs(data) {
  const total = uniqueEnrolls(data);
  const roles = new Set(data.map(r => norm(r[COLS.role])).filter(Boolean)).size;
  const totalMin = data.reduce((s, r) => s + (Number(r[COLS.taskMin]) || 0), 0);
  const requiredFTE = totalMin / SHIFT_BASELINE;

  const roleMap = {};
  data.forEach(r => {
    const k = norm(r[COLS.section]) + "|" + norm(r[COLS.role]);
    if (!roleMap[k]) roleMap[k] = {
      section: norm(r[COLS.section]),
      role: norm(r[COLS.role]),
      enrolls: new Set(),
      min: 0,
      phases: new Set()
    };
    const enroll = norm(r[COLS.enroll]);
    if (enroll) roleMap[k].enrolls.add(enroll);
    roleMap[k].min += Number(r[COLS.taskMin]) || 0;
    const ph = norm(r[COLS.phaseRemarks]);
    if (ph && !isAllPhase(ph)) roleMap[k].phases.add(ph);
  });
  const roles_ = Object.values(roleMap).map(x => {
    const hc = x.enrolls.size;
    const fte = x.min / SHIFT_BASELINE;
    return {
      section: x.section,
      role: x.role,
      hc,
      fte,
      phases: [...x.phases],
      load: hc ? (fte / hc) * 100 : 0
    };
  });

  const overloaded = roles_.filter(r => r.load > 100).length;
  const under = roles_.filter(r => r.load < 60).length;

  const sectionAvg = sec => {
    const rs = roles_.filter(r => r.section === sec);
    if (!rs.length) return null;
    return rs.reduce((s, r) => s + r.load, 0) / rs.length;
  };
  const avgAll = roles_.length ? roles_.reduce((s, r) => s + r.load, 0) / roles_.length : 0;

  const card = (label, val, sub, color = "text-slate-800", badge = "") => `
    <div class="bg-white p-3 rounded-xl border shadow-sm">
      <p class="text-[10px] text-slate-500 uppercase tracking-wide">${label}</p>
      <p class="text-2xl font-bold ${color} my-1">${val}</p>
      <p class="text-[11px] text-slate-500">${sub}</p>
      ${badge}
    </div>`;
  const tag = (txt, cls) => `<span class="inline-block mt-1 px-2 py-0.5 rounded text-[10px] ${cls}">${txt}</span>`;
  const fmt = v => v === null ? "—" : v.toFixed(1) + "%";

  // ✅ Build KPI cards — fixed cards + dynamic per-section cards
  const fixedCards = [
    card("Total Employees", total, "Unique Employee Enroll"),
    card("Unique Roles", roles, "Distinct role names", "text-slate-800", tag("All shifts", "bg-blue-50 text-blue-700")),
    card("Required FTE", requiredFTE.toFixed(1), "480 min standard shift", "text-slate-800", tag(`${avgAll.toFixed(1)}% avg load`, "bg-amber-50 text-amber-700")),
    card("Overloaded Roles", overloaded, "Workload > 100%", "text-red-600", tag("Action needed", "bg-red-50 text-red-700")),
    card("Underutilised Roles", under, "Workload < 60%", "text-blue-600", tag("Review capacity", "bg-blue-50 text-blue-700"))
  ];

  // ✅ DYNAMIC: one card per detected section (auto includes HR-Admin, Civil, Sustainability + future)
  const dynamicSectionCards = SECTIONS
    .filter(s => s !== "All")
    .map(s => {
      const avg = sectionAvg(s);
      return card(`${s} Avg Load`, fmt(avg), `${s} section`, "text-slate-800",
        tag(avg === null ? "No data" : avg > 100 ? "Overloaded" : avg < 60 ? "Underutilised" : "Optimal",
            avg === null ? "bg-slate-50 text-slate-500" :
            avg > 100 ? "bg-red-50 text-red-700" :
            avg < 60 ? "bg-blue-50 text-blue-700" :
            "bg-amber-50 text-amber-700"));
    });

  document.getElementById("kpiCards").innerHTML = [...fixedCards, ...dynamicSectionCards].join("");

  return { roles_ };
}

// ===== CHARTS =====
function renderCharts(data) {
  const map = {};
  data.forEach(r => {
    const s = norm(r[COLS.section]); if (!s) return;
    if (!map[s]) map[s] = { enrolls: new Set(), min: 0 };
    const e = norm(r[COLS.enroll]);
    if (e) map[s].enrolls.add(e);
    map[s].min += Number(r[COLS.taskMin]) || 0;
  });
  const labels = Object.keys(map);
  const fte = labels.map(l => +(map[l].min / SHIFT_BASELINE).toFixed(1));
  const hc  = labels.map(l => map[l].enrolls.size);

  if (chartFTE) chartFTE.destroy();
  chartFTE = new Chart(document.getElementById("chartFTE"), {
    type: "bar",
    data: { labels, datasets: [
      { label: "Required FTE", data: fte, backgroundColor: "#1e3a8a" },
      { label: "Headcount",    data: hc,  backgroundColor: "#bfdbfe" }
    ]},
    options: { responsive: true, plugins: { legend: { position: "top" } } }
  });

  const loads = labels.map(l => {
    const rows = data.filter(r => norm(r[COLS.section]) === l);
    const roleMap = {};
    rows.forEach(r => {
      const k = norm(r[COLS.role]);
      if (!roleMap[k]) roleMap[k] = { enrolls: new Set(), min: 0 };
      const e = norm(r[COLS.enroll]);
      if (e) roleMap[k].enrolls.add(e);
      roleMap[k].min += Number(r[COLS.taskMin]) || 0;
    });
    const arr = Object.values(roleMap).map(x => {
      const hc = x.enrolls.size;
      return hc ? (x.min / SHIFT_BASELINE) / hc * 100 : 0;
    });
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  });

  if (chartLoad) chartLoad.destroy();
  chartLoad = new Chart(document.getElementById("chartLoad"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Avg Workload %", data: loads.map(x => +x.toFixed(1)), backgroundColor: "#d97706" }] },
    options: { indexAxis: "y", responsive: true, plugins: { legend: { display: false } } }
  });
}

// ===== ROLE TABLE & ALERTS =====
function renderRoleTable(roles_) {
  const q = state.roleSearch.toLowerCase();
  let rows = roles_.filter(r => !q ||
    r.role.toLowerCase().includes(q) ||
    r.section.toLowerCase().includes(q) ||
    r.phases.join(" ").toLowerCase().includes(q));

  rows.sort((a, b) => state.roleSort === "fte" ? b.fte - a.fte : b.load - a.load);

  document.getElementById("roleTable").innerHTML = rows.map(r => {
    const phaseTags = r.phases.length
      ? r.phases.map(p => `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 mr-1">${p}</span>`).join("")
      : `<span class="text-slate-400 text-xs">—</span>`;
    return `<tr class="border-t hover:bg-slate-50">
      <td class="p-2"><span class="px-2 py-0.5 rounded text-xs ${SECTION_COLORS[r.section] || 'bg-slate-100'}">${r.section}</span></td>
      <td class="p-2">${r.role}</td>
      <td class="p-2 text-center">${r.hc}</td>
      <td class="p-2 text-center font-mono">${r.fte.toFixed(2)}</td>
      <td class="p-2 w-48">${loadBar(r.load)}</td>
      <td class="p-2">${phaseTags}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="p-4 text-center text-slate-400">No roles match.</td></tr>`;

  const over = rows.filter(r => r.load > 100).sort((a, b) => b.load - a.load);
  const und  = rows.filter(r => r.load < 60).sort((a, b) => a.load - b.load);

  document.getElementById("alerts").innerHTML = [
    ...over.map(r => `<div class="flex justify-between items-center p-2 bg-red-50 rounded-lg">
        <div class="flex items-center gap-2"><span class="text-red-600">↑</span>
          <div><p class="text-sm font-medium">${r.role}</p>
          <p class="text-xs"><span class="px-1.5 py-0.5 rounded ${SECTION_COLORS[r.section]||''}">${r.section}</span> <span class="text-red-600">Overloaded</span>${r.phases.length ? ' · <span class="text-emerald-700">'+r.phases.join(", ")+'</span>' : ''}</p></div>
        </div>
        <span class="text-red-600 font-mono text-sm">${Math.round(r.load)}%</span></div>`),
    ...und.map(r => `<div class="flex justify-between items-center p-2 bg-cyan-50 rounded-lg">
        <div class="flex items-center gap-2"><span class="text-cyan-600">↓</span>
          <div><p class="text-sm font-medium">${r.role}</p>
          <p class="text-xs"><span class="px-1.5 py-0.5 rounded ${SECTION_COLORS[r.section]||''}">${r.section}</span> <span class="text-cyan-600">Underutilised</span>${r.phases.length ? ' · <span class="text-emerald-700">'+r.phases.join(", ")+'</span>' : ''}</p></div>
        </div>
        <span class="text-cyan-600 font-mono text-sm">${Math.round(r.load)}%</span></div>`)
  ].join("") || `<p class="text-xs text-slate-400">No alerts</p>`;
}

// ===== EMPLOYEE TABLE =====
function renderEmployeeTable(data) {
  const q = state.empSearch.toLowerCase();
  const rows = data.filter(r => !q ||
    norm(r[COLS.employee]).toLowerCase().includes(q) ||
    norm(r[COLS.role]).toLowerCase().includes(q) ||
    norm(r[COLS.section]).toLowerCase().includes(q) ||
    norm(r[COLS.enroll]).toLowerCase().includes(q) ||
    norm(r[COLS.phaseRemarks]).toLowerCase().includes(q));

  const uniqueEmp = uniqueEnrolls(rows);
  document.getElementById("empCount").textContent =
    uniqueEmp + " unique employees · " + rows.length + " task rows";

  rows.sort((a, b) => (Number(b[COLS.taskMin]) || 0) - (Number(a[COLS.taskMin]) || 0));

  document.getElementById("empTable").innerHTML = rows.map(r => {
    const min = Number(r[COLS.taskMin]) || 0;
    const fte = min / SHIFT_BASELINE;
    const load = fte * 100;
    const sec = norm(r[COLS.section]);
    const phase = norm(r[COLS.phaseRemarks]);
    const showPhase = phase && !isAllPhase(phase);
    return `<tr class="border-t hover:bg-slate-50">
      <td class="p-2"><span class="px-2 py-0.5 rounded text-xs ${SECTION_COLORS[sec] || 'bg-slate-100'}">${sec}</span></td>
      <td class="p-2 text-center"><span class="px-2 py-0.5 rounded-full text-xs bg-purple-50">${norm(r[COLS.shift])}</span></td>
      <td class="p-2 font-medium">${norm(r[COLS.employee])}</td>
      <td class="p-2 text-center text-slate-500">${norm(r[COLS.enroll])}</td>
      <td class="p-2">${norm(r[COLS.role])}</td>
      <td class="p-2 text-center font-mono">${min}</td>
      <td class="p-2 text-center font-mono ${load>100?'text-red-600':load<60?'text-green-600':'text-amber-600'}">${fte.toFixed(2)}</td>
      <td class="p-2 w-40">${loadBar(load)}</td>
      <td class="p-2">${showPhase ? `<span class="px-2 py-0.5 rounded text-xs bg-emerald-50 text-emerald-700">${phase}</span>` : '<span class="text-slate-400">—</span>'}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" class="p-4 text-center text-slate-400">No employees match.</td></tr>`;
}

// ===== RENDER =====
function render() {
  const data = applyFilters();
  const { roles_ } = renderKPIs(data);
  renderCharts(data);
  renderRoleTable(roles_);
  renderEmployeeTable(data);
}

// ===== EVENTS =====
document.getElementById("refreshBtn").onclick = fetchData;
document.getElementById("roleSearch").oninput = e => { state.roleSearch = e.target.value; render(); };
document.getElementById("empSearch").oninput  = e => { state.empSearch  = e.target.value; render(); };
document.getElementById("sortFTE").onclick = () => {
  state.roleSort = "fte";
  document.getElementById("sortFTE").classList.add("bg-blue-50");
  document.getElementById("sortLoad").classList.remove("bg-blue-50");
  render();
};
document.getElementById("sortLoad").onclick = () => {
  state.roleSort = "load";
  document.getElementById("sortLoad").classList.add("bg-blue-50");
  document.getElementById("sortFTE").classList.remove("bg-blue-50");
  render();
};

// ===== INIT =====
buildFilters();
fetchData();
setInterval(fetchData, 5 * 60 * 1000);
