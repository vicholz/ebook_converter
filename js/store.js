import { uid } from "./id.js";

export const STORAGE_KEY = "simple_scheduler:v1";
export const APP_VERSION = 1;

export const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "twice_monthly", label: "2 times a month" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "seasonally", label: "Seasonally" },
  { value: "yearly", label: "Yearly" },
];

export const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export const SEASONS = [
  { value: "spring", label: "Spring", month: 2, day: 20 },
  { value: "summer", label: "Summer", month: 5, day: 21 },
  { value: "autumn", label: "Autumn", month: 8, day: 22 },
  { value: "winter", label: "Winter", month: 11, day: 21 },
];

export function emptyState() {
  return {
    version: APP_VERSION,
    people: [],
    pools: [],
    eventTypes: [
      { id: uid("etype"), name: "Shift", color: "#2f6f5e" },
      { id: uid("etype"), name: "On-call", color: "#b45a2a" },
      { id: uid("etype"), name: "Host", color: "#3d5a80" },
    ],
    schedules: [],
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return emptyState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function normalizeState(input) {
  const base = emptyState();
  if (!input || typeof input !== "object") return base;

  const people = Array.isArray(input.people)
    ? input.people
        .filter((p) => p && typeof p.name === "string" && p.name.trim())
        .map((p) => ({
          id: String(p.id || uid("person")),
          name: String(p.name).trim(),
          notes: p.notes ? String(p.notes) : "",
        }))
    : [];

  const peopleIds = new Set(people.map((p) => p.id));

  const pools = Array.isArray(input.pools)
    ? input.pools
        .filter((p) => p && typeof p.name === "string" && p.name.trim())
        .map((p) => ({
          id: String(p.id || uid("pool")),
          name: String(p.name).trim(),
          personIds: Array.isArray(p.personIds)
            ? p.personIds.map(String).filter((id) => peopleIds.has(id))
            : [],
        }))
    : [];

  const eventTypes = Array.isArray(input.eventTypes) && input.eventTypes.length
    ? input.eventTypes
        .filter((e) => e && typeof e.name === "string" && e.name.trim())
        .map((e) => ({
          id: String(e.id || uid("etype")),
          name: String(e.name).trim(),
          color: typeof e.color === "string" ? e.color : "#2f6f5e",
        }))
    : base.eventTypes;

  const eventTypeIds = new Set(eventTypes.map((e) => e.id));
  const poolIds = new Set(pools.map((p) => p.id));

  const schedules = Array.isArray(input.schedules)
    ? input.schedules
        .filter((s) => s && typeof s.name === "string" && s.name.trim())
        .map((s) => normalizeSchedule(s, peopleIds, poolIds, eventTypeIds, eventTypes))
    : [];

  return {
    version: APP_VERSION,
    people,
    pools,
    eventTypes,
    schedules,
  };
}

function normalizeSchedule(s, peopleIds, poolIds, eventTypeIds, eventTypes) {
  const freqValues = new Set(FREQUENCIES.map((f) => f.value));
  const frequency = freqValues.has(s.frequency) ? s.frequency : "weekly";
  const eventTypeId =
    s.eventTypeId && eventTypeIds.has(String(s.eventTypeId))
      ? String(s.eventTypeId)
      : eventTypes[0]?.id || "";

  return {
    id: String(s.id || uid("sched")),
    name: String(s.name).trim(),
    eventTypeId,
    frequency,
    poolIds: Array.isArray(s.poolIds)
      ? s.poolIds.map(String).filter((id) => poolIds.has(id))
      : [],
    personIds: Array.isArray(s.personIds)
      ? s.personIds.map(String).filter((id) => peopleIds.has(id))
      : [],
    slotsPerOccurrence: Math.max(1, Math.min(50, Number(s.slotsPerOccurrence) || 1)),
    startDate: isIsoDate(s.startDate) ? s.startDate : todayIso(),
    endDate: isIsoDate(s.endDate) ? s.endDate : "",
    avoidConsecutiveSameType: Boolean(s.avoidConsecutiveSameType),
    weekday: Number.isInteger(s.weekday) ? clamp(s.weekday, 0, 6) : 1,
    daysOfMonth: normalizeDaysOfMonth(s.daysOfMonth),
    monthDay: clamp(Number(s.monthDay) || 1, 1, 31),
    seasonMonths: Array.isArray(s.seasonMonths) && s.seasonMonths.length
      ? s.seasonMonths.map(Number).filter((m) => m >= 0 && m <= 11)
      : [2, 5, 8, 11],
    yearMonth: clamp(Number(s.yearMonth) || 0, 0, 11),
    yearDay: clamp(Number(s.yearDay) || 1, 1, 31),
    horizonMonths: clamp(Number(s.horizonMonths) || 12, 1, 60),
    assignments: Array.isArray(s.assignments)
      ? s.assignments
          .filter((a) => a && isIsoDate(a.date))
          .map((a) => ({
            date: a.date,
            personIds: Array.isArray(a.personIds)
              ? a.personIds.map(String).filter((id) => peopleIds.has(id))
              : [],
          }))
      : [],
  };
}

function normalizeDaysOfMonth(days) {
  if (!Array.isArray(days) || days.length === 0) return [1, 15];
  const cleaned = [...new Set(days.map(Number).filter((d) => d >= 1 && d <= 31))].sort(
    (a, b) => a - b
  );
  return cleaned.length ? cleaned.slice(0, 2) : [1, 15];
}

export function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function todayIso() {
  const d = new Date();
  return toIsoDate(d);
}

export function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function peopleForSchedule(state, schedule) {
  const ids = new Set(schedule.personIds || []);
  for (const poolId of schedule.poolIds || []) {
    const pool = state.pools.find((p) => p.id === poolId);
    if (!pool) continue;
    for (const pid of pool.personIds) ids.add(pid);
  }
  return state.people.filter((p) => ids.has(p.id));
}

export function mergeStates(current, incoming, mode = "replace") {
  if (mode === "replace") return normalizeState(incoming);
  const next = structuredClone(current);
  const incomingNorm = normalizeState(incoming);

  const byId = (list) => new Map(list.map((item) => [item.id, item]));

  const people = byId(next.people);
  for (const p of incomingNorm.people) people.set(p.id, p);
  next.people = [...people.values()];

  const pools = byId(next.pools);
  for (const p of incomingNorm.pools) pools.set(p.id, p);
  next.pools = [...pools.values()];

  const types = byId(next.eventTypes);
  for (const t of incomingNorm.eventTypes) types.set(t.id, t);
  next.eventTypes = [...types.values()];

  const schedules = byId(next.schedules);
  for (const s of incomingNorm.schedules) schedules.set(s.id, s);
  next.schedules = [...schedules.values()];

  return normalizeState(next);
}
