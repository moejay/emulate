---
name: stytch
description: Emulated Stytch B2B organizations, members, passwords, magic links, sessions, and Google discovery flows for local development and testing. Use when the user needs to test Stytch B2B auth locally, mock Stytch organizations or members, emulate invite and password reset links, switch organizations with session exchange, or inspect seeded Stytch state without calling the real Stytch APIs. Triggers include "Stytch B2B", "emulate Stytch", "mock Stytch login", "local Stytch", "test invite flow", "password reset flow", "session exchange", or any task requiring a local Stytch B2B API.
allowed-tools: Bash(npx emulate:*), Bash(emulate:*), Bash(curl:*)
---

# Stytch B2B Emulator

Local Stytch B2B emulation tuned for Opener Grow style usage.

## Start

```bash
npx emulate --service stytch
```

Default URL:

```text
http://localhost:4015
```

## What it covers

- Server SDK endpoints under `/v1/b2b/*` for:
  - organizations create, get, update, delete, search
  - organization members create, get, update, delete, search
  - sessions authenticate, revoke, JWKS
  - password strength check
  - password reset start
  - email invite
- Headless/browser SDK endpoints under `/v1/b2b/*` with legacy `/b2b/*` aliases for:
  - password authenticate
  - password reset by email
  - password reset by session
  - password strength check
  - discovery magic link send and authenticate
  - invite magic link authenticate
  - session authenticate, exchange, revoke
  - OAuth discovery authenticate
  - discovery intermediate session exchange
- Public Google discovery start page at `/v1/b2b/public/oauth/google/discovery/start`
- Inspector at `/`

## Default seeded credentials

```text
project_id    = project-test-emulate-stytch
secret        = secret-test-emulate-stytch
public_token  = public-token-test-emulate-stytch
jwt cookie    = stytch_session_jwt
session cookie = stytch_session
```

## Seed config

```yaml
stytch:
  credentials:
    project_id: project-test-my-app
    secret: secret-test-my-app
    public_token: public-token-test-my-app
  organizations:
    - organization_name: Acme Foods
      organization_slug: acme-foods
      email_allowed_domains: [acme.com]
      members:
        - email_address: owner@acme.com
          name: Owner
          password: owner-password
          roles: [stytch_admin]
          is_admin: true
          status: active
        - email_address: rep@acme.com
          name: Sales Rep
          status: invited
    - organization_name: Shared Org
      organization_slug: shared-org
      members:
        - email_address: owner@acme.com
          name: Owner
          status: active
  google_identities:
    - email_address: owner@acme.com
      name: Owner
      hosted_domain: acme.com
```

## Opener Grow mapping

Point these env vars at emulator values:

```bash
STYTCH_PROJECT_ID=project-test-my-app
STYTCH_SECRET=secret-test-my-app
NEXT_PUBLIC_STYTCH_PUBLIC_TOKEN=public-token-test-my-app
```

Then rewrite Stytch base URLs in your app or proxy layer to the emulator URL.

## Common flows

### Server SDK auth

The Node SDK uses HTTP Basic auth with `project_id:secret`.

### Invite flow

1. Call `/v1/b2b/magic_links/email/invite`
2. Open the generated token URL from the inspector auth tab
3. The app receives `?token=...&stytch_token_type=multi_tenant_magic_links`
4. Authenticate via `/v1/b2b/magic_links/authenticate` or `/b2b/magic_links/authenticate`

### Discovery magic link flow

1. Call `/v1/b2b/magic_links/email/discovery/send` or `/b2b/magic_links/email/discovery/send`
2. Open the generated token URL from the inspector auth tab
3. Authenticate via `/v1/b2b/magic_links/discovery/authenticate` or `/b2b/magic_links/discovery/authenticate`
4. Exchange via `/v1/b2b/discovery/intermediate_sessions/exchange` or `/b2b/discovery/intermediate_sessions/exchange`

### Google discovery flow

Open:

```text
/v1/b2b/public/oauth/google/discovery/start?public_token=...&discovery_redirect_url=http://localhost:3000/authenticate
```

Choose a seeded Google identity, then the emulator redirects back with:

```text
?token=...&stytch_token_type=discovery_oauth
```

Authenticate via `/v1/b2b/oauth/discovery/authenticate` or `/b2b/oauth/discovery/authenticate`, then exchange via `/v1/b2b/discovery/intermediate_sessions/exchange` or `/b2b/discovery/intermediate_sessions/exchange`.

## Inspector

Open `/` to inspect:

- organizations
- members
- sessions
- auth tokens and seeded credentials
