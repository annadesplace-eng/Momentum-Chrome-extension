// ---------- daily background photo ----------
// "london": Wikimedia Commons featured pictures of London (a different one each day)
// "daily":  Bing photo of the day (world's best photography, new every day)
const DAY = new Date().toDateString();
const dayIndex = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60e3) / 864e5);

async function londonList() {
  const c = await store.get("londonList");
  if (c && Date.now() - c.at < 30 * 864e5 && c.items.length) return c.items;
  const items = []; let cont = {};
  for (let i = 0; i < 6; i++) {
    const q = new URLSearchParams({ action: "query", format: "json", origin: "*", generator: "categorymembers",
      gcmtitle: "Category:Featured pictures of London", gcmtype: "file", gcmlimit: "500",
      prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: "2560", iiextmetadatafilter: "Artist|ObjectName", ...cont });
    const j = await (await fetch("https://commons.wikimedia.org/w/api.php?" + q)).json();
    for (const p of Object.values((j.query || {}).pages || {})) {
      const ii = p.imageinfo && p.imageinfo[0]; if (!ii) continue;
      const r = ii.width / ii.height;
      if (r < 1.3 || r > 2.4 || ii.width < 1600) continue; // landscape, not super-wide panoramas
      const m = ii.extmetadata || {};
      const txt = (v) => (v ? v.value : "").replace(/<[^>]+>/g, "").trim();
      const name = txt(m.ObjectName) || p.title.replace(/^File:|\.\w+$/g, "");
      items.push({ url: ii.thumburl || ii.url, caption: name, credit: txt(m.Artist), link: ii.descriptionurl });
    }
    if (!j.continue) break; cont = j.continue;
  }
  items.sort((a, b) => a.url.localeCompare(b.url));
  if (items.length) await store.set("londonList", { at: Date.now(), items });
  return items;
}

async function bingToday() {
  const j = await (await fetch("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-GB")).json();
  const im = j.images[0];
  const [caption, credit] = im.copyright.split(/\s*\(©\s*/);
  return { url: "https://www.bing.com" + im.urlbase + "_UHD.jpg", caption, credit: (credit || "").replace(/\)$/, ""), link: im.copyrightlink };
}

function applyBg(p) {
  const img = new Image();
  img.onload = () => {
    document.body.style.backgroundImage = `linear-gradient(rgba(10,10,30,.35), rgba(10,10,30,.55)), url("${p.url}")`;
    document.body.classList.add("photo");
  };
  img.src = p.url;
  const cr = $("credit");
  cr.innerHTML = `<a href="${esc(p.link || p.url)}" target="_blank" rel="noopener">${esc(p.caption || "")}</a>` +
    (p.credit ? `<span> · © ${esc(p.credit.slice(0, 60))}</span>` : "");
}

async function background(force) {
  const mode = (await store.get("bgMode")) || "london";
  document.querySelectorAll("#bgMode button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
  const cached = await store.get("bgToday");
  if (!force && cached && cached.day === DAY && cached.mode === mode) return applyBg(cached.photo);
  try {
    let photo;
    if (mode === "daily") photo = await bingToday();
    else { const l = await londonList(); photo = l[dayIndex % l.length]; }
    if (!photo) return;
    await store.set("bgToday", { day: DAY, mode, photo });
    applyBg(photo);
  } catch { if (cached) applyBg(cached.photo); } // offline: keep last photo, else the built-in sunset
}

document.querySelectorAll("#bgMode button").forEach((b) => b.onclick = async () => {
  await store.set("bgMode", b.dataset.m); background(true);
});
background();
