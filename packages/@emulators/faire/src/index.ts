import type { Hono } from "@emulators/core";
import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import { getFaireStore } from "./store.js";
import { issueToken, normalizeScopes } from "./auth.js";
import { oauthRoutes } from "./routes/oauth.js";
import { apiRoutes } from "./routes/api.js";
import { messengerRoutes } from "./routes/messenger.js";
import { inspectorRoutes } from "./routes/inspector.js";
import { makeDisplayId, makeFaireToken } from "./ids.js";
import type { FaireAddress, FaireOrderItem, FaireProductVariant, FaireShipment } from "./entities.js";

export { getFaireStore, type FaireStore } from "./store.js";
export * from "./entities.js";

export interface FaireSeedConfig {
  port?: number;
  brands?: Array<{
    brand_id?: string;
    name: string;
    profile?: Record<string, unknown>;
  }>;
  users?: Array<{
    user_id?: string;
    email: string;
    password?: string;
    name?: string;
    brand_ids?: string[] | string;
    default_brand_id?: string;
    mfa_required?: boolean;
    mfa_title?: string;
    mfa_description?: string;
  }>;
  oauth_apps?: Array<{
    application_token: string;
    application_secret: string;
    name: string;
    redirect_urls: string[];
    scopes?: string[] | string;
  }>;
  tokens?: Array<{
    access_token: string;
    token_type?: "oauth_access" | "api_token";
    brand_id: string;
    application_token?: string;
    user_id?: string;
    scopes?: string[] | string;
  }>;
  retailers?: Array<{
    retailer_id?: string;
    name: string;
    is_insider?: boolean;
    accepting_messages?: boolean;
    profile?: Record<string, unknown>;
  }>;
  products?: Array<{
    id?: string;
    brand_id: string;
    name: string;
    description?: string;
    short_description?: string;
    sale_state?: string;
    lifecycle_state?: string;
    variants?: FaireProductVariant[];
    images?: Array<Record<string, unknown>>;
    variant_option_sets?: Array<{ name: string; values: string[] }>;
    taxonomy_type?: { id: string; name: string };
    preorderable?: boolean;
    preorder_details?: Record<string, unknown>;
    created_at?: string;
    updated_at?: string;
  }>;
  orders?: Array<{
    id?: string;
    brand_id: string;
    display_id?: string;
    state?: string;
    retailer_id?: string;
    source?: string;
    currency?: string;
    address?: FaireAddress;
    customer?: { first_name?: string; last_name?: string };
    purchase_order_number?: string;
    notes?: string;
    sales_rep_name?: string;
    original_order_id?: string;
    is_fulfilled_by_faire?: boolean;
    is_free_shipping?: boolean;
    free_shipping_reason?: string;
    faire_covered_shipping_cost?: { amount_minor: number; currency: string };
    has_pending_retailer_cancellation_request?: boolean;
    brand_discounts?: Array<Record<string, unknown>>;
    payout_costs?: Record<string, unknown>;
    items?: FaireOrderItem[];
    shipments?: FaireShipment[];
    created_at?: string;
    updated_at?: string;
    requested_ship_date?: string;
    expected_ship_date?: string;
    ship_after?: string;
    processing_at?: string;
    payment_initiated_at?: string;
    estimated_payout_at?: string;
  }>;
  conversations?: Array<{
    token?: string;
    brand_id: string;
    retailer_token: string;
    retailer_name?: string;
    is_accepting_messages?: boolean;
    include_in_list?: boolean;
    total_messages?: number;
    unread_messages?: number;
    needs_reply?: boolean;
    updated_at?: number | string;
    latest_message_text?: string;
    latest_message_token?: string;
    latest_message_created_at?: number | string;
  }>;
  messages?: Array<{
    token?: string;
    brand_id: string;
    conversation_token: string;
    message_type?: "standard" | "inline";
    author_token?: string;
    author_name?: string;
    body?: string;
    image_urls?: string[];
    timestamp_ms?: number | string;
    inline_type?: string;
    inline_data?: Record<string, unknown>;
  }>;
  webhooks?: Array<{
    webhook_id?: string;
    brand_id: string;
    label?: string;
    url: string;
    events?: string[] | string;
    secret?: string;
    enabled?: boolean;
  }>;
}

const DEFAULT_SCOPES = ["READ_ORDERS", "READ_PRODUCTS", "READ_BRAND", "READ_RETAILER"];

function toMillis(value: number | string | undefined, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function seedDefaults(store: Store, _baseUrl: string): void {
  const fs = getFaireStore(store);

  const brandId = "b_emulate";
  if (!fs.brands.findOneBy("brand_id", brandId)) {
    fs.brands.insert({
      brand_id: brandId,
      name: "Emulate Brand",
      profile: {
        brand_id: brandId,
        name: "Emulate Brand",
      },
    });
  }

  if (!fs.users.findOneBy("email", "brand@example.com")) {
    fs.users.insert({
      user_id: "u_emulate",
      email: "brand@example.com",
      password: "password",
      name: "Brand User",
      brand_ids: [brandId],
      default_brand_id: brandId,
      mfa_required: false,
      mfa_title: "MFA Required",
      mfa_description: "Check your inbox for a Faire verification link.",
    });
  }

  if (!fs.oauthApps.findOneBy("application_token", "emu_faire_app_id")) {
    fs.oauthApps.insert({
      application_token: "emu_faire_app_id",
      application_secret: "emu_faire_app_secret",
      name: "My Faire App",
      redirect_urls: ["http://localhost:3000/api/auth/callback/faire"],
      scopes: DEFAULT_SCOPES,
    });
  }

  if (!fs.retailers.findOneBy("retailer_id", "r_emulate")) {
    fs.retailers.insert({
      retailer_id: "r_emulate",
      name: "Corner Pantry",
      is_insider: true,
      accepting_messages: true,
      profile: {
        retailer_id: "r_emulate",
        name: "Corner Pantry",
        is_insider: true,
      },
    });
  }

  if (!fs.products.findOneBy("product_id", "prod_emulate")) {
    fs.products.insert({
      product_id: "prod_emulate",
      brand_id: brandId,
      name: "Sunrise Tonic",
      description: "A seeded Faire product.",
      short_description: "Seeded tonic",
      sale_state: "FOR_SALE",
      lifecycle_state: "PUBLISHED",
      variants: [
        {
          id: "var_emulate_1",
          product_id: "prod_emulate",
          name: "12 pack",
          sku: "SUN-TONIC-12",
          available_quantity: 120,
          wholesale_price_cents: 1800,
          retail_price_cents: 3600,
          prices: [
            {
              wholesale_price: { amount_minor: 1800, currency: "USD" },
              retail_price: { amount_minor: 3600, currency: "USD" },
            },
          ],
          options: [{ name: "Size", value: "12 pack" }],
          created_at: "2026-01-05T10:00:00.000Z",
          updated_at: "2026-01-05T10:00:00.000Z",
        },
      ],
      images: [{ url: "https://example.com/sunrise-tonic.png" }],
      variant_option_sets: [{ name: "Size", values: ["12 pack"] }],
      taxonomy_type: { id: "beverages", name: "Beverages" },
      preorderable: false,
      preorder_details: null,
      created_at_api: "2026-01-05T10:00:00.000Z",
      updated_at_api: "2026-01-05T10:00:00.000Z",
    });
  }

  if (!fs.orders.findOneBy("order_id", "bo_emulate")) {
    fs.orders.insert({
      order_id: "bo_emulate",
      brand_id: brandId,
      display_id: "BOEMULATE",
      state: "DELIVERED",
      retailer_id: "r_emulate",
      source: "SAMPLE",
      currency: "USD",
      created_at_api: "2026-02-01T12:00:00.000Z",
      updated_at_api: "2026-02-03T12:00:00.000Z",
      address: {
        address1: "123 Market Street",
        city: "San Francisco",
        state: "California",
        state_code: "CA",
        postal_code: "94103",
        country: "United States",
        country_code: "USA",
      },
      customer: { first_name: "Taylor", last_name: "Buyer" },
      purchase_order_number: "SAMPLE-1001",
      notes: "Seeded sample order",
      sales_rep_name: "Demo Rep",
      original_order_id: null,
      is_fulfilled_by_faire: false,
      is_free_shipping: true,
      free_shipping_reason: "FAIRE_PROMO",
      faire_covered_shipping_cost: { amount_minor: 800, currency: "USD" },
      has_pending_retailer_cancellation_request: false,
      brand_discounts: [
        {
          code: "WELCOME10",
          discount_type: "FLAT_AMOUNT",
          discount_amount_cents: 1000,
          includes_free_shipping: true,
        },
      ],
      payout_costs: {
        subtotal_after_brand_discounts: { amount_minor: 2600, currency: "USD" },
        total_brand_discounts: { amount_minor: 1000, currency: "USD" },
        total_payout: { amount_minor: 2140, currency: "USD" },
        commission: { amount_minor: 360, currency: "USD" },
        payout_fee: { amount_minor: 100, currency: "USD" },
      },
      items: [
        {
          id: "oi_emulate_1",
          order_id: "bo_emulate",
          product_id: "prod_emulate",
          product_name: "Sunrise Tonic",
          variant_id: "var_emulate_1",
          variant_name: "12 pack",
          sku: "SUN-TONIC-12",
          quantity: 2,
          price_cents: 1800,
          created_at: "2026-02-01T12:00:00.000Z",
          updated_at: "2026-02-01T12:00:00.000Z",
        },
      ],
      shipments: [
        {
          id: "ship_emulate_1",
          order_id: "bo_emulate",
          carrier: "UPS",
          tracking_code: "1ZEMULATE",
          shipping_type: "STANDARD",
          maker_cost_cents: 500,
          created_at: "2026-02-02T12:00:00.000Z",
          updated_at: "2026-02-02T12:00:00.000Z",
        },
      ],
      requested_ship_date: null,
      expected_ship_date: null,
      ship_after: null,
      processing_at: null,
      payment_initiated_at: null,
      estimated_payout_at: null,
    });
  }

  if (!fs.conversations.findOneBy("token", "mc_emulate")) {
    fs.conversations.insert({
      token: "mc_emulate",
      brand_id: brandId,
      retailer_token: "r_emulate",
      retailer_name: "Corner Pantry",
      is_accepting_messages: true,
      include_in_list: true,
      total_messages: 2,
      unread_messages: 1,
      needs_reply: true,
      updated_at_ms: Date.parse("2026-03-02T11:00:00.000Z"),
      latest_message_text: "Can you send another sample?",
      latest_message_token: "mm_emulate_2",
      latest_message_created_at: Date.parse("2026-03-02T11:00:00.000Z"),
    });
  }

  if (!fs.messages.findOneBy("token", "mie_emulate_1")) {
    fs.messages.insert({
      token: "mie_emulate_1",
      brand_id: brandId,
      conversation_token: "mc_emulate",
      message_type: "inline",
      author_token: null,
      author_name: null,
      body: null,
      image_urls: null,
      timestamp_ms: Date.parse("2026-03-01T10:00:00.000Z"),
      inline_type: "ORDER_PLACED",
      inline_data: { related_tokens: ["bo_emulate"] },
    });
  }
  if (!fs.messages.findOneBy("token", "mm_emulate_2")) {
    fs.messages.insert({
      token: "mm_emulate_2",
      brand_id: brandId,
      conversation_token: "mc_emulate",
      message_type: "standard",
      author_token: "r_emulate",
      author_name: "Corner Pantry",
      body: "Can you send another sample?",
      image_urls: [],
      timestamp_ms: Date.parse("2026-03-02T11:00:00.000Z"),
      inline_type: null,
      inline_data: null,
    });
  }

  if (!fs.tokens.findOneBy("access_token", "faire_test_api_token")) {
    issueToken(store, {
      accessToken: "faire_test_api_token",
      tokenType: "api_token",
      brandId,
      userId: "u_emulate",
      scopes: DEFAULT_SCOPES,
    });
  }
}

export function seedFromConfig(store: Store, _baseUrl: string, config: FaireSeedConfig): void {
  const fs = getFaireStore(store);

  if (config.brands) {
    for (const brandConfig of config.brands) {
      const brandId = brandConfig.brand_id ?? makeFaireToken("b", 8);
      const existing = fs.brands.findOneBy("brand_id", brandId);
      if (existing) {
        fs.brands.update(existing.id, {
          name: brandConfig.name,
          profile: {
            brand_id: brandId,
            name: brandConfig.name,
            ...(brandConfig.profile ?? {}),
          },
        });
      } else {
        fs.brands.insert({
          brand_id: brandId,
          name: brandConfig.name,
          profile: {
            brand_id: brandId,
            name: brandConfig.name,
            ...(brandConfig.profile ?? {}),
          },
        });
      }
    }
  }

  if (config.users) {
    for (const userConfig of config.users) {
      if (fs.users.findOneBy("email", userConfig.email)) continue;
      const brandIds = normalizeScopes(userConfig.brand_ids, fs.brands.all()[0] ? [fs.brands.all()[0].brand_id] : []);
      const defaultBrandId = userConfig.default_brand_id ?? brandIds[0] ?? "b_emulate";
      fs.users.insert({
        user_id: userConfig.user_id ?? makeFaireToken("u", 8),
        email: userConfig.email.toLowerCase(),
        password: userConfig.password ?? "password",
        name: userConfig.name ?? userConfig.email.split("@")[0],
        brand_ids: brandIds,
        default_brand_id: defaultBrandId,
        mfa_required: userConfig.mfa_required ?? false,
        mfa_title: userConfig.mfa_title ?? "MFA Required",
        mfa_description: userConfig.mfa_description ?? "Check your inbox for a Faire verification link.",
      });
    }
  }

  if (config.oauth_apps) {
    for (const appConfig of config.oauth_apps) {
      const existing = fs.oauthApps.findOneBy("application_token", appConfig.application_token);
      const data = {
        application_secret: appConfig.application_secret,
        name: appConfig.name,
        redirect_urls: appConfig.redirect_urls,
        scopes: normalizeScopes(appConfig.scopes, DEFAULT_SCOPES),
      };
      if (existing) fs.oauthApps.update(existing.id, data);
      else fs.oauthApps.insert({ application_token: appConfig.application_token, ...data });
    }
  }

  if (config.tokens) {
    for (const tokenConfig of config.tokens) {
      issueToken(store, {
        accessToken: tokenConfig.access_token,
        tokenType: tokenConfig.token_type ?? "api_token",
        brandId: tokenConfig.brand_id,
        applicationToken: tokenConfig.application_token,
        userId: tokenConfig.user_id,
        scopes: normalizeScopes(tokenConfig.scopes, DEFAULT_SCOPES),
      });
    }
  }

  if (config.retailers) {
    for (const retailerConfig of config.retailers) {
      const retailerId = retailerConfig.retailer_id ?? makeFaireToken("r", 8);
      const existing = fs.retailers.findOneBy("retailer_id", retailerId);
      const data = {
        name: retailerConfig.name,
        is_insider: retailerConfig.is_insider ?? false,
        accepting_messages: retailerConfig.accepting_messages ?? true,
        profile: {
          retailer_id: retailerId,
          id: retailerId,
          name: retailerConfig.name,
          is_insider: retailerConfig.is_insider ?? false,
          ...(retailerConfig.profile ?? {}),
        },
      };
      if (existing) fs.retailers.update(existing.id, data);
      else fs.retailers.insert({ retailer_id: retailerId, ...data });
    }
  }

  if (config.products) {
    for (const productConfig of config.products) {
      const productId = productConfig.id ?? makeFaireToken("prod", 8);
      const existing = fs.products.findOneBy("product_id", productId);
      const data = {
        brand_id: productConfig.brand_id,
        name: productConfig.name,
        description: productConfig.description ?? null,
        short_description: productConfig.short_description ?? null,
        sale_state: productConfig.sale_state ?? "FOR_SALE",
        lifecycle_state: productConfig.lifecycle_state ?? "PUBLISHED",
        variants: productConfig.variants ?? [],
        images: productConfig.images,
        variant_option_sets: productConfig.variant_option_sets,
        taxonomy_type: productConfig.taxonomy_type ?? null,
        preorderable: productConfig.preorderable ?? null,
        preorder_details: productConfig.preorder_details ?? null,
        created_at_api: productConfig.created_at ?? nowIso(),
        updated_at_api: productConfig.updated_at ?? productConfig.created_at ?? nowIso(),
      };
      if (existing) fs.products.update(existing.id, data);
      else fs.products.insert({ product_id: productId, ...data });
    }
  }

  if (config.orders) {
    for (const orderConfig of config.orders) {
      const orderId = orderConfig.id ?? makeFaireToken("bo", 10);
      const existing = fs.orders.findOneBy("order_id", orderId);
      const data = {
        brand_id: orderConfig.brand_id,
        display_id: orderConfig.display_id ?? makeDisplayId(),
        state: (orderConfig.state ?? "NEW") as any,
        retailer_id: orderConfig.retailer_id ?? null,
        customer: orderConfig.customer,
        source: orderConfig.source ?? "DIRECT",
        ship_after: orderConfig.ship_after ?? null,
        expected_ship_date: orderConfig.expected_ship_date ?? null,
        requested_ship_date: orderConfig.requested_ship_date ?? null,
        processing_at: orderConfig.processing_at ?? null,
        payment_initiated_at: orderConfig.payment_initiated_at ?? null,
        estimated_payout_at: orderConfig.estimated_payout_at ?? null,
        created_at_api: orderConfig.created_at ?? nowIso(),
        updated_at_api: orderConfig.updated_at ?? orderConfig.created_at ?? nowIso(),
        address: orderConfig.address ?? null,
        purchase_order_number: orderConfig.purchase_order_number ?? null,
        notes: orderConfig.notes ?? null,
        sales_rep_name: orderConfig.sales_rep_name ?? null,
        original_order_id: orderConfig.original_order_id ?? null,
        is_fulfilled_by_faire: orderConfig.is_fulfilled_by_faire ?? null,
        is_free_shipping: orderConfig.is_free_shipping ?? null,
        free_shipping_reason: orderConfig.free_shipping_reason ?? null,
        faire_covered_shipping_cost: orderConfig.faire_covered_shipping_cost ?? null,
        has_pending_retailer_cancellation_request: orderConfig.has_pending_retailer_cancellation_request ?? null,
        brand_discounts: (orderConfig.brand_discounts ?? []) as any,
        payout_costs: (orderConfig.payout_costs ?? null) as any,
        currency: orderConfig.currency ?? "USD",
        items: orderConfig.items ?? [],
        shipments: orderConfig.shipments ?? [],
      };
      if (existing) fs.orders.update(existing.id, data);
      else fs.orders.insert({ order_id: orderId, ...data });
    }
  }

  if (config.conversations) {
    for (const conversationConfig of config.conversations) {
      const token = conversationConfig.token ?? makeFaireToken("mc", 10);
      const existing = fs.conversations.findOneBy("token", token);
      const updatedAtMs = toMillis(conversationConfig.updated_at);
      const data = {
        brand_id: conversationConfig.brand_id,
        retailer_token: conversationConfig.retailer_token,
        retailer_name: conversationConfig.retailer_name ?? null,
        is_accepting_messages: conversationConfig.is_accepting_messages ?? true,
        include_in_list: conversationConfig.include_in_list ?? true,
        total_messages: conversationConfig.total_messages ?? 0,
        unread_messages: conversationConfig.unread_messages ?? 0,
        needs_reply: conversationConfig.needs_reply ?? false,
        updated_at_ms: updatedAtMs,
        latest_message_text: conversationConfig.latest_message_text ?? null,
        latest_message_token: conversationConfig.latest_message_token ?? null,
        latest_message_created_at: conversationConfig.latest_message_created_at
          ? toMillis(conversationConfig.latest_message_created_at)
          : null,
      };
      if (existing) fs.conversations.update(existing.id, data);
      else fs.conversations.insert({ token, ...data });
    }
  }

  if (config.messages) {
    for (const messageConfig of config.messages) {
      const token = messageConfig.token ?? makeFaireToken(messageConfig.message_type === "inline" ? "mie" : "mm", 10);
      if (fs.messages.findOneBy("token", token)) continue;
      fs.messages.insert({
        token,
        brand_id: messageConfig.brand_id,
        conversation_token: messageConfig.conversation_token,
        message_type: messageConfig.message_type ?? "standard",
        author_token: messageConfig.author_token ?? null,
        author_name: messageConfig.author_name ?? null,
        body: messageConfig.body ?? null,
        image_urls: messageConfig.image_urls ?? [],
        timestamp_ms: toMillis(messageConfig.timestamp_ms),
        inline_type: messageConfig.inline_type ?? null,
        inline_data: messageConfig.inline_data ?? null,
      });
    }
  }

  if (config.webhooks) {
    for (const webhookConfig of config.webhooks) {
      const webhookId = webhookConfig.webhook_id ?? makeFaireToken("wh", 10);
      const existing = fs.webhooks.findOneBy("webhook_id", webhookId);
      const data = {
        brand_id: webhookConfig.brand_id,
        label: webhookConfig.label ?? webhookConfig.url,
        url: webhookConfig.url,
        events: normalizeScopes(webhookConfig.events, ["*"]),
        secret: webhookConfig.secret ?? null,
        enabled: webhookConfig.enabled ?? true,
      };
      if (existing) fs.webhooks.update(existing.id, data);
      else fs.webhooks.insert({ webhook_id: webhookId, ...data });
    }
  }

  for (const conversation of fs.conversations.all()) {
    const messages = fs.messages
      .all()
      .filter((message) => message.conversation_token === conversation.token)
      .sort((a, b) => a.timestamp_ms - b.timestamp_ms);
    if (messages.length === 0) continue;
    const latest = messages[messages.length - 1];
    fs.conversations.update(conversation.id, {
      total_messages: messages.length,
      updated_at_ms: latest.timestamp_ms,
      latest_message_token: latest.token,
      latest_message_created_at: latest.timestamp_ms,
      latest_message_text: latest.body ?? latest.inline_type ?? conversation.latest_message_text,
    });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export const fairePlugin: ServicePlugin = {
  name: "faire",
  register(app: Hono<AppEnv>, store: Store, _webhooks: WebhookDispatcher, _baseUrl: string, _tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks: _webhooks, baseUrl: _baseUrl, tokenMap: _tokenMap };
    oauthRoutes(ctx);
    apiRoutes(ctx);
    messengerRoutes(ctx);
    inspectorRoutes(ctx);
  },
  seed(store: Store, baseUrl: string): void {
    seedDefaults(store, baseUrl);
  },
};

export default fairePlugin;
