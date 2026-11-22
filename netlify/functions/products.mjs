// GET /api/products — the shop catalog, read live from Printify.
import { env, json, loadCatalog } from "../lib/shared.mjs";

export default async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  try {
    const products = await loadCatalog();
    const shipping_flat = Math.round(Number(env("SHIPPING_FLAT_USD", "6.95")) * 100);
    return json({ products, shipping_flat }, 200, {
      "Cache-Control": "public, max-age=60",
      "Netlify-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    });
  } catch (err) {
    console.error(err);
    return json({ error: "The shop is unavailable right now." }, 502);
  }
};

export const config = { path: "/api/products" };
