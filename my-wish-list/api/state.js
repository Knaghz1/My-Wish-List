// My Wish List — shared state API (Vercel Serverless Function + Upstash Redis REST).
// Each couple has its own room, chosen by a room code sent in the x-wl-room header.
// The code is both the room's name and its secret; only its SHA-256 hash is used as the key.
// GET  /api/state            -> { exists, ver, items, config }   (exists:false if the room is new)
// POST /api/state {op, ...}  -> same, after the change   (op "init" creates the room)
// Env: KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
const crypto = require("crypto");

const DB_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const DB_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const MAX_ITEMS = 500;
const CATS = ["fashion", "beauty", "books", "tech", "home", "food", "experience", "other"];
const STATUS = ["open", "picked", "gifted"];

async function call(path, body) {
  const r = await fetch(DB_URL + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + DB_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok || (j && j.error)) throw new Error((j && j.error) || "redis " + r.status);
  return j;
}
const pipeline = async cmds => (await call("/pipeline", cmds)).map(x => {
  if (x.error) throw new Error(x.error);
  return x.result;
});

const str = (v, max) => (v == null || v === "" ? null : String(v).slice(0, max));
function clean(it) {
  const price = Number(it.price);
  return {
    owner: it.owner === 1 ? 1 : 0,
    title: str(it.title, 90) || "Không tên",
    price: it.price != null && Number.isFinite(price) && price >= 0 ? Math.round(price) : null,
    link: /^https?:\/\//i.test(String(it.link || "")) ? String(it.link).slice(0, 500) : "",
    category: CATS.includes(it.category) ? it.category : "other",
    note: str(it.note, 300) || "",
    hearts: [1, 2, 3].includes(it.hearts) ? it.hearts : 2,
    createdAt: Number(it.createdAt) || Date.now(),
    status: STATUS.includes(it.status) ? it.status : "open",
    pickedBy: it.pickedBy === 0 || it.pickedBy === 1 ? it.pickedBy : null,
    occasion: str(it.occasion, 40),
    occasionDate: /^\d{4}-\d{2}-\d{2}$/.test(String(it.occasionDate || "")) ? it.occasionDate : null,
    pickNote: str(it.pickNote, 300),
    giftedAt: Number(it.giftedAt) || null,
  };
}
const MAX_SONGS = 30;
const MAX_MISSES = 30;   // wrong room codes per IP per 10 minutes
const MAX_CREATES = 10;  // new rooms per IP per hour
function clientIp(req) {
  const f = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (f || req.headers["x-real-ip"] || "unknown").toString().slice(0, 64);
}
// counter that resets itself after `ttl` seconds
async function bump(key, ttl) {
  // SET ... NX EX starts the window once; INCR keeps the expiry
  const [, n] = await pipeline([["SET", key, "0", "EX", String(ttl), "NX"], ["INCR", key]]);
  return Number(n) || 0;
}
function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(d + "T00:00:00Z");
  return Number.isFinite(t) && t > Date.parse("1950-01-01") && t < Date.now() + 2 * 86400000;
}
// accepts youtube.com/watch?v=, youtu.be/, /shorts/, /embed/, /live/, music.youtube.com, or a bare 11-char id
function youtubeId(url) {
  const u = String(url || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(u)) return u;
  const m = u.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
  return m ? m[1] : null;
}
// title via YouTube oEmbed; null when the video is private, removed or not embeddable
async function youtubeInfo(id) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id), { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return { title: String(j.title || "Bài YouTube").slice(0, 100) };
  } catch { return { title: "Bài YouTube" }; }
  finally { clearTimeout(t); }
}
const validId = id => typeof id === "string" && /^[a-z0-9]{6,40}$/i.test(id);

function roomKeys(req) {
  let code = "";
  try { code = decodeURIComponent(String(req.headers["x-wl-room"] || "")); } catch { return null; }
  code = code.trim().toLowerCase().replace(/\s+/g, " ");
  if (code.length < 6 || code.length > 64) return null;
  const h = crypto.createHash("sha256").update("my-wish-list:" + code).digest("hex").slice(0, 32);
  return { items: `wl:${h}:items`, cfg: `wl:${h}:config`, ver: `wl:${h}:ver` };
}

function parseState(flat, cfg, ver) {
  const items = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) {
    try { items.push(Object.assign(JSON.parse(flat[i + 1]), { id: flat[i] })); } catch {}
  }
  let config = null;
  try { config = cfg ? JSON.parse(cfg) : null; } catch {}
  return { exists: true, ver: Number(ver) || 0, items, config };
}
// One round trip: the writes, the version bump and the fresh state.
async function writeAndRead(K, cmds) {
  const out = await pipeline([...cmds, ["INCR", K.ver], ["HGETALL", K.items], ["GET", K.cfg], ["GET", K.ver]]);
  const n = out.length;
  return parseState(out[n - 3], out[n - 2], out[n - 1]);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!DB_URL || !DB_TOKEN) return res.status(503).json({ error: "no_db" });
  const K = roomKeys(req);
  if (!K) return res.status(401).json({ error: "room" });
  try {
    const ip = clientIp(req);
    if (req.method === "GET") {
      const [misses, ex, flat, cfg, ver] = await pipeline([["GET", "wl:rl:miss:" + ip], ["EXISTS", K.ver], ["HGETALL", K.items], ["GET", K.cfg], ["GET", K.ver]]);
      // too many wrong codes from this address: stop answering for a while, so codes can't be guessed
      if (Number(misses) >= MAX_MISSES) return res.status(429).json({ error: "rate" });
      if (ex === 1) return res.status(200).json(parseState(flat, cfg, ver));
      await bump("wl:rl:miss:" + ip, 600);
      return res.status(200).json({ exists: false });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "method" });

    let b = req.body || {};
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }

    // one round trip for everything the checks need
    const needItem = (b.op === "patch" || b.op === "put") && validId(b.op === "put" ? (b.item || {}).id : b.id);
    const [ex, count, current, cfgRaw] = await pipeline([
      ["EXISTS", K.ver], ["HLEN", K.items],
      needItem ? ["HGET", K.items, b.op === "put" ? b.item.id : b.id] : ["GET", "wl:none"],
      ["GET", K.cfg],
    ]);
    const exists = ex === 1;
    let cfg = {};
    try { cfg = cfgRaw ? JSON.parse(cfgRaw) || {} : {}; } catch { cfg = {}; }
    const saveCfg = patch => [["SET", K.cfg, JSON.stringify(Object.assign({}, cfg, patch))]];

    if (b.op === "init") {
      if (exists) return res.status(200).json(await writeAndRead(K, []));
      if ((await bump("wl:rl:create:" + ip, 3600)) > MAX_CREATES) return res.status(429).json({ error: "rate" });
      return res.status(200).json(await writeAndRead(K, [["SET", K.cfg, JSON.stringify({ names: ["Anh", "Em"] })]]));
    }
    if (!exists) return res.status(404).json({ error: "no_room" });

    let cmds;
    if (b.op === "put") {
      const it = b.item || {};
      if (!validId(it.id)) return res.status(400).json({ error: "id" });
      if (!current && count >= MAX_ITEMS) return res.status(400).json({ error: "full" });
      cmds = [["HSET", K.items, it.id, JSON.stringify(clean(it))]];
    } else if (b.op === "patch") {
      if (!validId(b.id)) return res.status(400).json({ error: "id" });
      if (!current) return res.status(404).json({ error: "not_found" });
      cmds = [["HSET", K.items, b.id, JSON.stringify(clean(Object.assign(JSON.parse(current), b.patch || {})))]];
    } else if (b.op === "del") {
      if (!validId(b.id)) return res.status(400).json({ error: "id" });
      cmds = [["HDEL", K.items, b.id]];
    } else if (b.op === "names") {
      const n = Array.isArray(b.names) ? b.names : [];
      const names = [str(n[0], 24), str(n[1], 24)];
      if (!names[0] || !names[1]) return res.status(400).json({ error: "names" });
      cmds = saveCfg({ names });
    } else if (b.op === "date") {
      const d = b.date == null || b.date === "" ? null : String(b.date);
      if (d !== null && !validDate(d)) return res.status(400).json({ error: "date" });
      cmds = saveCfg({ startDate: d });
    } else if (b.op === "song_add") {
      const id = youtubeId(b.url);
      if (!id) return res.status(400).json({ error: "song_url" });
      const songs = Array.isArray(cfg.songs) ? cfg.songs : [];
      if (songs.some(x => x.id === id)) return res.status(200).json(await writeAndRead(K, []));
      if (songs.length >= MAX_SONGS) return res.status(400).json({ error: "songs_full" });
      const info = await youtubeInfo(id);
      if (!info) return res.status(400).json({ error: "song_unavailable" });
      cmds = saveCfg({ songs: [...songs, { id, title: info.title }] });
    } else if (b.op === "song_del") {
      const songs = Array.isArray(cfg.songs) ? cfg.songs : [];
      cmds = saveCfg({ songs: songs.filter(x => x.id !== String(b.id)) });
    } else {
      return res.status(400).json({ error: "op" });
    }
    return res.status(200).json(await writeAndRead(K, cmds));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server" });
  }
};
