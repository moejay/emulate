import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono, Store, WebhookDispatcher, createApiErrorHandler, createErrorHandler, authMiddleware, type TokenMap } from "@emulators/core";
import { googlePlugin, seedFromConfig as seedGoogle } from "../../../google/src/index.js";
import { nangoPlugin, seedFromConfig as seedNango } from "../index.js";
import { getNangoStore } from "../store.js";

const nangoBase = "http://nango.test";
const googleBase = "http://google.test";
const webhookBase = "http://webhook.test";
const secretKey = "nango_secret_test";

function createNangoTestApp(seed?: Parameters<typeof seedNango>[2]) {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const app = new Hono();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  nangoPlugin.register(app as any, store, webhooks, nangoBase);
  nangoPlugin.seed?.(store, nangoBase);
  if (seed) seedNango(store, nangoBase, seed);
  return { app, store };
}

function createGoogleTestApp() {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  const app = new Hono();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  app.use("*", authMiddleware(tokenMap));
  googlePlugin.register(app as any, store, webhooks, googleBase, tokenMap);
  googlePlugin.seed?.(store, googleBase);
  seedGoogle(store, googleBase, {
    users: [{ email: "testuser@gmail.com", name: "Test User" }],
    oauth_clients: [
      {
        client_id: "emu_google_client_id",
        client_secret: "emu_google_client_secret",
        name: "Grow Local",
        redirect_uris: [`${nangoBase}/connect/oauth/callback`],
      },
    ],
  });
  return { app, store, tokenMap };
}

function authHeaders(extra?: Record<string, string>) {
  return { Authorization: `Bearer ${secretKey}`, ...(extra ?? {}) };
}

async function createConnectSession(app: Hono, allowedIntegration: string, endUserId = "org-1") {
  const response = await app.request(`${nangoBase}/connect/sessions`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      allowed_integrations: [allowedIntegration],
      tags: { organization_id: "org-1", end_user_id: endUserId },
      end_user: { id: endUserId, email: `${endUserId}@example.test` },
    }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { data: { token: string; connect_link: string; expires_at: string } };
}

async function postForm(app: Hono, path: string, body: Record<string, string>) {
  return app.request(`${nangoBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

describe("@emulators/nango", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects malformed connect session bearer tokens", async () => {
    const { app } = createNangoTestApp();

    const response = await app.request(`${nangoBase}/connect/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer wrong-${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ allowed_integrations: ["shopify"] }),
    });

    expect(response.status).toBe(401);
  });

  it("lists seeded integrations and exposes connect sessions", async () => {
    const { app } = createNangoTestApp();

    const integrationsRes = await app.request(`${nangoBase}/integrations`, { headers: authHeaders() });
    expect(integrationsRes.status).toBe(200);
    const integrations = (await integrationsRes.json()) as { data: Array<{ unique_key: string }> };
    expect(integrations.data.map((item) => item.unique_key)).toEqual(
      expect.arrayContaining(["google-mail", "shopify", "quickbooks", "opener"]),
    );

    const session = await createConnectSession(app, "shopify", "brand-user-1");
    const sessionRes = await app.request(`${nangoBase}/connect/session`, {
      headers: { Authorization: `Bearer ${session.data.token}` },
    });
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as {
      data: { allowed_integrations: string[]; endUser: { id: string; email?: string } | null };
    };
    expect(sessionBody.data.allowed_integrations).toEqual(["shopify"]);
    expect(sessionBody.data.endUser).toMatchObject({ id: "brand-user-1", email: "brand-user-1@example.test" });
  });

  it("creates manual Shopify connections and serves synthetic shop responses", async () => {
    const { app, store } = createNangoTestApp();
    const session = await createConnectSession(app, "shopify", "brand-user-2");

    const connectRes = await postForm(app, "/connect/manual", {
      session_token: session.data.token,
      integration_id: "shopify",
      "config.shopDomain": "acme-snacks.myshopify.com",
      "metadata.displayName": "Acme Snacks",
    });
    expect(connectRes.status).toBe(302);

    const connectionRes = await app.request(
      `${nangoBase}/connections/acme-snacks.myshopify.com?provider_config_key=shopify`,
      { headers: authHeaders() },
    );
    expect(connectionRes.status).toBe(200);
    const connection = (await connectionRes.json()) as { connection_config: { shopDomain: string } };
    expect(connection.connection_config.shopDomain).toBe("acme-snacks.myshopify.com");

    const proxyRes = await app.request(`${nangoBase}/proxy/admin/api/2024-01/shop.json`, {
      headers: authHeaders({
        "Connection-Id": "acme-snacks.myshopify.com",
        "Provider-Config-Key": "shopify",
      }),
    });
    expect(proxyRes.status).toBe(200);
    const shop = (await proxyRes.json()) as { shop: { name: string; myshopify_domain: string } };
    expect(shop.shop).toEqual({ name: "Acme Snacks", myshopify_domain: "acme-snacks.myshopify.com" });

    const logs = getNangoStore(store).proxyLogs.all();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      provider_config_key: "shopify",
      connection_id: "acme-snacks.myshopify.com",
      synthetic: true,
      response_status: 200,
    });
  });

  it("injects Shopify access tokens when proxying Admin GraphQL", async () => {
    const { app } = createNangoTestApp({
      base_url_mappings: { shopify: "http://shopify.test" },
      connections: [{
        connection_id: "shopify-auth-test",
        provider_config_key: "shopify",
        connection_config: { targetBaseUrl: "http://shopify.test" },
        credentials: { type: "OAUTH2", access_token: "shpat_test_admin" },
      }],
    });
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input.toString(), init);
      expect(request.headers.get("X-Shopify-Access-Token")).toBe("shpat_test_admin");
      return Response.json({ data: { shop: { name: "Acme" } } });
    });

    const proxyRes = await app.request(`${nangoBase}/proxy/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: authHeaders({
        "Connection-Id": "shopify-auth-test",
        "Provider-Config-Key": "shopify",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ query: "query { shop { name } }" }),
    });

    expect(proxyRes.status).toBe(200);
    expect(await proxyRes.json()).toEqual({ data: { shop: { name: "Acme" } } });
  });

  it("runs Google OAuth against the local Google emulator and proxies Gmail", async () => {
    const { app, store } = createNangoTestApp({
      base_url_mappings: { google: googleBase },
      integrations: [
        {
          unique_key: "google-mail",
          provider: "google",
          auth_mode: "oauth2",
          proxy_auth_mode: "oauth2-bearer",
          oauth_authorize_url: `${googleBase}/o/oauth2/v2/auth`,
          oauth_token_url: `${googleBase}/oauth2/token`,
          oauth_client_id: "emu_google_client_id",
          oauth_client_secret: "emu_google_client_secret",
          oauth_scope:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify",
          proxy_base_url_mapping_key: "google",
        },
      ],
    });
    const google = createGoogleTestApp();

    const deliveredWebhookBodies: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(typeof input === "string" || input instanceof URL ? input.toString() : String(input), init);
      const url = new URL(request.url);
      if (url.origin === googleBase) {
        return google.app.request(request.url, {
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
        });
      }
      if (url.origin === webhookBase) {
        deliveredWebhookBodies.push(await request.text());
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch to ${url.toString()}`);
    });

    const session = await createConnectSession(app, "google-mail", "brand-user-3");
    const startRes = await app.request(`${nangoBase}/connect/oauth/start?session_token=${encodeURIComponent(session.data.token)}&integration_id=google-mail`);
    expect(startRes.status).toBe(302);
    const authUrl = new URL(startRes.headers.get("Location")!);
    expect(authUrl.origin).toBe(googleBase);

    const googleCallbackRes = await postForm(google.app, "/o/oauth2/v2/auth/callback", {
      email: "testuser@gmail.com",
      redirect_uri: authUrl.searchParams.get("redirect_uri")!,
      scope: authUrl.searchParams.get("scope")!,
      state: authUrl.searchParams.get("state")!,
      client_id: authUrl.searchParams.get("client_id")!,
    });
    expect(googleCallbackRes.status).toBe(302);
    const nangoCallbackUrl = googleCallbackRes.headers.get("Location")!;

    const finishRes = await app.request(nangoCallbackUrl);
    expect(finishRes.status).toBe(302);
    const finishUrl = new URL(finishRes.headers.get("Location")!, nangoBase);
    expect(finishUrl.pathname).toBe("/connect/finalize");

    const connectionId = finishUrl.searchParams.get("connection_id")!;
    const connectionRes = await app.request(`${nangoBase}/connections/${encodeURIComponent(connectionId)}?provider_config_key=google-mail`, {
      headers: authHeaders(),
    });
    expect(connectionRes.status).toBe(200);
    const connection = (await connectionRes.json()) as {
      credentials: { type: string; access_token: string };
      end_user: { id: string; email?: string } | null;
    };
    expect(connection.credentials.type).toBe("OAUTH2");
    expect(connection.end_user).toMatchObject({ id: "brand-user-3", email: "brand-user-3@example.test" });

    const profileRes = await app.request(`${nangoBase}/proxy/gmail/v1/users/me/profile`, {
      headers: authHeaders({
        "Connection-Id": connectionId,
        "Provider-Config-Key": "google-mail",
      }),
    });
    expect(profileRes.status).toBe(200);
    expect((await profileRes.json()) as { emailAddress: string }).toEqual({ emailAddress: "testuser@gmail.com" });

    const threadsRes = await app.request(`${nangoBase}/proxy/gmail/v1/users/me/threads?maxResults=1`, {
      headers: authHeaders({
        "Connection-Id": connectionId,
        "Provider-Config-Key": "google-mail",
      }),
    });
    expect(threadsRes.status).toBe(200);
    const threadsBody = (await threadsRes.json()) as { threads?: Array<{ id: string }> };
    expect(Array.isArray(threadsBody.threads)).toBe(true);

    const logs = getNangoStore(store).proxyLogs.all();
    expect(logs).toHaveLength(2);
    expect(logs.find((log) => log.synthetic)?.endpoint).toBe("/gmail/v1/users/me/profile");
    expect(logs.find((log) => !log.synthetic)?.resolved_url.startsWith(`${googleBase}/gmail/v1/users/me/threads`)).toBe(true);
  });

  it("signs connection webhooks and records deliveries", async () => {
    const { app, store } = createNangoTestApp({
      integrations: [
        {
          unique_key: "shopify",
          provider: "shopify",
          auth_mode: "manual",
          forward_webhooks: true,
          webhook_url: `${webhookBase}/hooks/shopify`,
          manual_fields: [{ name: "config.shopDomain", label: "Shop domain", required: true }],
        },
      ],
    });

    const deliveries: Array<{ headers: Headers; body: string }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(typeof input === "string" || input instanceof URL ? input.toString() : String(input), init);
      deliveries.push({ headers: request.headers, body: await request.text() });
      return new Response(null, { status: 204 });
    });

    const createRes = await app.request(`${nangoBase}/connections`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        provider_config_key: "shopify",
        connection_id: "acme-webhook.myshopify.com",
        connection_config: { shopDomain: "acme-webhook.myshopify.com" },
        metadata: { displayName: "Acme Webhook" },
        credentials: { type: "NONE", raw: {} },
      }),
    });
    expect(createRes.status).toBe(201);
    expect(deliveries).toHaveLength(1);
    const signature = deliveries[0].headers.get("X-Nango-Hmac-Sha256");
    expect(signature).toBeTruthy();
    const deliveryRows = getNangoStore(store).webhookDeliveries.all();
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0]).toMatchObject({
      event: "connection.created",
      provider_config_key: "shopify",
      response_status: 204,
      success: true,
    });
  });
});
