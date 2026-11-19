// ---------- clock & date ----------
const $ = (id) => document.getElementById(id);
function tick() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("date").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}
tick();
setInterval(tick, 1000 * 15);

// ---------- settings ----------
const store = {
  get: (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k]))),
  set: (k, v) => new Promise((r) => chrome.storage.local.set({ [k]: v }, r)),
};

$("gear").onclick = async () => {
  $("url").value = (await store.get("calUrl")) || "";
  $("settings").hidden = !$("settings").hidden;
};
$("cancel").onclick = () => ($("settings").hidden = true);
$("settings").onsubmit = async (e) => {
  e.preventDefault();
  await store.set("calUrl", $("url").value.trim());
  await store.set("calCache", null);
  $("settings").hidden = true;
  load();
};

// ---------- ICS parsing ----------
function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseDate(value, params) {
  // value like 20261119T090000Z, 20261119T090000, or 20261119
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const allDay = !h || (params && /VALUE=DATE(?!-)/.test(params));
  if (allDay) return { date: new Date(+y, mo - 1, +d), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +s)), allDay: false };
  return { date: new Date(+y, mo - 1, +d, +h, +mi, +s), allDay: false }; // TZID / floating → local
}

function parseICS(text) {
  const events = [];
  let ev = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { ev = { exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (ev && ev.start) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const left = line.slice(0, idx), value = line.slice(idx + 1);
    const [name, ...p] = left.split(";");
    const params = p.join(";");
    const clean = (s) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
    switch (name) {
      case "SUMMARY": ev.title = clean(value); break;
      case "LOCATION": ev.location = clean(value); break;
      case "DTSTART": { const d = parseDate(value, params); ev.start = d.date; ev.allDay = d.allDay; break; }
      case "DTEND": ev.end = parseDate(value, params).date; break;
      case "RRULE": ev.rrule = Object.fromEntries(value.split(";").map((kv) => kv.split("="))); break;
      case "EXDATE": value.split(",").forEach((v) => { const d = parseDate(v, params); if (d) ev.exdates.push(d.date); }); break;
      case "RECURRENCE-ID": ev.recurrenceId = parseDate(value, params).date; break;
      case "UID": ev.uid = value; break;
      case "STATUS": ev.status = value; break;
    }
  }
  return events;
}

// ---------- today's occurrences ----------
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function occursOn(ev, day) {
  const dayStart = startOfDay(day);
  const dayEnd = new Date(dayStart.getTime() + 864e5);
  const dur = (ev.end || ev.start) - ev.start;

  // build the candidate start on `day`
  const cand = new Date(day.getFullYear(), day.getMonth(), day.getDate(), ev.start.getHours(), ev.start.getMinutes());
  if (!ev.rrule) {
    const end = ev.end || new Date(ev.start.getTime() + (ev.allDay ? 864e5 : 0));
    return ev.start < dayEnd && (end > dayStart || sameDay(ev.start, day)) ? ev.start : null;
  }

  const r = ev.rrule;
  if (cand < startOfDay(ev.start)) return null;
  if (r.UNTIL) { const u = parseDate(r.UNTIL).date; if (startOfDay(cand) > u) return null; }
  if (ev.exdates.some((x) => sameDay(x, cand))) return null;

  const interval = +(r.INTERVAL || 1);
  const s0 = startOfDay(ev.start);
  const daysBetween = Math.round((startOfDay(cand) - s0) / 864e5);
  let ok = false;
  switch (r.FREQ) {
    case "DAILY": ok = daysBetween % interval === 0; break;
    case "WEEKLY": {
      const byday = r.BYDAY ? r.BYDAY.split(",") : [DAYS[ev.start.getDay()]];
      const weekStart = (d) => new Date(d.getTime() - ((d.getDay() + 6) % 7) * 864e5);
      const weeks = Math.round((weekStart(startOfDay(cand)) - weekStart(s0)) / (7 * 864e5));
      ok = byday.includes(DAYS[cand.getDay()]) && weeks % interval === 0;
      break;
    }
    case "MONTHLY": {
      const months = (cand.getFullYear() - s0.getFullYear()) * 12 + cand.getMonth() - s0.getMonth();
      if (months % interval !== 0) break;
      if (r.BYDAY) {
        const m = r.BYDAY.match(/^(-?\d)?([A-Z]{2})$/);
        if (m && DAYS[cand.getDay()] === m[2]) {
          const n = +(m[1] || 0), d = cand.getDate();
          const last = new Date(cand.getFullYear(), cand.getMonth() + 1, 0).getDate();
          ok = n === 0 || (n > 0 && Math.ceil(d / 7) === n) || (n < 0 && Math.ceil((last - d + 1) / 7) === -n);
        }
      } else ok = cand.getDate() === (r.BYMONTHDAY ? +r.BYMONTHDAY : s0.getDate());
      break;
    }
    case "YEARLY":
      ok = cand.getMonth() === s0.getMonth() && cand.getDate() === s0.getDate() &&
        (cand.getFullYear() - s0.getFullYear()) % interval === 0;
      break;
  }
  if (!ok) return null;
  if (r.COUNT) {
    // rough check: stop after COUNT occurrences for daily/weekly
    const approx = r.FREQ === "DAILY" ? daysBetween / interval : r.FREQ === "WEEKLY" ? daysBetween / 7 / interval * (r.BYDAY ? r.BYDAY.split(",").length : 1) : 0;
    if (approx >= +r.COUNT) return null;
  }
  void dur;
  return cand;
}

function todaysEvents(events, day = new Date()) {
  // modified single instances replace their recurring parent for that day
  const overrides = new Set(events.filter((e) => e.recurrenceId && sameDay(e.recurrenceId, day)).map((e) => e.uid));
  const out = [];
  for (const ev of events) {
    if (ev.status === "CANCELLED") continue;
    if (ev.rrule && overrides.has(ev.uid)) continue;
    const start = occursOn(ev, day);
    if (!start) continue;
    const end = new Date(start.getTime() + ((ev.end || ev.start) - ev.start));
    out.push({ ...ev, start, end });
  }
  return out.sort((a, b) => (b.allDay - a.allDay) || a.start - b.start);
}

// ---------- render ----------
const fmt = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const esc = (s = "") => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function render(list, message) {
  const ul = $("events");
  if (message) { ul.innerHTML = `<li class="empty">${message}</li>`; return; }
  if (!list.length) { ul.innerHTML = `<li class="empty">Nothing on the calendar today. Enjoy it.</li>`; return; }
  const now = new Date();
  ul.innerHTML = list.map((e) => {
    const cls = e.allDay ? "" : e.end < now ? "past" : e.start <= now ? "now" : "";
    const time = e.allDay ? "All day" : `${fmt(e.start)} – ${fmt(e.end)}`;
    return `<li class="${cls}"><div class="time">${time}</div><div><div class="title">${esc(e.title || "(No title)")}</div>${e.location ? `<div class="loc">${esc(e.location)}</div>` : ""}</div></li>`;
  }).join("");
}

async function load() {
  const url = await store.get("calUrl");
  if (!url) { render([], "Tap ⚙ and paste your calendar link to see today's events."); return; }

  // show cached copy instantly, then refresh
  const cache = await store.get("calCache");
  if (cache) render(todaysEvents(parseICS(cache)));
  else render([], "Loading…");

  try {
    const res = await fetch(url.replace(/^webcal:\/\//i, "https://"), { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const text = await res.text();
    await store.set("calCache", text);
    render(todaysEvents(parseICS(text)));
  } catch (err) {
    if (!cache) render([], "Couldn't load the calendar. Check the link under ⚙.");
  }
}
load();
setInterval(() => load(), 10 * 60 * 1000);
