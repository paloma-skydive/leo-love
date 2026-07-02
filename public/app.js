"use strict";

const $ = (id) => document.getElementById(id);
let BABY = null;
let IS_PARENT = false;
let APPROVAL_MODE = false;
let ALL_POSTS = [];
let FAMILY = [];
let feedFilter = null;
let feedSort = "newest";

const PROMPTS = [
  "Tell Leo about the day he was born and where you were when you heard.",
  "Send Luke & Dana a message of strength for today.",
  "Share a family memory you can't wait for Leo to be part of.",
  "What's one thing you love about being a Fraser?",
  "Record a quick video just saying hi to Leo.",
  "Describe the weather and view where you are right now\u2014so Leo knows his family across the world.",
  "Tell Leo a little about his grandparents.",
  "What song will you sing to Leo one day?",
  "Send Dana something only another mum would understand.",
  "Tell Luke you're proud of the dad he's becoming.",
  "Share a photo of something that made you smile today.",
  "What adventure are you planning for when Leo's big and strong?",
  "Send Leo a bedtime story, even a tiny one.",
  "Tell Leo who he's named after, or who he reminds you of.",
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
function tickClocks() {
  if (!BABY) return;
  $("clk-leo").textContent = fmtTime(BABY.timezone);
  $("clk-you").textContent = fmtTime(localTz);
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
  const posters = [...new Set(ALL_POSTS.map((p) => (p.author || "").trim()).filter(Boolean))];
  if (posters.length < 2) { wrap.innerHTML = ""; return; }
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
}

// ---------- Feed ----------
async function loadFeed() {
  const r = await fetch("/api/feed");
  if (!r.ok) return;
  const { posts } = await r.json();
  ALL_POSTS = posts;
  renderFeedFilters();
  renderFeed();
}

function renderFeed() {
  const list = $("feed-list");
  let posts = ALL_POSTS.slice();
  if (feedFilter && feedFilter.tokens) posts = posts.filter((p) => matchesTokens(p.author, feedFilter.tokens));
  posts.sort((a, b) => {
    const d = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return feedSort === "oldest" ? d : -d;
  });
  list.innerHTML = "";
  $("feed-empty").classList.toggle("hidden", posts.length > 0);
  for (const p of posts) {
    const card = document.createElement("article");
    card.className = "card";
    const media = p.mediaType === "video"
      ? `<video src="/media/${p.mediaFile}" controls playsinline preload="metadata"></video>`
      : `<img src="/media/${p.mediaFile}" loading="lazy" alt="" />`;
    const initial = (p.author || "?").trim().charAt(0).toUpperCase() || "?";
    const col = avatarColor(p.author || "?");
    const cap = p.caption ? `<p class="card-caption">${escapeHtml(p.caption)}</p>` : "";
    const where = p.posterTz ? " \u00b7 " + shortTz(p.posterTz) : "";
    card.innerHTML = `
      <div class="card-media">${media}</div>
      <div class="card-body">
        <div class="card-head">
          <div class="avatar" style="background:${col}">${escapeHtml(initial)}</div>
          <div>
            <div class="card-who">${escapeHtml(p.author || "Someone")}</div>
            <div class="card-when">${timeAgo(p.createdAt)}${where}</div>
          </div>
        </div>
        ${cap}
        <div class="comments-mount" data-type="post" data-id="${escapeHtml(p.id)}"></div>
      </div>`;
    list.appendChild(card);
    mountComments(card.querySelector(".comments-mount"));
  }
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
  const name = currentName();
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
    <div class="comments">
      ${items}
      <div class="comment-form">
        <input class="cf-name" type="text" placeholder="Name" value="${escapeHtml(name)}" maxlength="80" />
        <input class="cf-text" type="text" placeholder="Add a comment…" maxlength="1500" />
        <button class="comment-send" type="button">Send</button>
      </div>
    </div>`;

  const nameEl = mount.querySelector(".cf-name");
  const textEl = mount.querySelector(".cf-text");
  const send = async () => {
    const author = nameEl.value.trim();
    const text = textEl.value.trim();
    if (!author) { nameEl.focus(); return; }
    if (!text) { textEl.focus(); return; }
    rememberName(author);
    const btn = mount.querySelector(".comment-send");
    btn.disabled = true;
    try {
      const r = await fetch("/api/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: type, targetId: id, author, text }),
      });
      if (r.ok) { textEl.value = ""; mountComments(mount); }
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
    const media = m.mediaFile
      ? (m.mediaType === "video"
          ? `<div class="ms-media"><video src="/media/${escapeHtml(m.mediaFile)}" controls playsinline preload="metadata"></video></div>`
          : `<div class="ms-media"><img src="/media/${escapeHtml(m.mediaFile)}" loading="lazy" alt="" /></div>`)
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
function setupComposer() {
  const author = $("author");
  author.value = localStorage.getItem("leo_author") || "";
  author.addEventListener("input", () => localStorage.setItem("leo_author", author.value));

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

function submitPost() {
  const status = $("post-status");
  const author = $("author").value.trim();
  const caption = $("caption").value.trim();
  if (!chosenFile) { status.className = "post-status err"; status.textContent = "Pick a photo or video first \u{1F60A}"; return; }
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
  $("clk-you-label").textContent = shortTz(localTz);

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
  loadFamily();
  loadFeed();
  tickClocks(); tickAge();
  setInterval(tickClocks, 1000 * 10);
  setInterval(tickAge, 1000 * 30);
  setInterval(loadFeed, 1000 * 45);
  const hash = location.hash.replace("#", "");
  if (["timeline", "family", "guide"].includes(hash)) setView(hash);
}

function setupSort() {
  document.querySelectorAll(".sort-btn").forEach((b) => b.addEventListener("click", () => {
    feedSort = b.dataset.sort;
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
const AVATAR_IDS = new Set([
  "jacki", "john", "margot", "paul", "mama", "janet",
  "antony", "kirsty", "matt", "ryleigh", "antony-luke", "roland",
]);
const AVATAR_VER = 1;

function famCard(p) {
  const editable = p.role === "grandparent";
  const cls = `fam-card${p.id === "leo" ? " leo" : ""}${editable ? " editable" : ""}`;
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
  if (p.role === "grandparent") { openTitleEditor(p); return; }
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

boot();
