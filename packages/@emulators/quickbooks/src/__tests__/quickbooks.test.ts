import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "@emulators/core";
import {
  Store,
  WebhookDispatcher,
  authMiddleware,
  createApiErrorHandler,
  createErrorHandler,
  type TokenMap,
} from "@emulators/core";
import {
  DEFAULT_ACCESS_TOKEN,
  DEFAULT_REALM_ID,
  ensureCustomerPayload,
  getQuickBooksStore,
  quickbooksPlugin,
  seedFromConfig,
} from "../index.js";

const base = "http://localhost:4100";

function createTestApp() {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  const app = new Hono();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  app.use("*", authMiddleware(tokenMap));
  quickbooksPlugin.register(app as any, store, webhooks, base, tokenMap);
  quickbooksPlugin.seed?.(store, base);
  return { app, store, webhooks, tokenMap };
}

function auth(token = DEFAULT_ACCESS_TOKEN): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

describe("QuickBooks plugin", () => {
  let app: Hono;
  let store: Store;

  beforeEach(() => {
    const ctx = createTestApp();
    app = ctx.app;
    store = ctx.store;
  });

  it("serves company info using the same shape Grow fetches after connect", async () => {
    const res = await app.request(`${base}/v3/company/${DEFAULT_REALM_ID}/companyinfo/${DEFAULT_REALM_ID}?minorversion=75`, {
      headers: auth(),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { CompanyInfo: { CompanyName: string; Id: string } };
    expect(body.CompanyInfo.CompanyName).toBe("Emulate Sample Co");
    expect(body.CompanyInfo.Id).toBe(DEFAULT_REALM_ID);
  });

  it("handles the paginated Customer query Grow issues via Nango", async () => {
    const query = "SELECT * FROM Customer WHERE MetaData.LastUpdatedTime >= '2024-01-01T00:00:00.000Z' STARTPOSITION 1 MAXRESULTS 1000";
    const res = await app.request(
      `${base}/v3/company/${DEFAULT_REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=75`,
      { headers: auth() },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      QueryResponse: { Customer: Array<{ Id: string; DisplayName: string }>; startPosition: number; maxResults: number };
    };
    expect(body.QueryResponse.startPosition).toBe(1);
    expect(body.QueryResponse.maxResults).toBe(1000);
    expect(body.QueryResponse.Customer.map((customer) => customer.Id)).toEqual(["1", "2"]);
  });

  it("filters Item queries by Type IN like Grow's product sync", async () => {
    const query =
      "SELECT * FROM Item WHERE MetaData.LastUpdatedTime >= '2024-01-01T00:00:00.000Z' AND Type IN ('Inventory','NonInventory') STARTPOSITION 1 MAXRESULTS 1000";
    const res = await app.request(
      `${base}/v3/company/${DEFAULT_REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=75`,
      { headers: auth() },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { QueryResponse: { Item: Array<{ Id: string; Type: string }> } };
    expect(body.QueryResponse.Item.map((item) => item.Id)).toEqual(["100", "101"]);
    expect(body.QueryResponse.Item.every((item) => ["Inventory", "NonInventory"].includes(item.Type))).toBe(true);
  });

  it("supports pagination across large customer result sets", async () => {
    const qs = getQuickBooksStore(store);
    for (let i = 3; i <= 1003; i++) {
      const payload = ensureCustomerPayload(store, DEFAULT_REALM_ID, {
        Id: String(i),
        DisplayName: `Customer ${i}`,
        CompanyName: `Customer ${i}`,
      });
      qs.customers.insert({
        realm_id: DEFAULT_REALM_ID,
        qbo_id: payload.Id,
        display_name: payload.DisplayName,
        active: payload.Active,
        payload,
      });
    }

    const pageOneQuery = "SELECT * FROM Customer STARTPOSITION 1 MAXRESULTS 1000";
    const pageOne = await app.request(`${base}/v3/company/${DEFAULT_REALM_ID}/query?query=${encodeURIComponent(pageOneQuery)}`, {
      headers: auth(),
    });
    const pageOneBody = (await pageOne.json()) as {
      QueryResponse: { Customer: Array<{ Id: string }>; totalCount: number; startPosition: number; maxResults: number };
    };

    expect(pageOneBody.QueryResponse.Customer).toHaveLength(1000);
    expect(pageOneBody.QueryResponse.totalCount).toBe(1003);

    const pageTwoQuery = "SELECT * FROM Customer STARTPOSITION 1001 MAXRESULTS 1000";
    const pageTwo = await app.request(`${base}/v3/company/${DEFAULT_REALM_ID}/query?query=${encodeURIComponent(pageTwoQuery)}`, {
      headers: auth(),
    });
    const pageTwoBody = (await pageTwo.json()) as { QueryResponse: { Customer: Array<{ Id: string }> } };
    expect(pageTwoBody.QueryResponse.Customer.map((customer) => customer.Id)).toEqual(["1001", "1002", "1003"]);
  });

  it("supports sparse customer updates with SyncToken bumps", async () => {
    const getBefore = await app.request(`${base}/v3/company/${DEFAULT_REALM_ID}/customer/1`, { headers: auth() });
    const original = (await getBefore.json()) as {
      Customer: { Id: string; SyncToken: string; DisplayName: string; CompanyName?: string; PrimaryEmailAddr?: { Address?: string } };
    };

    const updateRes = await app.request(`${base}/v3/company/${DEFAULT_REALM_ID}/customer?operation=update&minorversion=75`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        sparse: true,
        Id: original.Customer.Id,
        SyncToken: original.Customer.SyncToken,
        DisplayName: "Acme Grocery Updated",
        PrimaryEmailAddr: { Address: "ops@acme.example" },
      }),
    });

    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as {
      Customer: { DisplayName: string; CompanyName?: string; SyncToken: string; PrimaryEmailAddr?: { Address?: string } };
    };
    expect(updated.Customer.DisplayName).toBe("Acme Grocery Updated");
    expect(updated.Customer.CompanyName).toBe("Acme Grocery");
    expect(updated.Customer.PrimaryEmailAddr?.Address).toBe("ops@acme.example");
    expect(updated.Customer.SyncToken).toBe("1");
  });

  it("returns seeded invoice, sales receipt, and payment entities", async () => {
    const invoiceRes = await app.request(`${base}/v3/company/${DEFAULT_REALM_ID}/invoice/500`, { headers: auth() });
    const salesReceiptRes = await app.request(`${base}/v3/company/${DEFAULT_REALM_ID}/salesreceipt/700`, { headers: auth() });
    const paymentRes = await app.request(`${base}/v3/company/${DEFAULT_REALM_ID}/payment/900`, { headers: auth() });

    expect(invoiceRes.status).toBe(200);
    expect(salesReceiptRes.status).toBe(200);
    expect(paymentRes.status).toBe(200);

    const invoice = (await invoiceRes.json()) as { Invoice: { Line: unknown[]; TotalAmt: number } };
    const salesReceipt = (await salesReceiptRes.json()) as { SalesReceipt: { TotalAmt: number } };
    const payment = (await paymentRes.json()) as { Payment: { TotalAmt: number; Line?: Array<{ LinkedTxn?: Array<{ TxnId: string }> }> } };

    expect(invoice.Invoice.Line).toHaveLength(2);
    expect(salesReceipt.SalesReceipt.TotalAmt).toBe(30);
    expect(payment.Payment.Line?.[0]?.LinkedTxn?.[0]?.TxnId).toBe("500");
  });

  it("enforces realm scoping on bearer tokens", async () => {
    seedFromConfig(store, base, {
      companies: [{ realm_id: "2222222222222222", company_name: "Other Co" }],
      tokens: [{ realm_id: "2222222222222222", user: "other@example.com", access_token: "qbo_access_other" }],
    });

    const wrongRealm = await app.request(`${base}/v3/company/2222222222222222/companyinfo/2222222222222222`, {
      headers: auth(),
    });
    expect(wrongRealm.status).toBe(403);

    const correctRealm = await app.request(`${base}/v3/company/2222222222222222/companyinfo/2222222222222222`, {
      headers: auth("qbo_access_other"),
    });
    expect(correctRealm.status).toBe(200);
  });

  it("runs a full OAuth code exchange and refresh rotation flow for planned Nango proxy use", async () => {
    seedFromConfig(store, base, {
      users: [{ email: "dev@example.com", name: "Developer", realm_ids: ["3333333333333333"] }],
      oauth_apps: [
        {
          client_id: "qbo-client-id",
          client_secret: "qbo-client-secret",
          name: "Grow Local",
          redirect_uris: ["http://localhost:3000/api/integrations/qbo/callback"],
        },
      ],
      companies: [{ realm_id: "3333333333333333", company_name: "Realm Three" }],
    });

    const authorizePage = await app.request(
      `${base}/connect/oauth2?client_id=qbo-client-id&redirect_uri=${encodeURIComponent("http://localhost:3000/api/integrations/qbo/callback")}&scope=com.intuit.quickbooks.accounting&state=abc123`,
    );
    expect(authorizePage.status).toBe(200);
    expect(await authorizePage.text()).toContain("Realm Three");

    const callbackRes = await app.request(`${base}/connect/oauth2/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "qbo-client-id",
        redirect_uri: "http://localhost:3000/api/integrations/qbo/callback",
        scope: "com.intuit.quickbooks.accounting",
        state: "abc123",
        user_email: "dev@example.com",
        realm_id: "3333333333333333",
      }).toString(),
      redirect: "manual",
    });

    expect(callbackRes.status).toBe(302);
    const redirectLocation = callbackRes.headers.get("Location") ?? "";
    expect(redirectLocation).toContain("realmId=3333333333333333");
    const authCode = new URL(redirectLocation).searchParams.get("code");
    expect(authCode).toBeTruthy();

    const tokenRes = await app.request(`${base}/oauth2/v1/tokens/bearer`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("qbo-client-id:qbo-client-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode!,
        redirect_uri: "http://localhost:3000/api/integrations/qbo/callback",
      }).toString(),
    });

    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string; token_type: string };
    expect(tokens.token_type).toBe("bearer");

    const companyRes = await app.request(`${base}/v3/company/3333333333333333/companyinfo/3333333333333333`, {
      headers: auth(tokens.access_token),
    });
    expect(companyRes.status).toBe(200);

    const refreshRes = await app.request(`${base}/oauth2/v1/tokens/bearer`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("qbo-client-id:qbo-client-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }).toString(),
    });

    expect(refreshRes.status).toBe(200);
    const rotated = (await refreshRes.json()) as { access_token: string; refresh_token: string };
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);

    const reusedRefresh = await app.request(`${base}/oauth2/v1/tokens/bearer`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("qbo-client-id:qbo-client-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }).toString(),
    });
    expect(reusedRefresh.status).toBe(400);
  });

  it("rejects authorization-code exchanges when client_id or redirect_uri do not match the authorize request", async () => {
    seedFromConfig(store, base, {
      users: [{ email: "dev@example.com", name: "Developer", realm_ids: ["3333333333333333"] }],
      oauth_apps: [
        {
          client_id: "qbo-client-id",
          client_secret: "qbo-client-secret",
          name: "Grow Local",
          redirect_uris: ["http://localhost:3000/api/integrations/qbo/callback"],
        },
        {
          client_id: "other-client-id",
          client_secret: "other-client-secret",
          name: "Other App",
          redirect_uris: ["http://localhost:3000/api/integrations/qbo/callback"],
        },
      ],
      companies: [{ realm_id: "3333333333333333", company_name: "Realm Three" }],
    });

    const callbackRes = await app.request(`${base}/connect/oauth2/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "qbo-client-id",
        redirect_uri: "http://localhost:3000/api/integrations/qbo/callback",
        scope: "com.intuit.quickbooks.accounting",
        state: "abc123",
        user_email: "dev@example.com",
        realm_id: "3333333333333333",
      }).toString(),
      redirect: "manual",
    });
    const authCode = new URL(callbackRes.headers.get("Location") ?? "http://localhost/invalid").searchParams.get("code");
    expect(authCode).toBeTruthy();

    const wrongRedirect = await app.request(`${base}/oauth2/v1/tokens/bearer`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("qbo-client-id:qbo-client-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode!,
        redirect_uri: "http://localhost:3000/api/integrations/qbo/other-callback",
      }).toString(),
    });
    expect(wrongRedirect.status).toBe(400);
    expect(await wrongRedirect.json()).toMatchObject({ error: "invalid_grant" });

    const wrongClient = await app.request(`${base}/oauth2/v1/tokens/bearer`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("other-client-id:other-client-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode!,
        redirect_uri: "http://localhost:3000/api/integrations/qbo/callback",
      }).toString(),
    });
    expect(wrongClient.status).toBe(400);
    expect(await wrongClient.json()).toMatchObject({ error: "invalid_grant" });

    const correctExchange = await app.request(`${base}/oauth2/v1/tokens/bearer`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("qbo-client-id:qbo-client-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode!,
        redirect_uri: "http://localhost:3000/api/integrations/qbo/callback",
      }).toString(),
    });
    expect(correctExchange.status).toBe(200);
  });

  it("binds refresh-token rotation to the issuing OAuth client", async () => {
    seedFromConfig(store, base, {
      users: [{ email: "dev@example.com", name: "Developer", realm_ids: ["3333333333333333"] }],
      oauth_apps: [
        {
          client_id: "qbo-client-id",
          client_secret: "qbo-client-secret",
          name: "Grow Local",
          redirect_uris: ["http://localhost:3000/api/integrations/qbo/callback"],
        },
        {
          client_id: "other-client-id",
          client_secret: "other-client-secret",
          name: "Other App",
          redirect_uris: ["http://localhost:3000/api/integrations/qbo/callback"],
        },
      ],
      companies: [{ realm_id: "3333333333333333", company_name: "Realm Three" }],
    });

    const callbackRes = await app.request(`${base}/connect/oauth2/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "qbo-client-id",
        redirect_uri: "http://localhost:3000/api/integrations/qbo/callback",
        scope: "com.intuit.quickbooks.accounting",
        state: "abc123",
        user_email: "dev@example.com",
        realm_id: "3333333333333333",
      }).toString(),
      redirect: "manual",
    });
    const authCode = new URL(callbackRes.headers.get("Location") ?? "http://localhost/invalid").searchParams.get("code");
    expect(authCode).toBeTruthy();

    const tokenRes = await app.request(`${base}/oauth2/v1/tokens/bearer`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("qbo-client-id:qbo-client-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode!,
        redirect_uri: "http://localhost:3000/api/integrations/qbo/callback",
      }).toString(),
    });
    const tokens = (await tokenRes.json()) as { refresh_token: string };

    const wrongClientRefresh = await app.request(`${base}/oauth2/v1/tokens/bearer`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("other-client-id:other-client-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }).toString(),
    });
    expect(wrongClientRefresh.status).toBe(400);
    expect(await wrongClientRefresh.json()).toMatchObject({ error: "invalid_grant" });

    const correctClientRefresh = await app.request(`${base}/oauth2/v1/tokens/bearer`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("qbo-client-id:qbo-client-secret").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }).toString(),
    });
    expect(correctClientRefresh.status).toBe(200);
  });

  it("renders the shared-design inspector with query logs", async () => {
    await app.request(`${base}/v3/company/${DEFAULT_REALM_ID}/query?query=${encodeURIComponent("SELECT * FROM Customer STARTPOSITION 1 MAXRESULTS 1000")}`, {
      headers: auth(),
    });

    const res = await app.request(`${base}/?tab=queries`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("QuickBooks Inspector");
    expect(html).toContain("SELECT * FROM Customer STARTPOSITION 1 MAXRESULTS 1000");
  });
});
