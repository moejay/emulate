import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "@emulators/core";
import { fairePlugin, seedFromConfig } from "../index.js";
import { getFaireStore } from "../store.js";

const BASE_URL = "http://localhost:4000";

function createTestApp(config?: Parameters<typeof seedFromConfig>[2]) {
  const server = createServer(fairePlugin, { baseUrl: BASE_URL });
  fairePlugin.seed?.(server.store, server.baseUrl);
  if (config) seedFromConfig(server.store, server.baseUrl, config);
  return server;
}

function appCredentials(value = "emu_faire_app_id:emu_faire_app_secret") {
  return Buffer.from(value, "utf8").toString("base64");
}

async function login(app: ReturnType<typeof createTestApp>["app"], email = "brand@example.com", password = "password") {
  const res = await app.request(`${BASE_URL}/api/v2/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email_address: email,
      password,
      enable_mfa_method_selection: true,
    }),
  });
  return {
    res,
    body: (await res.json()) as Record<string, unknown>,
    sessionToken: res.headers.get("x-if-wsat") ?? "",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Faire emulator", () => {
  it("supports the Grow OAuth flow and brand profile auth headers", async () => {
    const { app } = createTestApp();

    const authorize = await app.request(
      `${BASE_URL}/oauth2/authorize?applicationId=emu_faire_app_id&scope=READ_ORDERS&scope=READ_BRAND&state=test-state&redirectUrl=${encodeURIComponent("http://localhost:3000/api/auth/callback/faire")}`,
    );
    expect(authorize.status).toBe(200);
    expect(await authorize.text()).toContain("Sign in to Faire");

    const callback = await app.request(`${BASE_URL}/oauth2/authorize/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        user_id: "u_emulate",
        brand_id: "b_emulate",
        application_id: "emu_faire_app_id",
        redirect_url: "http://localhost:3000/api/auth/callback/faire",
        state: "test-state",
        scopes: "READ_ORDERS,READ_BRAND",
      }),
    });
    expect(callback.status).toBe(302);
    const redirected = new URL(callback.headers.get("location") ?? "");
    const code = redirected.searchParams.get("authorization_code");
    expect(code).toBeTruthy();
    expect(redirected.searchParams.get("state")).toBe("test-state");

    const tokenRes = await app.request(`${BASE_URL}/api/external-api-oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "AUTHORIZATION_CODE",
        application_token: "emu_faire_app_id",
        application_secret: "emu_faire_app_secret",
        redirect_url: "http://localhost:3000/api/auth/callback/faire",
        scope: ["READ_ORDERS", "READ_BRAND"],
        authorization_code: code,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const tokenBody = (await tokenRes.json()) as Record<string, unknown>;
    expect(tokenBody.brand_id).toBe("b_emulate");
    expect(typeof tokenBody.access_token).toBe("string");

    const brandProfile = await app.request(`${BASE_URL}/external-api/v2/brands/profile`, {
      headers: {
        "X-FAIRE-APP-CREDENTIALS": appCredentials(),
        "X-FAIRE-OAUTH-ACCESS-TOKEN": String(tokenBody.access_token),
      },
    });
    expect(brandProfile.status).toBe(200);
    expect(await brandProfile.json()).toMatchObject({ brand_id: "b_emulate", name: "Emulate Brand" });
  });

  it("supports external API v2 order pagination with updated_at_min filtering", async () => {
    const { app } = createTestApp({
      orders: [
        { id: "bo_old", brand_id: "b_emulate", retailer_id: "r_emulate", state: "DELIVERED", updated_at: "2026-04-01T00:00:00.000Z" },
        { id: "bo_mid", brand_id: "b_emulate", retailer_id: "r_emulate", state: "PROCESSING", updated_at: "2026-04-03T00:00:00.000Z" },
        { id: "bo_new", brand_id: "b_emulate", retailer_id: "r_emulate", state: "NEW", updated_at: "2026-04-05T00:00:00.000Z" },
        { id: "bo_latest", brand_id: "b_emulate", retailer_id: "r_emulate", state: "NEW", updated_at: "2026-04-06T00:00:00.000Z" },
      ],
    });

    const pageOne = await app.request(`${BASE_URL}/external-api/v2/orders?limit=2&updated_at_min=2026-04-02T00:00:00.000Z`, {
      headers: { "X-FAIRE-ACCESS-TOKEN": "faire_test_api_token" },
    });
    expect(pageOne.status).toBe(200);
    const firstBody = (await pageOne.json()) as { orders: Array<{ id: string }>; cursor?: string };
    expect(firstBody.orders.map((order) => order.id)).toEqual(["bo_latest", "bo_new"]);
    expect(firstBody.cursor).toBeTruthy();

    const pageTwo = await app.request(`${BASE_URL}/external-api/v2/orders?cursor=${encodeURIComponent(firstBody.cursor ?? "")}&limit=2&updated_at_min=2026-04-02T00:00:00.000Z`, {
      headers: { "X-FAIRE-ACCESS-TOKEN": "faire_test_api_token" },
    });
    const secondBody = (await pageTwo.json()) as { orders: Array<{ id: string }>; cursor?: string };
    expect(secondBody.orders).toHaveLength(1);
    expect(secondBody.orders[0]?.id).toBe("bo_mid");
    expect(secondBody.cursor).toBeUndefined();
  });

  it("supports product pagination and retailer public lookups with Grow-shaped responses", async () => {
    const { app } = createTestApp({
      products: [
        {
          id: "prod_alpha",
          brand_id: "b_emulate",
          name: "Alpha",
          updated_at: "2026-05-01T00:00:00.000Z",
          variants: [{ id: "var_alpha", sku: "ALPHA-1", quantity: 1, price_cents: 1000 } as any],
          variant_option_sets: [{ name: "Size", values: ["1 pack"] }],
        },
        {
          id: "prod_beta",
          brand_id: "b_emulate",
          name: "Beta",
          updated_at: "2026-05-02T00:00:00.000Z",
          variants: [{ id: "var_beta", sku: "BETA-1", quantity: 1, price_cents: 1200 } as any],
          variant_option_sets: [{ name: "Size", values: ["1 pack"] }],
        },
      ],
    });

    const products = await app.request(`${BASE_URL}/external-api/v2/products?limit=2`, {
      headers: { "X-FAIRE-ACCESS-TOKEN": "faire_test_api_token" },
    });
    expect(products.status).toBe(200);
    const productBody = (await products.json()) as { products: Array<{ id: string; variant_option_sets?: unknown[] }> };
    expect(productBody.products[0]?.id).toBe("prod_beta");
    expect(productBody.products[0]?.variant_option_sets).toEqual([{ name: "Size", values: ["1 pack"] }]);

    const retailer = await app.request(`${BASE_URL}/external-api/v2/retailers/public/r_emulate`, {
      headers: { "X-FAIRE-ACCESS-TOKEN": "faire_test_api_token" },
    });
    expect(retailer.status).toBe(200);
    expect(await retailer.json()).toMatchObject({ retailer_id: "r_emulate", id: "r_emulate", name: "Corner Pantry" });
  });

  it("supports stateful order creation, updates, shipment mutations, and webhook delivery", async () => {
    const deliveries: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      deliveries.push({
        url: String(input),
        body: String(init?.body ?? ""),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      return new Response("ok", { status: 200 });
    });

    const { app, store } = createTestApp({
      webhooks: [
        {
          brand_id: "b_emulate",
          url: "http://localhost:9876/webhooks/faire",
          events: ["order.created", "order.updated", "shipment.created"],
          secret: "whsec_test",
        },
      ],
    });

    const created = await app.request(`${BASE_URL}/external-api/v2/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FAIRE-ACCESS-TOKEN": "faire_test_api_token",
      },
      body: JSON.stringify({
        brand_id: "b_emulate",
        retailer_id: "r_emulate",
        source: "SAMPLE",
        state: "NEW",
        currency: "USD",
        items: [{ id: "oi_new", quantity: 1, price_cents: 900 }],
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string; source: string };
    expect(createdBody.source).toBe("SAMPLE");

    const updated = await app.request(`${BASE_URL}/external-api/v2/orders/${createdBody.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-FAIRE-ACCESS-TOKEN": "faire_test_api_token",
      },
      body: JSON.stringify({ state: "PROCESSING", notes: "Packed" }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ id: createdBody.id, state: "PROCESSING", notes: "Packed" });

    const shipment = await app.request(`${BASE_URL}/external-api/v2/orders/${createdBody.id}/shipments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FAIRE-ACCESS-TOKEN": "faire_test_api_token",
      },
      body: JSON.stringify({ carrier: "UPS", tracking_code: "1Z123", shipping_type: "STANDARD" }),
    });
    expect(shipment.status).toBe(201);
    const shipmentBody = (await shipment.json()) as { order: { state: string }; shipment: { tracking_code: string } };
    expect(shipmentBody.shipment.tracking_code).toBe("1Z123");
    expect(shipmentBody.order.state).toBe("PROCESSING");

    expect(deliveries).toHaveLength(3);
    expect(deliveries[0]?.headers["x-faire-event"]).toBe("order.created");
    expect(deliveries[2]?.headers["x-faire-signature-256"]).toContain("sha256=");

    const fs = getFaireStore(store);
    expect(fs.webhookDeliveries.all()).toHaveLength(3);
  });

  it("supports MFA completion with iflt and iflc links", async () => {
    const { app } = createTestApp({
      users: [
        {
          user_id: "u_mfa",
          email: "mfa@example.com",
          password: "secret",
          name: "MFA User",
          brand_ids: ["b_emulate"],
          default_brand_id: "b_emulate",
          mfa_required: true,
        },
      ],
    });

    const loginRes = await app.request(`${BASE_URL}/api/v2/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email_address: "mfa@example.com",
        password: "secret",
        enable_mfa_method_selection: true,
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as { login_state: string; mfa_description: string };
    expect(loginBody.login_state).toBe("MFA_REQUIRED");

    const mfaUrl = loginBody.mfa_description.match(/https?:\/\/[^\s]+/i)?.[0];
    expect(mfaUrl).toBeTruthy();

    const verify = await app.request(mfaUrl ?? "");
    expect(verify.status).toBe(200);
    expect(verify.headers.get("x-if-wsat")).toBeTruthy();
    expect(verify.headers.get("set-cookie")).toContain("indigofair_session=");
  });

  it("supports Messenger sessions, conversation listing, incremental message fetches, and sends", async () => {
    const { app } = createTestApp();
    const { sessionToken, body } = await login(app);
    expect(body.brand_token).toBe("b_emulate");
    expect(sessionToken).toBeTruthy();

    const retailerConversation = await app.request(`${BASE_URL}/api/v3/messenger/retailer-conversation/r_emulate`, {
      headers: {
        cookie: `indigofair_session=${sessionToken}`,
        "x-facnt": "b_emulate",
      },
    });
    expect(retailerConversation.status).toBe(200);
    expect(await retailerConversation.json()).toMatchObject({
      conversation: { token: "mc_emulate", retailer_token: "r_emulate" },
    });

    const listConversations = await app.request(`${BASE_URL}/api/messenger/list-conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `indigofair_session=${sessionToken}`,
        "x-facnt": "b_emulate",
      },
      body: JSON.stringify({ limit: 10 }),
    });
    expect(listConversations.status).toBe(200);
    const conversationBody = (await listConversations.json()) as { conversations: Array<{ token: string }> };
    expect(conversationBody.conversations[0]?.token).toBe("mc_emulate");

    const newMessage = await app.request(`${BASE_URL}/api/v3/messenger/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `indigofair_session=${sessionToken}`,
        "x-facnt": "b_emulate",
      },
      body: JSON.stringify({
        conversation_token: "mc_emulate",
        message_contents: {
          text: "Absolutely. We can send another sample.",
          image_tokens: [],
          product_tokens: [],
          product_based_collection_tokens: [],
        },
      }),
    });
    expect(newMessage.status).toBe(200);
    const sendBody = (await newMessage.json()) as { conversation: { latest_message: { token: string; text: string; created_at: number } } };
    expect(sendBody.conversation.latest_message.text).toBe("Absolutely. We can send another sample.");

    const incremental = await app.request(`${BASE_URL}/api/v3/messenger/list-messages-page`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `indigofair_session=${sessionToken}`,
        "x-facnt": "b_emulate",
      },
      body: JSON.stringify({
        conversation_token: "mc_emulate",
        after_timestamp: sendBody.conversation.latest_message.created_at - 1,
      }),
    });
    expect(incremental.status).toBe(200);
    const messageBody = (await incremental.json()) as {
      messages: Array<{ standard_message?: { token: string; body: string } }>;
      message_authors: Array<{ token: string; type: string }>;
    };
    expect(messageBody.messages.at(-1)?.standard_message?.body).toBe("Absolutely. We can send another sample.");
    expect(messageBody.message_authors.some((author) => author.type === "BRAND_USER")).toBe(true);
  });

  it("returns a non-retryable 400 payload for blacklisted Messenger recipients", async () => {
    const { app } = createTestApp({
      retailers: [{ retailer_id: "r_blocked", name: "Blocked Buyer", accepting_messages: false }],
      conversations: [{ token: "mc_blocked", brand_id: "b_emulate", retailer_token: "r_blocked", retailer_name: "Blocked Buyer" }],
    });
    const { sessionToken } = await login(app);

    const send = await app.request(`${BASE_URL}/api/v3/messenger/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `indigofair_session=${sessionToken}`,
        "x-facnt": "b_emulate",
      },
      body: JSON.stringify({
        conversation_token: "mc_blocked",
        message_contents: { text: "Hello" },
      }),
    });
    expect(send.status).toBe(400);
    expect(await send.json()).toMatchObject({
      service_error_code: "BlockMessageException.BLACKLISTED_RECIPIENT",
    });
  });

  it("supports switching a multi-brand session to a different brand", async () => {
    const { app } = createTestApp({
      brands: [{ brand_id: "b_other", name: "Other Brand" }],
      users: [
        {
          user_id: "u_multi",
          email: "multi@example.com",
          password: "password",
          name: "Multi",
          brand_ids: ["b_emulate", "b_other"],
          default_brand_id: "b_emulate",
        },
      ],
    });

    const firstLogin = await login(app, "multi@example.com", "password");
    const switchRes = await app.request(`${BASE_URL}/api/user/switch-account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `indigofair_session=${firstLogin.sessionToken}`,
        "x-facnt": "b_emulate",
      },
      body: JSON.stringify({ brand_token: "b_other" }),
    });
    expect(switchRes.status).toBe(200);
    const switchedSession = switchRes.headers.get("x-if-wsat");
    expect(switchedSession).toBeTruthy();
    expect(switchedSession).not.toBe(firstLogin.sessionToken);

    const conversations = await app.request(`${BASE_URL}/api/messenger/list-conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `indigofair_session=${switchedSession}`,
        "x-facnt": "b_other",
      },
      body: JSON.stringify({}),
    });
    expect(conversations.status).toBe(200);
    expect(await conversations.json()).toMatchObject({ conversations: [] });
  });

  it("can create a first Faire Messenger conversation for an order-only retailer relationship", async () => {
    const { app } = createTestApp({
      retailers: [{ retailer_id: "r_first_touch", name: "First Touch", accepting_messages: true }],
    });
    const { sessionToken } = await login(app);

    const retailerConversation = await app.request(`${BASE_URL}/api/v3/messenger/retailer-conversation/r_first_touch`, {
      headers: {
        cookie: `indigofair_session=${sessionToken}`,
        "x-facnt": "b_emulate",
      },
    });
    expect(await retailerConversation.json()).toMatchObject({
      conversation: {
        retailer_token: "r_first_touch",
        is_accepting_messages: true,
      },
    });

    const created = await app.request(`${BASE_URL}/api/v3/messenger/create-conversation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `indigofair_session=${sessionToken}`,
        "x-facnt": "b_emulate",
      },
      body: JSON.stringify({
        other_participant_token: { retailer_token: "r_first_touch" },
        message_contents: {
          text: "Hi there",
          image_tokens: [],
          product_tokens: [],
          product_based_collection_tokens: [],
        },
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { conversation: { token: string; latest_message: { token: string } } };
    expect(createdBody.conversation.token).toMatch(/^mc_/);
    expect(createdBody.conversation.latest_message.token).toMatch(/^mm_/);
  });
});
