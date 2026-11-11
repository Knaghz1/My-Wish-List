// My Wish List — shared state API (Vercel Serverless Function + Upstash Redis REST).
// GET  /api/state            -> { ver, items, config }
// POST /api/state {op, ...}  -> same, after the change
// Env: KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
//      WISHLIST_PASSCODE (optional, strongly recommended)
const crypto = require("crypto");

const DB_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const DB_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const PASS = process.env.WISHLIST_PASSCODE || "";

const K_ITEMS = "wl:items", K_CFG = "wl:config", K_VER = "wl:ver";
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

async function readState() {
  const [flat, cfg, ver] = await pipeline([["HGETALL", K_ITEMS], ["GET", K_CFG], ["GET", K_VER]]);
  const items = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) {
    try { items.push(Object.assign(JSON.parse(flat[i + 1]), { id: flat[i] })); } catch {}
  }
  let config = null;
  try { config = cfg ? JSON.parse(cfg) : null; } catch {}
  return { ver: Number(ver) || 0, items, config };
}

function passOk(given) {
  if (!PASS) return true;
  const a = Buffer.from(String(given || "")), b = Buffer.from(PASS);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!DB_URL || !DB_TOKEN) return res.status(503).json({ error: "no_db" });
  if (!passOk(req.headers["x-wl-key"])) return res.status(401).json({ error: "passcode" });
  try {
    if (req.method === "GET") return res.status(200).json(await readState());
    if (req.method !== "POST") return res.status(405).json({ error: "method" });

    let b = req.body || {};
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }

    if (b.op === "put") {
      const it = b.item || {};
      if (!validId(it.id)) return res.status(400).json({ error: "id" });
      const exists = await redis("HEXISTS", K_ITEMS, it.id);
      if (!exists && (await redis("HLEN", K_ITEMS)) >= MAX_ITEMS) return res.status(400).json({ error: "full" });
      await redis("HSET", K_ITEMS, it.id, JSON.stringify(clean(it)));
    } else if (b.op === "patch") {
      if (!validId(b.id)) return res.status(400).json({ error: "id" });
      const raw = await redis("HGET", K_ITEMS, b.id);
      if (!raw) return res.status(404).json({ error: "not_found" });
      const merged = clean(Object.assign(JSON.parse(raw), b.patch || {}));
      await redis("HSET", K_ITEMS, b.id, JSON.stringify(merged));
    } else if (b.op === "del") {
      if (!validId(b.id)) return res.status(400).json({ error: "id" });
      await redis("HDEL", K_ITEMS, b.id);
    } else if (b.op === "names") {
      const n = Array.isArray(b.names) ? b.names : [];
      const names = [str(n[0], 24), str(n[1], 24)];
      if (!names[0] || !names[1]) return res.status(400).json({ error: "names" });
      await redis("SET", K_CFG, JSON.stringify({ names }));
    } else {
      return res.status(400).json({ error: "op" });
    }
    await redis("INCR", K_VER);
    return res.status(200).json(await readState());
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server" });
  }
};
