---
name: faire
description: Emulated Faire OAuth, External API v2, and Faire Messenger for local development and testing. Use when the user needs to test Grow's Faire sync, Faire OAuth, Faire API token auth, retailer and order imports, Messenger conversation sync, or Faire message sends without calling the real Faire service.
allowed-tools: Bash(curl:*), Bash(node:*), Bash(pnpm:*)
---

# Faire Emulator

Stateful Faire emulator focused on the surfaces Grow currently uses:

- OAuth authorize and token exchange
- External API v2 brand profile, products, retailers, and orders
- API token auth and OAuth app auth headers
- Stateful Faire Messenger login, MFA completion links, brand switching, conversation lookup, conversation listing, message listing, create-conversation, and send-message
- Local inspector at `GET /`

## Package

Workspace package: `packages/@emulators/faire`

This branch intentionally does not edit the central service registry or `packages/emulate`, so `npx emulate --service faire` is not wired here. Use the package directly in tests or a local harness.

## Programmatic Use

```ts
import { createServer } from "@emulators/core"
import fairePlugin, { seedFromConfig } from "@emulators/faire"

const server = createServer(fairePlugin, { baseUrl: "http://localhost:4000" })
fairePlugin.seed?.(server.store, server.baseUrl)
seedFromConfig(server.store, server.baseUrl, {
  brands: [{ brand_id: "b_acme", name: "Acme Foods" }],
})
```

## Important URLs

| Real Faire URL | Emulator URL |
| --- | --- |
| `https://www.faire.com/oauth2/authorize` | `$FAIRE_EMULATOR_URL/oauth2/authorize` |
| `https://www.faire.com/api/external-api-oauth2/token` | `$FAIRE_EMULATOR_URL/api/external-api-oauth2/token` |
| `https://www.faire.com/external-api/v2/brands/profile` | `$FAIRE_EMULATOR_URL/external-api/v2/brands/profile` |
| `https://www.faire.com/external-api/v2/products` | `$FAIRE_EMULATOR_URL/external-api/v2/products` |
| `https://www.faire.com/external-api/v2/orders` | `$FAIRE_EMULATOR_URL/external-api/v2/orders` |
| `https://www.faire.com/external-api/v2/retailers/public/:id` | `$FAIRE_EMULATOR_URL/external-api/v2/retailers/public/:id` |
| `https://www.faire.com/api/v2/users/login` | `$FAIRE_EMULATOR_URL/api/v2/users/login` |
| `https://www.faire.com/api/user/switch-account` | `$FAIRE_EMULATOR_URL/api/user/switch-account` |
| `https://www.faire.com/api/messenger/list-conversations` | `$FAIRE_EMULATOR_URL/api/messenger/list-conversations` |
| `https://www.faire.com/api/v3/messenger/list-messages-page` | `$FAIRE_EMULATOR_URL/api/v3/messenger/list-messages-page` |
| `https://www.faire.com/api/v3/messenger/create-conversation` | `$FAIRE_EMULATOR_URL/api/v3/messenger/create-conversation` |
| `https://www.faire.com/api/v3/messenger/send-message` | `$FAIRE_EMULATOR_URL/api/v3/messenger/send-message` |

## Auth

### API token

```bash
curl "$FAIRE_EMULATOR_URL/external-api/v2/brands/profile" \
  -H "X-FAIRE-ACCESS-TOKEN: faire_test_api_token"
```

### OAuth app

```bash
curl "$FAIRE_EMULATOR_URL/external-api/v2/brands/profile" \
  -H "X-FAIRE-APP-CREDENTIALS: $(printf 'emu_faire_app_id:emu_faire_app_secret' | base64)" \
  -H "X-FAIRE-OAUTH-ACCESS-TOKEN: <oauth-access-token>"
```

### Messenger

```bash
curl "$FAIRE_EMULATOR_URL/api/v2/users/login" \
  -H "Content-Type: application/json" \
  -d '{"email_address":"brand@example.com","password":"password","enable_mfa_method_selection":true}'
```

Use the returned `x-if-wsat` value as `indigofair_session`, then send `x-facnt: <brand token>` on Messenger requests.

## Seed Config

```yaml
faire:
  brands:
    - brand_id: b_acme
      name: Acme Foods
  users:
    - email: owner@example.com
      password: password
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
  retailers:
    - retailer_id: r_corner
      name: Corner Pantry
      accepting_messages: true
  orders:
    - id: bo_sample
      brand_id: b_acme
      retailer_id: r_corner
      source: SAMPLE
      state: DELIVERED
  conversations:
    - token: mc_corner
      brand_id: b_acme
      retailer_token: r_corner
  messages:
    - token: mm_corner_1
      brand_id: b_acme
      conversation_token: mc_corner
      body: Can you send another sample?
```

## Inspector

Open `GET /` to inspect auth state, products, retailers, orders, Messenger conversations and messages, webhook subscriptions, and webhook deliveries.

## Current Limits

Focused on Grow's current Faire usage only. Refresh tokens, the full Faire surface area, exact production webhook semantics, and every Messenger edge case are not implemented.
