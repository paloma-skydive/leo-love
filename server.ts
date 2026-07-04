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
const SUBSCRIBERS_FILE = path.join(DATA_DIR, "subscribers.json");

// ---- Email (Resend) ----
// Family opt-in email notifications. Sending goes through Resend; the API key
// and "from" address come from env so no secret lives in the repo. If the key
// is absent (e.g. before the sender domain is verified), sendEmail is a no-op
// so subscribing still works and nothing errors — it just doesn't deliver yet.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "Leo \u{1F49B} <leo@leo-love.com>";
const SITE_URL = (process.env.SITE_URL || "https://leo-love.com").replace(/\/$/, "");
const emailReady = () => !!RESEND_API_KEY;

// ---- Amy's hand-curated feed order (see /api/feed) ----
// Family posts keyed by post id; milestones by "ms:<id>". Rearrange to re-order.
// Anything not listed falls after these, newest-first (e.g. Ra & Marlow — Amy is
// deciding where they go).
const FEED_ORDER: string[] = [
  "19f0cfd8e415151bf",       // 1  Margot
  "19f0cfd8f01176b1b",       // 2  Paul
  "mqrjknqlff90fa7b",        // 3  Jacki (Nana)
  "mqs01fk0ec11a71e",        // 4  John (Poppa)
  "ms:mr68k0xueb9ffc",       // 5  Home at last
  "mr5r9dpb42a1c7d5",        // 6  Ra
  "ms:mr68k0qj515948",       // 7  Leo’s ears work!
  "19f0d093196b3e04b",       // 8  Ant + Nicky (Antony)
  "19f0d225e57b8c57d",       // 9  Sam
  "ms:ms19f0d20795b353ac1",  // 10 Graduated to a cot!
  "19f0d0b4628a79b54",       // 11 Great Grandma (Mama)
  "ms:mr65otxi8886f5",       // 12 Making his mark
  "ms:mr65os719354ed",       // 13 Off breathing support
  "19f0d0b76dd81bfac",       // 14 Suzanne, Adriano & Dario
  "mqskwzql95e9dc0b",        // 15 Ant
  "ms:eating-more",          // 16 Going from strength to strength
  "mr5pgqgqe9cb8e1b",        // 17 Marlow
  "mqtifrcs92aad18f",        // 18 Roland
  "ms:incubator-cuddles",    // 19 Leo’s first cuddles!
  "19f0d0b9fc290ee56",       // 20 Kirsty
  "ms:first-feed",           // 21 Leo’s first meal!
  "19f0d20e1dbccc86f",       // 22 Matt
  "19f0d0b6dc50a69a0",       // 23 Aunty Janet
  "ms:first-days",           // 24 Making himself at home
  "mr6dqm9gc583e5a1",        // 25 Max
  "mqs0ppq7a6e4124a",        // 26 Ryleigh
  "ms:born",                 // 27 Leo arrives
];

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
  { id: "margot", name: "Margot", relation: "Grandma", title: "Mimi", side: "dana", location: "nz", gen: 2, role: "grandparent" },
  { id: "paul", name: "Paul", relation: "Grandad", title: "Pop", side: "dana", location: "nz", gen: 2, role: "grandparent" },
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
  { id: "roland", name: "Roland", relation: "Cousin", qualifier: "Dad's cousin", side: "luke", location: "australia", gen: 5, role: "extended" },
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

// ---- Subscribers (email notifications) ----
type Subscriber = {
  email: string;
  name?: string;
  freq: "instant" | "off"; // "instant" = email on every update; "off" = unsubscribed
  token: string; // for one-click unsubscribe links
  createdAt: string;
};

function loadSubscribers(): Subscriber[] {
  try {
    return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, "utf8"));
  } catch {
    return [];
  }
}
function saveSubscribers(list: Subscriber[]) {
  fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(list, null, 2));
}
function normEmail(e: string) {
  return String(e || "").trim().toLowerCase();
}
function validEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// ---- Send a single email via Resend ----
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!emailReady()) {
    console.log("email not configured (no RESEND_API_KEY) \u2014 skipping send to", to);
    return false;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
    });
    if (!r.ok) {
      console.error("resend send failed", r.status, await r.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e: any) {
    console.error("resend send error:", e?.message);
    return false;
  }
}

// ---- Warm, on-brand email templates ----
function emailShell(inner: string, unsubUrl: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#FFFEF5;">
  <div style="background:#FFFEF5;padding:28px 16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#151414;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:18px;overflow:hidden;">
      <div style="background:#EB2832;padding:22px 26px;">
        <div style="font-size:22px;font-weight:800;color:#FFFEF5;letter-spacing:-.01em;">Leo <span style="color:#EEE272;">&bull;</span></div>
        <div style="font-size:12px;color:#ffe;opacity:.9;margin-top:2px;letter-spacing:.08em;text-transform:uppercase;">A note from Leo&rsquo;s family page</div>
      </div>
      <div style="padding:26px;">${inner}</div>
      <div style="padding:16px 26px;border-top:1px solid #f0f0f0;font-size:12px;color:#999;line-height:1.6;">
        You&rsquo;re getting this because you asked to hear about Leo on his family page.
        <br /><a href="${unsubUrl}" style="color:#356CC0;">Stop these emails</a> &middot; <a href="${SITE_URL}" style="color:#356CC0;">Open Leo&rsquo;s page</a>
      </div>
    </div>
    <div style="text-align:center;font-size:11px;color:#bbb;margin-top:14px;">Made with love, NZ &harr; Cayman</div>
  </div></body></html>`;
}
function unsubUrlFor(s: Subscriber) {
  return `${SITE_URL}/api/unsubscribe?token=${encodeURIComponent(s.token)}`;
}
function btn(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;background:#356CC0;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px;font-size:15px;">${label}</a>`;
}

// ---- Notify subscribers of a new feed post ----
async function notifyNewPost(post: any) {
  try {
    const subs = loadSubscribers().filter((s) => s.freq !== "off");
    if (!subs.length) return;
    const who = escapeText(post.author || "Someone in the family");
    const cap = post.caption ? `<p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 18px;">&ldquo;${escapeText(post.caption)}&rdquo;</p>` : "";
    const mediaWord = post.mediaType === "video" ? "a new video" : "a new photo";
    for (const s of subs) {
      const inner = `<p style="font-size:17px;font-weight:700;margin:0 0 6px;">${who} just shared ${mediaWord} of Leo \u{1F49B}</p>
        <p style="font-size:14px;color:#777;margin:0 0 16px;">There&rsquo;s something new on his page.</p>
        ${cap}
        <div style="margin:6px 0 4px;">${btn(SITE_URL, "See it on Leo&rsquo;s page \u2192")}</div>`;
      await sendEmail(s.email, `${who} shared ${mediaWord} of Leo \u{1F49B}`, emailShell(inner, unsubUrlFor(s)));
    }
  } catch (e: any) {
    console.error("notifyNewPost error:", e?.message);
  }
}

// ---- Notify subscribers of a new milestone ----
async function notifyNewMilestone(m: any) {
  try {
    const subs = loadSubscribers().filter((s) => s.freq !== "off");
    if (!subs.length) return;
    const title = escapeText(m.title || "A new milestone");
    const emoji = m.emoji ? escapeText(m.emoji) + " " : "";
    const body = m.body ? `<p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 18px;">${escapeText(m.body)}</p>` : "";
    for (const s of subs) {
      const inner = `<p style="font-size:13px;color:#356CC0;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin:0 0 6px;">A new milestone</p>
        <p style="font-size:19px;font-weight:800;margin:0 0 4px;">${emoji}${title}</p>
        <p style="font-size:13px;color:#999;margin:0 0 16px;">${escapeText(m.dateText || "")}</p>
        ${body}
        <div style="margin:6px 0 4px;">${btn(SITE_URL + "/#timeline", "See Leo&rsquo;s milestones \u2192")}</div>`;
      await sendEmail(s.email, `Leo: ${title} \u{1F49B}`, emailShell(inner, unsubUrlFor(s)));
    }
  } catch (e: any) {
    console.error("notifyNewMilestone error:", e?.message);
  }
}

function escapeText(s: string): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  isVideo: boolean,
  skipTranscode = false
): Promise<{ fileName: string; mediaType: "image" | "video"; mime: string }> {
  if (isVideo) {
    const outName = id + ".mp4";
    const outPath = path.join(UPLOAD_DIR, outName);
    // Pre-transcoded path: the uploader already produced a web-ready H.264/yuv420p
    // file (e.g. Paloma transcodes big family videos off-box, since re-encoding a
    // 40MB clip on the small Render instance exhausts its memory and restarts the
    // app). Just stream-copy with faststart — cheap, low-memory, no re-encode.
    if (skipTranscode) {
      try {
        await run("ffmpeg", ["-y", "-i", rawPath, "-c", "copy", "-movflags", "+faststart", outPath], 60 * 1000);
        if (rawPath !== outPath) fs.unlink(rawPath, () => {});
        return { fileName: outName, mediaType: "video", mime: "video/mp4" };
      } catch (e: any) {
        console.error("faststart remux failed, keeping original:", e?.message);
        // Fall back to just using the raw file as-is (already web-ready by contract).
        try {
          if (rawPath !== outPath) fs.renameSync(rawPath, outPath);
          return { fileName: outName, mediaType: "video", mime: "video/mp4" };
        } catch {
          return { fileName: path.basename(rawPath), mediaType: "video", mime: "video/mp4" };
        }
      }
    }
    // Always re-encode to a universally-playable baseline: 8-bit yuv420p (NOT
    // 10-bit/HDR, which many phones & browsers can't decode and which causes
    // playback to stall a few seconds in), constant frame rate, regular
    // keyframes, faststart. Never trust a source .mp4 as-is — iPhones now
    // record 10-bit Dolby Vision HEVC/H.264 with variable frame rate.
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

// ---- Email subscriptions ----
// Who's signed up (parents can see the list is handled client-side; here we just
// confirm the caller's own current preference by email).
app.get("/api/subscribe/me", requireAuth, (req, res) => {
  const email = normEmail(String(req.query.email || ""));
  if (!email) return res.json({ subscriber: null });
  const s = loadSubscribers().find((x) => x.email === email) || null;
  res.json({ subscriber: s ? { email: s.email, name: s.name || "", on: s.freq !== "off" } : null });
});

// Subscribe / unsubscribe. Family are already behind the site password, so
// entering their own address here is the opt-in. Subscribers get an email on
// every update. A friendly welcome email doubles as confirmation the address works.
app.post("/api/subscribe", requireAuth, async (req, res) => {
  const b = req.body || {};
  const email = normEmail(b.email);
  const name = String(b.name || "").trim().slice(0, 80);
  const off = String(b.freq || "").trim() === "off";
  const freq: "instant" | "off" = off ? "off" : "instant";
  if (!validEmail(email)) return res.status(400).json({ error: "That email doesn\u2019t look quite right." });

  const list = loadSubscribers();
  let s = list.find((x) => x.email === email);
  const wasOn = s && s.freq !== "off";
  if (!s) {
    s = { email, name, freq, token: crypto.randomBytes(16).toString("hex"), createdAt: new Date().toISOString() };
    list.push(s);
  } else {
    s.freq = freq;
    if (name) s.name = name;
    if (!s.token) s.token = crypto.randomBytes(16).toString("hex");
  }
  saveSubscribers(list);

  // Send a warm welcome/confirmation the first time they turn emails on.
  if (!off && !wasOn) {
    const hi = name ? `Hi ${escapeText(name)},` : "Hello!";
    const inner = `<p style="font-size:18px;font-weight:800;margin:0 0 10px;">You&rsquo;re all set \u{1F49B}</p>
      <p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 16px;">${hi} you&rsquo;ll now get an email whenever there&rsquo;s something new about Leo &mdash; new photos, videos and little milestones as he grows stronger.</p>
      <div style="margin:6px 0 4px;">${btn(SITE_URL, "Open Leo&rsquo;s page \u2192")}</div>`;
    sendEmail(email, "You\u2019re signed up for Leo updates \u{1F49B}", emailShell(inner, unsubUrlFor(s)));
  }
  res.json({ ok: true, on: !off, already: !off && !!wasOn });
});

// Quietly pre-add family members (parent-only, NO welcome email). Lets Amy seed
// the list ahead of time so people land on an "already on the list" state
// instead of an empty form. Body: { subscribers: [{ email, name }] }.
app.post("/api/subscribe/preadd", requireParent, (req, res) => {
  const incoming = Array.isArray(req.body?.subscribers) ? req.body.subscribers : [];
  const list = loadSubscribers();
  let added = 0, skipped = 0;
  for (const item of incoming) {
    const email = normEmail(item?.email);
    const name = String(item?.name || "").trim().slice(0, 80);
    if (!validEmail(email)) { skipped++; continue; }
    let s = list.find((x) => x.email === email);
    if (s) {
      s.freq = "instant";
      if (name) s.name = name;
      if (!s.token) s.token = crypto.randomBytes(16).toString("hex");
    } else {
      list.push({ email, name, freq: "instant", token: crypto.randomBytes(16).toString("hex"), createdAt: new Date().toISOString() });
      added++;
    }
  }
  saveSubscribers(list);
  res.json({ ok: true, added, skipped, total: list.filter((s) => s.freq !== "off").length });
});

// One-click unsubscribe from an email link (public, no auth needed).
app.get("/api/unsubscribe", (req, res) => {
  const token = String(req.query.token || "").trim();
  const list = loadSubscribers();
  const s = list.find((x) => x.token === token);
  if (s) {
    s.freq = "off";
    saveSubscribers(list);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Leo</title></head>
  <body style="margin:0;background:#FFFEF5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#151414;">
    <div style="max-width:440px;margin:12vh auto;padding:32px;text-align:center;">
      <div style="font-size:26px;font-weight:800;color:#EB2832;">Leo <span style="color:#EEE272;">&bull;</span></div>
      <p style="font-size:17px;margin:22px 0 8px;font-weight:700;">${s ? "You won&rsquo;t get any more emails." : "You&rsquo;re already unsubscribed."}</p>
      <p style="font-size:14px;color:#777;line-height:1.6;">You can still visit Leo&rsquo;s page any time, and turn emails back on there whenever you like.</p>
      <p style="margin-top:24px;"><a href="${SITE_URL}" style="color:#356CC0;font-weight:700;">Open Leo&rsquo;s page &rarr;</a></p>
    </div></body></html>`);
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
  const posts = await readPosts();
  // EVERY milestone also appears in the feed (Amy's ask) — including copy-only
  // ones — so the timeline and the feed tell the same story. Shaped like a post,
  // flagged fromMilestone so the client can badge/link them and route comments to
  // the milestone's own thread. Sorted together with regular posts.
  const msPosts = loadMilestones()
    .map((m) => {
      // Feed-display OVERRIDES: Amy can tweak how a milestone reads on the homepage
      // tile (title/story/emoji, for spacing/aesthetics) WITHOUT changing the root
      // milestone shown on the timeline. feedTitle/feedBody/feedEmoji win on the feed
      // only; when unset, the feed shows the real milestone text.
      const fTitle = (typeof m.feedTitle === "string" && m.feedTitle.length) ? m.feedTitle : (m.title || "");
      const fBody = (typeof m.feedBody === "string") ? m.feedBody : (m.body || "");
      const fEmoji = (typeof m.feedEmoji === "string" && m.feedEmoji.length) ? m.feedEmoji : (m.emoji || "");
      return {
        id: "ms_" + m.id,
        author: m.author || "Leo",   // milestone updates show as "Leo" on the feed tile (Amy)
        title: fTitle,
        body: fBody,
        emoji: fEmoji,
        caption: [fTitle, fBody].filter(Boolean).join(" \u2014 "),
        mediaFile: m.mediaFile,
        mediaType: m.mediaType,
        media: Array.isArray(m.media) && m.media.length ? m.media : (m.mediaFile ? [{ file: m.mediaFile, type: m.mediaType || "image" }] : []),
        createdAt: m.sortISO || m.createdAt || new Date().toISOString(),
        dateText: m.dateText || "",
        fromMilestone: true,
        milestoneId: m.id,
      };
    });
  const all = [...posts, ...msPosts];
  // Amy's hand-curated feed order. Key a family post by its post id, a milestone
  // by "ms:<milestoneId>". Listed items appear in exactly this order at the top;
  // anything not listed (new posts, Ra/Marlow) falls after, newest-first.
  // To re-order: just rearrange this list. Max's slot is held until his post lands.
  const ord = new Map(FEED_ORDER.map((k, i) => [k, i]));
  const keyOf = (p: any) => (p.fromMilestone ? "ms:" + p.milestoneId : p.id);
  all.sort((a, b) => {
    const ia = ord.has(keyOf(a)) ? ord.get(keyOf(a))! : Infinity;
    const ib = ord.has(keyOf(b)) ? ord.get(keyOf(b))! : Infinity;
    if (ia !== ib) return ia - ib;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  res.json({ posts: all });
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
  // Optional multi-photo: media array [{file,type}]. Mirror first into mediaFile
  // for backward compat (feed tile, older clients).
  if (Array.isArray(b.media)) {
    const arr = b.media
      .filter((x: any) => x && x.file)
      .map((x: any) => ({ file: path.basename(String(x.file)), type: x.type === "video" ? "video" : "image" }))
      .slice(0, 8);
    if (arr.length) {
      milestone.media = arr;
      milestone.mediaFile = arr[0].file;
      milestone.mediaType = arr[0].type;
    }
  }
  const list = loadMilestones();
  list.push(milestone);
  saveMilestones(list);
  res.json({ ok: true, milestone });
  notifyNewMilestone(milestone); // fire-and-forget
});

// Upload media for a milestone (saves file, returns filename; does NOT create a feed post)
app.post("/api/milestone-media", requireAuth, (req, res) => {
  const origName = decodeURIComponent(String(req.headers["x-filename"] || "upload"));
  const mime = String(req.headers["content-type"] || "application/octet-stream");
  const isVideo = mime.startsWith("video/");
  const isImage = mime.startsWith("image/");
  const skipTranscode = String(req.headers["x-pretranscoded"] || "") === "1";
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
      const media = await normaliseMedia(dest, id, isVideo, skipTranscode);
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

// ---- Edit / delete a comment (parent-only) ----
// Luke & Dana (parent mode) can tidy up or remove any comment on a feed post or
// milestone. Works for both because comments are stored the same way, keyed by
// targetType + targetId. Family (non-parent) visitors have no such control.
app.post("/api/comments/edit", requireParent, (req, res) => {
  const b = req.body || {};
  const targetType = String(b.targetType || "");
  const targetId = String(b.targetId || "");
  const cid = String(b.id || "");
  const text = String(b.text || "").trim();
  if (!validTarget(targetType) || !targetId) return res.status(400).json({ error: "bad target" });
  if (!text) return res.status(400).json({ error: "Write something first." });
  const list = loadComments(targetType, targetId);
  const c = list.find((x) => x.id === cid);
  if (!c) return res.status(404).json({ error: "Couldn't find that comment." });
  c.text = text.slice(0, 1500);
  c.editedAt = new Date().toISOString();
  fs.writeFileSync(commentsPath(targetType, targetId), JSON.stringify(list, null, 2));
  res.json({ ok: true, comment: c });
});
app.post("/api/comments/delete", requireParent, (req, res) => {
  const b = req.body || {};
  const targetType = String(b.targetType || "");
  const targetId = String(b.targetId || "");
  const cid = String(b.id || "");
  if (!validTarget(targetType) || !targetId) return res.status(400).json({ error: "bad target" });
  const list = loadComments(targetType, targetId);
  const idx = list.findIndex((x) => x.id === cid);
  if (idx === -1) return res.status(404).json({ error: "Couldn't find that comment." });
  list.splice(idx, 1);
  fs.writeFileSync(commentsPath(targetType, targetId), JSON.stringify(list, null, 2));
  res.json({ ok: true });
});

// ---- Upload: raw body streamed to disk ----
app.post("/api/upload", requireAuth, (req, res) => {
  const author = String(req.headers["x-author"] || "Someone in the family");
  const caption = decodeURIComponent(String(req.headers["x-caption"] || ""));
  const tz = String(req.headers["x-tz"] || "");
  // From the "who's posting?" picker: kind = family | friend | newfamily; relation = free text (newfamily only)
  const posterKind = String(req.headers["x-kind"] || "").slice(0, 20);
  const posterRelation = decodeURIComponent(String(req.headers["x-relation"] || "")).slice(0, 120);
  // Stable link to a family-tree person, chosen in the "who's posting?" picker.
  // This is what binds a post to a tree circle — NOT the free-text author. So
  // editing the visible name/title on a tile can never break the tree link.
  const posterId = String(req.headers["x-poster-id"] || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  const origName = decodeURIComponent(String(req.headers["x-filename"] || "upload"));
  const mime = String(req.headers["content-type"] || "application/octet-stream");

  const isVideo = mime.startsWith("video/");
  const isImage = mime.startsWith("image/");
  const skipTranscode = String(req.headers["x-pretranscoded"] || "") === "1";
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
      media = await normaliseMedia(dest, id, isVideo, skipTranscode);
    } catch {
      fs.unlink(dest, () => {});
      return res.status(422).json({ error: "Couldn't process that file\u2014try a JPG or MP4?" });
    }
    const post: any = {
      id,
      author: author.slice(0, 80),
      caption: caption.slice(0, 2000),
      mediaFile: media.fileName,
      mediaType: media.mediaType,
      mime: media.mime,
      posterTz: tz,
      createdAt: new Date().toISOString(),
    };
    // Remember when a new family member self-identifies, so it can be surfaced
    // (they asked to be added to the tree). Friends carry no such flag.
    if (posterKind) post.posterKind = posterKind;
    if (posterId) post.posterId = posterId;
    if (posterKind === "newfamily" && posterRelation) post.posterRelation = posterRelation;
    await fsp.writeFile(path.join(POSTS_DIR, id + ".json"), JSON.stringify(post, null, 2));
    res.json({ ok: true, post });
    notifyNewPost(post); // fire-and-forget
  });
  out.on("error", () => {
    if (!aborted) res.status(500).json({ error: "Something went wrong saving that." });
  });
});

// ---- Edit a post's caption / author (parent-only) ----
// Lets Leo's mum & dad (and me on their behalf) tidy up the words under a post
// without re-uploading the media. Only caption & author are editable.
app.post("/api/posts/:id/edit", requireParent, async (req, res) => {
  const id = path.basename(String(req.params.id || ""));
  const file = path.join(POSTS_DIR, id + ".json");
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Couldn't find that post." });
  let post: any;
  try { post = JSON.parse(await fsp.readFile(file, "utf8")); }
  catch { return res.status(500).json({ error: "Couldn't read that post." }); }
  const b = req.body || {};
  if (typeof b.caption === "string") post.caption = b.caption.slice(0, 2000);
  if (typeof b.author === "string" && b.author.trim()) post.author = b.author.trim().slice(0, 80);
  if (typeof b.posterTz === "string") post.posterTz = b.posterTz.trim().slice(0, 60);
  // Re-bind (or clear) the tree link explicitly if asked. Editing the author
  // text alone NEVER touches posterId — the link is deliberately independent.
  if (typeof b.posterId === "string") {
    const pid = b.posterId.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    if (pid) post.posterId = pid; else delete post.posterId;
  }
  await fsp.writeFile(file, JSON.stringify(post, null, 2));
  res.json({ ok: true, post });
});

// ---- Delete a family feed post (parent-only) ----
// Removes the post record; its media file is left on disk so it could be
// recovered if needed (mirrors the milestone-delete behaviour).
app.post("/api/posts/:id/delete", requireParent, async (req, res) => {
  const id = path.basename(String(req.params.id || ""));
  const file = path.join(POSTS_DIR, id + ".json");
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Couldn't find that post." });
  try { await fsp.unlink(file); }
  catch { return res.status(500).json({ error: "Couldn't remove that post." }); }
  res.json({ ok: true });
});

// ---- Edit a milestone's title / story / emoji (parent-only) ----
app.post("/api/milestones/:id/edit", requireParent, (req, res) => {
  const id = String(req.params.id || "");
  const list = loadMilestones();
  const m = list.find((x) => x.id === id);
  if (!m) return res.status(404).json({ error: "Couldn't find that milestone." });
  const b = req.body || {};
  // Feed-display overrides (see /api/feed). These NEVER touch the root milestone
  // text shown on the timeline. resetFeed clears them (feed reverts to root text).
  if (b.resetFeed) { delete m.feedTitle; delete m.feedBody; delete m.feedEmoji; }
  if (typeof b.feedTitle === "string") m.feedTitle = b.feedTitle.trim().slice(0, 140);
  if (typeof b.feedBody === "string") m.feedBody = b.feedBody.slice(0, 4000);
  if (typeof b.feedEmoji === "string") m.feedEmoji = b.feedEmoji.trim().slice(0, 8);
  if (typeof b.title === "string" && b.title.trim()) m.title = b.title.trim().slice(0, 140);
  if (typeof b.body === "string") m.body = b.body.slice(0, 4000);
  if (typeof b.emoji === "string") m.emoji = b.emoji.trim().slice(0, 8);
  // Allow re-dating a milestone (dateText shown; sortISO orders the timeline).
  if (typeof b.dateText === "string" && b.dateText.trim()) m.dateText = b.dateText.trim().slice(0, 60);
  if (typeof b.sortISO === "string" && b.sortISO.trim()) m.sortISO = b.sortISO.trim().slice(0, 40);
  if (typeof b.author === "string" && b.author.trim()) m.author = b.author.trim().slice(0, 80);
  // Attach / replace media. Single mediaFile, OR a full media array [{file,type}].
  if (typeof b.mediaFile === "string" && b.mediaFile.trim()) {
    m.mediaFile = path.basename(b.mediaFile.trim());
    m.mediaType = b.mediaType === "video" ? "video" : "image";
    m.media = [{ file: m.mediaFile, type: m.mediaType }];
  }
  if (Array.isArray(b.media)) {
    const arr = b.media
      .filter((x: any) => x && x.file)
      .map((x: any) => ({ file: path.basename(String(x.file)), type: x.type === "video" ? "video" : "image" }))
      .slice(0, 8);
    m.media = arr;
    if (arr.length) { m.mediaFile = arr[0].file; m.mediaType = arr[0].type; }
    else { delete m.mediaFile; delete m.mediaType; }
  }
  saveMilestones(list);
  res.json({ ok: true, milestone: m });
});

// ---- Delete a milestone (parent-only) ----
// Used to prune the timeline. The media files on disk are left in place so a
// deleted milestone can be recreated verbatim if needed.
app.post("/api/milestones/:id/delete", requireParent, (req, res) => {
  const id = String(req.params.id || "");
  const list = loadMilestones();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return res.status(404).json({ error: "Couldn't find that milestone." });
  const [removed] = list.splice(idx, 1);
  saveMilestones(list);
  res.json({ ok: true, removed });
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
