// GET /api/order?session_id=cs_... — minimal order summary for the thank-you page.
import { json, stripe } from "../lib/shared.mjs";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ error: "Not found" }, 404);
  try {
    const s = await stripe(`/v1/checkout/sessions/${id}`, { method: "GET" });
    if (s.metadata?.source !== "substitution-shop") return json({ error: "Not found" }, 404);
    const name = (s.customer_details?.name || "").trim().split(/\s+/)[0] || "";
    return json({
      first_name: name,
      email: s.customer_details?.email || "",
      total: s.amount_total,
      currency: s.currency,
      paid: s.payment_status === "paid",
      reference: `SUB-${s.id.slice(-8).toUpperCase()}`,
    }, 200, { "Cache-Control": "private, no-store" });
  } catch {
    return json({ error: "Not found" }, 404);
  }
};

export const config = { path: "/api/order" };
