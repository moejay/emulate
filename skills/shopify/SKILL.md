---
name: shopify
description: Emulated Shopify Admin API for local development and testing. Use when the user needs local Shopify OAuth, Admin GraphQL queries, B2B customer and company data, products and variants, orders, fulfillments, bulk operations, draft orders, webhook subscriptions, GDPR webhooks, or Shopify session tokens without calling the real Shopify API. Triggers include "Shopify Admin API", "Shopify GraphQL", "Shopify OAuth", "Shopify webhooks", "bulk operations", "draft orders", "session token", or any task requiring a local Shopify backend.
allowed-tools: Bash(npx emulate:*), Bash(emulate:*), Bash(curl:*)
---

# Shopify Admin API Emulator

Stateful Shopify Admin API emulation for local app installs, Admin GraphQL reads and mutations, webhook delivery, B2B signals, and embedded app session tokens.

## Start

```bash
npx emulate --service shopify
```

Default port when run alone:

```text
http://localhost:4000
```

Or programmatically:

```typescript
import { createEmulator } from 'emulate'

const shopify = await createEmulator({ service: 'shopify', port: 4000 })
```

## Important Endpoints

| Purpose | Endpoint |
| --- | --- |
| OAuth authorize | `/admin/oauth/authorize` |
| OAuth token exchange | `/admin/oauth/access_token` |
| Admin GraphQL | `/admin/api/2026-01/graphql.json` |
| Session token minting | `/auth/session-token` |
| Inspector | `/` |

## Auth

### Admin access token

Pass the access token with `X-Shopify-Access-Token` or `Authorization: Bearer ...`.

```bash
curl http://localhost:4000/admin/api/2026-01/graphql.json \
  -H 'Content-Type: application/json' \
  -H 'X-Shopify-Access-Token: shpat_test_admin' \
  -d '{"query":"{ shop { name myshopifyDomain } }"}'
```

### Embedded app session token

Mint a short-lived HS256 token signed with the seeded app's client secret:

```bash
curl http://localhost:4000/auth/session-token \
  -H 'X-Shopify-Access-Token: shpat_test_admin'
```

The payload matches what local embedded app flows need:

- `iss = https://<shop>/admin`
- `dest = https://<shop>/admin`
- `aud = <client_id>`
- `sub = gid://shopify/User/<id>`

## Seed Config

```yaml
shopify:
  shop:
    name: Demo Shop
    myshopify_domain: demo-shop.myshopify.com
    currency_code: USD
  oauth_apps:
    - client_id: shopify-client-id
      client_secret: shopify-client-secret
      name: Local Shopify App
      redirect_uris:
        - http://localhost:3000/api/auth/callback/shopify
      scopes:
        - read_customers
        - read_products
        - read_orders
        - write_draft_orders
        - write_fulfillments
  access_tokens:
    - token: shpat_test_admin
  webhook_subscriptions:
    - topic: bulk_operations/finish
      uri: http://localhost:3000/api/shopify/webhooks
  customers:
    - id: 1001
      email: buyer@example.com
      first_name: Taylor
      last_name: Buyer
      company: Corner Store
      tags: [b2b, wholesale]
  products:
    - id: 2001
      title: Demo Granola
      vendor: Opener Foods
      variants:
        - id: 3001
          title: 12-pack
          sku: GRANOLA-12
          price: 48.00
  orders:
    - id: 4001
      name: '#1001'
      customer_id: 1001
      display_financial_status: PAID
      display_fulfillment_status: UNFULFILLED
      line_items:
        - variant_id: 3001
          quantity: 2
```

## Supported GraphQL Surfaces

The emulator is designed around the Grow Shopify documents and nearby workflows:

- `shop`
- `customers`
- `companies`
- `products`
- `orders`
- `currentBulkOperation`
- `bulkOperationRunQuery`
- `draftOrderCreate`
- `webhookSubscriptionCreate`
- `webhookSubscriptions`
- `webhookSubscriptionDelete`
- `fulfillmentCreateV2`

Cursor pagination is stateful and compatible with Grow's `fetchAllGraphQL(...)` pattern.

## Bulk Operations

Start a bulk export via Admin GraphQL. The emulator will:

1. create a bulk operation record
2. generate JSONL output
3. expose the result at a local `.../bulk/<id>.jsonl` URL
4. send a signed `bulk_operations/finish` webhook to matching subscriptions

## Webhooks

Webhook deliveries include Shopify-style headers:

- `X-Shopify-Topic`
- `X-Shopify-Shop-Domain`
- `X-Shopify-Webhook-Id`
- `X-Shopify-Hmac-Sha256`

The HMAC uses the seeded app `client_secret`, matching Grow's local verification behavior.

GDPR topics are supported:

- `customers/data_request`
- `customers/redact`
- `shop/redact`

Use the inspector to emit test webhook payloads.

## Inspector

Open `/` to inspect:

- shop, customers, companies, products, and orders
- OAuth apps and access tokens
- session token previews
- webhook subscriptions and deliveries
- bulk operations and draft orders

The inspector also lets you emit signed test topics for product, order, bulk, uninstall, and GDPR flows.
