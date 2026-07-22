---
name: nango
description: Emulated Nango API and Connect UI for local Grow-style integration testing. Use when the user needs a local Nango replacement, wants to test connect sessions, connection CRUD, metadata updates, Nango proxy requests, Google Mail OAuth through the Google emulator, Shopify or QuickBooks manual connections, or inspect proxied requests and webhook deliveries without hitting real Nango.
allowed-tools: Bash(npx emulate:*), Bash(curl:*)
---

# Nango Emulator

Local Nango-compatible surfaces for apps that use `@nangohq/node` and `@nangohq/frontend`.

## What it covers

- `POST /connect/sessions` and `POST /connect/sessions/reconnect`
- `GET /connect/session` and `DELETE /connect/session`
- Managed Connect UI at `/connect`
- `GET/POST/PATCH/DELETE /integrations`
- `GET/POST/PATCH/DELETE /connections`
- `POST/PATCH /connections/metadata`
- `GET/POST/PUT/PATCH/DELETE /proxy/...`
- Request and response recording for every proxied call
- Signed webhook deliveries for connection create, update, and delete when an integration enables `forward_webhooks`

## Default seeded integrations

- `google-mail`
- `shopify`
- `quickbooks`
- `opener`

Default API secret:

```text
nango_secret_test
```

## Start

Programmatic use:

```ts
import { createServer } from '@emulators/core'
import nangoPlugin from '@emulators/nango'

const { app, store, baseUrl } = createServer(nangoPlugin, {
  port: 4090,
  baseUrl: 'http://localhost:4090',
})

nangoPlugin.seed?.(store, baseUrl)
```

Inspector:

```text
http://localhost:4090/
```

Connect UI base URL:

```text
http://localhost:4090/connect
```

API base URL:

```text
http://localhost:4090
```

## Grow-style environment mapping

```bash
NANGO_SECRET_KEY=nango_secret_test
NANGO_API_URL=http://localhost:4090
NANGO_CONNECT_URL=http://localhost:4090/connect
```

## Seed config

```ts
import { seedFromConfig } from '@emulators/nango'

seedFromConfig(store, baseUrl, {
  secret_key: 'nango_secret_test',
  base_url_mappings: {
    google: 'http://localhost:4002',
    shopify: 'http://localhost:4010',
    quickbooks: 'http://localhost:4011',
  },
  integrations: [
    {
      unique_key: 'google-mail',
      provider: 'google',
      auth_mode: 'oauth2',
      proxy_auth_mode: 'oauth2-bearer',
      oauth_authorize_url: 'http://localhost:4002/o/oauth2/v2/auth',
      oauth_token_url: 'http://localhost:4002/oauth2/token',
      oauth_client_id: 'emu_google_client_id',
      oauth_client_secret: 'emu_google_client_secret',
      proxy_base_url_mapping_key: 'google',
    },
    {
      unique_key: 'shopify',
      provider: 'shopify',
      auth_mode: 'manual',
      manual_fields: [
        { name: 'config.shopDomain', label: 'Shop domain', required: true },
        { name: 'metadata.displayName', label: 'Store name' },
        { name: 'config.targetBaseUrl', label: 'Target base URL', type: 'url' },
      ],
    },
  ],
})
```

## Common API calls

List integrations:

```bash
curl http://localhost:4090/integrations \
  -H 'Authorization: Bearer nango_secret_test'
```

Create a connect session:

```bash
curl -X POST http://localhost:4090/connect/sessions \
  -H 'Authorization: Bearer nango_secret_test' \
  -H 'Content-Type: application/json' \
  -d '{
    "allowed_integrations": ["google-mail"],
    "tags": { "organization_id": "org-1", "end_user_id": "user-1" },
    "end_user": { "id": "user-1", "email": "user@example.test" }
  }'
```

Fetch a connection:

```bash
curl 'http://localhost:4090/connections/google-mail-user-1?provider_config_key=google-mail' \
  -H 'Authorization: Bearer nango_secret_test'
```

Update metadata:

```bash
curl -X PATCH http://localhost:4090/connections/metadata \
  -H 'Authorization: Bearer nango_secret_test' \
  -H 'Content-Type: application/json' \
  -d '{
    "provider_config_key": "shopify",
    "connection_id": "brand.myshopify.com",
    "metadata": { "displayName": "Brand Store" }
  }'
```

Proxy a Gmail request:

```bash
curl 'http://localhost:4090/proxy/gmail/v1/users/me/threads?maxResults=10' \
  -H 'Authorization: Bearer nango_secret_test' \
  -H 'Connection-Id: google-mail-user-1' \
  -H 'Provider-Config-Key: google-mail'
```

Proxy to a different local target for one request:

```bash
curl 'http://localhost:4090/proxy/admin/api/2024-01/shop.json' \
  -H 'Authorization: Bearer nango_secret_test' \
  -H 'Connection-Id: brand.myshopify.com' \
  -H 'Provider-Config-Key: shopify' \
  -H 'Base-Url-Override: http://localhost:4012'
```

## Notes

- `google-mail` can run a real OAuth code exchange against the local Google emulator.
- Gmail profile responses are synthesized from the stored Google token when the upstream emulator does not expose `/gmail/v1/users/me/profile`.
- Shopify and QuickBooks can run with a real target base URL or with the built-in synthetic fallback responses used by Grow connection registration.
- The package is workspace-local only until the central service registry is updated.
