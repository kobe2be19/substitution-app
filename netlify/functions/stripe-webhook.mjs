// POST /api/stripe-webhook — when a shop checkout is paid, send the order to Printify.
// Subscribed events: checkout.session.completed, checkout.session.async_payment_succeeded.
// Sessions from anything else on the same Stripe account (e.g. the Tribune) are ignored.
import { env, json, printify, shopId, stripe, unpackItems, verifyStripeSignature } from "../lib/shared.mjs";

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: "Customer", last_name: "-" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "-" };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts.at(-1) };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), env("STRIPE_WEBHOOK_SECRET"))) {
    return json({ error: "Bad signature" }, 400);
  }

  const event = JSON.parse(raw);
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
    return json({ received: true, ignored: event.type });
  }

  const sessionId = event.data?.object?.id;
  // Re-read the session from Stripe rather than trusting the payload.
  const session = await stripe(`/v1/checkout/sessions/${sessionId}`, { method: "GET", params: { expand: ["payment_intent"] } });
  if (session.metadata?.source !== "substitution-shop") return json({ received: true, ignored: "not a shop order" });
  if (session.payment_status !== "paid") return json({ received: true, waiting: session.payment_status });

  const pi = session.payment_intent;
  if (pi?.metadata?.printify_order_id) {
    return json({ received: true, duplicate: pi.metadata.printify_order_id });
  }

  const items = unpackItems(session.metadata);
  if (!items.length) {
    console.error("Shop session without items", session.id);
    return json({ error: "No items" }, 500);
  }

  const ship = session.collected_information?.shipping_details || session.shipping_details || {};
  const addr = ship.address || {};
  const cust = session.customer_details || {};
  const { first_name, last_name } = splitName(ship.name || cust.name);

  const order = await printify(`/shops/${shopId()}/orders.json`, {
    method: "POST",
    body: {
      external_id: session.id,
      label: `SUB-${session.id.slice(-8).toUpperCase()}`,
      line_items: items,
      shipping_method: 1,
      is_printify_express: false,
      send_shipping_notification: env("PRINTIFY_SHIPPING_EMAILS", "true") !== "false",
      address_to: {
        first_name,
        last_name,
        email: cust.email || "",
        phone: cust.phone || "",
        country: addr.country || "",
        region: addr.state || "",
        address1: addr.line1 || "",
        address2: addr.line2 || "",
        city: addr.city || "",
        zip: addr.postal_code || "",
      },
    },
  });

  // Mark the payment so a retried webhook never creates a second order.
  if (pi?.id) {
    await stripe(`/v1/payment_intents/${pi.id}`, { params: { metadata: { printify_order_id: order.id } } });
  }

  if (env("PRINTIFY_AUTO_PRODUCTION", "false") === "true") {
    await printify(`/shops/${shopId()}/orders/${order.id}/send_to_production.json`, { method: "POST" });
  }

  return json({ received: true, printify_order_id: order.id });
};

export const config = { path: "/api/stripe-webhook" };
