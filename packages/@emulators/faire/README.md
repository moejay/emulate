# @emulators/faire

Stateful Faire OAuth, External API v2, and Faire Messenger emulator for local development and CI.

Part of [emulate](https://github.com/vercel-labs/emulate), local drop-in replacement services for CI and no-network sandboxes.

## Install

```bash
npm install @emulators/faire
```

## Supported Surface

- `GET /oauth2/authorize` and `POST /api/external-api-oauth2/token`
- `GET /external-api/v2/brands/profile`
- `GET /external-api/v2/products` and `GET /external-api/v2/products/:id`
- `GET /external-api/v2/retailers/public/:id`
- `GET /external-api/v2/orders` and `GET /external-api/v2/orders/:id`
- `POST /external-api/v2/orders`, `PATCH /external-api/v2/orders/:id`, and `POST /external-api/v2/orders/:id/shipments`
- `POST /api/v2/users/login`
- `POST /api/user/switch-account`
- `GET /api/v3/messenger/retailer-conversation/:retailerToken`
- `POST /api/messenger/list-conversations`
- `POST /api/v3/messenger/list-messages-page`
- `POST /api/v3/messenger/create-conversation`
- `POST /api/v3/messenger/send-message`
- `GET /` local inspector and MFA completion route

OAuth access tokens and API tokens are stateful. Messenger sessions use a real cookie header flow with JWT-shaped `indigofair_session` values and `x-if-wsat` login responses so Grow's current session parsing works unchanged.

## Auth

External API v2 supports the two auth modes Grow uses today:

- API token auth via `X-FAIRE-ACCESS-TOKEN`
- OAuth app auth via `X-FAIRE-APP-CREDENTIALS` plus `X-FAIRE-OAUTH-ACCESS-TOKEN`

Faire Messenger supports:

- `cookie: indigofair_session=...`
- `x-facnt: <brand token>`
- `x-if-app-identifier: web-maker` or `web-retailer`

## Seed Configuration

```yaml
faire:
  brands:
    - brand_id: b_acme
      name: Acme Foods
  users:
    - email: owner@example.com
      password: password
      name: Owner
      brand_ids: [b_acme]
      default_brand_id: b_acme
  oauth_apps:
    - application_token: emu_faire_app_id
      application_secret: emu_faire_app_secret
      name: My Faire App
      redirect_urls:
        - http://localhost:3000/api/auth/callback/faire
      scopes: [READ_ORDERS, READ_PRODUCTS, READ_BRAND, READ_RETAILER]
  tokens:
    - access_token: faire_test_api_token
      token_type: api_token
      brand_id: b_acme
      scopes: [READ_ORDERS, READ_PRODUCTS, READ_BRAND, READ_RETAILER]
  retailers:
    - retailer_id: r_corner
      name: Corner Pantry
      is_insider: true
      accepting_messages: true
  products:
    - id: prod_1
      brand_id: b_acme
      name: Sunrise Tonic
      sale_state: FOR_SALE
      lifecycle_state: PUBLISHED
      variants:
        - id: var_1
          sku: SUN-TONIC-12
          quantity: 12
          price_cents: 1800
  orders:
    - id: bo_1
      brand_id: b_acme
      retailer_id: r_corner
      state: DELIVERED
      source: SAMPLE
      currency: USD
  conversations:
    - token: mc_1
      brand_id: b_acme
      retailer_token: r_corner
      retailer_name: Corner Pantry
      include_in_list: true
  messages:
    - token: mm_1
      brand_id: b_acme
      conversation_token: mc_1
      message_type: standard
      author_token: r_corner
      body: Can you send another sample?
  webhooks:
    - brand_id: b_acme
      url: http://localhost:3000/webhooks/faire
      events: [order.created, order.updated, shipment.created, conversation.created, message.sent]
```

## Inspector

Open `GET /` to inspect brands, users, OAuth apps, tokens, sessions, retailers, products, orders, Messenger conversations and messages, webhook subscriptions, and webhook deliveries.

## Current Limits

This package is intentionally focused on the Faire surfaces Grow currently uses. Refresh tokens, the full public Faire schema, exact production webhook formats, file uploads, and every historical Messenger edge case are not implemented.
