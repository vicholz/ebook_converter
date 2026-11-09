import { uid } from "./id.js";
import { isIsoDate, toIsoDate, parseIsoDate } from "./store.js";

/**
 * Export all schedule assignments as an iCalendar (.ics) file body.
 */
export function exportIcs(state) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//simple_scheduler//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:simple_scheduler",
  ];

  const peopleById = new Map(state.people.map((p) => [p.id, p]));
  const typeById = new Map(state.eventTypes.map((t) => [t.id, t]));
  const stamp = formatStamp(new Date());

  for (const schedule of state.schedules) {
    const type = typeById.get(schedule.eventTypeId);
    for (const a of schedule.assignments || []) {
      if (!isIsoDate(a.date)) continue;
      const names = (a.personIds || [])
        .map((id) => peopleById.get(id)?.name)
        .filter(Boolean);
      const summary = `${type?.name || "Event"}: ${schedule.name}${
        names.length ? ` — ${names.join(", ")}` : ""
      }`;
      const description = [
        `Schedule: ${schedule.name}`,
        `Event type: ${type?.name || "Event"}`,
        names.length ? `People: ${names.join(", ")}` : "People: (unassigned)",
        `simple_scheduler id: ${schedule.id}`,
      ].join("\\n");

      const dtEnd = nextDayIso(a.date);
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${schedule.id}-${a.date}@simple_scheduler`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART;VALUE=DATE:${compactDate(a.date)}`);
      lines.push(`DTEND;VALUE=DATE:${compactDate(dtEnd)}`);
      lines.push(`SUMMARY:${escapeText(summary)}`);
      lines.push(`DESCRIPTION:${escapeText(description)}`);
      lines.push(`CATEGORIES:${escapeText(type?.name || "Event")}`);
      lines.push("END:VEVENT");
    }
  }

  lines.push("END:VCALENDAR");
  return foldLines(lines).join("\r\n") + "\r\n";
}

/**
 * Import ICS events into a draft state patch:
 * - Creates people found in SUMMARY/DESCRIPTION when possible
 * - Creates one schedule per unique CATEGORIES / summary prefix
 * - Adds date assignments
 *
 * Returns { statePatch, stats }.
 */
export function importIcs(icsText, currentState) {
  const events = parseIcsEvents(icsText);
  if (!events.length) {
    throw new Error("No VEVENT entries found in that ICS file.");
  }

  const people = [...currentState.people];
  const peopleByName = new Map(people.map((p) => [p.name.toLowerCase(), p]));
  const eventTypes = [...currentState.eventTypes];
  const typeByName = new Map(eventTypes.map((t) => [t.name.toLowerCase(), t]));
  const schedulesByKey = new Map();

  // Seed existing schedules keyed by name.
  for (const s of currentState.schedules) {
    schedulesByKey.set(s.name.toLowerCase(), structuredClone(s));
  }

  let imported = 0;

  for (const ev of events) {
    const date = ev.date;
    if (!date) continue;

    const typeName = (ev.category || "Imported").trim() || "Imported";
    let type = typeByName.get(typeName.toLowerCase());
    if (!type) {
      type = { id: uid("etype"), name: typeName, color: pickColor(eventTypes.length) };
      eventTypes.push(type);
      typeByName.set(typeName.toLowerCase(), type);
    }

    const scheduleName = (ev.scheduleName || ev.summary || "Imported schedule").trim();
    const key = scheduleName.toLowerCase();
    let schedule = schedulesByKey.get(key);
    if (!schedule) {
      schedule = {
        id: uid("sched"),
        name: scheduleName,
        eventTypeId: type.id,
        frequency: "monthly",
        poolIds: [],
        personIds: [],
        slotsPerOccurrence: 1,
        startDate: date,
        endDate: "",
        avoidConsecutiveSameType: false,
        weekday: 1,
        daysOfMonth: [1, 15],
        monthDay: 1,
        seasonMonths: [2, 5, 8, 11],
        yearMonth: 0,
        yearDay: 1,
        horizonMonths: 12,
        assignments: [],
      };
      schedulesByKey.set(key, schedule);
    }

    const personIds = [];
    for (const name of ev.peopleNames) {
      const cleaned = name.trim();
      if (!cleaned) continue;
      let person = peopleByName.get(cleaned.toLowerCase());
      if (!person) {
        person = { id: uid("person"), name: cleaned, notes: "Imported from ICS" };
        people.push(person);
        peopleByName.set(cleaned.toLowerCase(), person);
      }
      personIds.push(person.id);
      if (!schedule.personIds.includes(person.id)) schedule.personIds.push(person.id);
    }

    schedule.slotsPerOccurrence = Math.max(schedule.slotsPerOccurrence, personIds.length || 1);
    schedule.eventTypeId = type.id;
    if (!schedule.startDate || date < schedule.startDate) schedule.startDate = date;

    const existing = schedule.assignments.find((a) => a.date === date);
    if (existing) {
      const set = new Set([...existing.personIds, ...personIds]);
      existing.personIds = [...set];
    } else {
      schedule.assignments.push({ date, personIds });
    }
    imported += 1;
  }

  return {
    state: {
      ...currentState,
      people,
      eventTypes,
      schedules: [...schedulesByKey.values()],
    },
    stats: { events: imported, people: people.length, schedules: schedulesByKey.size },
  };
}

function parseIcsEvents(text) {
  const unfolded = unfold(text);
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  const events = [];

  for (const block of blocks) {
    const body = block.split(/END:VEVENT/i)[0] || "";
    const fields = parseFields(body);
    const dtstart = fields.DTSTART || "";
    const date = icsDateToIso(dtstart);
    if (!date) continue;

    const summary = fields.SUMMARY || "";
    const description = fields.DESCRIPTION || "";
    const category = (fields.CATEGORIES || "").split(",")[0].trim();

    const peopleNames = extractPeople(summary, description);
    const scheduleName = extractScheduleName(summary, description) || summary.split("—")[0].split(":")[0].trim();

    events.push({
      date,
      summary,
      description,
      category,
      peopleNames,
      scheduleName,
    });
  }
  return events;
}

function extractPeople(summary, description) {
  const names = [];
  const descPeople = description.match(/People:\s*([^\n\\]+)/i);
  if (descPeople && !/unassigned/i.test(descPeople[1])) {
    names.push(...descPeople[1].split(",").map((s) => s.trim()));
  } else {
    const afterEm = summary.split(/—|–|-/);
    if (afterEm.length > 1) {
      names.push(...afterEm[afterEm.length - 1].split(",").map((s) => s.trim()));
    }
  }
  return names.filter((n) => n && n.length < 80);
}

function extractScheduleName(summary, description) {
  const m = description.match(/Schedule:\s*([^\n\\]+)/i);
  if (m) return m[1].trim();
  // "Type: Schedule Name — people"
  const parts = summary.split(":");
  if (parts.length >= 2) {
    return parts.slice(1).join(":").split(/—|–/)[0].trim();
  }
  return "";
}

function parseFields(body) {
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    if (!line || line.startsWith(" ")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const keyPart = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = keyPart.split(";")[0].toUpperCase();
    fields[key] = unescapeText(value);
  }
  return fields;
}

function icsDateToIso(raw) {
  const m = String(raw).match(/(\d{4})(\d{2})(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function compactDate(iso) {
  return iso.replace(/-/g, "");
}

function nextDayIso(iso) {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + 1);
  return toIsoDate(d);
}

function formatStamp(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function unescapeText(value) {
  return String(value)
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function unfold(text) {
  return String(text).replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function foldLines(lines) {
  const out = [];
  for (const line of lines) {
    if (line.length <= 75) {
      out.push(line);
      continue;
    }
    out.push(line.slice(0, 75));
    let rest = line.slice(75);
    while (rest.length > 74) {
      out.push(" " + rest.slice(0, 74));
      rest = rest.slice(74);
    }
    if (rest.length) out.push(" " + rest);
  }
  return out;
}

function pickColor(index) {
  const palette = ["#2f6f5e", "#b45a2a", "#3d5a80", "#7a4e2d", "#4a6670", "#6b3f5b"];
  return palette[index % palette.length];
}
