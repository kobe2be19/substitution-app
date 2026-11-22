// POST /api/checkout — builds a Stripe Checkout Session from the cart.
// Prices are always re-read from Printify here; the browser never sets a price.
import { env, json, printify, shopId, normalizeProduct, stripe, taxCodeFor, packItems, SITE_URL } from "../lib/shared.mjs";

const MAX_LINES = 20;
const MAX_QTY = 10;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const raw = Array.isArray(body?.items) ? body.items : [];
  if (!raw.length) return json({ error: "Your bag is empty." }, 400);
  if (raw.length > MAX_LINES) return json({ error: "Too many items in one order." }, 400);

  // Merge duplicates and validate shape.
  const merged = new Map();
  for (const it of raw) {
    const product_id = String(it?.product_id || "");
    const variant_id = Number(it?.variant_id);
    const quantity = Math.floor(Number(it?.quantity));
    if (!/^[a-f0-9]{24}$/i.test(product_id) || !Number.isInteger(variant_id) || !(quantity >= 1)) {
      return json({ error: "Invalid item in your bag." }, 400);
    }
    const key = `${product_id}:${variant_id}`;
    const prev = merged.get(key);
    merged.set(key, { product_id, variant_id, quantity: Math.min(MAX_QTY, (prev?.quantity || 0) + quantity) });
  }
  const items = [...merged.values()];

  // Look up each product once.
  const products = new Map();
  try {
    for (const id of new Set(items.map((i) => i.product_id))) {
      const p = normalizeProduct(await printify(`/shops/${shopId()}/products/${id}.json`));
      if (!p) return json({ error: "An item in your bag is no longer available." }, 409);
      products.set(id, p);
    }
  } catch (err) {
    console.error(err);
    return json({ error: "An item in your bag is no longer available." }, 409);
  }

  const line_items = [];
  for (const it of items) {
    const p = products.get(it.product_id);
    const v = p.variants.find((x) => x.id === it.variant_id);
    if (!v || !v.available) return json({ error: `${p.title} (${v?.title || "that option"}) is sold out.` }, 409);
    const img = p.images.find((im) => im.variant_ids.includes(v.id)) || p.images[0];
    line_items.push({
      quantity: it.quantity,
      price_data: {
        currency: "usd",
        unit_amount: v.price,
        tax_behavior: "exclusive",
        product_data: {
          name: p.title,
          description: v.title,
          images: img ? [img.src] : undefined,
          tax_code: taxCodeFor(p.title),
          metadata: { printify_product_id: p.id, printify_variant_id: String(v.id) },
        },
      },
    });
  }

  const shippingCents = Math.round(Number(env("SHIPPING_FLAT_USD", "6.95")) * 100);
  const countries = env("SHIP_COUNTRIES", "US").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
  const site = SITE_URL();

  try {
    const session = await stripe("/v1/checkout/sessions", {
      params: {
        mode: "payment",
        line_items,
        success_url: `${site}/shop/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/shop`,
        shipping_address_collection: { allowed_countries: countries },
        shipping_options: [{
          shipping_rate_data: {
            type: "fixed_amount",
            display_name: "Standard shipping",
            fixed_amount: { amount: shippingCents, currency: "usd" },
            tax_behavior: "exclusive",
            tax_code: "txcd_92010001",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 5 },
              maximum: { unit: "business_day", value: 10 },
            },
          },
        }],
        automatic_tax: { enabled: env("STRIPE_TAX", "true") !== "false" },
        phone_number_collection: { enabled: true },
        billing_address_collection: "auto",
        submit_type: "pay",
        metadata: { source: "substitution-shop", ...packItems(items) },
        payment_intent_data: {
          description: "Substitution Shop order",
          statement_descriptor_suffix: "SHOP",
          metadata: { source: "substitution-shop" },
        },
      },
    });
    return json({ url: session.url });
  } catch (err) {
    console.error(err);
    return json({ error: "Checkout could not start. Please try again." }, 502);
  }
};

export const config = { path: "/api/checkout" };
