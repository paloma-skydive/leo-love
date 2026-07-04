"use strict";

const $ = (id) => document.getElementById(id);
let BABY = null;
let IS_PARENT = false;
let APPROVAL_MODE = false;
let ALL_POSTS = [];
let FAMILY = [];
let feedFilter = null;
let feedSort = "newest";
let shuffleOrder = [];
let renderedFeedSig = null;   // signature of the posts currently drawn in the DOM
let pendingFeedRefresh = false; // a refresh is waiting for a playing video to stop

const PROMPTS = [
  "Share a baby photo of Luke or Dana\u2014let's see who Leo takes after.",
  "Post a family tradition or game you can't wait for Leo to join in on.",
  "See something that made you think of Leo? Film a quick video and share it.",
  "Share a mum meme to make Dana laugh after a rough night.",
  "Drop your best (or worst) parenting advice.",
  "What adventure are you planning for when Leo's big and strong?",
  "Read Leo a bedtime story on video\u2014his mum & dad can play it to him.",
  "Post a photo of where you are right now, so Leo sees his family's world.",
  "Record a quick hello so Leo knows your voice.",
  "Share a song you'll sing to Leo one day.",
  "Who does Leo remind you of? Tell him.",
  "Send Luke & Dana a quick message for today.",
];

// ---------- Clocks ----------
function fmtTime(tz) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz,
    }).format(new Date()).replace(" ", "").toLowerCase();
  } catch { return "--:--"; }
}
function shortTz(tz) {
  if (!tz) return "You";
  const city = tz.split("/").pop().replace(/_/g, " ");
  return city;
}
let localTz = "";

// The places Leo's family are scattered across. Cayman is home (Leo & parents).
const FAMILY_ZONES = [
  { flag: "\u{1F1F0}\u{1F1FE}", label: "Cayman", tz: "America/Cayman", home: true },
  { flag: "\u{1F1F3}\u{1F1FF}", label: "NZ", tz: "Pacific/Auckland" },
  { flag: "\u{1F1E6}\u{1F1FA}", label: "AUS", tz: "Australia/Sydney" },
  { flag: "\u{1F1EF}\u{1F1F5}", label: "Japan", tz: "Asia/Tokyo" },
];

function worldZones() {
  const zones = FAMILY_ZONES.slice();
  // Add the visitor's own zone as a "You" pill, unless they're already in a
  // family zone (same current UTC offset as one we already show).
  if (localTz) {
    const off = (tz) => { try { return new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value; } catch { return tz; } };
    const mine = off(localTz);
    const already = zones.some((z) => off(z.tz) === mine);
    if (!already) zones.push({ flag: "\u{1F4CD}", label: "You", tz: localTz, you: true });
  }
  return zones;
}

function renderWorldClocks() {
  const track = $("worldclocks");
  if (!track) return;
  const zones = worldZones();
  track.innerHTML = zones
    .map(
      (z, i) =>
        `<div class="wc-pill${z.home ? " wc-home" : ""}${z.you ? " wc-you" : ""}">` +
        `<span class="wc-flag">${z.flag}</span>` +
        `<span class="wc-label">${escapeHtml(z.label)}</span>` +
        `<span class="wc-time" data-tz="${escapeHtml(z.tz)}">--:--</span>` +
        `</div>`
    )
    .join("");
  tickClocks();
}

function tickClocks() {
  const track = $("worldclocks");
  if (!track) return;
  track.querySelectorAll(".wc-time").forEach((el) => {
    el.textContent = fmtTime(el.dataset.tz);
  });
}
function tickAge() {
  if (!BABY) return;
  const born = new Date(BABY.bornISO).getTime();
  const now = Date.now();
  let ms = Math.max(0, now - born);
  const day = 86400000, hr = 3600000, min = 60000;
  const d = Math.floor(ms / day); ms -= d * day;
  const h = Math.floor(ms / hr); ms -= h * hr;
  const m = Math.floor(ms / min);
  const dl = d === 1 ? "day" : "days";
  const hl = h === 1 ? "hr" : "hrs";
  $("age-pill").innerHTML = `Leo is <b>${d}</b> ${dl}, <b>${h}</b> ${hl}, <b>${m}</b> min young`;
}

// ---------- Views ----------
function setView(v) {
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  $("view-" + v).classList.remove("hidden");
  document.querySelectorAll("[data-view]").forEach((a) => {
    if (a.classList.contains("brand")) return;
    a.classList.toggle("active", a.dataset.view === v);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (v === "timeline") loadMilestones();
  if (v === "family") loadFamily();
  if (v === "feed") requestAnimationFrame(() => setTimeout(updateFilterArrows, 40));
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-view]");
  if (a) { e.preventDefault(); setView(a.dataset.view); }
});

// ---------- Time-ago ----------
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? " min ago" : " mins ago");
  const h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? " hr ago" : " hrs ago");
  const d = Math.floor(h / 24); if (d < 7) return d + (d === 1 ? " day ago" : " days ago");
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
const AV = ["#EB2832", "#356CC0", "#1c1a17", "#9A7B2E"];
function avatarColor(name) {
  let h = 0; for (const c of (name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV[h % AV.length];
}
function flag(loc) { return loc === "cayman" ? "\u{1F1F0}\u{1F1FE}" : loc === "nz" ? "\u{1F1F3}\u{1F1FF}" : loc === "australia" ? "\u{1F1E6}\u{1F1FA}" : loc === "japan" ? "\u{1F1EF}\u{1F1F5}" : ""; }
function personLabel(p) { return p.title && p.title.trim() ? p.title.trim() : p.relation; }

// ---------- Name matching (tag free-text post names to family people) ----------
function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function personTokens(p) {
  const toks = [p.name, p.title, ...(p.aliases || [])].map(norm).filter((t) => t && t.length >= 3);
  return [...new Set(toks)];
}
function matchesTokens(author, tokens) {
  const a = norm(author);
  if (!a) return false;
  return tokens.some((t) => a.includes(t) || t.includes(a));
}
function personForAuthor(author) {
  for (const p of FAMILY) {
    if (p.id === "leo" || p.role === "pet") continue;
    if (matchesTokens(author, personTokens(p))) return p;
  }
  return null;
}

// ---------- Family filter cards on the feed ----------
function renderFeedFilters() {
  const wrap = $("feed-filters");
  if (!wrap) return;
  const outer = $("feed-filters-wrap");
  const posters = [...new Set(ALL_POSTS.map((p) => (p.author || "").trim()).filter(Boolean))];
  if (posters.length < 2) { wrap.innerHTML = ""; if (outer) outer.hidden = true; return; }
  if (outer) outer.hidden = false;
  // group posters by matched family person (so "Nana" + "Nana Jacki" become one chip)
  const groups = []; // {key,label,tokens}
  const seen = {};
  for (const name of posters) {
    const p = personForAuthor(name);
    const key = p ? "p:" + p.id : "a:" + name.toLowerCase();
    if (seen[key]) continue;
    seen[key] = 1;
    groups.push(p
      ? { key, label: p.name.split(" ")[0], tokens: personTokens(p) }
      : { key, label: name.split(" ")[0], tokens: [norm(name)] });
  }
  const isOn = (key) => feedFilter && feedFilter.key === key;
  let html = `<button type="button" class="fam-chip ${!feedFilter ? "on" : ""}" data-key=""><span class="fc-av" style="background:var(--ink)">\u2728</span><span class="fc-name">Everyone</span></button>`;
  for (const g of groups) {
    html += `<button type="button" class="fam-chip ${isOn(g.key) ? "on" : ""}" data-key="${escapeHtml(g.key)}"><span class="fc-av" style="background:${avatarColor(g.label)}">${escapeHtml((g.label[0] || "?").toUpperCase())}</span><span class="fc-name">${escapeHtml(g.label)}</span></button>`;
  }
  wrap.innerHTML = html;
  wrap.querySelectorAll(".fam-chip").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.key;
    feedFilter = key ? groups.find((g) => g.key === key) || null : null;
    renderFeedFilters(); renderFeed();
  }));
  setTimeout(updateFilterArrows, 30);
}

function updateFilterArrows() {
  const row = $("feed-filters"), prev = $("ff-prev"), next = $("ff-next");
  if (!row || !prev || !next) return;
  const overflow = row.scrollWidth - row.clientWidth > 4;
  prev.hidden = !overflow || row.scrollLeft <= 2;
  next.hidden = !overflow || row.scrollLeft >= row.scrollWidth - row.clientWidth - 2;
}

function setupFilterArrows() {
  const row = $("feed-filters"), prev = $("ff-prev"), next = $("ff-next");
  if (!row) return;
  const step = () => Math.max(140, row.clientWidth * 0.7);
  if (prev) prev.addEventListener("click", () => row.scrollBy({ left: -step(), behavior: "smooth" }));
  if (next) next.addEventListener("click", () => row.scrollBy({ left: step(), behavior: "smooth" }));
  row.addEventListener("scroll", updateFilterArrows, { passive: true });
  window.addEventListener("resize", updateFilterArrows);
}

// ---------- Feed ----------
// A lightweight signature of the feed's content. Two loads with the same
// signature mean nothing visible changed, so we can leave the DOM (and any
// playing videos) completely untouched. Comments are deliberately excluded so a
// new comment never tears the whole feed down.
function feedSig(posts) {
  return (posts || [])
    .map((p) => `${p.id}:${p.mediaFile || ""}:${p.caption || ""}:${p.author || ""}`)
    .join("|");
}

// Is a video in the feed actually playing right now? If so, a rebuild would snap
// it back to the start — so we hold off until it's paused or finished.
function feedVideosPlaying() {
  return [...document.querySelectorAll("#feed-list video")].filter(
    (v) => !v.paused && !v.ended && v.readyState > 2
  );
}

// When we've deferred a refresh, re-run it once the video the family was
// watching has stopped.
function flushPendingFeed() {
  if (!pendingFeedRefresh) return;
  if (feedVideosPlaying().length) return; // something else is still playing
  pendingFeedRefresh = false;
  renderFeedFilters();
  renderFeed();
}

async function loadFeed() {
  const r = await fetch("/api/feed");
  if (!r.ok) return;
  const { posts } = await r.json();
  const sig = feedSig(posts);

  // Nothing changed since what's on screen — refresh the data but don't touch the
  // DOM, so videos keep playing and comment boxes keep their focus/text.
  if (sig === renderedFeedSig && $("feed-list").children.length) {
    ALL_POSTS = posts;
    return;
  }

  ALL_POSTS = posts;

  // There's a real change, but if someone's mid-video, don't yank it out from
  // under them. Stash the update and apply it the moment the video stops.
  const playing = feedVideosPlaying();
  if (playing.length && $("feed-list").children.length) {
    pendingFeedRefresh = true;
    playing.forEach((v) => {
      v.addEventListener("pause", flushPendingFeed, { once: true });
      v.addEventListener("ended", flushPendingFeed, { once: true });
    });
    return;
  }

  renderFeedFilters();
  renderFeed();
}

function renderFeed() {
  const list = $("feed-list");
  let posts = ALL_POSTS.slice();
  if (feedFilter && feedFilter.tokens) posts = posts.filter((p) => matchesTokens(p.author, feedFilter.tokens));
  if (feedSort === "shuffle") {
    // Order by a fixed shuffle rolled when Shuffle was tapped, so auto-refresh
    // doesn't reshuffle under them. New posts (not in the order) fall to the end.
    const idx = (id) => { const i = shuffleOrder.indexOf(id); return i === -1 ? 1e9 : i; };
    posts.sort((a, b) => idx(a.id) - idx(b.id));
  } else {
    posts.sort((a, b) => {
      const d = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return feedSort === "oldest" ? d : -d;
    });
  }
  list.innerHTML = "";
  $("feed-empty").classList.toggle("hidden", posts.length > 0);
  for (const p of posts) {
    const card = document.createElement("article");
    const hasMedia = !!p.mediaFile;
    card.className = hasMedia ? "card" : "card card-text";
    const src = `/media/${p.mediaFile}`;
    const media = p.mediaType === "video"
      ? `<video src="${src}#t=0.1" playsinline preload="metadata" muted></video><span class="play-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>`
      : `<img src="${src}" alt="" />`;
    const initial = (p.author || "?").trim().charAt(0).toUpperCase() || "?";
    const col = avatarColor(p.author || "?");
    const capClass = hasMedia ? "card-caption" : "card-caption card-caption-text";
    let cap = "";
    if (p.fromMilestone && p.title) {
      // Milestone cards: title reads as a header, story sits below it.
      const body = p.body ? `<p class="${capClass}" tabindex="0" title="Tap to read it all">${escapeHtml(p.body)}</p>` : "";
      cap = `<h4 class="card-ms-title">${escapeHtml(p.title)}</h4>${body}`;
    } else if (p.caption) {
      cap = `<p class="${capClass}" tabindex="0" title="Tap to read it all">${escapeHtml(p.caption)}</p>`;
    }
    const where = p.posterTz ? " \u00b7 " + shortTz(p.posterTz) : "";
    const badge = p.fromMilestone ? `<span class="ms-badge">\u2728 Milestone</span>` : "";
    // Milestone-derived cards share the milestone's own comment thread.
    const cType = p.fromMilestone ? "milestone" : "post";
    const cId = p.fromMilestone ? p.milestoneId : p.id;
    const mediaBlock = hasMedia
      ? `<div class="card-media" role="button" tabindex="0" data-lightbox="${src}" data-type="${p.mediaType}" data-caption="${escapeHtml(p.caption || "")}" data-author="${escapeHtml(p.author || "Someone")}">${media}${badge}</div>`
      : "";
    card.innerHTML = `
      ${mediaBlock}
      <div class="card-body">
        <div class="card-head">
          <div class="avatar" style="background:${col}">${escapeHtml(initial)}</div>
          <div>
            <div class="card-who">${escapeHtml(p.author || "Someone")}</div>
            <div class="card-when">${timeAgo(p.createdAt)}${where}</div>
          </div>
        </div>
        ${cap}
        <div class="comments-mount" data-type="${cType}" data-id="${escapeHtml(cId)}"></div>
      </div>`;
    list.appendChild(card);
    mountComments(card.querySelector(".comments-mount"));
  }
  // Flag captions that are actually truncated so we can show a clear
  // "…more" affordance (esp. on video tiles where the text is easy to miss).
  requestAnimationFrame(() => {
    list.querySelectorAll(".card-caption").forEach((c) => {
      if (c.classList.contains("expanded")) return;
      c.classList.toggle("clamped", c.scrollHeight - c.clientHeight > 4);
    });
  });
  // Remember what's now drawn, so the next auto-refresh can tell if anything
  // actually changed before rebuilding (and interrupting any playing video).
  renderedFeedSig = feedSig(ALL_POSTS);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function currentName() {
  return (localStorage.getItem("leo_author") || "").trim();
}
function rememberName(n) {
  if (n && n.trim()) localStorage.setItem("leo_author", n.trim());
}

// Parent who-picker (Dana / Luke) used in the timeline forms
function setupWhoPicker(wrapId) {
  const wrap = $(wrapId);
  if (!wrap || wrap.dataset.wired) return;
  wrap.dataset.wired = "1";
  const saved = localStorage.getItem("leo_parent_who") || "";
  wrap.querySelectorAll(".who-btn").forEach((b) => {
    if (b.dataset.who === saved) b.classList.add("on");
    b.addEventListener("click", () => {
      wrap.querySelectorAll(".who-btn").forEach((x) => x.classList.toggle("on", x === b));
      localStorage.setItem("leo_parent_who", b.dataset.who);
      // mirror selection to the other picker if present
      document.querySelectorAll(".who-pick").forEach((w) => {
        w.querySelectorAll(".who-btn").forEach((x) => x.classList.toggle("on", x.dataset.who === b.dataset.who));
      });
    });
  });
}
function whoValue(wrapId) {
  const on = $(wrapId)?.querySelector(".who-btn.on");
  return on ? on.dataset.who : "";
}

// ---------- Comments ----------
async function mountComments(mount) {
  if (!mount) return;
  const type = mount.dataset.type, id = mount.dataset.id;
  let comments = [];
  try {
    const r = await fetch(`/api/comments?targetType=${encodeURIComponent(type)}&targetId=${encodeURIComponent(id)}`);
    if (r.ok) comments = (await r.json()).comments || [];
  } catch {}
  renderComments(mount, comments);
}

function renderComments(mount, comments) {
  const type = mount.dataset.type, id = mount.dataset.id;
  // Name field starts BLANK — on a shared family feed we don't want it
  // pre-filled with whoever commented last.
  const name = "";
  const items = comments.map((c) => {
    const col = avatarColor(c.author || "?");
    const initial = (c.author || "?").trim().charAt(0).toUpperCase() || "?";
    return `<div class="comment">
      <div class="cav" style="background:${col}">${escapeHtml(initial)}</div>
      <div class="comment-main">
        <div><span class="comment-who">${escapeHtml(c.author || "Someone")}</span><span class="comment-when">${timeAgo(c.createdAt)}</span></div>
        <p class="comment-text">${escapeHtml(c.text)}</p>
      </div>
    </div>`;
  }).join("");

  mount.innerHTML = `
    <button type="button" class="comments-toggle" aria-expanded="false">
      <span class="ct-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></span>
      <span class="ct-label">${comments.length ? comments.length + (comments.length === 1 ? " comment" : " comments") : "Add a comment"}</span>
      <span class="ct-chev" aria-hidden="true"></span>
    </button>
    <div class="comments hidden">
      ${comments.length ? `<div class="comment-list">${items}</div>` : ""}
      ${comments.length ? `<button type="button" class="comment-add-btn">+ Add a comment</button>` : ""}
      <div class="comment-form${comments.length ? " hidden" : ""}">
        <input class="cf-name" type="text" placeholder="Name" value="${escapeHtml(name)}" maxlength="80" />
        <input class="cf-text" type="text" placeholder="Add a comment…" maxlength="1500" />
        <button class="comment-send" type="button">Post</button>
      </div>
    </div>`;

  const toggle = mount.querySelector(".comments-toggle");
  const panel = mount.querySelector(".comments");
  const addBtn = mount.querySelector(".comment-add-btn");
  const form = mount.querySelector(".comment-form");
  toggle.addEventListener("click", () => {
    const nowOpen = panel.classList.toggle("hidden") === false;
    toggle.setAttribute("aria-expanded", String(nowOpen));
    toggle.classList.toggle("open", nowOpen);
    // With no comments yet, opening goes straight to composing.
    if (nowOpen && !comments.length) setTimeout(() => mount.querySelector(".cf-text")?.focus(), 30);
  });
  // "Add a comment" reveals the compose form (so viewing isn't the same as composing).
  if (addBtn) addBtn.addEventListener("click", () => {
    form.classList.remove("hidden"); addBtn.classList.add("hidden");
    setTimeout(() => mount.querySelector(".cf-name")?.focus(), 30);
  });

  const nameEl = mount.querySelector(".cf-name");
  const textEl = mount.querySelector(".cf-text");
  const send = async () => {
    const author = nameEl.value.trim();
    const text = textEl.value.trim();
    if (!author) { nameEl.focus(); return; }
    if (!text) { textEl.focus(); return; }
    const btn = mount.querySelector(".comment-send");
    btn.disabled = true;
    try {
      const r = await fetch("/api/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: type, targetId: id, author, text }),
      });
      // Snap the comment box back to its collapsed state after posting
      // (the fresh render is closed by default and shows the new count).
      if (r.ok) { textEl.value = ""; await mountComments(mount); }
    } finally { btn.disabled = false; }
  };
  mount.querySelector(".comment-send").addEventListener("click", send);
  textEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
}

// ---------- Milestones ----------
async function loadMilestones() {
  const r = await fetch("/api/milestones");
  if (!r.ok) return;
  const { milestones } = await r.json();
  const el = $("timeline-list");
  el.innerHTML = "";
  for (const m of milestones) {
    const d = document.createElement("div");
    d.className = "ms";
    const by = m.author ? `<div class="ms-date" style="margin-top:6px">added by ${escapeHtml(m.author)}</div>` : "";
    const msrc = `/media/${escapeHtml(m.mediaFile || "")}`;
    const mcap = escapeHtml(m.title || "");
    const media = m.mediaFile
      ? (m.mediaType === "video"
          ? `<div class="ms-media" role="button" tabindex="0" data-lightbox="${msrc}" data-type="video" data-caption="${mcap}"><video src="${msrc}#t=0.1" playsinline preload="metadata" muted></video><span class="play-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></div>`
          : `<div class="ms-media" role="button" tabindex="0" data-lightbox="${msrc}" data-type="image" data-caption="${mcap}"><img src="${msrc}" alt="" /></div>`)
      : "";
    d.innerHTML = `
      <div class="ms-card">
        <div class="ms-date">${escapeHtml(m.dateText || "")}</div>
        <div class="ms-title">${m.emoji ? `<span class="ms-emoji">${escapeHtml(m.emoji)}</span> ` : ""}${escapeHtml(m.title || "")}</div>
        ${m.body ? `<p class="ms-body">${escapeHtml(m.body)}</p>` : ""}
        ${media}
        ${by}
        <div class="comments-mount" data-type="milestone" data-id="${escapeHtml(m.id)}"></div>
      </div>`;
    el.appendChild(d);
    mountComments(d.querySelector(".comments-mount"));
  }
}

// ---------- Composer ----------
let chosenFile = null;
let posterKind = "";        // family | friend | newfamily
function setupComposer() {
  const author = $("author");
  setupWhoPicker();

  $("file").addEventListener("change", (e) => {
    chosenFile = e.target.files[0] || null;
    const prev = $("preview");
    prev.innerHTML = "";
    if (!chosenFile) { prev.classList.add("hidden"); $("filepick-label").innerHTML = "\u{1F4F7}  Choose a photo or video"; return; }
    $("filepick-label").textContent = chosenFile.name;
    const url = URL.createObjectURL(chosenFile);
    if (chosenFile.type.startsWith("video/")) {
      prev.innerHTML = `<video src="${url}" controls playsinline></video>`;
    } else {
      prev.innerHTML = `<img src="${url}" alt="preview" />`;
    }
    prev.classList.remove("hidden");
  });

  $("post-btn").addEventListener("click", submitPost);

  // prompts
  let pIdx = Math.floor(Math.random() * PROMPTS.length);
  const showPrompt = () => { $("prompt-text").textContent = PROMPTS[pIdx % PROMPTS.length]; };
  showPrompt();
  $("prompt-shuffle").addEventListener("click", () => { pIdx++; showPrompt(); });
}

// ---- "Who's posting?" picker (custom dropdown, styled to match the site) ----
// Family self-select from the tree (exact tag), a friend (feed only, off tree),
// or a new family member (self-identifies + we surface them to add to the tree).
function whoPersonName(p) {
  const t = (p.title && p.title.trim()) ? p.title.trim() : "";
  return t && t.toLowerCase() !== p.name.toLowerCase() ? `${p.name} (${t})` : p.name;
}
async function ensureFamilyLoaded() {
  if (FAMILY.length) return;
  try { const r = await fetch("/api/family"); if (r.ok) FAMILY = (await r.json()).family || []; } catch {}
}
function closeWhoMenu() {
  const menu = $("who-menu"), btn = $("who-btn");
  if (menu) menu.classList.add("hidden");
  if (btn) btn.setAttribute("aria-expanded", "false");
}
async function buildWhoMenu() {
  const menu = $("who-menu");
  if (!menu) return;
  await ensureFamilyLoaded();
  const people = FAMILY.filter((p) => p.id !== "leo" && p.role !== "pet");
  const famItems = people.map((p) =>
    `<button type="button" class="who-opt" role="option" data-kind="family" data-id="${p.id}">${escapeHtml(whoPersonName(p))}</button>`
  ).join("");
  menu.innerHTML =
    `<div class="who-group-label">Family</div>${famItems}` +
    `<div class="who-sep"></div>` +
    `<button type="button" class="who-opt who-opt-alt" role="option" data-kind="friend">A friend of Luke &amp; Dana</button>` +
    `<button type="button" class="who-opt who-opt-alt" role="option" data-kind="newfamily">Family \u2014 not on the tree yet</button>`;
  menu.querySelectorAll(".who-opt").forEach((o) =>
    o.addEventListener("click", () => chooseWho(o.dataset.kind, o.dataset.id, o.textContent.trim()))
  );
}
function chooseWho(kind, id, label) {
  const nameEl = $("author"), relEl = $("who-relation"), btnLabel = $("who-btn-label");
  posterKind = kind;
  btnLabel.textContent = label;
  btnLabel.classList.remove("placeholder");
  if (kind === "family") {
    const p = FAMILY.find((x) => x.id === id);
    nameEl.value = p ? ((p.title && p.title.trim()) || p.name) : "";
    nameEl.classList.add("hidden"); relEl.classList.add("hidden");
  } else if (kind === "friend") {
    nameEl.value = ""; nameEl.classList.remove("hidden"); relEl.classList.add("hidden");
    setTimeout(() => nameEl.focus(), 20);
  } else if (kind === "newfamily") {
    nameEl.value = ""; nameEl.classList.remove("hidden"); relEl.classList.remove("hidden");
    setTimeout(() => nameEl.focus(), 20);
  }
  closeWhoMenu();
}
function setupWhoPicker() {
  const btn = $("who-btn"), menu = $("who-menu");
  if (!btn || !menu) return;
  buildWhoMenu();
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const open = menu.classList.contains("hidden");
    if (open) { await buildWhoMenu(); menu.classList.remove("hidden"); btn.setAttribute("aria-expanded", "true"); }
    else closeWhoMenu();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#composer-who")) closeWhoMenu();
  });
}

function submitPost() {
  const status = $("post-status");
  const author = $("author").value.trim();
  const caption = $("caption").value.trim();
  const relation = ($("who-relation")?.value || "").trim();
  if (!chosenFile) { status.className = "post-status err"; status.textContent = "Pick a photo or video first \u{1F60A}"; return; }
  if (!posterKind) { status.className = "post-status err"; status.textContent = "Let us know who's posting \u{1F642}"; return; }
  if (!author) { status.className = "post-status err"; status.textContent = "Add your name so Leo knows who it's from."; return; }

  const btn = $("post-btn");
  btn.disabled = true;
  status.className = "post-status";
  status.innerHTML = 'Sending\u2026<div class="bar"><i id="pbar"></i></div>';

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/upload");
  xhr.setRequestHeader("Content-Type", chosenFile.type || "application/octet-stream");
  xhr.setRequestHeader("X-Filename", encodeURIComponent(chosenFile.name));
  xhr.setRequestHeader("X-Author", author.replace(/[^\x20-\x7E]/g, ""));
  xhr.setRequestHeader("X-Caption", encodeURIComponent(caption));
  xhr.setRequestHeader("X-Tz", localTz);
  if (posterKind) xhr.setRequestHeader("X-Kind", posterKind);
  if (posterKind === "newfamily" && relation) xhr.setRequestHeader("X-Relation", encodeURIComponent(relation));
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) { const b = $("pbar"); if (b) b.style.width = (e.loaded / e.total * 100) + "%"; }
  };
  xhr.upload.onload = () => {
    // bytes are up; server now processes (transcode/convert) before responding
    status.innerHTML = 'Polishing it up\u2026 (videos can take a moment)';
  };
  xhr.onload = () => {
    btn.disabled = false;
    if (xhr.status === 200) {
      status.className = "post-status ok";
      status.textContent = "Sent with love \u{1F90D}";
      $("caption").value = ""; $("file").value = ""; chosenFile = null;
      $("preview").innerHTML = ""; $("preview").classList.add("hidden");
      $("filepick-label").innerHTML = "\u{1F4F7}  Choose a photo or video";
      // Reset the who-picker back to its prompt.
      posterKind = "";
      if ($("who-btn-label")) { $("who-btn-label").textContent = "Who\u2019s posting? Choose your name\u2026"; $("who-btn-label").classList.add("placeholder"); }
      $("author").value = ""; $("author").classList.add("hidden");
      if ($("who-relation")) { $("who-relation").value = ""; $("who-relation").classList.add("hidden"); }
      loadFeed();
      setTimeout(() => { status.textContent = ""; status.className = "post-status"; }, 3500);
    } else {
      status.className = "post-status err";
      try { status.textContent = JSON.parse(xhr.responseText).error || "Something went wrong."; }
      catch { status.textContent = "Something went wrong sending that."; }
    }
  };
  xhr.onerror = () => { btn.disabled = false; status.className = "post-status err"; status.textContent = "Connection hiccup\u2014try again."; };
  xhr.send(chosenFile);
}

// ---------- Boot ----------
async function boot() {
  try { localTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { localTz = ""; }
  renderWorldClocks();

  const r = await fetch("/api/session");
  const data = await r.json();
  BABY = data.baby;
  IS_PARENT = !!data.parent;
  APPROVAL_MODE = !!data.approvalMode;

  // "?for=parents" funnel: Luke & Dana arriving via their guide link.
  const forParents = new URLSearchParams(location.search).get("for") === "parents";
  if (forParents) {
    const sub = $("login-sub");
    if (sub) sub.textContent = "Welcome, Mum & Dad. Pop in the family password first, then your parent code, and we\u2019ll open your private guide.";
  }

  if (!data.authed) {
    PENDING_PARENT = forParents;
    $("login").classList.remove("hidden");
    $("app").classList.add("hidden");
    return;
  }
  // Approval mode: every family-password visitor lands on the guide first, until
  // they choose “Enter Leo’s page” (which sets leoGuideSeen on the guide page).
  if (APPROVAL_MODE && !localStorage.getItem("leoGuideSeen")) {
    location.href = "/guide.html";
    return;
  }
  // Already a recognised parent: send them to their guide first (once).
  if (IS_PARENT && !localStorage.getItem("leoGuideSeen")) {
    location.href = "/guide.html";
    return;
  }
  // Authed but not yet identified as a parent, and they came via the parent link.
  if (forParents && !IS_PARENT) {
    showParentGate();
    return;
  }
  startApp();
}

let msFile = null;
function setupMilestoneForm() {
  setupWhoPicker("ms-who");
  const btn = $("ms-save");
  if (btn.dataset.wired) return;
  btn.dataset.wired = "1";

  // file picker for milestone media
  const fileEl = $("ms-file");
  if (fileEl) fileEl.addEventListener("change", (e) => {
    msFile = e.target.files[0] || null;
    const prev = $("ms-preview");
    prev.innerHTML = "";
    if (!msFile) { prev.classList.add("hidden"); $("ms-filepick-label").innerHTML = "\u{1F4F7}  Add a photo or video (optional)"; return; }
    $("ms-filepick-label").textContent = msFile.name;
    const url = URL.createObjectURL(msFile);
    prev.innerHTML = msFile.type.startsWith("video/") ? `<video src="${url}" controls playsinline></video>` : `<img src="${url}" alt="preview" />`;
    prev.classList.remove("hidden");
  });

  btn.addEventListener("click", async () => {
    const status = $("ms-status");
    const date = $("ms-date").value;
    const time = $("ms-time").value;
    const title = $("ms-title").value.trim();
    const body = $("ms-body").value.trim();
    const emoji = $("ms-emoji").value.trim();
    const author = whoValue("ms-who");
    if (!date) { status.className = "post-status err"; status.textContent = "Pick a date first."; return; }
    if (!title) { status.className = "post-status err"; status.textContent = "Give it a short title."; return; }
    if (!author) { status.className = "post-status err"; status.textContent = "Tap Dana or Luke."; return; }
    if (!author) { status.className = "post-status err"; status.textContent = "Tap Dana or Luke."; return; }
    btn.disabled = true;
    status.className = "post-status"; status.textContent = msFile ? "Uploading\u2026" : "Adding\u2026";
    try {
      let mediaFile = "", mediaType = "";
      if (msFile) {
        const up = await fetch("/api/milestone-media", {
          method: "POST",
          headers: { "Content-Type": msFile.type || "application/octet-stream", "X-Filename": encodeURIComponent(msFile.name) },
          body: msFile,
        });
        if (up.ok) { const ud = await up.json(); mediaFile = ud.mediaFile; mediaType = ud.mediaType; }
        else { const ud = await up.json().catch(() => ({})); status.className = "post-status err"; status.textContent = ud.error || "Couldn\u2019t upload that."; btn.disabled = false; return; }
      }
      const r = await fetch("/api/milestones", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time, title, body, emoji, author, mediaFile, mediaType }),
      });
      if (r.ok) {
        status.className = "post-status ok"; status.textContent = "Added to Leo\u2019s timeline \u2728";
        $("ms-title").value = ""; $("ms-body").value = ""; $("ms-emoji").value = ""; $("ms-time").value = "";
        $("ms-file").value = ""; msFile = null; $("ms-preview").innerHTML = ""; $("ms-preview").classList.add("hidden");
        $("ms-filepick-label").innerHTML = "\u{1F4F7}  Add a photo or video (optional)";
        await loadMilestones();
        setTimeout(() => { $("timeline-add").removeAttribute("open"); status.textContent = ""; status.className = "post-status"; }, 1400);
      } else {
        const d = await r.json().catch(() => ({}));
        status.className = "post-status err"; status.textContent = d.error || "Couldn\u2019t add that.";
      }
    } catch {
      status.className = "post-status err"; status.textContent = "Connection hiccup\u2014try again.";
    } finally { btn.disabled = false; }
  });
}

function setupTimelineTabs() {
  const tabs = document.querySelectorAll(".tl-tab");
  if (!tabs.length || tabs[0].dataset.wired) return;
  tabs.forEach((t) => {
    t.dataset.wired = "1";
    t.addEventListener("click", () => {
      tabs.forEach((x) => x.classList.toggle("active", x === t));
      $("tab-quick").classList.toggle("hidden", t.dataset.tab !== "quick");
      $("tab-milestone").classList.toggle("hidden", t.dataset.tab !== "milestone");
    });
  });
}

function startApp() {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  setupComposer();
  setupMilestoneForm();
  setupTimelineTabs();
  setupCheckin();
  setupSort();
  setupEmailSignup();
  setupIntroToggle();
  setupFilterArrows();
  setupInfoTips();
  setupLightbox();
  loadFamily();
  loadFeed();
  renderWorldClocks(); tickAge();
  setInterval(tickClocks, 1000 * 10);
  setInterval(tickAge, 1000 * 30);
  setInterval(loadFeed, 1000 * 45);
  const hash = location.hash.replace("#", "");
  if (["timeline", "family"].includes(hash)) setView(hash);
}

function setupSort() {
  document.querySelectorAll(".sort-btn").forEach((b) => b.addEventListener("click", () => {
    feedSort = b.dataset.sort;
    // (Re)roll the shuffle each time Shuffle is tapped.
    if (feedSort === "shuffle") {
      shuffleOrder = ALL_POSTS.map((p) => p.id);
      for (let i = shuffleOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
      }
    }
    document.querySelectorAll(".sort-btn").forEach((x) => x.classList.toggle("active", x === b));
    renderFeed();
  }));
}

// ---------- Family tree ----------
const GEN_LABELS = {
  1: "Mum & Dad", 2: "Grandparents", 7: "Great-Grandma", 8: "Great-Aunties & Uncle", 3: "Aunties & Uncles", 4: "Cousins", 5: "Cousins & wider clan", 6: "And of course\u2026",
};
const TITLE_SUGGESTIONS = {
  grandma: ["Nana", "Granny", "Gran", "Grandma", "Nan", "Oma", "Mimi"],
  grandad: ["Poppa", "Grandad", "Pop", "Gramps", "Opa", "Pa"],
};

async function loadFamily() {
  try {
    const r = await fetch("/api/family");
    if (!r.ok) return;
    FAMILY = (await r.json()).family;
    renderFamily();
    if (ALL_POSTS.length) renderFeedFilters();
  } catch {}
}

function renderFamily() {
  const root = $("family-tree");
  if (!root) return;
  // Leo first (centre), then by generation
  const leo = FAMILY.find((p) => p.id === "leo");
  let html = "";
  if (leo) {
    html += `<div class="fam-gen"><div class="fam-row">${famCard(leo)}</div></div>`;
  }
  for (const gen of [1, 2, 7, 8, 3, 4, 5, 6]) {
    const people = FAMILY.filter((p) => p.gen === gen);
    if (!people.length) continue;
    html += `<div class="fam-gen"><p class="fam-gen-label">${GEN_LABELS[gen] || ""}</p><div class="fam-row">${people.map(famCard).join("")}</div></div>`;
  }
  root.innerHTML = html;
  root.querySelectorAll(".fam-card").forEach((c) => c.addEventListener("click", () => onFamilyCard(c.dataset.id)));
}

// Family members with a photo avatar (cropped from their video hello). Others
// keep their coloured initial circle.
// Family cards are plain coloured circles now (Amy's call) — no photo avatars.
const AVATAR_IDS = new Set([]);
const AVATAR_VER = 1;

function famCard(p) {
  const cls = `fam-card${p.id === "leo" ? " leo" : ""}`;
  const av = p.role === "pet" ? "\u{1F436}" : (p.name[0] || "?").toUpperCase();
  const bg = p.id === "leo" ? "var(--red)" : avatarColor(p.name);
  const avInner = AVATAR_IDS.has(p.id)
    ? `<img class="av-photo" src="/img/avatars/${p.id}.jpg?v=${AVATAR_VER}" alt="${escapeHtml(p.name)}" loading="lazy" />`
    : av;
  return `<button type="button" class="${cls}" data-id="${p.id}">
    <span class="av-lg${AVATAR_IDS.has(p.id) ? " has-photo" : ""}" style="background:${bg}">${avInner}</span>
    <span class="fam-name">${escapeHtml(p.name)}</span>
    <span class="fam-rel">${escapeHtml(personLabel(p))} ${flag(p.location)}</span>
    ${p.qualifier ? `<span class="fam-qual">${escapeHtml(p.qualifier)}</span>` : ""}
  </button>`;
}

function onFamilyCard(id) {
  const p = FAMILY.find((x) => x.id === id);
  if (!p) return;
  if (p.id === "leo" || p.role === "pet") return;
  // otherwise: filter the feed to their posts (matches their name, title & nicknames)
  feedFilter = { key: "p:" + p.id, label: p.name.split(" ")[0], tokens: personTokens(p) };
  setView("feed");
  setTimeout(() => { renderFeedFilters(); renderFeed(); }, 60);
}

function openTitleEditor(p) {
  // remove any existing editor
  document.querySelectorAll(".title-editor").forEach((e) => e.remove());
  const kind = p.relation.toLowerCase().includes("grandad") || p.relation.toLowerCase().includes("grandpa") ? "grandad" : "grandma";
  const sugg = TITLE_SUGGESTIONS[kind];
  const ed = document.createElement("div");
  ed.className = "title-editor";
  ed.innerHTML = `
    <h3>What will Leo call ${escapeHtml(p.name)}?</h3>
    <p class="composer-help">Pick your special grandparent name, or type your own.</p>
    <div class="title-chips">${sugg.map((s) => `<button type="button" class="chip" data-t="${s}">${s}</button>`).join("")}</div>
    <div class="title-row">
      <input class="field" id="title-input" type="text" placeholder="e.g. Nana Jacki" maxlength="40" value="${escapeHtml(p.title || "")}" />
      <button class="btn btn-blue" id="title-save" type="button">Save</button>
    </div>
    <div id="title-status" class="post-status"></div>`;
  // insert after the tapped card's generation row
  $("family-tree").appendChild(ed);
  ed.scrollIntoView({ behavior: "smooth", block: "center" });
  ed.querySelectorAll(".title-chips .chip").forEach((c) => c.addEventListener("click", () => { $("title-input").value = c.dataset.t; }));
  $("title-save").addEventListener("click", async () => {
    const title = $("title-input").value.trim();
    const st = $("title-status");
    st.className = "post-status"; st.textContent = "Saving\u2026";
    try {
      const r = await fetch("/api/family/title", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, title }),
      });
      if (r.ok) { await loadFamily(); }
      else { const d = await r.json().catch(() => ({})); st.className = "post-status err"; st.textContent = d.error || "Couldn't save."; }
    } catch { st.className = "post-status err"; st.textContent = "Connection hiccup\u2014try again."; }
  });
}

// ---------- Quick update (consolidated single chip group) ----------
function setupCheckin() {
  const btn = $("ci-save");
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";
  const today = new Date().toISOString().slice(0, 10);
  $("ci-date").value = today;
  setupWhoPicker("ci-who");

  // one gentle category, multi-select
  $("chips-moment").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    c.classList.toggle("on");
  });

  btn.addEventListener("click", async () => {
    const status = $("ci-status");
    const picks = [...$("chips-moment").querySelectorAll(".chip.on")];
    const date = $("ci-date").value;
    const weight = $("ci-weight").value.trim();
    const note = $("ci-note").value.trim();
    const author = whoValue("ci-who");
    if (!date) { status.className = "post-status err"; status.textContent = "Pick a date."; return; }
    if (!picks.length && !note && !weight) { status.className = "post-status err"; status.textContent = "Tap at least one thing \u{1F60A}"; return; }
    if (!author) { status.className = "post-status err"; status.textContent = "Tap Dana or Luke."; return; }

    const words = picks.map((c) => c.dataset.word);
    const emoji = picks.length ? picks[0].dataset.emoji : "\u2728";
    let title = "A little note on today";
    if (words.length) {
      const joined = words.length === 1 ? words[0]
        : words.slice(0, -1).join(", ") + " and " + words[words.length - 1];
      title = "Today Leo was " + joined;
    }
    const parts = [];
    if (weight) parts.push(`Weighing in at ${weight}.`);
    if (note) parts.push(note);
    const body = parts.join(" ");

    btn.disabled = true; status.className = "post-status"; status.textContent = "Posting\u2026";
    try {
      const r = await fetch("/api/milestones", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, title, body, emoji, author }),
      });
      if (r.ok) {
        status.className = "post-status ok"; status.textContent = "Posted \u2728";
        [...document.querySelectorAll("#chips-moment .chip")].forEach((c) => c.classList.remove("on"));
        $("ci-weight").value = ""; $("ci-note").value = "";
        await loadMilestones();
        setTimeout(() => { $("timeline-add").removeAttribute("open"); status.textContent = ""; }, 1400);
      } else {
        const d = await r.json().catch(() => ({}));
        status.className = "post-status err"; status.textContent = d.error || "Couldn\u2019t post that.";
      }
    } catch { status.className = "post-status err"; status.textContent = "Connection hiccup\u2014try again."; }
    finally { btn.disabled = false; }
  });
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("login-err");
  err.textContent = "";
  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: $("pw").value }),
  });
  if (r.ok) {
    $("login").classList.add("hidden");
    // Approval mode: first thing L&D see after the password is their guide.
    if (APPROVAL_MODE) { try { localStorage.removeItem("leoGuideSeen"); } catch (e) {} location.href = "/guide.html"; return; }
    if (PENDING_PARENT) { showParentGate(); }
    else { startApp(); }
  }
  else { const d = await r.json().catch(() => ({})); err.textContent = d.error || "That didn't work."; $("pw").select(); }
});

// ---------- Parent-code gate (funnels Luke & Dana to their private guide) ----------
let PENDING_PARENT = false;
function showParentGate() {
  $("login").classList.add("hidden");
  $("app").classList.add("hidden");
  $("parent-gate").classList.remove("hidden");
  setTimeout(() => $("pg-code")?.focus(), 50);
}
async function parentGateGo() {
  const err = $("pg-err"); err.textContent = "";
  const code = $("pg-code").value;
  try {
    const r = await fetch("/api/parent-login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (r.ok) { IS_PARENT = true; localStorage.removeItem("leoGuideSeen"); location.href = "/guide.html"; }
    else { const d = await r.json().catch(() => ({})); err.textContent = d.error || "That code didn\u2019t match."; $("pg-code").select(); }
  } catch { err.textContent = "Connection hiccup\u2014try again."; }
}
$("pg-go")?.addEventListener("click", parentGateGo);
$("pg-code")?.addEventListener("keydown", (e) => { if (e.key === "Enter") parentGateGo(); });
$("pg-skip")?.addEventListener("click", (e) => { e.preventDefault(); $("parent-gate").classList.add("hidden"); PENDING_PARENT = false; startApp(); });

// ---------- Email signup (get news about Leo by email) ----------
function emailCardHTML(compact) {
  const name = escapeHtml(localStorage.getItem("leo_author") || localStorage.getItem("leo_email_name") || "");
  const email = escapeHtml(localStorage.getItem("leo_email") || "");
  return `
    <div class="email-card email-card-slim">
      <div class="ec-form">
        <div class="ec-lead">
          <span class="ec-title">\u{1F4EC} Get an email when there&rsquo;s news of Leo</span>
        </div>
        <div class="ec-row">
          <input class="field ec-name" type="text" placeholder="Your name" maxlength="80" value="${name}" />
          <input class="field ec-email" type="email" placeholder="you@email.com" maxlength="160" value="${email}" />
          <button type="button" class="btn btn-red ec-go">Keep me posted \u{1F49B}</button>
        </div>
        <div class="ec-status post-status"></div>
      </div>
      <div class="ec-done hidden">
        <div class="ec-done-tick" aria-hidden="true">\u{1F49B}</div>
        <h3 class="ec-done-title">You&rsquo;re all set!</h3>
        <p class="ec-done-sub"></p>
        <button type="button" class="ec-off">Turn these emails off</button>
      </div>
    </div>`;
}

function wireEmailCard(card) {
  const formEl = card.querySelector(".ec-form");
  const doneEl = card.querySelector(".ec-done");
  const doneSub = card.querySelector(".ec-done-sub");
  const nameEl = card.querySelector(".ec-name");
  const emailEl = card.querySelector(".ec-email");
  const status = card.querySelector(".ec-status");

  function showDone(msg) {
    doneSub.innerHTML = msg;
    formEl.classList.add("hidden");
    doneEl.classList.remove("hidden");
  }
  function showAlready(first) {
    // Distinct "we already have you" greeting (e.g. Amy pre-added them).
    const doneTitle = card.querySelector(".ec-done-title");
    if (doneTitle) doneTitle.textContent = "You\u2019re already on the list!";
    showDone(
      (first ? `Hi ${escapeHtml(first)} \u2014 ` : "") +
      `good news, you\u2019re already set to hear about Leo. We\u2019ll email you whenever there\u2019s something new. \u{1F49B}`
    );
  }
  function showForm() {
    doneEl.classList.add("hidden");
    formEl.classList.remove("hidden");
    status.textContent = "";
    status.className = "ec-status post-status";
    const doneTitle = card.querySelector(".ec-done-title");
    if (doneTitle) doneTitle.textContent = "You\u2019re all set!";
  }

  // If this browser has already signed up, greet them with the confirmation.
  if (localStorage.getItem("leo_email_on") === "1" && localStorage.getItem("leo_email")) {
    showDone("We&rsquo;ll email you whenever there&rsquo;s something new about Leo. \u{1F49B}");
  }

  // Proactive check: when someone types an email we already have on the list
  // (e.g. Amy pre-added them), flip straight to the "already on the list" state
  // so they don't re-enter details they don't need to.
  let lastChecked = "";
  async function checkExisting() {
    const email = (emailEl.value || "").trim().toLowerCase();
    if (email === lastChecked) return;
    lastChecked = email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    try {
      const r = await fetch("/api/subscribe/me?email=" + encodeURIComponent(email));
      const d = await r.json().catch(() => ({}));
      if (d.subscriber && d.subscriber.on) {
        localStorage.setItem("leo_email", email);
        localStorage.setItem("leo_email_on", "1");
        if (d.subscriber.name) localStorage.setItem("leo_email_name", d.subscriber.name);
        const first = (d.subscriber.name || "").split(/\s+/)[0];
        showAlready(first);
      }
    } catch {}
  }
  emailEl.addEventListener("change", checkExisting);
  emailEl.addEventListener("blur", checkExisting);

  async function submit(offMode) {
    const email = (emailEl.value || "").trim();
    const name = (nameEl.value || "").trim();
    if (!offMode && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      status.className = "ec-status post-status err";
      status.textContent = "Pop in an email address first \u{1F60A}";
      return;
    }
    status.className = "ec-status post-status";
    status.textContent = offMode ? "Turning them off\u2026" : "Signing you up\u2026";
    try {
      const useEmail = offMode ? (localStorage.getItem("leo_email") || email) : email;
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: useEmail, name, freq: offMode ? "off" : "instant" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        status.className = "ec-status post-status err";
        status.textContent = d.error || "That didn\u2019t work\u2014try again?";
        return;
      }
      if (offMode) {
        localStorage.setItem("leo_email_on", "0");
        showForm();
        status.className = "ec-status post-status ok";
        status.textContent = "Done \u2014 you won\u2019t get any more emails.";
        return;
      }
      localStorage.setItem("leo_email", email);
      localStorage.setItem("leo_email_on", "1");
      if (name) localStorage.setItem("leo_email_name", name);
      const first = name ? name.split(/\s+/)[0] : (localStorage.getItem("leo_email_name") || "").split(/\s+/)[0];
      if (d.already) {
        showAlready(first);
      } else {
        showDone(
          (first ? `Thanks, ${escapeHtml(first)} \u2014 ` : "") +
          `we&rsquo;ll email you whenever there&rsquo;s something new about Leo. \u{1F49B}`
        );
      }
    } catch {
      status.className = "ec-status post-status err";
      status.textContent = "Connection hiccup\u2014try again.";
    }
  }
  card.querySelector(".ec-go").addEventListener("click", () => submit(false));
  card.querySelector(".ec-off").addEventListener("click", () => submit(true));
}

// ---------- Lightbox (tap a photo/video to view it big, blurred backdrop) ----------
function openLightbox({ src, type, caption, author }) {
  const lb = $("lightbox");
  const stage = $("lb-stage");
  stage.innerHTML = type === "video"
    ? `<video src="${src}" controls playsinline autoplay></video>`
    : `<img src="${src}" alt="" />`;
  $("lb-author").textContent = author || "";
  $("lb-caption").textContent = caption || "";
  $("lb-caption").style.display = caption ? "" : "none";
  lb.classList.remove("hidden");
  lb.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeLightbox() {
  const lb = $("lightbox");
  if (lb.classList.contains("hidden")) return;
  const v = lb.querySelector("video");
  if (v) { try { v.pause(); } catch (e) {} }
  $("lb-stage").innerHTML = "";
  lb.classList.add("hidden");
  lb.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}
function setupLightbox() {
  if (document.body.dataset.lbWired) return;
  document.body.dataset.lbWired = "1";
  const lb = $("lightbox");
  lb.querySelector(".lb-close").addEventListener("click", closeLightbox);
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.classList.contains("lb-inner")) closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

  // Delegated: open lightbox on any media tile; toggle caption on caption tap.
  document.addEventListener("click", (e) => {
    const tile = e.target.closest(".card-media[data-lightbox], .ms-media[data-lightbox]");
    if (tile) {
      openLightbox({
        src: tile.dataset.lightbox,
        type: tile.dataset.type || (tile.querySelector("video") ? "video" : "image"),
        caption: tile.dataset.caption || "",
        author: tile.dataset.author || "",
      });
      return;
    }
    const cap = e.target.closest(".card-caption");
    if (cap) { cap.classList.toggle("expanded"); if (cap.classList.contains("expanded")) cap.classList.remove("clamped"); }
  });
}

function setupEmailSignup() {
  const feed = document.getElementById("email-signup-feed");
  if (feed && !feed.dataset.wired) {
    feed.innerHTML = emailCardHTML(true);
    wireEmailCard(feed);
    feed.dataset.wired = "1";
  }
}

// ---------- Section info popups (ⓘ brief instructions per section) ----------
// Replaces the old standalone Guide: each section heading has a small ⓘ that
// shows a one-line instruction on hover (desktop) or tap (touch).
function setupIntroToggle() {
  const section = $("intro-section");
  const btn = $("intro-toggle");
  if (!section || !btn) return;
  const apply = (collapsed) => {
    section.classList.toggle("collapsed", collapsed);
    btn.setAttribute("aria-expanded", String(!collapsed));
    btn.textContent = collapsed ? "Show welcome & post" : "Hide welcome";
  };
  // Default expanded on first visit; remember the reader's choice after that.
  apply(localStorage.getItem("leoWelcomeCollapsed") === "1");
  btn.addEventListener("click", () => {
    const collapsed = !section.classList.contains("collapsed");
    apply(collapsed);
    try { localStorage.setItem("leoWelcomeCollapsed", collapsed ? "1" : "0"); } catch (e) {}
  });
}

function setupInfoTips() {
  const tips = [...document.querySelectorAll(".info-tip")];
  tips.forEach((tip) => {
    if (tip.dataset.wired) return;
    tip.dataset.wired = "1";
    const btn = tip.querySelector(".info-btn");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wasOpen = tip.classList.contains("open");
      tips.forEach((t) => t.classList.remove("open")); // one at a time
      if (!wasOpen) tip.classList.add("open");
    });
  });
  // Tap/click anywhere outside a tip closes any open tip.
  if (!document.body.dataset.infoTipDismiss) {
    document.body.dataset.infoTipDismiss = "1";
    document.addEventListener("click", (e) => {
      if (e.target && e.target.closest && e.target.closest(".info-tip")) return;
      document.querySelectorAll(".info-tip.open").forEach((t) => t.classList.remove("open"));
    });
  }
}

boot();
