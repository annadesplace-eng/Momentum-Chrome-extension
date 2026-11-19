// ---------- daily brief: fashion business, trends, startups ----------
const FEEDS = {
  "Fashion business": [
    ["BoF", "https://www.businessoffashion.com/arc/outboundfeeds/rss/?outputType=xml"],
    ["WWD", "https://wwd.com/feed/"],
    ["Glossy", "https://www.glossy.co/feed/"],
  ],
  "Trends": [
    ["Fashionista", "https://fashionista.com/.rss/full/"],
    ["Hypebeast", "https://hypebeast.com/feed"],
  ],
  "Startups": [
    ["Sifted", "https://sifted.eu/feed"],
    ["TechCrunch", "https://techcrunch.com/category/startups/feed/"],
  ],
};
const CACHE_MIN = 30;
let NEWS = {}; let TAB = null;

const strip = (h = "") => { const d = new DOMParser().parseFromString(h, "text/html"); return (d.body.textContent || "").replace(/\s+/g, " ").trim(); };

async function fetchFeed([source, url]) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status);
  const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
  return [...xml.querySelectorAll("item")].slice(0, 25).map((it) => {
    const g = (t) => (it.getElementsByTagName(t)[0] || {}).textContent || "";
    return { source, title: strip(g("title")), link: g("link").trim(), date: new Date(g("pubDate") || g("dc:date")).getTime() || 0, snip: strip(g("description")).slice(0, 220) };
  });
}

async function loadNews(force = false) {
  const cached = await store.get("news");
  if (cached && !force && Date.now() - cached.at < CACHE_MIN * 60e3) { NEWS = cached.data; return showNews(); }
  if (cached) { NEWS = cached.data; showNews(); } else $("headlines").innerHTML = `<li class="empty">Loading today's brief…</li>`;
  const data = {};
  await Promise.all(Object.entries(FEEDS).map(async ([cat, feeds]) => {
    const lists = await Promise.all(feeds.map((f) => fetchFeed(f).catch(() => [])));
    data[cat] = lists.flat().sort((a, b) => b.date - a.date);
  }));
  if (Object.values(data).some((l) => l.length)) { NEWS = data; await store.set("news", { at: Date.now(), data }); }
  showNews();
}

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60e3);
  if (!t || m < 0) return ""; if (m < 2) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

// Words and pairs that show up across several of today's headlines
const STOP = new Set(("a an the and or but of in on at to for from with by as is are was were be been it its this that these those " +
  "new how why what who when where your you we our their they his her he she not no more most than over into about after before up out " +
  "says said will can could just get gets has have had do does all one two three first year years week day today now here there " +
  "show shows report reports exclusive inside behind make makes making launch launches launched brand brands fashion startup startups " +
  "best top like vs via amid could would should also may still big set back off " +
  "next looks look buy buys race betting bets enters enter announces announce award awards team teams key raise raises raised " +
  "watch companies company playbook sales sale growth take takes go goes named names name try tries plans plan win wins winning " +
  "hit hits see sees add adds open opens drop drops kind need needs moment ceo strong annual jump jumps lift lifts rise rises " +
  "deal deals help helps turn turns way ways time times people world global inc ltd co here’s heres via exclusive opinion " +
  "first-look meet everything know things thing guide gift gifts").split(" "));

function hotTopics() {
  const day = Date.now() - 36 * 3600e3;
  const items = Object.values(NEWS).flat().filter((i) => i.date > day);
  const count = new Map();
  for (const it of items) {
    const words = it.title.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9à-ÿ&\- ]/g, " ").split(/\s+/).filter(Boolean);
    const seen = new Set(); const src = it.source;
    words.forEach((w, i) => {
      if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)) seen.add(w);
      const n = words[i + 1];
      if (n && !STOP.has(w) && !STOP.has(n) && w.length > 1 && n.length > 1) seen.add(w + " " + n);
    });
    seen.forEach((k) => { if (!count.has(k)) count.set(k, new Set()); count.get(k).add(src); });
  }
  // keep terms that at least two different publications are writing about
  let top = [...count].map(([k, s]) => [k, s.size]).filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].split(" ").length - a[0].split(" ").length);
  // drop a word or pair when a pair overlapping it is already listed
  const kept = [];
  for (const [k] of top) if (!kept.some((p) => p.split(" ").some((w) => k.split(" ").includes(w)))) kept.push(k);
  top = kept.map((k) => [k]);
  return top.slice(0, 7).map(([k]) => k.replace(/\b\w/g, (c) => c.toUpperCase()));
}

function showNews() {
  const cats = Object.keys(FEEDS);
  if (!TAB) TAB = cats[0];
  $("tabs").innerHTML = cats.map((c) => `<button class="${c === TAB ? "on" : ""}" data-c="${c}">${c}</button>`).join("");
  $("tabs").querySelectorAll("button").forEach((b) => b.onclick = () => { TAB = b.dataset.c; showNews(); });

  const t = hotTopics();
  $("topics").innerHTML = t.length ? `<span class="label">Talked about today:</span>` + t.map((x) => `<span class="chip">${esc(x)}</span>`).join("") : "";

  const list = (NEWS[TAB] || []).slice(0, 15);
  $("headlines").innerHTML = list.length ? list.map((i) =>
    `<li><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a>` +
    `<div class="src">${esc(i.source)}${i.date ? " · " + ago(i.date) : ""}</div>` +
    (i.snip && i.snip !== i.title ? `<div class="snip">${esc(i.snip)}</div>` : "") + `</li>`).join("")
    : `<li class="empty">No stories loaded. Check your connection and press ↻.</li>`;
}

$("refresh").onclick = () => loadNews(true);
loadNews();
