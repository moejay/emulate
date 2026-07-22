# @emulators/gadget

Stateful local Gadget GraphQL emulation for Opener Grow's Shopify sync and sample-request flows. Supports the Grow GraphQL documents used for shops, customers, products, variants, orders, line items, fulfillments, and sample requests, plus Grow-shaped outbound webhook delivery for `shopify.integration_event` and `sample_request.rejected` payloads.

Part of [emulate](https://github.com/vercel-labs/emulate) — local drop-in replacement services for CI and no-network sandboxes.

## Install

```bash
npm install @emulators/gadget
```

## Endpoints

- `POST /graphql` — Gadget GraphQL endpoint with API-key auth
- `GET /graphql` — GraphQL GET transport
- `GET /` — tabbed inspector for shops, customers, products, orders, sample requests, auth, webhooks, and deliveries
- `POST /inspector/integration-event` — inspector control for dispatching a `shopify.integration_event`
- `POST /inspector/sample-requests/:id/reject` — inspector control for dispatching a `sample_request.rejected` event

## Auth

GraphQL requires `Authorization: Bearer <api-key>`.

Default key:

```text
gadget_test_api_key
```

## Seed Configuration

```yaml
gadget:
  apiKeys:
    - token: gadget_test_api_key
      label: Local Gadget API key
  shops:
    - id: gid://shopify/Shop/1
      myshopifyDomain: acme-snacks.myshopify.com
      name: Acme Snacks
  customers:
    - id: gid://shopify/Customer/101
      shopId: gid://shopify/Shop/1
      legacyResourceId: "101"
      email: buyer@harbormarket.example
      firstName: Harper
      lastName: Lee
  products:
    - id: gid://shopify/Product/201
      shopId: gid://shopify/Shop/1
      title: Sea Salt Granola Bites
  productVariants:
    - id: gid://shopify/ProductVariant/401
      shopId: gid://shopify/Shop/1
      productId: gid://shopify/Product/201
      sku: GRANOLA-12
  orders:
    - id: gid://shopify/Order/301
      shopId: gid://shopify/Shop/1
      customerId: gid://shopify/Customer/101
  sampleRequests:
    - id: sample_request_1
      status: pending
      customerName: Harper Lee
      customerAddress: 179 Commercial St, Boston, MA 02109, Canada
      brandId: 42
      storeId: 7
      activityId: activity_abc
  webhooks:
    - id: grow-webhook
      label: Grow local
      url: http://localhost:3000/api/webhooks/gadget
      eventTypes:
        - shopify.integration_event
        - sample_request.rejected
      headers:
        x-internal-service-token: local-test-token
```

## GraphQL Surface

Supported queries:

- `shopifyShops`
- `shopifyCustomers`
- `shopifyProducts`
- `shopifyProductVariants`
- `shopifyOrders`
- `shopifyOrderLineItems`
- `shopifyFulfillments`
- `sampleRequest`

Supported mutations:

- `updateSampleRequest`

## Current Limits

This package intentionally covers the Grow query and webhook shapes in current use. It does not aim to emulate the full Gadget platform, app builder, admin UI, or arbitrary generated model APIs. It is not wired into the central `npx emulate --service ...` registry yet.
