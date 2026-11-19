// ---------- world clocks ----------
const ZONES = [["Paris", "Europe/Paris"], ["London", "Europe/London"], ["New York", "America/New_York"]];
function zones() {
  const now = new Date();
  $("zones").innerHTML = ZONES.map(([n, tz]) =>
    `<span><b>${n}</b>${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: tz })}</span>`).join("");
}
zones();
setInterval(zones, 30 * 1000);

// ---------- weather (Open-Meteo, no key needed) ----------
const WMO = { 0: "☀️ Clear", 1: "🌤 Mostly clear", 2: "⛅ Partly cloudy", 3: "☁️ Cloudy", 45: "🌫 Fog", 48: "🌫 Fog",
  51: "🌦 Drizzle", 53: "🌦 Drizzle", 55: "🌦 Drizzle", 61: "🌧 Rain", 63: "🌧 Rain", 65: "🌧 Heavy rain",
  71: "🌨 Snow", 73: "🌨 Snow", 75: "🌨 Snow", 80: "🌦 Showers", 81: "🌦 Showers", 82: "⛈ Heavy showers",
  95: "⛈ Storm", 96: "⛈ Storm", 99: "⛈ Storm" };

async function weather() {
  const city = (await store.get("city")) || { name: "Lisbon", lat: 38.72, lon: -9.14 };
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`;
    const w = await (await fetch(u)).json();
    const c = w.current, d = w.daily;
    const rain = d.precipitation_probability_max[0];
    $("weather").textContent = `${WMO[c.weather_code] || "🌡"} · ${Math.round(c.temperature_2m)}° in ${city.name}` +
      ` · ${Math.round(d.temperature_2m_min[0])}–${Math.round(d.temperature_2m_max[0])}°` + (rain >= 40 ? ` · ☂ ${rain}% rain` : "");
  } catch { $("weather").textContent = `Weather in ${city.name} unavailable`; }
}
weather();

$("weather").onclick = async () => { $("city").value = ((await store.get("city")) || {}).name || ""; $("cityForm").hidden = false; $("city").focus(); };
$("cityCancel").onclick = () => ($("cityForm").hidden = true);
$("cityForm").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("city").value.trim(); if (!q) return;
  try {
    const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(q)}`)).json();
    const g = r.results && r.results[0];
    if (!g) { $("city").value = ""; $("city").placeholder = "City not found, try again"; return; }
    await store.set("city", { name: g.name, lat: g.latitude, lon: g.longitude });
    $("cityForm").hidden = true; weather();
  } catch { $("city").placeholder = "Couldn't look that up"; }
};

// ---------- top 3 priorities (reset daily) ----------
async function prios() {
  const today = new Date().toDateString();
  let p = await store.get("prios");
  if (!p || p.day !== today) p = { day: today, items: [{ t: "", d: false }, { t: "", d: false }, { t: "", d: false }] };
  const ol = $("prios");
  const ph = ["Most important thing today", "Second priority", "Third priority"];
  ol.innerHTML = p.items.map((it, i) =>
    `<li class="${it.d ? "done" : ""}"><input type="checkbox" data-i="${i}" ${it.d ? "checked" : ""}>` +
    `<input type="text" data-i="${i}" placeholder="${ph[i]}" value="${esc(it.t)}"></li>`).join("");
  const save = () => store.set("prios", p);
  ol.querySelectorAll("input[type=text]").forEach((el) => el.oninput = () => { p.items[el.dataset.i].t = el.value; save(); });
  ol.querySelectorAll("input[type=checkbox]").forEach((el) => el.onchange = () => {
    p.items[el.dataset.i].d = el.checked; el.parentElement.classList.toggle("done", el.checked); save();
  });
  await save();
}
prios();
