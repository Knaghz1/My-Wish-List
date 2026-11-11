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
const redis = async (...cmd) => (await call("", cmd)).result;
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
const validId = id => typeof id === "string" && /^[a-z0-9]{6,40}$/i.test(id);

function roomKeys(req) {
  let code = "";
  try { code = decodeURIComponent(String(req.headers["x-wl-room"] || "")); } catch { return null; }
  code = code.trim().toLowerCase().replace(/\s+/g, " ");
  if (code.length < 6 || code.length > 64) return null;
  const h = crypto.createHash("sha256").update("my-wish-list:" + code).digest("hex").slice(0, 32);
  return { items: `wl:${h}:items`, cfg: `wl:${h}:config`, ver: `wl:${h}:ver` };
}

async function readState(K) {
  const [flat, cfg, ver] = await pipeline([["HGETALL", K.items], ["GET", K.cfg], ["GET", K.ver]]);
  const items = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) {
    try { items.push(Object.assign(JSON.parse(flat[i + 1]), { id: flat[i] })); } catch {}
  }
  let config = null;
  try { config = cfg ? JSON.parse(cfg) : null; } catch {}
  return { exists: true, ver: Number(ver) || 0, items, config };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!DB_URL || !DB_TOKEN) return res.status(503).json({ error: "no_db" });
  const K = roomKeys(req);
  if (!K) return res.status(401).json({ error: "room" });
  try {
    const exists = (await redis("EXISTS", K.ver)) === 1;
    if (req.method === "GET") return res.status(200).json(exists ? await readState(K) : { exists: false });
    if (req.method !== "POST") return res.status(405).json({ error: "method" });

    let b = req.body || {};
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }

    if (b.op === "init") {
      if (!exists) await pipeline([["SET", K.cfg, JSON.stringify({ names: ["Anh", "Em"] })], ["SET", K.ver, "1"]]);
      return res.status(200).json(await readState(K));
    }
    if (!exists) return res.status(404).json({ error: "no_room" });

    if (b.op === "put") {
      const it = b.item || {};
      if (!validId(it.id)) return res.status(400).json({ error: "id" });
      const exists = await redis("HEXISTS", K.items, it.id);
      if (!exists && (await redis("HLEN", K.items)) >= MAX_ITEMS) return res.status(400).json({ error: "full" });
      await redis("HSET", K.items, it.id, JSON.stringify(clean(it)));
    } else if (b.op === "patch") {
      if (!validId(b.id)) return res.status(400).json({ error: "id" });
      const raw = await redis("HGET", K.items, b.id);
      if (!raw) return res.status(404).json({ error: "not_found" });
      const merged = clean(Object.assign(JSON.parse(raw), b.patch || {}));
      await redis("HSET", K.items, b.id, JSON.stringify(merged));
    } else if (b.op === "del") {
      if (!validId(b.id)) return res.status(400).json({ error: "id" });
      await redis("HDEL", K.items, b.id);
    } else if (b.op === "names") {
      const n = Array.isArray(b.names) ? b.names : [];
      const names = [str(n[0], 24), str(n[1], 24)];
      if (!names[0] || !names[1]) return res.status(400).json({ error: "names" });
      await redis("SET", K.cfg, JSON.stringify({ names }));
    } else {
      return res.status(400).json({ error: "op" });
    }
    await redis("INCR", K.ver);
    return res.status(200).json(await readState(K));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server" });
  }
};
