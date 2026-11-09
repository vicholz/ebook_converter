import { parseIsoDate, peopleForSchedule, toIsoDate } from "./store.js";

/**
 * Generate occurrence dates for a schedule within its horizon.
 */
export function generateOccurrences(schedule, fromDate = null) {
  const start = parseIsoDate(schedule.startDate);
  const horizonEnd = addMonths(start, schedule.horizonMonths || 12);
  const end = schedule.endDate
    ? minDate(parseIsoDate(schedule.endDate), horizonEnd)
    : horizonEnd;
  const from = fromDate ? parseIsoDate(fromDate) : start;
  const cursorStart = maxDate(start, from);

  const dates = [];
  switch (schedule.frequency) {
    case "weekly":
      collectWeekly(dates, cursorStart, end, schedule.weekday ?? 1);
      break;
    case "twice_monthly":
      collectTwiceMonthly(dates, cursorStart, end, schedule.daysOfMonth || [1, 15]);
      break;
    case "monthly":
      collectMonthly(dates, cursorStart, end, schedule.monthDay || 1);
      break;
    case "quarterly":
      collectQuarterly(dates, cursorStart, end, schedule.monthDay || 1);
      break;
    case "seasonally":
      collectSeasonally(dates, cursorStart, end, schedule.seasonMonths || [2, 5, 8, 11], schedule.monthDay || 20);
      break;
    case "yearly":
      collectYearly(dates, cursorStart, end, schedule.yearMonth ?? 0, schedule.yearDay || 1);
      break;
    default:
      collectWeekly(dates, cursorStart, end, 1);
  }
  return dates.map(toIsoDate);
}

function collectWeekly(out, start, end, weekday) {
  let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  while (d <= end) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
}

function collectTwiceMonthly(out, start, end, daysOfMonth) {
  const days = [...new Set(daysOfMonth)].sort((a, b) => a - b);
  let y = start.getFullYear();
  let m = start.getMonth();
  while (true) {
    for (const day of days) {
      const d = clampDay(y, m, day);
      if (d >= start && d <= end) out.push(d);
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    if (new Date(y, m, 1) > end) break;
  }
}

function collectMonthly(out, start, end, monthDay) {
  let y = start.getFullYear();
  let m = start.getMonth();
  while (true) {
    const d = clampDay(y, m, monthDay);
    if (d >= start && d <= end) out.push(d);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    if (new Date(y, m, 1) > end) break;
  }
}

function collectQuarterly(out, start, end, monthDay) {
  // Align to quarter starts: Jan, Apr, Jul, Oct — using monthDay within that month.
  let y = start.getFullYear();
  let qMonth = Math.floor(start.getMonth() / 3) * 3;
  while (true) {
    const d = clampDay(y, qMonth, monthDay);
    if (d >= start && d <= end) out.push(d);
    qMonth += 3;
    if (qMonth > 11) {
      qMonth = 0;
      y += 1;
    }
    if (new Date(y, qMonth, 1) > end) break;
  }
}

function collectSeasonally(out, start, end, seasonMonths, monthDay) {
  const months = [...new Set(seasonMonths)].sort((a, b) => a - b);
  let y = start.getFullYear();
  // Start a year early so we don't miss a season before start.
  while (true) {
    let any = false;
    for (const month of months) {
      const d = clampDay(y, month, monthDay);
      if (d > end) return;
      if (d >= start) {
        out.push(d);
        any = true;
      } else {
        any = true; // still scanning
      }
    }
    y += 1;
    if (!any && new Date(y, 0, 1) > end) break;
    if (new Date(y, 0, 1) > end) break;
  }
}

function collectYearly(out, start, end, yearMonth, yearDay) {
  let y = start.getFullYear();
  while (true) {
    const d = clampDay(y, yearMonth, yearDay);
    if (d > end) break;
    if (d >= start) out.push(d);
    y += 1;
  }
}

function clampDay(year, month, day) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

function addMonths(date, months) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setMonth(d.getMonth() + months);
  return d;
}

function minDate(a, b) {
  return a < b ? a : b;
}

function maxDate(a, b) {
  return a > b ? a : b;
}

/**
 * Build a map of eventTypeId -> sorted assignment dates with person ids
 * across all schedules (for consecutive-type avoidance).
 */
function typeHistory(state) {
  const map = new Map();
  for (const schedule of state.schedules) {
    const typeId = schedule.eventTypeId;
    if (!map.has(typeId)) map.set(typeId, []);
    for (const a of schedule.assignments || []) {
      map.get(typeId).push({
        date: a.date,
        personIds: [...(a.personIds || [])],
        scheduleId: schedule.id,
      });
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return map;
}

/**
 * Auto-assign people to schedule occurrences.
 * When avoidConsecutiveSameType is on, a person who was on the immediately
 * previous occurrence of the same event type (any schedule) is skipped if
 * alternatives exist.
 */
export function autoAssignSchedule(state, scheduleId, { refill = false } = {}) {
  const schedule = state.schedules.find((s) => s.id === scheduleId);
  if (!schedule) return state;

  const pool = peopleForSchedule(state, schedule);
  if (!pool.length) {
    return {
      ...state,
      schedules: state.schedules.map((s) =>
        s.id === scheduleId ? { ...s, assignments: refill ? [] : s.assignments } : s
      ),
    };
  }

  const dates = generateOccurrences(schedule);
  const existingByDate = new Map(
    (schedule.assignments || []).map((a) => [a.date, [...(a.personIds || [])]])
  );

  // Working copy of type history including other schedules' assignments.
  const history = typeHistory({
    ...state,
    schedules: state.schedules.map((s) =>
      s.id === scheduleId
        ? { ...s, assignments: refill ? [] : s.assignments.filter((a) => !dates.includes(a.date)) }
        : s
    ),
  });

  const slots = schedule.slotsPerOccurrence || 1;
  const avoid = Boolean(schedule.avoidConsecutiveSameType);
  const rotation = [...pool];
  let rotIndex = 0;

  const newAssignments = [];

  for (const date of dates) {
    if (!refill && existingByDate.has(date) && existingByDate.get(date).length) {
      const kept = existingByDate.get(date);
      newAssignments.push({ date, personIds: kept });
      pushHistory(history, schedule.eventTypeId, date, kept, schedule.id);
      continue;
    }

    const chosen = [];
    const blocked = avoid
      ? peopleOnPreviousSameType(history, schedule.eventTypeId, date)
      : new Set();

    // Prefer people not blocked; fall back to anyone if not enough.
    const prefer = rotation.filter((p) => !blocked.has(p.id) && !chosen.includes(p.id));
    const fallback = rotation.filter((p) => !chosen.includes(p.id));

    const pickFrom = (list) => {
      while (chosen.length < slots && list.length) {
        // Round-robin from current rotation index among candidates.
        let picked = null;
        for (let i = 0; i < rotation.length; i++) {
          const idx = (rotIndex + i) % rotation.length;
          const candidate = rotation[idx];
          if (list.some((p) => p.id === candidate.id) && !chosen.includes(candidate.id)) {
            picked = candidate;
            rotIndex = (idx + 1) % rotation.length;
            break;
          }
        }
        if (!picked) break;
        chosen.push(picked.id);
        list.splice(
          list.findIndex((p) => p.id === picked.id),
          1
        );
      }
    };

    pickFrom(prefer);
    if (chosen.length < slots) pickFrom(fallback);

    newAssignments.push({ date, personIds: chosen });
    pushHistory(history, schedule.eventTypeId, date, chosen, schedule.id);
  }

  return {
    ...state,
    schedules: state.schedules.map((s) =>
      s.id === scheduleId ? { ...s, assignments: newAssignments } : s
    ),
  };
}

function pushHistory(history, typeId, date, personIds, scheduleId) {
  if (!history.has(typeId)) history.set(typeId, []);
  history.get(typeId).push({ date, personIds: [...personIds], scheduleId });
  history.get(typeId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function peopleOnPreviousSameType(history, typeId, date) {
  const list = history.get(typeId) || [];
  let prev = null;
  for (const entry of list) {
    if (entry.date < date) prev = entry;
    else break;
  }
  return new Set(prev ? prev.personIds : []);
}

/**
 * Flatten all assignments across schedules for calendar display.
 */
export function allEvents(state) {
  const peopleById = new Map(state.people.map((p) => [p.id, p]));
  const typeById = new Map(state.eventTypes.map((t) => [t.id, t]));
  const events = [];

  for (const schedule of state.schedules) {
    const type = typeById.get(schedule.eventTypeId);
    for (const a of schedule.assignments || []) {
      events.push({
        date: a.date,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        eventTypeId: schedule.eventTypeId,
        eventTypeName: type?.name || "Event",
        color: type?.color || "#2f6f5e",
        people: (a.personIds || [])
          .map((id) => peopleById.get(id))
          .filter(Boolean),
        frequency: schedule.frequency,
      });
    }
  }

  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.scheduleName.localeCompare(b.scheduleName);
  });
  return events;
}

export function frequencyLabel(value) {
  const map = {
    weekly: "Weekly",
    twice_monthly: "2× / month",
    monthly: "Monthly",
    quarterly: "Quarterly",
    seasonally: "Seasonally",
    yearly: "Yearly",
  };
  return map[value] || value;
}
