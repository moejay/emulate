---
name: gadget
description: Emulated Gadget GraphQL API for Opener Grow Shopify sync and sample-request flows. Use when the user needs a local Gadget endpoint for Grow's customer, product, variant, order, fulfillment, or sample-request queries, or when they need Grow-shaped webhook delivery for `shopify.integration_event` and `sample_request.rejected`.
allowed-tools: Bash(node:*,pnpm:*)
---

# Gadget API Emulator

Stateful Gadget GraphQL emulation for Grow. Covers the actual Grow query shapes for:

- `shopifyShops`
- `shopifyCustomers`
- `shopifyProducts`
- `shopifyProductVariants`
- `shopifyOrders`
- `shopifyOrderLineItems`
- `shopifyFulfillments`
- `sampleRequest`
- `updateSampleRequest`

It also records webhook endpoints and can dispatch Grow-shaped outbound payloads for:

- `shopify.integration_event`
- `sample_request.rejected`

## Current packaging state

This package exists at `packages/@emulators/gadget`, but it is not wired into the central `npx emulate --service ...` registry yet. Start it programmatically in a local script or test harness.

## Minimal start example

```ts
import { createServer } from "@emulators/core";
import gadgetPlugin, { seedFromConfig } from "@emulators/gadget";

const { app, store } = createServer(gadgetPlugin, {
  port: 4400,
  baseUrl: "http://localhost:4400",
  docsUrl: "https://emulate.dev/gadget",
});

gadgetPlugin.seed?.(store, "http://localhost:4400");
seedFromConfig(store, {
  webhooks: [
    {
      id: "grow-webhook",
      label: "Grow local",
      url: "http://localhost:3000/api/webhooks/gadget",
      headers: {
        "x-internal-service-token": "local-test-token",
      },
    },
  ],
});

export default app;
```

## URL mapping

| Grow target | Emulator URL |
|-------------|--------------|
| `$GADGET_BDR_APP_URL/api/graphql` | `$GADGET_EMULATOR_URL/graphql` |
| sample request inspector | `$GADGET_EMULATOR_URL/` |

## Auth

GraphQL requires a bearer API key.

Default key:

```text
gadget_test_api_key
```

Example:

```bash
curl "$GADGET_EMULATOR_URL/graphql" \
  -H "Authorization: Bearer gadget_test_api_key" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ shopifyShops(first: 1) { edges { node { id myshopifyDomain } } } }"}'
```

## Inspector

Open `GET /` to inspect:

- shops
- customers
- products and variants
- orders, line items, and fulfillments
- sample requests
- API keys
- webhook endpoints and deliveries

The inspector also includes controls to:

- dispatch a `shopify.integration_event`
- reject a sample request and dispatch `sample_request.rejected`

## Seed config notes

Useful keys:

- `apiKeys`
- `shops`
- `customers`
- `products`
- `productVariants`
- `orders`
- `orderLineItems`
- `fulfillments`
- `sampleRequests`
- `webhooks`

For Grow webhook testing, seed `webhooks[].headers.x-internal-service-token` with the token Grow expects.

## Current limits

This emulator is intentionally scoped to the Grow integration surface. It does not emulate arbitrary generated Gadget APIs, the Gadget admin UI, or the full platform action system.
