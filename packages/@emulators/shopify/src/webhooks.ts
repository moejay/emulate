import { randomUUID } from "node:crypto";
import type { Store } from "@emulators/core";
import { getShopifyStore } from "./store.js";
import { randomToken, webhookHmacBase64 } from "./helpers.js";
import type { ShopifyWebhookSubscription } from "./entities.js";

export interface ShopifyWebhookDispatchOptions {
  shopDomain: string;
  topic: string;
  payload: Record<string, unknown>;
}

function subscriptionSecret(store: Store, subscription: ShopifyWebhookSubscription): string | null {
  const ss = getShopifyStore(store);
  const app = ss.oauthApps.findOneBy("client_id", subscription.client_id);
  return app?.client_secret ?? null;
}

export async function dispatchShopifyWebhook(
  store: Store,
  _baseUrl: string,
  opts: ShopifyWebhookDispatchOptions,
): Promise<void> {
  const ss = getShopifyStore(store);
  const subscriptions = ss.webhookSubscriptions
    .all()
    .filter(
      (subscription) =>
        subscription.active && subscription.shop_domain === opts.shopDomain && subscription.topic === opts.topic,
    );

  const body = JSON.stringify(opts.payload);

  for (const subscription of subscriptions) {
    const secret = subscriptionSecret(store, subscription);
    const webhookId = randomUUID();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Shopify-Topic": opts.topic,
      "X-Shopify-Shop-Domain": opts.shopDomain,
      "X-Shopify-Webhook-Id": webhookId,
      "X-Shopify-API-Version": subscription.api_version,
      "X-Shopify-Triggered-At": new Date().toISOString(),
    };
    if (secret) {
      headers["X-Shopify-Hmac-Sha256"] = webhookHmacBase64(secret, body);
    }

    let statusCode: number | null = null;
    let success = false;
    let durationMs: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;

    try {
      const startedAt = Date.now();
      const response = await fetch(subscription.uri, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });
      durationMs = Date.now() - startedAt;
      statusCode = response.status;
      success = response.ok;
      responseBody = await response.text().catch(() => null);
    } catch (error) {
      durationMs = 0;
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    ss.webhookDeliveries.insert({
      delivery_gid: randomToken("whd"),
      webhook_id_header: webhookId,
      subscription_gid: subscription.subscription_gid,
      topic: opts.topic,
      shop_domain: opts.shopDomain,
      request_url: subscription.uri,
      request_body: body,
      status_code: statusCode,
      success,
      duration_ms: durationMs,
      response_body: responseBody,
      error_message: errorMessage,
    });
  }
}

export function createDefaultWebhookPayload(topic: string, shopDomain: string, store: Store): Record<string, unknown> {
  const ss = getShopifyStore(store);
  switch (topic) {
    case "customers/data_request": {
      const customer = ss.customers.all()[0];
      return {
        shop_id: ss.shops.all()[0]?.numeric_id ?? 1,
        shop_domain: shopDomain,
        customer: { id: customer?.numeric_id ?? 1, email: customer?.email ?? "customer@example.com" },
        data_request: { id: 1001 },
        orders_requested: ss.orders.all().slice(0, 2).map((order) => order.numeric_id),
      };
    }
    case "customers/redact": {
      const customer = ss.customers.all()[0];
      return {
        shop_id: ss.shops.all()[0]?.numeric_id ?? 1,
        shop_domain: shopDomain,
        customer: { id: customer?.numeric_id ?? 1, email: customer?.email ?? "customer@example.com" },
        orders_to_redact: ss.orders.all().slice(0, 2).map((order) => order.numeric_id),
      };
    }
    case "shop/redact":
      return {
        shop_id: ss.shops.all()[0]?.numeric_id ?? 1,
        shop_domain: shopDomain,
      };
    case "app/uninstalled":
      return {
        id: ss.shops.all()[0]?.numeric_id ?? 1,
        domain: shopDomain,
      };
    case "products/update": {
      const product = ss.products.all()[0];
      return {
        id: product?.numeric_id ?? 1,
        admin_graphql_api_id: product?.product_gid ?? "gid://shopify/Product/1",
        title: product?.title ?? "Sample Product",
        updated_at: product?.updated_at_iso ?? new Date().toISOString(),
      };
    }
    case "products/delete": {
      const product = ss.products.all()[0];
      return {
        id: product?.numeric_id ?? 1,
        admin_graphql_api_id: product?.product_gid ?? "gid://shopify/Product/1",
      };
    }
    case "orders/updated": {
      const order = ss.orders.all()[0];
      return {
        id: order?.numeric_id ?? 1,
        admin_graphql_api_id: order?.order_gid ?? "gid://shopify/Order/1",
        name: order?.name ?? "#1001",
        updated_at: order?.updated_at_iso ?? new Date().toISOString(),
      };
    }
    case "draft_orders/update": {
      const draftOrder = ss.draftOrders.all()[0];
      return {
        id: draftOrder?.numeric_id ?? 1,
        admin_graphql_api_id: draftOrder?.draft_order_gid ?? "gid://shopify/DraftOrder/1",
        status: draftOrder?.status ?? "invoice_sent",
      };
    }
    case "bulk_operations/finish": {
      const operation = ss.bulkOperations
        .all()
        .slice()
        .sort((a, b) => b.numeric_id - a.numeric_id)[0];
      return {
        admin_graphql_api_id: operation?.bulk_operation_gid ?? "gid://shopify/BulkOperation/1",
        status: operation?.status?.toLowerCase() ?? "completed",
        type: "query",
        object_count: String(operation?.object_count ?? 0),
        url: operation?.url ?? null,
        partial_data_url: null,
        created_at: operation?.created_at ?? new Date().toISOString(),
        completed_at: operation?.completed_at ?? new Date().toISOString(),
        error_code: operation?.error_code ?? null,
      };
    }
    default:
      return { shop_domain: shopDomain, topic };
  }
}
