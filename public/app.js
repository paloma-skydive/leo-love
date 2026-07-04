"use strict";

const $ = (id) => document.getElementById(id);
let BABY = null;
let IS_PARENT = false;
let APPROVAL_MODE = false;
let ALL_POSTS = [];
let FAMILY = [];
let MILESTONES = [];
let feedFilter = null;
// Default landing view scatters milestones evenly through the grid (rather than
// clumping them at the bottom by their June dates). Newest/Oldest go strict-date.
let feedSort = "curated";

// Pencil icon for the parent-only edit control on posts/milestones.
const PENCIL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
let shuffleOrder = [];
let renderedFeedSig = null;   // signature of the posts currently drawn in the DOM
let pendingFeedRefresh = false; // a refresh is waiting for a playing video to stop

const PROMPTS = [
  "Share a baby photo of Luke or Dana\u2014let's see who Leo takes after.",
  "Post a family tradition or game you can't wait for Leo to join in on.",
  "See something that made you think of Leo? Film a quick video and share it.",
  "Drop your best (or worst) parenting advice.",
  "What adventure are you planning for when Leo's big and strong?",
  "Read Leo a bedtime story on video\u2014his mum & dad can play it to him.",
  "Post a photo of where you are right now, so Leo sees his family's world.",
  "Record a quick hello so Leo knows your voice.",
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
  if (v === "feed") requestAnimationFrame(() => setTimeout(() => { updateFilterArrows(); flagClampedCaptions(); }, 40));
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

// Eased, custom-duration horizontal glide (native "smooth" jumps too fast/hard
// on short rows — this makes the filter arrows feel like a gentle slide).
function glideScroll(el, delta, duration = 480) {
  if (el._gliding) cancelAnimationFrame(el._gliding);
  const start = el.scrollLeft;
  const max = el.scrollWidth - el.clientWidth;
  const target = Math.max(0, Math.min(max, start + delta));
  const dist = target - start;
  if (!dist) return;
  const t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2); // easeInOutQuad
  const step = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    el.scrollLeft = start + dist * ease(t);
    if (t < 1) el._gliding = requestAnimationFrame(step);
    else el._gliding = null;
  };
  el._gliding = requestAnimationFrame(step);
}
function setupFilterArrows() {
  const row = $("feed-filters"), prev = $("ff-prev"), next = $("ff-next");
  if (!row) return;
  // A gentle nudge — about two-thirds of the visible row, so chips slide into view
  // rather than leaping a whole screen at a time.
  const step = () => Math.max(160, row.clientWidth * 0.66);
  if (prev) prev.addEventListener("click", () => glideScroll(row, -step()));
  if (next) next.addEventListener("click", () => glideScroll(row, step()));
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

// Stable pseudo-random key from an id (so a "scatter" looks random but never
// changes between renders / auto-refreshes).
function hashId(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Spread milestones evenly through the family posts. Family posts stay newest-first;
// milestones are interleaved at even intervals (in a stable pseudo-random order),
// so they're scattered across the grid rather than clumped at the bottom by date.
function scatterFeed(posts) {
  const fam = posts.filter((p) => !p.fromMilestone)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const ms = posts.filter((p) => p.fromMilestone)
    .sort((a, b) => hashId(a.id) - hashId(b.id));
  if (!ms.length) return fam;
  if (!fam.length) return ms;
  const total = fam.length + ms.length;
  const step = total / ms.length;
  const out = [];
  let fi = 0, mi = 0, nextMs = step / 2;
  for (let i = 0; i < total; i++) {
    if (mi < ms.length && i >= Math.floor(nextMs)) { out.push(ms[mi++]); nextMs += step; }
    else if (fi < fam.length) out.push(fam[fi++]);
    else if (mi < ms.length) out.push(ms[mi++]);
  }
  return out;
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
  } else if (feedSort === "curated") {
    // Default view: keep the server's hand-curated order (FEED_ORDER) exactly as
    // returned — no client-side reordering.
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
    card.className = "card";
    const src = `/media/${p.mediaFile}`;
    const media = p.mediaType === "video"
      ? `<video src="${src}#t=0.1" playsinline preload="metadata" muted></video><span class="play-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>`
      : `<img src="${src}" alt="" />`;
    const initial = (p.author || "?").trim().charAt(0).toUpperCase() || "?";
    const col = avatarColor(p.author || "?");
    // Media cards keep the caption in the body below the photo. Text-only cards
    // (copy milestones + text posts) carry their message on a brand-coloured tile
    // instead, so every card is the same height and the grid lines stay even.
    let cap = "";
    if (hasMedia && p.fromMilestone && p.title) {
      const body = p.body ? `<p class="card-caption" tabindex="0" title="Tap to read it all">${escapeHtml(p.body)}</p>` : "";
      cap = `<h4 class="card-ms-title">${escapeHtml(p.title)}</h4>${body}`;
    } else if (hasMedia && p.caption) {
      cap = `<p class="card-caption" tabindex="0" title="Tap to read it all">${escapeHtml(p.caption)}</p>`;
    }
    const where = p.posterTz ? shortTz(p.posterTz) : "";
    // Milestones keep their date stamp; family posts show no date (just location if
    // any) so the grid reads cleanly on first view.
    let whenText;
    if (p.fromMilestone) {
      whenText = escapeHtml(p.dateText || "");
      if (where) whenText += (whenText ? " \u00b7 " : "") + where;
    } else {
      whenText = where;
    }
    const badge = p.fromMilestone ? `<span class="ms-badge">\u2728 Milestone</span>` : "";
    // Milestone-derived cards share the milestone's own comment thread.
    const cType = p.fromMilestone ? "milestone" : "post";
    const cId = p.fromMilestone ? p.milestoneId : p.id;
    const extra = mediaList(p).length - 1;
    const countBadge = extra > 0 ? `<span class="media-count" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M4 6h12v10H4z" opacity=".5"/><path d="M8 4h12v12H8z"/></svg> +${extra}</span>` : "";
    const msLbAttrs = p.fromMilestone ? ` data-emoji="${escapeHtml(p.emoji || "")}" data-title="${escapeHtml(p.title || "")}" data-body="${escapeHtml(p.body || "")}"` : "";
    let mediaBlock;
    if (hasMedia) {
      mediaBlock = `<div class="card-media" role="button" tabindex="0" data-lightbox="${src}" data-type="${p.mediaType}" data-caption="${escapeHtml(p.caption || "")}" data-author="${escapeHtml(p.author || "Someone")}"${msLbAttrs}>${media}${badge}${countBadge}</div>`;
    } else {
      // Brand-coloured text tile (fixed height like a photo/video tile). Tap opens
      // the lightbox to read the whole thing.
      const tint = ["card-tile-red", "card-tile-blue", "card-tile-yellow"][hashId(p.id) % 3];
      const tileInner = p.fromMilestone
        ? `${p.emoji ? `<span class="tile-emoji">${escapeHtml(p.emoji)}</span>` : ""}<h4 class="tile-title">${escapeHtml(p.title || "")}</h4>${p.body ? `<p class="tile-body">${escapeHtml(p.body)}</p>` : ""}`
        : `<p class="tile-quote">${escapeHtml(p.caption || "")}</p>`;
      mediaBlock = `<div class="card-media card-tile ${tint}" role="button" tabindex="0" data-lightbox="" data-type="text" data-caption="${escapeHtml(p.caption || "")}" data-author="${escapeHtml(p.author || "Someone")}"${msLbAttrs}><div class="tile-inner">${tileInner}</div>${badge}</div>`;
    }
    // Parents (Luke & Dana) get a small pencil to fix their own posts/milestones.
    const editBtn = IS_PARENT
      ? `<button type="button" class="edit-btn" data-edit-kind="${p.fromMilestone ? "milestone" : "post"}" data-edit-id="${escapeHtml(p.fromMilestone ? p.milestoneId : p.id)}" aria-label="Edit" title="Edit">${PENCIL_SVG}</button>`
      : "";
    card.innerHTML = `
      ${mediaBlock}
      <div class="card-body">
        <div class="card-head">
          <div class="avatar" style="background:${col}">${escapeHtml(initial)}</div>
          <div>
            <div class="card-who">${escapeHtml(p.author || "Someone")}</div>
            <div class="card-when">${whenText}</div>
          </div>
          ${editBtn}
        </div>
        ${cap}
        <div class="comments-mount" data-type="${cType}" data-id="${escapeHtml(cId)}"></div>
      </div>`;
    list.appendChild(card);
    mountComments(card.querySelector(".comments-mount"));
  }
  // Flag captions that are actually truncated and give them a clean "Read more"
  // link below (no messy half-faded words trailing across cards). Runs now and
  // again shortly after, so it's reliable even if layout/fonts settle late.
  flagClampedCaptions();
  requestAnimationFrame(flagClampedCaptions);
  setTimeout(flagClampedCaptions, 250);
  // Remember what's now drawn, so the next auto-refresh can tell if anything
  // actually changed before rebuilding (and interrupting any playing video).
  renderedFeedSig = feedSig(ALL_POSTS);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Give any truncated feed caption a clean "Read more" link below it. Idempotent
// and safe to call repeatedly (it adds/removes as truncation state changes).
function flagClampedCaptions() {
  const list = $("feed-list");
  if (!list) return;
  // Don't measure while the feed is hidden or laid out at zero height (e.g. the
  // user switched to Milestones/Family, or a transition is mid-flight). A zero
  // measurement reads every caption as "not truncated" and would wrongly strip the
  // Read more buttons — the bug where Read more vanished after interacting elsewhere.
  if (!list.offsetParent || list.clientHeight === 0) return;
  list.querySelectorAll(".card-caption").forEach((c) => {
    if (c.classList.contains("expanded")) return;
    if (c.clientHeight === 0) return;   // caption not laid out yet — don't touch it
    const clamped = c.scrollHeight - c.clientHeight > 4;
    c.classList.toggle("clamped", clamped);
    const next = c.nextElementSibling;
    const hasMore = next && next.classList.contains("cap-more");
    if (clamped && !hasMore) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cap-more";
      btn.textContent = "Read more";
      c.insertAdjacentElement("afterend", btn);
    } else if (!clamped && hasMore) {
      next.remove();
    }
  });
}

// Normalise a milestone/post's media into an array of {file,type}. Supports both
// the new `media` array and the legacy single mediaFile/mediaType.
function mediaList(m) {
  if (Array.isArray(m.media) && m.media.length) {
    return m.media.filter((x) => x && x.file).map((x) => ({ file: x.file, type: x.type === "video" ? "video" : "image" }));
  }
  if (m.mediaFile) return [{ file: m.mediaFile, type: m.mediaType === "video" ? "video" : "image" }];
  return [];
}

function currentName() {
  return (localStorage.getItem("leo_author") || "").trim();
}
function rememberName(n) {
  if (n && n.trim()) localStorage.setItem("leo_author", n.trim());
}

// Parent who-picker (Dana / Luke) used in the timeline forms
function setupParentPills(wrapId) {
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
  MILESTONES = milestones || [];
  const el = $("timeline-list");
  el.innerHTML = "";
  for (const m of milestones) {
    const d = document.createElement("div");
    d.className = "ms";
    const by = m.author ? `<div class="ms-date" style="margin-top:6px">added by ${escapeHtml(m.author)}</div>` : "";
    const mcap = escapeHtml(m.title || "");
    const mLbAttrs = `data-emoji="${escapeHtml(m.emoji || "")}" data-title="${mcap}" data-body="${escapeHtml(m.body || "")}"`;
    const items = mediaList(m);
    let media = "";
    if (items.length === 1) {
      const it = items[0], msrc = `/media/${escapeHtml(it.file)}`;
      media = it.type === "video"
        ? `<div class="ms-media" role="button" tabindex="0" data-lightbox="${msrc}" data-type="video" ${mLbAttrs}><video src="${msrc}#t=0.1" playsinline preload="metadata" muted></video><span class="play-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></div>`
        : `<div class="ms-media" role="button" tabindex="0" data-lightbox="${msrc}" data-type="image" ${mLbAttrs}><img src="${msrc}" alt="" /></div>`;
    } else if (items.length > 1) {
      const tiles = items.map((it) => {
        const msrc = `/media/${escapeHtml(it.file)}`;
        return it.type === "video"
          ? `<div class="ms-gtile" role="button" tabindex="0" data-lightbox="${msrc}" data-type="video" ${mLbAttrs}><video src="${msrc}#t=0.1" playsinline preload="metadata" muted></video><span class="play-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></div>`
          : `<div class="ms-gtile" role="button" tabindex="0" data-lightbox="${msrc}" data-type="image" ${mLbAttrs}><img src="${msrc}" alt="" /></div>`;
      }).join("");
      media = `<div class="ms-gallery" data-count="${items.length}">${tiles}</div>`;
    }
    const editBtn = IS_PARENT
      ? `<button type="button" class="edit-btn" data-edit-kind="milestone" data-edit-id="${escapeHtml(m.id)}" aria-label="Edit" title="Edit">${PENCIL_SVG}</button>`
      : "";
    d.innerHTML = `
      <div class="ms-card">
        ${editBtn}
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
    `<button type="button" class="who-opt who-opt-alt" role="option" data-kind="friend">Wider Fam + Friends</button>` +
    `<button type="button" class="who-opt who-opt-alt" role="option" data-kind="newfamily">Relative\u2014not on the tree yet</button>`;
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
// ---------- Custom date picker ----------
// Replaces the native <input type="date"> (which can't be styled and drops its
// popup on the wrong side) with an on-brand calendar anchored under the field.
// Writes an ISO yyyy-mm-dd string to the hidden input the forms already read.
const DP_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DP_DOW = ["M","T","W","T","F","S","S"];
function dpPad(n) { return String(n).padStart(2, "0"); }
function dpTodayISO() { const t = new Date(); return `${t.getFullYear()}-${dpPad(t.getMonth() + 1)}-${dpPad(t.getDate())}`; }
function dpFmt(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function setupDatePicker(inputId, defaultToday) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.dpWired) return;
  const wrap = input.closest(".datepick");
  if (!wrap) return;
  input.dataset.dpWired = "1";
  const trigger = wrap.querySelector(".dp-field");
  const valEl = wrap.querySelector(".dp-val");
  let pop = null, view = null;

  function setValue(iso) {
    input.value = iso || "";
    valEl.textContent = iso ? dpFmt(iso) : "Pick a date";
    valEl.classList.toggle("dp-placeholder", !iso);
  }
  function build() {
    const y = view.y, m = view.m;
    let start = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
    const days = new Date(y, m + 1, 0).getDate();
    const todayISO = dpTodayISO(), sel = input.value;
    let cells = "";
    for (let i = 0; i < start; i++) cells += `<span class="dp-day dp-empty"></span>`;
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${dpPad(m + 1)}-${dpPad(d)}`;
      const cls = ["dp-day"];
      if (iso === sel) cls.push("sel");
      if (iso === todayISO) cls.push("today");
      cells += `<button type="button" class="${cls.join(" ")}" data-iso="${iso}">${d}</button>`;
    }
    pop.innerHTML =
      `<div class="dp-head">` +
        `<button type="button" class="dp-nav" data-nav="-1" aria-label="Previous month">\u2039</button>` +
        `<span class="dp-title">${DP_MONTHS[m]} ${y}</span>` +
        `<button type="button" class="dp-nav" data-nav="1" aria-label="Next month">\u203a</button>` +
      `</div>` +
      `<div class="dp-dow">${DP_DOW.map((x) => `<span>${x}</span>`).join("")}</div>` +
      `<div class="dp-days">${cells}</div>` +
      `<div class="dp-foot"><button type="button" class="dp-today">Today</button></div>`;
  }
  function open() {
    if (pop) return;
    pop = document.createElement("div");
    pop.className = "dp-pop";
    const base = input.value ? input.value.split("-").map(Number) : (function () { const t = new Date(); return [t.getFullYear(), t.getMonth() + 1, t.getDate()]; })();
    view = { y: base[0], m: base[1] - 1 };
    build();
    wrap.appendChild(pop);
    trigger.classList.add("open");
  }
  function close() { if (pop) { pop.remove(); pop = null; trigger.classList.remove("open"); } }

  trigger.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); pop ? close() : open(); });
  wrap.addEventListener("click", (e) => {
    if (!pop) return;
    const nav = e.target.closest(".dp-nav");
    if (nav) { e.stopPropagation(); view.m += parseInt(nav.dataset.nav, 10); if (view.m < 0) { view.m = 11; view.y--; } if (view.m > 11) { view.m = 0; view.y++; } build(); return; }
    const day = e.target.closest(".dp-day[data-iso]");
    if (day) { e.stopPropagation(); setValue(day.dataset.iso); close(); return; }
    if (e.target.closest(".dp-today")) { e.stopPropagation(); setValue(dpTodayISO()); close(); return; }
  });
  document.addEventListener("click", (e) => { if (pop && !e.target.closest(".datepick")) close(); });

  if (defaultToday && !input.value) setValue(dpTodayISO());
  else setValue(input.value);
}

function setupMilestoneForm() {
  setupParentPills("ms-who");
  setupDatePicker("ms-date", false);
  const btn = $("ms-save");
  if (btn.dataset.wired) return;
  btn.dataset.wired = "1";

  // Tap-to-pick emoji (so it works on desktop too, where there's no emoji key)
  const eq = $("ms-emoji-quick");
  if (eq) eq.addEventListener("click", (e) => {
    const b = e.target.closest(".eq"); if (!b) return;
    $("ms-emoji").value = b.dataset.emoji;
    eq.querySelectorAll(".eq").forEach((x) => x.classList.toggle("on", x === b));
  });

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
        body: JSON.stringify({ date, title, body, emoji, author, mediaFile, mediaType }),
      });
      if (r.ok) {
        status.className = "post-status ok"; status.textContent = "Added to Leo\u2019s timeline \u2728";
        $("ms-title").value = ""; $("ms-body").value = ""; $("ms-emoji").value = "";
        $("ms-emoji-quick") && $("ms-emoji-quick").querySelectorAll(".eq").forEach((x) => x.classList.remove("on"));
        $("ms-file").value = ""; msFile = null; $("ms-preview").innerHTML = ""; $("ms-preview").classList.add("hidden");
        $("ms-filepick-label").innerHTML = "\u{1F4F7}  Add a photo or video (optional)";
        await loadMilestones(); if (typeof loadFeed === "function") loadFeed();
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

function startApp() {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  setupComposer();
  setupMilestoneForm();
  setupSort();
  setupEmailSignup();
  setupIntroToggle();
  setupFilterArrows();
  setupInfoTips();
  setupLightbox();
  setupEditModal();
  setupParentMode();
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
  // Start the name blank on this shared family feed — pre-filling the last author
  // (e.g. "Amy") made it look like a filled state rather than a fresh resting one.
  const name = "";
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
function openLightbox({ src, type, caption, author, emoji, title, body }) {
  const lb = $("lightbox");
  const stage = $("lb-stage");
  // Text-only card (copy milestone or text post): show the message on a card
  // rather than a media element.
  if (type === "text" || !src) {
    const inner = title
      ? `${emoji ? `<span class="lb-tc-emoji">${escapeHtml(emoji)}</span>` : ""}<h3 class="lb-tc-title">${escapeHtml(title)}</h3>${body ? `<p class="lb-tc-body">${escapeHtml(body)}</p>` : ""}`
      : `<p class="lb-tc-quote">${escapeHtml(caption || "")}</p>`;
    stage.innerHTML = `<div class="lb-textcard">${inner}</div>`;
    $("lb-author").textContent = author || "";
    $("lb-title").style.display = "none";
    $("lb-caption").style.display = "none";
    lb.classList.remove("hidden");
    lb.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    return;
  }
  stage.innerHTML = type === "video"
    ? `<video src="${src}" controls playsinline autoplay></video>`
    : `<img src="${src}" alt="" />`;
  $("lb-author").textContent = author || "";
  const titleEl = $("lb-title");
  const capEl = $("lb-caption");
  if (title) {
    // Milestone: read the title as a header (display type + emoji), story below.
    titleEl.innerHTML = (emoji ? `<span class="lb-emoji">${escapeHtml(emoji)}</span>` : "") + escapeHtml(title);
    titleEl.style.display = "";
    capEl.textContent = body || "";
    capEl.style.display = body ? "" : "none";
  } else {
    titleEl.style.display = "none";
    capEl.textContent = caption || "";
    capEl.style.display = caption ? "" : "none";
  }
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
// ---------- Edit a post / milestone (parents only: Luke & Dana) ----------
let editState = null; // { kind: "post" | "milestone", id }

function showEditError(msg) {
  const e = $("em-error");
  e.textContent = msg; e.classList.remove("hidden");
}
function setEditDate(iso) {
  const input = $("em-date");
  input.value = iso || "";
  const valEl = $("edit-modal").querySelector(".datepick .dp-val");
  if (valEl) {
    valEl.textContent = iso ? dpFmt(iso) : "Pick a date";
    valEl.classList.toggle("dp-placeholder", !iso);
  }
}

async function openEditModal(kind, id) {
  const modal = $("edit-modal");
  const postFields = modal.querySelector(".em-post");
  const msFields = modal.querySelector(".em-ms");
  $("em-error").classList.add("hidden");
  $("em-confirm").classList.add("hidden");
  modal.querySelector(".em-actions").classList.remove("em-modal-hide");
  editState = { kind, id };

  if (kind === "post") {
    const p = ALL_POSTS.find((x) => x.id === id);
    if (!p) return;
    $("em-title").textContent = "Edit post";
    $("em-caption").value = p.caption || "";
    $("em-author").value = p.author || "";
    postFields.classList.remove("hidden");
    msFields.classList.add("hidden");
    $("em-confirm-text").textContent = "Delete this post? It\u2019ll be removed from the feed.";
  } else {
    // Feed cards don't carry dateText/sortISO, so fetch the authoritative record.
    let m = MILESTONES.find((x) => x.id === id);
    if (!m) {
      try {
        const r = await fetch("/api/milestones");
        if (r.ok) { MILESTONES = (await r.json()).milestones || []; m = MILESTONES.find((x) => x.id === id); }
      } catch {}
    }
    if (!m) return;
    $("em-title").textContent = "Edit milestone";
    $("em-emoji").value = m.emoji || "";
    $("em-title-input").value = m.title || "";
    $("em-body").value = m.body || "";
    setEditDate((m.sortISO || "").slice(0, 10));
    const eq = $("em-emoji-quick");
    eq.querySelectorAll(".eq").forEach((b) => b.classList.toggle("on", b.dataset.emoji === (m.emoji || "")));
    postFields.classList.add("hidden");
    msFields.classList.remove("hidden");
    $("em-confirm-text").textContent = "Delete this milestone? It\u2019ll be removed from the timeline and feed.";
  }
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeEditModal() {
  const modal = $("edit-modal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  editState = null;
}

async function refreshAfterEdit() {
  renderedFeedSig = null; // force a rebuild
  await loadFeed();
  if (!$("view-timeline").classList.contains("hidden")) await loadMilestones();
}

async function saveEdit() {
  if (!editState) return;
  const { kind, id } = editState;
  $("em-error").classList.add("hidden");
  const saveBtn = $("em-save");
  saveBtn.disabled = true;
  try {
    let url, body;
    if (kind === "post") {
      url = `/api/posts/${encodeURIComponent(id)}/edit`;
      body = { caption: $("em-caption").value, author: $("em-author").value.trim() };
    } else {
      const title = $("em-title-input").value.trim();
      if (!title) { showEditError("Give the milestone a short title."); saveBtn.disabled = false; return; }
      body = { title, body: $("em-body").value, emoji: $("em-emoji").value.trim() };
      const dateISO = $("em-date").value;
      if (dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
        body.sortISO = new Date(`${dateISO}T12:00:00Z`).toISOString();
        const [y, mo, d] = dateISO.split("-").map(Number);
        body.dateText = `${d} ${MONTHS_FULL[mo - 1]} ${y}`;
      }
      url = `/api/milestones/${encodeURIComponent(id)}/edit`;
    }
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Couldn\u2019t save that."); }
    closeEditModal();
    await refreshAfterEdit();
  } catch (e) {
    showEditError(e.message || "Couldn\u2019t save that.");
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteItem() {
  if (!editState) return;
  const { kind, id } = editState;
  const url = kind === "post"
    ? `/api/posts/${encodeURIComponent(id)}/delete`
    : `/api/milestones/${encodeURIComponent(id)}/delete`;
  const yesBtn = $("em-confirm-yes");
  yesBtn.disabled = true;
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Couldn\u2019t delete that."); }
    closeEditModal();
    await refreshAfterEdit();
  } catch (e) {
    showEditError(e.message || "Couldn\u2019t delete that.");
    yesBtn.disabled = false;
  }
}

// ---------- Parent mode unlock (Luke & Dana) ----------
// Lets a parent flip into edit mode from the page itself (the edit pencils only
// show when IS_PARENT), without being funnelled through the guide.
function reflectParentMode() {
  const btn = $("parent-mode-btn");
  if (!btn) return;
  btn.classList.toggle("on", IS_PARENT);
  btn.textContent = IS_PARENT ? "Parent mode on" : "\u{1F511} Unlock Parent Mode";
}
function setupParentMode() {
  const btn = $("parent-mode-btn");
  const modal = $("parent-unlock");
  if (!btn || !modal || modal.dataset.wired) return;
  modal.dataset.wired = "1";
  reflectParentMode();

  const open = () => {
    if (IS_PARENT) return; // already unlocked
    $("pu-error").classList.add("hidden");
    $("pu-code").value = "";
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setTimeout(() => $("pu-code").focus(), 40);
  };
  const close = () => {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };
  const go = async () => {
    const code = $("pu-code").value.trim();
    if (!code) { $("pu-code").focus(); return; }
    const goBtn = $("pu-go");
    goBtn.disabled = true;
    try {
      const r = await fetch("/api/parent-login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "That code didn\u2019t work."); }
      IS_PARENT = true;
      reflectParentMode();
      close();
      // Re-render so the edit pencils appear immediately.
      renderedFeedSig = null;
      await loadFeed();
      if (!$("view-timeline").classList.contains("hidden")) await loadMilestones();
    } catch (e) {
      const err = $("pu-error");
      err.textContent = e.message || "That code didn\u2019t work.";
      err.classList.remove("hidden");
    } finally {
      goBtn.disabled = false;
    }
  };

  btn.addEventListener("click", open);
  $("pu-close").addEventListener("click", close);
  $("pu-cancel").addEventListener("click", close);
  $("pu-go").addEventListener("click", go);
  $("pu-code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.classList.contains("hidden")) close(); });
}

function setupEditModal() {
  const modal = $("edit-modal");
  if (!modal || modal.dataset.wired) return;
  modal.dataset.wired = "1";
  setupDatePicker("em-date", false);

  // Emoji quick-pick fills the text field.
  const eq = $("em-emoji-quick");
  eq.addEventListener("click", (e) => {
    const b = e.target.closest(".eq");
    if (!b) return;
    eq.querySelectorAll(".eq").forEach((x) => x.classList.toggle("on", x === b));
    $("em-emoji").value = b.dataset.emoji;
  });

  modal.querySelector(".em-close").addEventListener("click", closeEditModal);
  $("em-cancel").addEventListener("click", closeEditModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeEditModal(); });
  $("em-save").addEventListener("click", saveEdit);

  // Delete → reveal confirm sub-panel, then act.
  $("em-delete").addEventListener("click", () => {
    modal.querySelector(".em-actions").classList.add("em-modal-hide");
    $("em-confirm").classList.remove("hidden");
  });
  $("em-confirm-no").addEventListener("click", () => {
    $("em-confirm").classList.add("hidden");
    modal.querySelector(".em-actions").classList.remove("em-modal-hide");
  });
  $("em-confirm-yes").addEventListener("click", deleteItem);

  // Open on any edit pencil (delegated, so it works for freshly-rendered cards).
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".edit-btn[data-edit-kind]");
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    openEditModal(btn.dataset.editKind, btn.dataset.editId);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeEditModal(); });
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
    const tile = e.target.closest(".card-media[data-lightbox], .ms-media[data-lightbox], .ms-gtile[data-lightbox]");
    if (tile) {
      openLightbox({
        src: tile.dataset.lightbox,
        type: tile.dataset.type || (tile.querySelector("video") ? "video" : "image"),
        caption: tile.dataset.caption || "",
        author: tile.dataset.author || "",
        emoji: tile.dataset.emoji || "",
        title: tile.dataset.title || "",
        body: tile.dataset.body || "",
      });
      return;
    }
    const more = e.target.closest(".cap-more");
    if (more) {
      const cap = more.previousElementSibling;
      if (cap && cap.classList.contains("card-caption")) { cap.classList.add("expanded"); cap.classList.remove("clamped"); more.remove(); }
      return;
    }
    const cap = e.target.closest(".card-caption");
    if (cap) { cap.classList.toggle("expanded"); if (cap.classList.contains("expanded")) { cap.classList.remove("clamped"); const n = cap.nextElementSibling; if (n && n.classList.contains("cap-more")) n.remove(); } }
  });
}

function setupEmailSignup() {
  // The email signup lives in the red footer band at the bottom of both the
  // feed (homepage) and the timeline views — mount whichever are present.
  ["email-signup-feed", "email-signup-timeline", "email-signup-family"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.dataset.wired) {
      el.innerHTML = emailCardHTML(true);
      wireEmailCard(el);
      el.dataset.wired = "1";
    }
  });
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
  // Always land on the open/expanded state (Amy's ask) — don't persist collapse across visits.
  apply(false);
  btn.addEventListener("click", () => {
    const collapsed = !section.classList.contains("collapsed");
    apply(collapsed);
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
