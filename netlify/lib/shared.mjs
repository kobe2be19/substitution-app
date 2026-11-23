// Shared helpers for the Substitution shop (Stripe Checkout + Printify).
// No npm dependencies: Stripe and Printify are called over HTTPS with fetch.
import crypto from "node:crypto";

export function env(key, fallback) {
  const fromNetlify = globalThis.Netlify?.env?.get?.(key);
  const value = fromNetlify ?? process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

export const SITE_URL = () => env("SITE_URL", "https://substitution.app").replace(/\/$/, "");

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

// ---------- Printify ----------
const printifyBase = () => env("PRINTIFY_API_BASE", "https://api.printify.com/v1");
export const shopId = () => env("PRINTIFY_SHOP_ID");

export async function printify(path, { method = "GET", body } = {}) {
  const res = await fetch(printifyBase() + path, {
    method,
    headers: {
      Authorization: `Bearer ${env("PRINTIFY_API_TOKEN")}`,
      "User-Agent": "Substitution-Shop/1.0",
      "Content-Type": "application/json;charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`Printify ${method} ${path} -> ${res.status}: ${String(text).slice(0, 400)}`);
  return data;
}

const APPAREL = /\b(tee|t-shirt|shirt|hoodie|crewneck|sweatshirt|sweater|jacket|shorts|pants|joggers|zip|quarter-zip|sleeve|pullover|hat|cap|beanie|snapback|socks|polo|jersey)\b/i;
export function taxCodeFor(title) {
  // Stripe Tax codes: clothing vs. general tangible goods.
  return APPAREL.test(title || "") ? "txcd_30011000" : "txcd_99999999";
}

function plainText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Turn a raw Printify product into what the shop page needs.
export function normalizeProduct(p) {
  const variants = (p.variants || [])
    .filter((v) => v.is_enabled !== false)
    .map((v) => ({
      id: v.id,
      title: v.title,
      price: v.price, // cents, the retail price set in Printify
      options: v.options || [],
      available: v.is_available !== false,
    }));
  if (!variants.length) return null;
  const used = new Set(variants.flatMap((v) => v.options));
  const options = (p.options || []).map((o) => ({
    name: o.name,
    type: o.type,
    values: (o.values || []).filter((val) => used.has(val.id)).map((val) => ({ id: val.id, title: val.title, colors: val.colors || null })),
  })).filter((o) => o.values.length);
  const images = (p.images || [])
    .slice()
    .sort((a, b) => (b.is_default === true) - (a.is_default === true))
    .map((img) => ({ src: img.src, variant_ids: img.variant_ids || [] }));
  const prices = variants.map((v) => v.price);
  return {
    id: p.id,
    title: p.title,
    description: plainText(p.description),
    tags: p.tags || [],
    options,
    variants,
    images,
    price_from: Math.min(...prices),
    price_to: Math.max(...prices),
  };
}

export async function loadCatalog() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const data = await printify(`/shops/${shopId()}/products.json?limit=50&page=${page}`);
    for (const p of data.data || []) {
      const tags = (p.tags || []).map((t) => String(t).toLowerCase());
      if (tags.includes("hidden")) continue;
      const n = normalizeProduct(p);
      if (n) out.push(n);
    }
    if (!data.last_page || page >= data.last_page) break;
  }
  return out;
}

// ---------- Stripe ----------
const stripeBase = () => env("STRIPE_API_BASE", "https://api.stripe.com");

function formEncode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") formEncode(item, `${key}[${i}]`, out);
        else out.push([`${key}[${i}]`, String(item)]);
      });
    } else if (typeof v === "object") {
      formEncode(v, key, out);
    } else {
      out.push([key, String(v)]);
    }
  }
  return out;
}

export async function stripe(path, { method = "POST", params } = {}) {
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
      "Stripe-Version": "2024-06-20",
    },
  };
  let url = stripeBase() + path;
  if (params) {
    const body = new URLSearchParams(formEncode(params)).toString();
    if (method === "GET") url += (url.includes("?") ? "&" : "?") + body;
    else {
      init.body = body;
      init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
  }
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${path} -> ${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 300)}`);
  return data;
}

// Verify the Stripe-Signature header against the raw request body.
export function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.create(null);
  const v1 = [];
  for (const piece of header.split(",")) {
    const [k, v] = piece.split("=");
    if (k === "v1") v1.push(v); else parts[k] = v;
  }
  const t = Number(parts.t);
  if (!t || !v1.length) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  return v1.some((sig) => {
    const b = Buffer.from(sig, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

// Cart <-> metadata (Stripe metadata values are capped at 500 characters).
export function packItems(items) {
  const chunks = [];
  let cur = "";
  for (const it of items) {
    const s = `${it.product_id}:${it.variant_id}:${it.quantity}`;
    if (cur && cur.length + 1 + s.length > 490) { chunks.push(cur); cur = s; }
    else cur = cur ? `${cur},${s}` : s;
  }
  if (cur) chunks.push(cur);
  const meta = { items_count: String(chunks.length) };
  chunks.forEach((c, i) => (meta[`items_${i}`] = c));
  return meta;
}

export function unpackItems(meta) {
  const n = Number(meta?.items_count || 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    for (const s of String(meta[`items_${i}`] || "").split(",").filter(Boolean)) {
      const [product_id, variant_id, quantity] = s.split(":");
      out.push({ product_id, variant_id: Number(variant_id), quantity: Number(quantity) });
    }
  }
  return out;
}
