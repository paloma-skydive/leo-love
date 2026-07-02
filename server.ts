import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PORT = Number(process.env.PORT) || 3001;
// On Render this points at the mounted persistent disk (e.g. /var/data); locally
// it falls back to the old Documents path.
const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), "Documents", "leo-app");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const POSTS_DIR = path.join(DATA_DIR, "posts");
const COMMENTS_DIR = path.join(DATA_DIR, "comments");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const MILESTONES_FILE = path.join(DATA_DIR, "milestones.json");
const FAMILY_FILE = path.join(DATA_DIR, "family.json");

// ---- First-boot seed ----
// A fresh Render persistent disk is empty. On first boot only, copy the bundled
// snapshot of the family's data (config, milestones, family, posts, uploads,
// originals) onto the disk. Subsequent boots see config.json already present
// and skip, so live data is never overwritten.
function seedDataDir() {
  try {
    const seedDir = path.join(import.meta.dirname, "seed");
    if (!fs.existsSync(seedDir)) return;
    if (fs.existsSync(path.join(DATA_DIR, "config.json"))) return; // already seeded / live
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.cpSync(seedDir, DATA_DIR, { recursive: true });
    console.log("Seeded DATA_DIR from bundled snapshot.");
  } catch (e: any) {
    console.error("seed failed:", e?.message);
  }
}
seedDataDir();

for (const d of [DATA_DIR, UPLOAD_DIR, POSTS_DIR, COMMENTS_DIR]) fs.mkdirSync(d, { recursive: true });

// ---- Config (password + baby info) ----
type Config = {
  password: string;
  parentCode: string;
  // Approval mode: while true, entering the family password lands Luke & Dana on
  // their guide first (not the whole site), so they can review before it opens up.
  // Flip to false in config.json once they've approved and the site opens normally.
  approvalMode: boolean;
  baby: {
    name: string;
    bornISO: string; // UTC instant of birth
    bornLocalText: string;
    timezone: string; // Leo's timezone
    parents: string;
  };
};

const DEFAULT_CONFIG: Config = {
  password: "leojp2026",
  parentCode: "146",
  approvalMode: false,
  baby: {
    name: "Leo John Paul Fraser",
    bornISO: "2026-06-16T18:46:00.000Z", // 16th 1:46pm Georgetown (UTC-5)
    bornLocalText: "16 June, 1:46pm \u00b7 Georgetown, Cayman",
    timezone: "America/Cayman",
    parents: "Luke & Dana Fraser",
  },
};

function loadConfig(): Config {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return { ...DEFAULT_CONFIG, ...c, baby: { ...DEFAULT_CONFIG.baby, ...(c.baby || {}) } };
  } catch {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
}

const DEFAULT_MILESTONES = [
  {
    id: "born",
    dateText: "16 June 2026",
    title: "Leo arrives \u2014 a little early, a lot loved",
    body: "Leo John Paul Fraser was born at 1:46pm Georgetown time, premature and brave, into the arms of Luke & Dana. The whole family, from the Caymans to New Zealand, started cheering at once.",
    emoji: "\ud83c\udf1f",
  },
];

function loadMilestones(): any[] {
  try {
    return JSON.parse(fs.readFileSync(MILESTONES_FILE, "utf8"));
  } catch {
    fs.writeFileSync(MILESTONES_FILE, JSON.stringify(DEFAULT_MILESTONES, null, 2));
    return DEFAULT_MILESTONES;
  }
}

function saveMilestones(list: any[]) {
  fs.writeFileSync(MILESTONES_FILE, JSON.stringify(list, null, 2));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Turn a yyyy-mm-dd (+ optional HH:MM) into "16 June 2026 · 1:46pm"
function formatDateText(dateStr: string, timeStr?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  let out = dateStr || "";
  if (m) {
    const y = m[1], mo = MONTHS[parseInt(m[2], 10) - 1] || m[2], d = parseInt(m[3], 10);
    out = `${d} ${mo} ${y}`;
  }
  if (timeStr && /^(\d{1,2}):(\d{2})$/.test(timeStr)) {
    let [h, min] = timeStr.split(":").map((n) => parseInt(n, 10));
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    out += ` · ${h12}:${String(min).padStart(2, "0")}${ampm}`;
  }
  return out;
}

function sortKey(m: any): number {
  // Prefer an explicit sortable date if present; else fall back to creation order.
  if (m.sortISO) return new Date(m.sortISO).getTime();
  if (m.createdAt) return new Date(m.createdAt).getTime();
  return 0;
}

// ---- Comments (one file per target, holding an array) ----
function commentsPath(targetType: string, targetId: string) {
  const safe = (targetType + "_" + targetId).replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(COMMENTS_DIR, safe + ".json");
}
function loadComments(targetType: string, targetId: string): any[] {
  try {
    return JSON.parse(fs.readFileSync(commentsPath(targetType, targetId), "utf8"));
  } catch {
    return [];
  }
}
function addComment(targetType: string, targetId: string, c: any) {
  const list = loadComments(targetType, targetId);
  list.push(c);
  fs.writeFileSync(commentsPath(targetType, targetId), JSON.stringify(list, null, 2));
  return list;
}

function authHash(pw: string) {
  return crypto.createHash("sha256").update("leo:" + pw).digest("hex");
}
function parentHash(code: string) {
  return crypto.createHash("sha256").update("leo-parent:" + code).digest("hex");
}


// ---- Family tree ----
// relation = relation to LEO. side = which parent's family. gen orders the tree.
const DEFAULT_FAMILY = [
  { id: "leo", name: "Leo", relation: "That's me!", side: "leo", location: "cayman", gen: 0, role: "baby" },
  // parents
  { id: "dana", name: "Dana", relation: "Mum", side: "dana", location: "cayman", gen: 1, role: "parent" },
  { id: "luke", name: "Luke", relation: "Dad", side: "luke", location: "cayman", gen: 1, role: "parent" },
  // grandparents (titles editable)
  { id: "jacki", name: "Jacki", relation: "Grandma", title: "", side: "luke", location: "nz", gen: 2, role: "grandparent" },
  { id: "john", name: "John", relation: "Grandad", title: "", side: "luke", location: "nz", gen: 2, role: "grandparent" },
  { id: "margot", name: "Margot", relation: "Grandma", title: "", side: "dana", location: "nz", gen: 2, role: "grandparent" },
  { id: "paul", name: "Paul", relation: "Grandad", title: "", side: "dana", location: "nz", gen: 2, role: "grandparent" },
  // great-grandparent (Dana's grandmother, Margot's mum)
  { id: "mama", name: "Mama", relation: "Great-Grandma", qualifier: "Dana's grandma", side: "dana", location: "nz", gen: 7, role: "greatgrandparent" },
  // great-aunts & uncle (Margot's siblings / Dana's aunts & uncle)
  { id: "janet", name: "Janet", relation: "Great-Aunty", qualifier: "Dana's aunty", side: "dana", location: "nz", gen: 8, role: "greataunt" },
  { id: "suzanne", name: "Suzanne", relation: "Great-Aunty", qualifier: "Dana's aunty", side: "dana", location: "nz", gen: 8, role: "greataunt" },
  { id: "adriano", name: "Adriano", relation: "Great-Uncle", qualifier: "Dana's uncle", side: "dana", location: "nz", gen: 8, role: "greataunt" },
  // aunts & uncles
  { id: "amy", name: "Amy", relation: "Aunty", side: "luke", location: "nz", gen: 3, role: "auntuncle" },
  { id: "sam", name: "Sam", relation: "Uncle", side: "luke", location: "nz", gen: 3, role: "auntuncle" },
  { id: "max", name: "Max", relation: "Uncle", side: "luke", location: "nz", gen: 3, role: "auntuncle" },
  { id: "charlotte", name: "Charlotte", relation: "Aunty", side: "luke", location: "nz", gen: 3, role: "auntuncle" },
  { id: "antony", name: "Antony", relation: "Uncle", qualifier: "Mum's brother", side: "dana", location: "australia", gen: 3, role: "auntuncle" },
  // cousins (Leo's cousins)
  { id: "ra", name: "Ra", relation: "Cousin", side: "luke", location: "nz", gen: 4, role: "cousin" },
  { id: "ryleigh", name: "Ryleigh", relation: "Cousin", side: "luke", location: "nz", gen: 4, role: "cousin" },
  // wider clan (extended family & cousins sharing in Leo's pinboard)
  { id: "antony-luke", name: "Ant", relation: "Cousin", qualifier: "Dad's cousin", side: "luke", location: "nz", gen: 5, role: "extended" },
  { id: "roland", name: "Roland", relation: "Cousin", qualifier: "Dad's cousin", side: "luke", location: "nz", gen: 5, role: "extended" },
  { id: "matt", name: "Matt", relation: "Cousin", qualifier: "Dad's cousin", side: "luke", location: "japan", gen: 5, role: "extended" },
  { id: "kirsty", name: "Kirsty", relation: "Cousin", qualifier: "Mum's cousin", side: "dana", location: "nz", gen: 5, role: "extended" },
  { id: "dario", name: "Dario", relation: "Cousin", qualifier: "Mum's cousin", side: "dana", location: "nz", gen: 5, role: "extended" },
  // pet
  { id: "marlow", name: "Marlow", relation: "Leo's dog", side: "leo", location: "cayman", gen: 6, role: "pet" },
];

function loadFamily(): any[] {
  try {
    const saved = JSON.parse(fs.readFileSync(FAMILY_FILE, "utf8"));
    const titleById: Record<string, string> = {};
    for (const p of saved) if (p && p.id && p.title) titleById[p.id] = p.title;
    // Structure always follows DEFAULT_FAMILY; only family-chosen titles persist.
    return DEFAULT_FAMILY.map((d) => ({ ...d, title: titleById[d.id] ?? (d as any).title ?? "" }));
  } catch {
    fs.writeFileSync(FAMILY_FILE, JSON.stringify(DEFAULT_FAMILY, null, 2));
    return DEFAULT_FAMILY;
  }
}
function saveFamily(list: any[]) {
  fs.writeFileSync(FAMILY_FILE, JSON.stringify(list, null, 2));
}

import { execFile } from "node:child_process";

// ---- Media normalisation ----
// Browsers can't play iPhone HEVC/.mov video or show HEIC photos. Convert
// everything to universally-supported MP4 (H.264) / JPEG, fix rotation, and
// cap dimensions. Returns the final filename + type, replacing the raw upload.
function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 16 }, (err) =>
      err ? reject(err) : resolve()
    );
  });
}
function probeVideoCodec(file: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", file],
      { timeout: 15000 },
      (err, stdout) => resolve(err ? "" : String(stdout).trim())
    );
  });
}

async function normaliseMedia(
  rawPath: string,
  id: string,
  isVideo: boolean
): Promise<{ fileName: string; mediaType: "image" | "video"; mime: string }> {
  if (isVideo) {
    // Always re-encode to a universally-playable baseline: 8-bit yuv420p (NOT
    // 10-bit/HDR, which many phones & browsers can't decode and which causes
    // playback to stall a few seconds in), constant frame rate, regular
    // keyframes, faststart. Never trust a source .mp4 as-is — iPhones now
    // record 10-bit Dolby Vision HEVC/H.264 with variable frame rate.
    const outName = id + ".mp4";
    const outPath = path.join(UPLOAD_DIR, outName);
    try {
      await run(
        "ffmpeg",
        [
          "-y", "-i", rawPath,
          "-vf", "scale='min(1280,iw)':-2:flags=lanczos,format=yuv420p",
          "-c:v", "libx264", "-profile:v", "high", "-level", "4.0",
          "-preset", "veryfast", "-crf", "24",
          "-r", "30", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "44100",
          "-movflags", "+faststart",
          outPath,
        ],
        8 * 60 * 1000
      );
      if (rawPath !== outPath) fs.unlink(rawPath, () => {});
      return { fileName: outName, mediaType: "video", mime: "video/mp4" };
    } catch (e: any) {
      console.error("video transcode failed, keeping original:", e?.message);
      return { fileName: path.basename(rawPath), mediaType: "video", mime: "video/mp4" };
    }
  }
  // image: convert HEIC->jpg, fix EXIF orientation, cap size
  const lower = rawPath.toLowerCase();
  const needsConvert = lower.endsWith(".heic") || lower.endsWith(".heif");
  const outName = id + ".jpg";
  const outPath = path.join(UPLOAD_DIR, outName);
  try {
    await run("convert", [rawPath, "-auto-orient", "-resize", "2400x2400>", "-quality", "86", outPath], 60 * 1000);
    if (rawPath !== outPath) fs.unlink(rawPath, () => {});
    return { fileName: outName, mediaType: "image", mime: "image/jpeg" };
  } catch (e: any) {
    console.error("image convert failed, keeping original:", e?.message);
    if (needsConvert) throw e; // HEIC unusable if not converted
    return { fileName: path.basename(rawPath), mediaType: "image", mime: "image/jpeg" };
  }
}

const app = express();
app.use(express.json());

// ---- Cookie parsing ----
function getCookie(req: express.Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function isAuthed(req: express.Request): boolean {
  const cfg = loadConfig();
  return getCookie(req, "leo_auth") === authHash(cfg.password);
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "Not authorized" });
}

function isParent(req: express.Request): boolean {
  const cfg = loadConfig();
  return getCookie(req, "leo_parent") === parentHash(cfg.parentCode);
}
function requireParent(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isAuthed(req) && isParent(req)) return next();
  res.status(403).json({ error: "This is just for Leo's mum & dad." });
}

// ---- Auth endpoints ----
app.post("/api/login", (req, res) => {
  const cfg = loadConfig();
  const pw = String(req.body?.password ?? "");
  if (pw.trim().toLowerCase() === cfg.password.toLowerCase()) {
    res.setHeader(
      "Set-Cookie",
      `leo_auth=${authHash(cfg.password)}; Path=/; Max-Age=${60 * 60 * 24 * 120}; HttpOnly; SameSite=Lax`
    );
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "That password didn't match." });
});

app.get("/api/session", (req, res) => {
  const cfg = loadConfig();
  res.json({ authed: isAuthed(req), parent: isParent(req), baby: cfg.baby, approvalMode: !!cfg.approvalMode });
});

// ---- Parent area (Luke & Dana) ----
app.post("/api/parent-login", requireAuth, (req, res) => {
  const cfg = loadConfig();
  const code = String(req.body?.code ?? "").trim();
  if (code.toLowerCase() === String(cfg.parentCode).toLowerCase()) {
    res.setHeader(
      "Set-Cookie",
      `leo_parent=${parentHash(cfg.parentCode)}; Path=/; Max-Age=${60 * 60 * 24 * 180}; HttpOnly; SameSite=Lax`
    );
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "That parent code didn't match." });
});

// ---- Family tree ----
app.get("/api/family", requireAuth, (_req, res) => {
  res.json({ family: loadFamily() });
});

// Set a person's title (e.g. grandparent picks "Nana"). Any family member can help fill these in.
app.post("/api/family/title", requireAuth, (req, res) => {
  const id = String(req.body?.id || "").trim();
  const title = String(req.body?.title || "").trim().slice(0, 40);
  const list = loadFamily();
  const person = list.find((p) => p.id === id);
  if (!person) return res.status(404).json({ error: "Couldn't find that person." });
  person.title = title;
  saveFamily(list);
  res.json({ ok: true, person });
});

// ---- Feed ----
async function readPosts() {
  const files = (await fsp.readdir(POSTS_DIR)).filter((f) => f.endsWith(".json"));
  const posts = [];
  for (const f of files) {
    try {
      posts.push(JSON.parse(await fsp.readFile(path.join(POSTS_DIR, f), "utf8")));
    } catch {}
  }
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return posts;
}

app.get("/api/feed", requireAuth, async (_req, res) => {
  res.json({ posts: await readPosts() });
});

app.get("/api/milestones", requireAuth, (_req, res) => {
  const list = loadMilestones().slice().sort((a, b) => sortKey(b) - sortKey(a));
  res.json({ milestones: list });
});

// Add a milestone (family self-service)
app.post("/api/milestones", requireAuth, (req, res) => {
  const b = req.body || {};
  const date = String(b.date || "").trim();
  const time = String(b.time || "").trim();
  const title = String(b.title || "").trim();
  const body = String(b.body || "").trim();
  const author = String(b.author || "").trim();
  const emoji = String(b.emoji || "").trim().slice(0, 8);
  const mediaFile = String(b.mediaFile || "").trim().slice(0, 120);
  const mediaType = String(b.mediaType || "").trim();
  if (!date) return res.status(400).json({ error: "Please pick a date." });
  if (!title) return res.status(400).json({ error: "Give the milestone a short title." });

  let sortISO = "";
  try {
    sortISO = new Date(`${date}T${time && /^\d{1,2}:\d{2}$/.test(time) ? time : "12:00"}:00`).toISOString();
  } catch {}

  const milestone: any = {
    id: Date.now().toString(36) + crypto.randomBytes(3).toString("hex"),
    dateText: formatDateText(date, time),
    title: title.slice(0, 140),
    body: body.slice(0, 4000),
    emoji,
    author: author.slice(0, 80),
    sortISO,
    createdAt: new Date().toISOString(),
  };
  if (mediaFile && (mediaType === "image" || mediaType === "video")) {
    milestone.mediaFile = path.basename(mediaFile);
    milestone.mediaType = mediaType;
  }
  const list = loadMilestones();
  list.push(milestone);
  saveMilestones(list);
  res.json({ ok: true, milestone });
});

// Upload media for a milestone (saves file, returns filename; does NOT create a feed post)
app.post("/api/milestone-media", requireAuth, (req, res) => {
  const origName = decodeURIComponent(String(req.headers["x-filename"] || "upload"));
  const mime = String(req.headers["content-type"] || "application/octet-stream");
  const isVideo = mime.startsWith("video/");
  const isImage = mime.startsWith("image/");
  if (!isVideo && !isImage) return res.status(400).json({ error: "Only images and videos." });
  let ext = path.extname(origName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!ext) ext = isVideo ? ".mp4" : ".jpg";
  const id = "ms" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
  const rawName = id + "_raw" + ext;
  const dest = path.join(UPLOAD_DIR, rawName);
  const out = fs.createWriteStream(dest);
  let size = 0; const MAX = 600 * 1024 * 1024; let aborted = false;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX && !aborted) { aborted = true; out.destroy(); fs.unlink(dest, () => {}); res.status(413).json({ error: "That file is a bit too big (max 600MB)." }); req.destroy(); }
  });
  req.pipe(out);
  out.on("finish", async () => {
    if (aborted) return;
    try {
      const media = await normaliseMedia(dest, id, isVideo);
      res.json({ ok: true, mediaFile: media.fileName, mediaType: media.mediaType });
    } catch {
      fs.unlink(dest, () => {});
      res.status(422).json({ error: "Couldn't process that file\u2014try a JPG or MP4?" });
    }
  });
  out.on("error", () => { if (!aborted) res.status(500).json({ error: "Something went wrong saving that." }); });
});

// ---- Comments ----
function validTarget(t: string) {
  return t === "post" || t === "milestone";
}
app.get("/api/comments", requireAuth, (req, res) => {
  const targetType = String(req.query.targetType || "");
  const targetId = String(req.query.targetId || "");
  if (!validTarget(targetType) || !targetId) return res.status(400).json({ error: "bad target" });
  res.json({ comments: loadComments(targetType, targetId) });
});
app.post("/api/comments", requireAuth, (req, res) => {
  const b = req.body || {};
  const targetType = String(b.targetType || "");
  const targetId = String(b.targetId || "");
  const author = String(b.author || "").trim();
  const text = String(b.text || "").trim();
  if (!validTarget(targetType) || !targetId) return res.status(400).json({ error: "bad target" });
  if (!author) return res.status(400).json({ error: "Add your name." });
  if (!text) return res.status(400).json({ error: "Write something first." });
  const comment = {
    id: Date.now().toString(36) + crypto.randomBytes(3).toString("hex"),
    author: author.slice(0, 80),
    text: text.slice(0, 1500),
    createdAt: new Date().toISOString(),
  };
  addComment(targetType, targetId, comment);
  res.json({ ok: true, comment });
});

// ---- Upload: raw body streamed to disk ----
app.post("/api/upload", requireAuth, (req, res) => {
  const author = String(req.headers["x-author"] || "Someone in the family");
  const caption = decodeURIComponent(String(req.headers["x-caption"] || ""));
  const tz = String(req.headers["x-tz"] || "");
  const origName = decodeURIComponent(String(req.headers["x-filename"] || "upload"));
  const mime = String(req.headers["content-type"] || "application/octet-stream");

  const isVideo = mime.startsWith("video/");
  const isImage = mime.startsWith("image/");
  if (!isVideo && !isImage) {
    return res.status(400).json({ error: "Only images and videos can be shared." });
  }

  let ext = path.extname(origName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!ext) ext = isVideo ? ".mp4" : ".jpg";
  const id = Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
  const rawName = id + "_raw" + ext;
  const dest = path.join(UPLOAD_DIR, rawName);

  const out = fs.createWriteStream(dest);
  let size = 0;
  const MAX = 600 * 1024 * 1024; // 600MB
  let aborted = false;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX && !aborted) {
      aborted = true;
      out.destroy();
      fs.unlink(dest, () => {});
      res.status(413).json({ error: "That file is a bit too big (max 600MB)." });
      req.destroy();
    }
  });
  req.pipe(out);
  out.on("finish", async () => {
    if (aborted) return;
    let media;
    try {
      media = await normaliseMedia(dest, id, isVideo);
    } catch {
      fs.unlink(dest, () => {});
      return res.status(422).json({ error: "Couldn't process that file\u2014try a JPG or MP4?" });
    }
    const post = {
      id,
      author: author.slice(0, 80),
      caption: caption.slice(0, 2000),
      mediaFile: media.fileName,
      mediaType: media.mediaType,
      mime: media.mime,
      posterTz: tz,
      createdAt: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(POSTS_DIR, id + ".json"), JSON.stringify(post, null, 2));
    res.json({ ok: true, post });
  });
  out.on("error", () => {
    if (!aborted) res.status(500).json({ error: "Something went wrong saving that." });
  });
});

// ---- Serve media with range support ----
app.get("/media/:file", requireAuth, (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.join(UPLOAD_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full); // express handles Range requests
});

// ---- Parent-only guide page (Luke & Dana). Gated by the parent code so it is
// genuinely private; anyone not recognised as a parent is funnelled to the home
// screen with a flag that opens the parent-code step. ----
app.get(["/guide", "/guide.html"], (req, res) => {
  const _cfg = loadConfig();
  // Approval mode: any family-password visitor may see the guide (no parent code
  // needed) — the whole point is Luke & Dana reviewing it first.
  if (_cfg.approvalMode && isAuthed(req)) {
    return res.sendFile(path.join(import.meta.dirname, "public", "guide.html"));
  }
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  if (isAuthed(req) && isParent(req)) {
    return res.sendFile(path.join(import.meta.dirname, "public", "guide.html"));
  }
  return res.redirect("/?for=parents");
});

// Internal Skydive cluster site (kept in public/skydive) is not served here —
// this deployment is Leo only.

// ---- Static app shell ----
app.use(
  express.static(path.join(import.meta.dirname, "public"), {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else {
        res.setHeader("Cache-Control", "no-cache"); // revalidate every load
      }
    },
  })
);
app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(import.meta.dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Leo app on :${PORT}`));
