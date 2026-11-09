import { uid } from "./id.js";
import {
  FREQUENCIES,
  SEASONS,
  loadState,
  saveState,
  emptyState,
  normalizeState,
  mergeStates,
  peopleForSchedule,
  todayIso,
} from "./store.js";
import {
  generateOccurrences,
  autoAssignSchedule,
  allEvents,
  frequencyLabel,
} from "./schedule.js";
import { exportIcs, importIcs } from "./ics.js";

const APP_REPO = "vicholz/simple_scheduler";

const state = {
  data: loadState(),
  view: "people",
  activeScheduleId: null,
  status: "",
};

const els = {};

function $(sel, root = document) {
  return root.querySelector(sel);
}

function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

function commit(next, status = "") {
  state.data = normalizeState(next);
  state.status = status;
  saveState(state.data);
  render();
}

function setView(view) {
  state.view = view;
  render();
}

function init() {
  cacheEls();
  bindGlobal();
  if (!state.data.schedules.length) state.activeScheduleId = null;
  else if (!state.activeScheduleId) state.activeScheduleId = state.data.schedules[0].id;
  maybeLoadDemo();
  render();
  loadAppVersion();
}

function cacheEls() {
  els.main = $("#main");
  els.status = $("#global-status");
  els.views = {
    people: $("#view-people"),
    pools: $("#view-pools"),
    schedules: $("#view-schedules"),
    calendar: $("#view-calendar"),
    data: $("#view-data"),
  };
}

function bindGlobal() {
  $all(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  window.addEventListener("hashchange", () => maybeLoadDemo());

  // People
  $("#person-form").addEventListener("submit", onAddPerson);

  // Pools
  $("#pool-form").addEventListener("submit", onAddPool);

  // Event types
  $("#etype-form").addEventListener("submit", onAddEventType);

  // Schedules
  $("#btn-new-schedule").addEventListener("click", onNewSchedule);
  $("#btn-delete-schedule").addEventListener("click", onDeleteSchedule);
  $("#schedule-select").addEventListener("change", (e) => {
    state.activeScheduleId = e.target.value;
    render();
  });
  $("#schedule-form").addEventListener("submit", onSaveSchedule);
  $("#btn-generate").addEventListener("click", () => onGenerate(false));
  $("#btn-regenerate").addEventListener("click", () => onGenerate(true));
  $("#btn-clear-assignments").addEventListener("click", onClearAssignments);

  // Data
  $("#btn-export-json").addEventListener("click", onExportJson);
  $("#btn-export-ics").addEventListener("click", onExportIcs);
  $("#btn-copy-json").addEventListener("click", onCopyJson);
  $("#import-json-file").addEventListener("change", onImportJsonFile);
  $("#import-ics-file").addEventListener("change", onImportIcsFile);
  $("#btn-import-json-paste").addEventListener("click", onImportJsonPaste);
  $("#btn-reset").addEventListener("click", onReset);
}

function maybeLoadDemo() {
  if (location.hash === "#demo") loadDemo(false);
  updateDemoButton();
}

function updateDemoButton() {
  const btn = $("#btn-demo");
  if (!btn) return;
  if (location.hash === "#demo") {
    btn.textContent = "Exit demo";
    btn.title = "Clear demo data and leave demo mode";
    btn.onclick = (e) => {
      e.preventDefault();
      location.hash = "";
      commit(emptyState(), "Demo cleared.");
    };
  } else {
    btn.textContent = "Demo";
    btn.title = "Load sample people, pools, and schedules";
    btn.onclick = (e) => {
      e.preventDefault();
      location.hash = "#demo";
    };
  }
}

function loadDemo(force) {
  if (!force && location.hash !== "#demo") return;
  const alice = { id: uid("person"), name: "Alice Nguyen", notes: "" };
  const bob = { id: uid("person"), name: "Bob Okonkwo", notes: "" };
  const cara = { id: uid("person"), name: "Cara Singh", notes: "" };
  const diego = { id: uid("person"), name: "Diego Alvarez", notes: "" };
  const emma = { id: uid("person"), name: "Emma Berg", notes: "" };
  const farah = { id: uid("person"), name: "Farah Haddad", notes: "" };

  const hosts = {
    id: uid("pool"),
    name: "Weekend hosts",
    personIds: [alice.id, bob.id, cara.id],
  };
  const oncall = {
    id: uid("pool"),
    name: "On-call rotation",
    personIds: [diego.id, emma.id, farah.id, alice.id],
  };

  const types = [
    { id: uid("etype"), name: "Host", color: "#2f6f5e" },
    { id: uid("etype"), name: "On-call", color: "#b45a2a" },
    { id: uid("etype"), name: "All-hands", color: "#3d5a80" },
  ];

  const start = todayIso();
  let data = {
    version: 1,
    people: [alice, bob, cara, diego, emma, farah],
    pools: [hosts, oncall],
    eventTypes: types,
    schedules: [
      {
        id: uid("sched"),
        name: "Saturday host",
        eventTypeId: types[0].id,
        frequency: "weekly",
        poolIds: [hosts.id],
        personIds: [],
        slotsPerOccurrence: 1,
        startDate: start,
        endDate: "",
        avoidConsecutiveSameType: true,
        weekday: 6,
        daysOfMonth: [1, 15],
        monthDay: 1,
        seasonMonths: [2, 5, 8, 11],
        yearMonth: 0,
        yearDay: 1,
        horizonMonths: 6,
        assignments: [],
      },
      {
        id: uid("sched"),
        name: "Primary on-call",
        eventTypeId: types[1].id,
        frequency: "twice_monthly",
        poolIds: [oncall.id],
        personIds: [],
        slotsPerOccurrence: 1,
        startDate: start,
        endDate: "",
        avoidConsecutiveSameType: true,
        weekday: 1,
        daysOfMonth: [1, 15],
        monthDay: 1,
        seasonMonths: [2, 5, 8, 11],
        yearMonth: 0,
        yearDay: 1,
        horizonMonths: 6,
        assignments: [],
      },
      {
        id: uid("sched"),
        name: "Seasonal kickoff",
        eventTypeId: types[2].id,
        frequency: "seasonally",
        poolIds: [],
        personIds: [alice.id, diego.id, emma.id],
        slotsPerOccurrence: 2,
        startDate: start,
        endDate: "",
        avoidConsecutiveSameType: false,
        weekday: 1,
        daysOfMonth: [1, 15],
        monthDay: 20,
        seasonMonths: [2, 5, 8, 11],
        yearMonth: 0,
        yearDay: 1,
        horizonMonths: 18,
        assignments: [],
      },
    ],
  };

  data = autoAssignSchedule(data, data.schedules[0].id, { refill: true });
  data = autoAssignSchedule(data, data.schedules[1].id, { refill: true });
  data = autoAssignSchedule(data, data.schedules[2].id, { refill: true });

  state.activeScheduleId = data.schedules[0].id;
  commit(data, "Demo data loaded.");
  state.view = "calendar";
  render();
}

/* ---------- People ---------- */

function onAddPerson(e) {
  e.preventDefault();
  const input = $("#person-name");
  const name = input.value.trim();
  if (!name) return;
  const people = [...state.data.people, { id: uid("person"), name, notes: "" }];
  input.value = "";
  commit({ ...state.data, people }, `Added ${name}.`);
}

function onRenamePerson(id) {
  const person = state.data.people.find((p) => p.id === id);
  if (!person) return;
  const name = prompt("Rename person", person.name);
  if (!name || !name.trim()) return;
  commit(
    {
      ...state.data,
      people: state.data.people.map((p) =>
        p.id === id ? { ...p, name: name.trim() } : p
      ),
    },
    "Person updated."
  );
}

function onDeletePerson(id) {
  const person = state.data.people.find((p) => p.id === id);
  if (!person) return;
  if (!confirm(`Remove ${person.name}? They will be dropped from pools and assignments.`)) return;
  const people = state.data.people.filter((p) => p.id !== id);
  const pools = state.data.pools.map((pool) => ({
    ...pool,
    personIds: pool.personIds.filter((pid) => pid !== id),
  }));
  const schedules = state.data.schedules.map((s) => ({
    ...s,
    personIds: s.personIds.filter((pid) => pid !== id),
    assignments: s.assignments.map((a) => ({
      ...a,
      personIds: a.personIds.filter((pid) => pid !== id),
    })),
  }));
  commit({ ...state.data, people, pools, schedules }, `Removed ${person.name}.`);
}

/* ---------- Pools ---------- */

function onAddPool(e) {
  e.preventDefault();
  const input = $("#pool-name");
  const name = input.value.trim();
  if (!name) return;
  const pools = [...state.data.pools, { id: uid("pool"), name, personIds: [] }];
  input.value = "";
  commit({ ...state.data, pools }, `Pool “${name}” created.`);
}

function onRenamePool(id) {
  const pool = state.data.pools.find((p) => p.id === id);
  if (!pool) return;
  const name = prompt("Rename pool", pool.name);
  if (!name || !name.trim()) return;
  commit(
    {
      ...state.data,
      pools: state.data.pools.map((p) =>
        p.id === id ? { ...p, name: name.trim() } : p
      ),
    },
    "Pool renamed."
  );
}

function onDeletePool(id) {
  const pool = state.data.pools.find((p) => p.id === id);
  if (!pool) return;
  if (!confirm(`Delete pool “${pool.name}”?`)) return;
  const pools = state.data.pools.filter((p) => p.id !== id);
  const schedules = state.data.schedules.map((s) => ({
    ...s,
    poolIds: s.poolIds.filter((pid) => pid !== id),
  }));
  commit({ ...state.data, pools, schedules }, "Pool deleted.");
}

function onTogglePoolMember(poolId, personId, checked) {
  const pools = state.data.pools.map((p) => {
    if (p.id !== poolId) return p;
    const set = new Set(p.personIds);
    if (checked) set.add(personId);
    else set.delete(personId);
    return { ...p, personIds: [...set] };
  });
  commit({ ...state.data, pools });
}

/* ---------- Event types ---------- */

function onAddEventType(e) {
  e.preventDefault();
  const name = $("#etype-name").value.trim();
  const color = $("#etype-color").value || "#2f6f5e";
  if (!name) return;
  const eventTypes = [...state.data.eventTypes, { id: uid("etype"), name, color }];
  $("#etype-name").value = "";
  commit({ ...state.data, eventTypes }, `Event type “${name}” added.`);
}

function onDeleteEventType(id) {
  if (state.data.eventTypes.length <= 1) {
    alert("Keep at least one event type.");
    return;
  }
  const type = state.data.eventTypes.find((t) => t.id === id);
  if (!type) return;
  if (!confirm(`Delete event type “${type.name}”?`)) return;
  const eventTypes = state.data.eventTypes.filter((t) => t.id !== id);
  const fallback = eventTypes[0].id;
  const schedules = state.data.schedules.map((s) =>
    s.eventTypeId === id ? { ...s, eventTypeId: fallback } : s
  );
  commit({ ...state.data, eventTypes, schedules }, "Event type deleted.");
}

/* ---------- Schedules ---------- */

function onNewSchedule() {
  const name = prompt("Schedule name", "New schedule");
  if (!name || !name.trim()) return;
  const schedule = {
    id: uid("sched"),
    name: name.trim(),
    eventTypeId: state.data.eventTypes[0]?.id || "",
    frequency: "weekly",
    poolIds: [],
    personIds: [],
    slotsPerOccurrence: 1,
    startDate: todayIso(),
    endDate: "",
    avoidConsecutiveSameType: true,
    weekday: 1,
    daysOfMonth: [1, 15],
    monthDay: 1,
    seasonMonths: [2, 5, 8, 11],
    yearMonth: 0,
    yearDay: 1,
    horizonMonths: 12,
    assignments: [],
  };
  state.activeScheduleId = schedule.id;
  commit(
    { ...state.data, schedules: [...state.data.schedules, schedule] },
    "Schedule created."
  );
  state.view = "schedules";
  render();
}

function onDeleteSchedule() {
  const s = activeSchedule();
  if (!s) return;
  if (!confirm(`Delete schedule “${s.name}”?`)) return;
  const schedules = state.data.schedules.filter((x) => x.id !== s.id);
  state.activeScheduleId = schedules[0]?.id || null;
  commit({ ...state.data, schedules }, "Schedule deleted.");
}

function activeSchedule() {
  return state.data.schedules.find((s) => s.id === state.activeScheduleId) || null;
}

function readScheduleForm() {
  const s = activeSchedule();
  if (!s) return null;
  const form = $("#schedule-form");
  const daysOfMonth = [
    Number(form.dayOfMonth1.value) || 1,
    Number(form.dayOfMonth2.value) || 15,
  ];
  const seasonMonths = $all('input[name="seasonMonth"]:checked', form).map((el) =>
    Number(el.value)
  );
  const poolIds = $all('input[name="schedPool"]:checked', form).map((el) => el.value);
  const personIds = $all('input[name="schedPerson"]:checked', form).map((el) => el.value);

  return {
    ...s,
    name: form.schedName.value.trim() || s.name,
    eventTypeId: form.eventTypeId.value,
    frequency: form.frequency.value,
    slotsPerOccurrence: Math.max(1, Number(form.slotsPerOccurrence.value) || 1),
    startDate: form.startDate.value || s.startDate,
    endDate: form.endDate.value || "",
    avoidConsecutiveSameType: form.avoidConsecutive.checked,
    weekday: Number(form.weekday.value),
    daysOfMonth,
    monthDay: Number(form.monthDay.value) || 1,
    seasonMonths: seasonMonths.length ? seasonMonths : [2, 5, 8, 11],
    yearMonth: Number(form.yearMonth.value) || 0,
    yearDay: Number(form.yearDay.value) || 1,
    horizonMonths: Math.max(1, Number(form.horizonMonths.value) || 12),
    poolIds,
    personIds,
  };
}

function onSaveSchedule(e) {
  e.preventDefault();
  const updated = readScheduleForm();
  if (!updated) return;
  commit(
    {
      ...state.data,
      schedules: state.data.schedules.map((x) => (x.id === updated.id ? updated : x)),
    },
    "Schedule saved."
  );
}

function onGenerate(refill) {
  const updated = readScheduleForm();
  if (!updated) return;
  const draft = {
    ...state.data,
    schedules: state.data.schedules.map((x) => (x.id === updated.id ? updated : x)),
  };
  const pool = peopleForSchedule(draft, updated);
  if (!pool.length) {
    alert("Add people or pools to this schedule first.");
    return;
  }
  if (refill && updated.assignments.length) {
    if (!confirm("Regenerate and replace existing assignments for this schedule?")) return;
  }
  const next = autoAssignSchedule(draft, updated.id, { refill });
  const count = next.schedules.find((x) => x.id === updated.id)?.assignments.length || 0;
  commit(next, `Assigned ${count} occurrence(s).`);
}

function onClearAssignments() {
  const s = activeSchedule();
  if (!s) return;
  if (!confirm("Clear all assignments on this schedule?")) return;
  commit(
    {
      ...state.data,
      schedules: state.data.schedules.map((x) =>
        x.id === s.id ? { ...x, assignments: [] } : x
      ),
    },
    "Assignments cleared."
  );
}

function onAssignmentPeopleChange(date, selectedIds) {
  const s = activeSchedule();
  if (!s) return;
  const assignments = [...s.assignments];
  const idx = assignments.findIndex((a) => a.date === date);
  if (idx >= 0) assignments[idx] = { date, personIds: selectedIds };
  else assignments.push({ date, personIds: selectedIds });
  assignments.sort((a, b) => (a.date < b.date ? -1 : 1));
  commit({
    ...state.data,
    schedules: state.data.schedules.map((x) =>
      x.id === s.id ? { ...x, assignments } : x
    ),
  });
}

/* ---------- Data IO ---------- */

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function onExportJson() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], {
    type: "application/json",
  });
  downloadBlob(`simple_scheduler-${todayIso()}.json`, blob);
  flash("JSON exported.");
}

function onExportIcs() {
  const body = exportIcs(state.data);
  const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
  downloadBlob(`simple_scheduler-${todayIso()}.ics`, blob);
  flash("Calendar ICS exported.");
}

async function onCopyJson() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.data, null, 2));
    flash("JSON copied to clipboard.");
  } catch {
    flash("Could not copy — use Export JSON instead.");
  }
}

function importMode() {
  return $('input[name="importMode"]:checked')?.value || "replace";
}

function onImportJsonFile(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      applyImported(parsed, importMode(), "JSON");
    } catch (err) {
      alert(`Could not import JSON: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function onImportJsonPaste() {
  const raw = $("#json-paste").value.trim();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    applyImported(parsed, importMode(), "JSON");
    $("#json-paste").value = "";
  } catch (err) {
    alert(`Could not import JSON: ${err.message}`);
  }
}

function onImportIcsFile(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const mode = importMode();
      const base = mode === "replace" ? emptyState() : state.data;
      const { state: next, stats } = importIcs(String(reader.result), base);
      state.activeScheduleId = next.schedules[0]?.id || null;
      commit(
        next,
        `Imported ${stats.events} ICS event(s) → ${stats.schedules} schedule(s).`
      );
    } catch (err) {
      alert(`Could not import ICS: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function applyImported(parsed, mode, label) {
  const next = mergeStates(state.data, parsed, mode);
  state.activeScheduleId = next.schedules[0]?.id || null;
  commit(next, `${label} imported (${mode}).`);
}

function onReset() {
  if (!confirm("Erase all simple_scheduler data in this browser?")) return;
  location.hash = "";
  state.activeScheduleId = null;
  commit(emptyState(), "All data cleared.");
}

function flash(msg) {
  state.status = msg;
  renderStatus();
}

/* ---------- Render ---------- */

function render() {
  updateDemoButton();
  renderNav();
  renderStatus();
  renderPeople();
  renderPools();
  renderSchedules();
  renderCalendar();
  renderData();
}

function renderNav() {
  $all(".nav-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === state.view);
  });
  for (const [name, el] of Object.entries(els.views)) {
    const active = name === state.view;
    el.hidden = !active;
    el.classList.toggle("is-active", active);
  }
}

function renderStatus() {
  if (!els.status) return;
  els.status.textContent = state.status || "";
  els.status.hidden = !state.status;
}

function renderPeople() {
  const list = $("#people-list");
  const empty = $("#people-empty");
  list.replaceChildren();
  const people = state.data.people;
  empty.hidden = people.length > 0;
  for (const person of people) {
    const li = document.createElement("li");
    li.className = "row-card";
    li.innerHTML = `
      <div class="row-main">
        <span class="row-title"></span>
      </div>
      <div class="row-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="rename">Rename</button>
        <button type="button" class="btn btn-danger btn-sm" data-act="delete">Remove</button>
      </div>`;
    li.querySelector(".row-title").textContent = person.name;
    li.querySelector('[data-act="rename"]').addEventListener("click", () =>
      onRenamePerson(person.id)
    );
    li.querySelector('[data-act="delete"]').addEventListener("click", () =>
      onDeletePerson(person.id)
    );
    list.appendChild(li);
  }
}

function renderPools() {
  const list = $("#pools-list");
  const empty = $("#pools-empty");
  list.replaceChildren();
  empty.hidden = state.data.pools.length > 0;

  for (const pool of state.data.pools) {
    const article = document.createElement("article");
    article.className = "pool-card";
    const head = document.createElement("div");
    head.className = "pool-head";
    head.innerHTML = `
      <h3 class="pool-title"></h3>
      <div class="row-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="rename">Rename</button>
        <button type="button" class="btn btn-danger btn-sm" data-act="delete">Delete</button>
      </div>`;
    head.querySelector(".pool-title").textContent = `${pool.name} (${pool.personIds.length})`;
    head.querySelector('[data-act="rename"]').addEventListener("click", () =>
      onRenamePool(pool.id)
    );
    head.querySelector('[data-act="delete"]').addEventListener("click", () =>
      onDeletePool(pool.id)
    );
    article.appendChild(head);

    const members = document.createElement("div");
    members.className = "check-grid";
    if (!state.data.people.length) {
      members.innerHTML = `<p class="empty-hint">Add people first.</p>`;
    } else {
      for (const person of state.data.people) {
        const label = document.createElement("label");
        label.className = "check-item";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = pool.personIds.includes(person.id);
        input.addEventListener("change", () =>
          onTogglePoolMember(pool.id, person.id, input.checked)
        );
        label.appendChild(input);
        label.append(` ${person.name}`);
        members.appendChild(label);
      }
    }
    article.appendChild(members);
    list.appendChild(article);
  }

  // Event types panel
  const etList = $("#etype-list");
  etList.replaceChildren();
  for (const type of state.data.eventTypes) {
    const li = document.createElement("li");
    li.className = "row-card";
    li.innerHTML = `
      <div class="row-main">
        <span class="swatch" style="background:${type.color}"></span>
        <span class="row-title"></span>
      </div>
      <div class="row-actions">
        <button type="button" class="btn btn-danger btn-sm" data-act="delete">Delete</button>
      </div>`;
    li.querySelector(".row-title").textContent = type.name;
    li.querySelector('[data-act="delete"]').addEventListener("click", () =>
      onDeleteEventType(type.id)
    );
    etList.appendChild(li);
  }
}

function renderSchedules() {
  const select = $("#schedule-select");
  const workspace = $("#schedule-workspace");
  const empty = $("#schedules-empty");
  select.replaceChildren();

  if (!state.data.schedules.length) {
    workspace.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  workspace.hidden = false;

  if (!state.activeScheduleId || !activeSchedule()) {
    state.activeScheduleId = state.data.schedules[0].id;
  }

  for (const s of state.data.schedules) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    if (s.id === state.activeScheduleId) opt.selected = true;
    select.appendChild(opt);
  }

  const s = activeSchedule();
  const form = $("#schedule-form");
  form.schedName.value = s.name;
  form.slotsPerOccurrence.value = s.slotsPerOccurrence;
  form.startDate.value = s.startDate;
  form.endDate.value = s.endDate || "";
  form.avoidConsecutive.checked = s.avoidConsecutiveSameType;
  form.weekday.value = String(s.weekday);
  form.dayOfMonth1.value = s.daysOfMonth[0] ?? 1;
  form.dayOfMonth2.value = s.daysOfMonth[1] ?? 15;
  form.monthDay.value = s.monthDay;
  form.yearMonth.value = String(s.yearMonth);
  form.yearDay.value = s.yearDay;
  form.horizonMonths.value = s.horizonMonths;

  const freq = form.frequency;
  freq.replaceChildren();
  for (const f of FREQUENCIES) {
    const opt = document.createElement("option");
    opt.value = f.value;
    opt.textContent = f.label;
    if (f.value === s.frequency) opt.selected = true;
    freq.appendChild(opt);
  }

  const et = form.eventTypeId;
  et.replaceChildren();
  for (const t of state.data.eventTypes) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    if (t.id === s.eventTypeId) opt.selected = true;
    et.appendChild(opt);
  }

  // Season checkboxes
  const seasonBox = $("#season-months");
  seasonBox.replaceChildren();
  for (const season of SEASONS) {
    const label = document.createElement("label");
    label.className = "check-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "seasonMonth";
    input.value = String(season.month);
    input.checked = s.seasonMonths.includes(season.month);
    label.appendChild(input);
    label.append(` ${season.label}`);
    seasonBox.appendChild(label);
  }

  // People / pools pickers
  const poolBox = $("#sched-pools");
  poolBox.replaceChildren();
  if (!state.data.pools.length) {
    poolBox.innerHTML = `<p class="empty-hint">No pools yet.</p>`;
  } else {
    for (const pool of state.data.pools) {
      const label = document.createElement("label");
      label.className = "check-item";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "schedPool";
      input.value = pool.id;
      input.checked = s.poolIds.includes(pool.id);
      label.appendChild(input);
      label.append(` ${pool.name}`);
      poolBox.appendChild(label);
    }
  }

  const personBox = $("#sched-people");
  personBox.replaceChildren();
  if (!state.data.people.length) {
    personBox.innerHTML = `<p class="empty-hint">No people yet.</p>`;
  } else {
    for (const person of state.data.people) {
      const label = document.createElement("label");
      label.className = "check-item";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "schedPerson";
      input.value = person.id;
      input.checked = s.personIds.includes(person.id);
      label.appendChild(input);
      label.append(` ${person.name}`);
      personBox.appendChild(label);
    }
  }

  toggleFreqFields(s.frequency);
  freq.onchange = () => toggleFreqFields(freq.value);

  // Assignments preview
  const assignList = $("#assignment-list");
  assignList.replaceChildren();
  const dates = generateOccurrences(s);
  const byDate = new Map(s.assignments.map((a) => [a.date, a.personIds]));
  const poolPeople = peopleForSchedule(state.data, s);

  $("#assignment-meta").textContent = `${dates.length} occurrence(s) in horizon · ${
    poolPeople.length
  } person(s) eligible · ${frequencyLabel(s.frequency)}`;

  const show = dates.slice(0, 40);
  for (const date of show) {
    const row = document.createElement("div");
    row.className = "assign-row";
    const label = document.createElement("div");
    label.className = "assign-date";
    label.textContent = formatDisplayDate(date);
    const select = document.createElement("select");
    select.multiple = true;
    select.size = Math.min(6, Math.max(3, poolPeople.length || 3));
    select.setAttribute("aria-label", `People for ${date}`);
    const selected = new Set(byDate.get(date) || []);
    for (const person of poolPeople) {
      const opt = document.createElement("option");
      opt.value = person.id;
      opt.textContent = person.name;
      opt.selected = selected.has(person.id);
      select.appendChild(opt);
    }
    if (!poolPeople.length) {
      const opt = document.createElement("option");
      opt.disabled = true;
      opt.textContent = "No eligible people";
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      const ids = [...select.selectedOptions].map((o) => o.value);
      onAssignmentPeopleChange(date, ids);
    });
    row.appendChild(label);
    row.appendChild(select);
    assignList.appendChild(row);
  }
  if (dates.length > show.length) {
    const more = document.createElement("p");
    more.className = "empty-hint";
    more.textContent = `Showing first ${show.length} of ${dates.length}. Export ICS for the full set.`;
    assignList.appendChild(more);
  }
}

function toggleFreqFields(frequency) {
  $all("[data-freq]").forEach((el) => {
    const list = el.dataset.freq.split(",");
    el.hidden = !list.includes(frequency);
  });
}

function renderCalendar() {
  const list = $("#calendar-list");
  const empty = $("#calendar-empty");
  list.replaceChildren();
  const events = allEvents(state.data).filter((e) => e.date >= todayIso());
  empty.hidden = events.length > 0;

  let currentMonth = "";
  for (const ev of events.slice(0, 80)) {
    const monthKey = ev.date.slice(0, 7);
    if (monthKey !== currentMonth) {
      currentMonth = monthKey;
      const h = document.createElement("h3");
      h.className = "cal-month";
      h.textContent = formatMonth(monthKey);
      list.appendChild(h);
    }
    const item = document.createElement("article");
    item.className = "cal-item";
    item.style.setProperty("--event-color", ev.color);
    const people = ev.people.map((p) => p.name).join(", ") || "Unassigned";
    item.innerHTML = `
      <div class="cal-date"></div>
      <div class="cal-body">
        <div class="cal-title"></div>
        <div class="cal-meta"></div>
        <div class="cal-people"></div>
      </div>`;
    item.querySelector(".cal-date").textContent = formatDisplayDate(ev.date);
    item.querySelector(".cal-title").textContent = `${ev.eventTypeName} · ${ev.scheduleName}`;
    item.querySelector(".cal-meta").textContent = frequencyLabel(ev.frequency);
    item.querySelector(".cal-people").textContent = people;
    list.appendChild(item);
  }
}

function renderData() {
  $("#data-summary").textContent = `${state.data.people.length} people · ${state.data.pools.length} pools · ${state.data.schedules.length} schedules · ${state.data.eventTypes.length} event types`;
}

function formatDisplayDate(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function loadAppVersion() {
  fetch("https://api.github.com/repos/" + APP_REPO + "/commits/main")
    .then((res) => {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then((commit) => {
      if (!commit.sha) return;
      const el = $("#app-version");
      if (!el) return;
      el.replaceChildren();
      el.append("Version ");
      const a = document.createElement("a");
      a.href = "https://github.com/" + APP_REPO + "/commit/" + commit.sha;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = commit.sha.slice(0, 7);
      el.appendChild(a);
      el.hidden = false;
    })
    .catch(() => {});
}

init();
