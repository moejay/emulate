---
name: quickbooks
description: Emulated QuickBooks Online API for local development and testing. Use when the user needs to test QuickBooks company info, accounting queries, customers, vendors, items, invoices, sales receipts, payments, or Intuit OAuth locally without hitting the real QuickBooks Online API. Triggers include "QuickBooks", "QBO", "emulate QuickBooks", "test QBO sync", "mock Intuit OAuth", "companyinfo", "QBO query", or any task requiring a local QuickBooks Online API.
allowed-tools: Bash(npx emulate:*), Bash(curl:*)
---

# QuickBooks Online Emulator

Stateful QuickBooks Online emulation for the API surfaces Grow currently consumes through Nango: Intuit OAuth, company info, the SQL-like query endpoint, customers, vendors, items, invoices, sales receipts, payments, realm scoping, pagination, and sparse updates.

## Start

```bash
# QuickBooks only
npx emulate --service quickbooks

# Default port when run alone
# http://localhost:4000
```

Or programmatically:

```typescript
import { createEmulator } from 'emulate'

const quickbooks = await createEmulator({ service: 'quickbooks', port: 4000 })
// quickbooks.url === 'http://localhost:4000'
```

## Auth

API calls require `Authorization: Bearer <token>`.

Default seed values:

- Realm ID: `9130355372279406`
- Access token: `qbo_access_emulate`
- Refresh token: `qbo_refresh_emulate`

```bash
curl "http://localhost:4000/v3/company/9130355372279406/companyinfo/9130355372279406?minorversion=75" \
  -H "Authorization: Bearer qbo_access_emulate"
```

Realm access is enforced. A token issued for one company cannot read another company's records.

## Pointing Grow Or A Nango-style Proxy At The Emulator

### Company info

Grow fetches display metadata with:

```text
GET /v3/company/<realmId>/companyinfo/<realmId>?minorversion=75
```

### Query endpoint

Grow syncs customers, items, and invoices through:

```text
GET /v3/company/<realmId>/query?query=SELECT%20*%20FROM%20Customer...&minorversion=75
```

Supported query features:

- `SELECT * FROM <Entity>`
- `WHERE field = value`
- `WHERE field >= value`
- `WHERE field <= value`
- `WHERE field IN ('a','b')`
- `STARTPOSITION n`
- `MAXRESULTS n`

Supported entities:

- `Customer`
- `Vendor`
- `Item`
- `Invoice`
- `SalesReceipt`
- `Payment`

### Sparse updates

```bash
curl -X POST "http://localhost:4000/v3/company/9130355372279406/customer?operation=update&minorversion=75" \
  -H "Authorization: Bearer qbo_access_emulate" \
  -H "Content-Type: application/json" \
  -d '{
    "sparse": true,
    "Id": "1",
    "SyncToken": "0",
    "DisplayName": "Acme Grocery Updated",
    "PrimaryEmailAddr": { "Address": "ops@acme.example" }
  }'
```

Sparse updates preserve unspecified fields and bump `SyncToken`.

## Intuit OAuth

Authorize URL:

```text
GET /connect/oauth2?client_id=...&redirect_uri=...&scope=com.intuit.quickbooks.accounting&state=...
```

Token URL:

```text
POST /oauth2/v1/tokens/bearer
```

Revocation URL:

```text
POST /oauth2/v1/tokens/revoke
```

The authorization redirect includes both `code` and `realmId`, matching the real QBO callback contract. Authorization-code exchanges must reuse the same `client_id` and `redirect_uri` from the authorize step. Refresh grants rotate refresh tokens and are bound to the issuing OAuth client.

## Seed Config

```yaml
quickbooks:
  users:
    - email: dev@example.com
      name: Developer
      realm_ids:
        - "9130355372279406"
  oauth_apps:
    - client_id: qbo-client-id
      client_secret: qbo-client-secret
      name: Grow Local
      redirect_uris:
        - http://localhost:3000/api/integrations/qbo/callback
      scopes:
        - com.intuit.quickbooks.accounting
  companies:
    - realm_id: "9130355372279406"
      company_name: Emulate Sample Co
      legal_name: Emulate Sample Co LLC
      country: US
      email: billing@example.com
      phone: 415-555-0100
      company_addr:
        Line1: 123 Emulator Way
        City: San Francisco
        CountrySubDivisionCode: CA
        PostalCode: "94105"
        Country: US
      customers:
        - Id: "1"
          DisplayName: Acme Grocery
          CompanyName: Acme Grocery
          PrimaryEmailAddr:
            Address: buyer@acme.example
      vendors:
        - Id: "10"
          DisplayName: Best Distributor
      items:
        - Id: "100"
          Name: Sparkling Water 12oz
          Sku: SW-12OZ
          Type: Inventory
          UnitPrice: 24.5
      invoices:
        - Id: "500"
          DocNumber: "306693"
          TxnDate: "2026-02-12"
          CustomerRef:
            value: "1"
            name: Acme Grocery
          Line:
            - Id: "1"
              Amount: 24.5
              DetailType: SalesItemLineDetail
              SalesItemLineDetail:
                ItemRef:
                  value: "100"
                  name: Sparkling Water 12oz
                Qty: 1
                UnitPrice: 24.5
          TotalAmt: 24.5
      sales_receipts:
        - Id: "700"
          TxnDate: "2026-02-15"
          CustomerRef:
            value: "1"
      payments:
        - Id: "900"
          TxnDate: "2026-02-16"
          CustomerRef:
            value: "1"
          TotalAmt: 24.5
      tokens:
        - access_token: qbo_access_emulate
          refresh_token: qbo_refresh_emulate
          user: dev@example.com
```

## Common Requests

### Company info

```bash
curl "http://localhost:4000/v3/company/9130355372279406/companyinfo/9130355372279406?minorversion=75" \
  -H "Authorization: Bearer qbo_access_emulate"
```

### Customer sync query

```bash
curl "http://localhost:4000/v3/company/9130355372279406/query?query=$(python - <<'PY'
import urllib.parse
print(urllib.parse.quote("SELECT * FROM Customer WHERE MetaData.LastUpdatedTime >= '2024-01-01T00:00:00.000Z' STARTPOSITION 1 MAXRESULTS 1000"))
PY
)&minorversion=75" \
  -H "Authorization: Bearer qbo_access_emulate"
```

### Item sync query

```bash
curl "http://localhost:4000/v3/company/9130355372279406/query?query=$(python - <<'PY'
import urllib.parse
print(urllib.parse.quote("SELECT * FROM Item WHERE MetaData.LastUpdatedTime >= '2024-01-01T00:00:00.000Z' AND Type IN ('Inventory','NonInventory') STARTPOSITION 1 MAXRESULTS 1000"))
PY
)&minorversion=75" \
  -H "Authorization: Bearer qbo_access_emulate"
```

### OAuth token exchange

```bash
curl -X POST http://localhost:4000/oauth2/v1/tokens/bearer \
  -H "Authorization: Basic $(printf 'qbo-client-id:qbo-client-secret' | base64)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=<code-from-callback>&redirect_uri=http://localhost:3000/api/integrations/qbo/callback"
```

### Refresh token rotation

```bash
curl -X POST http://localhost:4000/oauth2/v1/tokens/bearer \
  -H "Authorization: Basic $(printf 'qbo-client-id:qbo-client-secret' | base64)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token&refresh_token=qbo_refresh_emulate"
```

## Inspector

Open `GET /` in the QuickBooks emulator to inspect:

- companies and realm IDs
- customers and vendors
- items
- invoices, sales receipts, and payments
- OAuth apps, users, access tokens, and refresh tokens
- recorded query traffic

## Current Limits

Journal entries, bills, purchase orders, batch endpoints, CDC endpoints, reports, attachments, tax rate configuration, exact Intuit validation rules, and webhook/event simulation are not implemented.
