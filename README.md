# Substitution Shop API (branch `shop-api`)

Serverless backend for **substitution.app/shop**. Deployed as its own Netlify site from this branch.
The main site (drag-and-drop deploy) proxies `/api/*` here, so customers only ever see substitution.app.

Flow: shop page → `POST /api/checkout` (Stripe Checkout Session, prices re-read from Printify) →
customer pays on Stripe → Stripe calls `POST /api/stripe-webhook` → order created in Printify.

| Endpoint | Purpose |
|---|---|
| `GET /api/products` | Catalog from the Printify shop (products tagged `hidden` are skipped) |
| `POST /api/checkout` | Creates the Stripe Checkout Session (flat shipping, Stripe Tax) |
| `POST /api/stripe-webhook` | On paid shop checkouts, creates the Printify order (idempotent) |
| `GET /api/order?session_id=` | Small summary for the thank-you page |

## Environment variables (Netlify → this site → Site configuration → Environment variables)
Required: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRINTIFY_API_TOKEN`, `PRINTIFY_SHOP_ID`

Optional:
- `SHIPPING_FLAT_USD` (default `6.95`)
- `SHIP_COUNTRIES` (default `US`; comma-separated, e.g. `US,CA,GB`)
- `PRINTIFY_AUTO_PRODUCTION` (default `false`: orders wait "On hold" in Printify for approval; `true` sends them straight to production)
- `PRINTIFY_SHIPPING_EMAILS` (default `true`)
- `STRIPE_TAX` (default `true`)
- `SITE_URL` (default `https://substitution.app`)

## Stripe webhook
Endpoint: `https://<this-site>.netlify.app/api/stripe-webhook`
Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`.
Sessions without `metadata.source = substitution-shop` (e.g. the Tribune) are ignored.

## Main-site files
`site-shop/` holds the pages that go into the main site's deploy folder: `shop/index.html`,
`shop/shop.css`, `shop/shop.js`, `shop/thanks/index.html`, plus the redirect in
`site-shop/netlify-redirect.toml` to append to the main site's `netlify.toml`.
