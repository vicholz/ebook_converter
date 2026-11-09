# simple_scheduler

Browser-only people scheduler. Vanilla HTML, CSS, and JavaScript — no build step, no server. Data stays in `localStorage` until you export it.

## Features

- **People** — add and manage everyone who can be scheduled
- **Pools** — reusable groups of people you can attach to schedules
- **Event types** — label duties (Host, On-call, …) and optionally **avoid scheduling the same person for the same event type twice in a row**
- **Schedules** — weekly, 2× / month, monthly, quarterly, seasonally, or yearly
- **Assignments** — auto-fill from pools/people, then tweak per date
- **Calendar** — upcoming assignments across every schedule
- **Import / export** — JSON (replace or merge) and calendar **ICS**

## Open locally

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

Or open `index.html` directly in a modern browser (ES modules + `localStorage`).

## Demo

Open with `#demo` (or use the **Demo** control) to load sample people, pools, and schedules with generated assignments.

## Project layout

```
index.html
css/style.css
js/
  app.js        UI
  store.js      localStorage model
  schedule.js   recurrence + auto-assign
  ics.js        ICS import/export
  id.js         ids
```

## License

MIT
