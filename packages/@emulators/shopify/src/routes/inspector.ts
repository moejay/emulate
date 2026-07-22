import type { InspectorTab, RouteContext } from "@emulators/core";
import { escapeHtml, renderInspectorPage } from "@emulators/core";
import { decodeJwtPayload, normalizeTopic } from "../helpers.js";
import { getShopifyStore } from "../store.js";
import { dispatchShopifyWebhook, createDefaultWebhookPayload } from "../webhooks.js";
import { mintSessionToken } from "../auth.js";

const SERVICE_LABEL = "Shopify";

const TABS: InspectorTab[] = [
  { id: "overview", label: "Overview", href: "/?tab=overview" },
  { id: "auth", label: "Auth", href: "/?tab=auth" },
  { id: "webhooks", label: "Webhooks", href: "/?tab=webhooks" },
  { id: "bulk", label: "Bulk Ops", href: "/?tab=bulk" },
];

function section(title: string, body: string): string {
  return `<section class="inspector-section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function table(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `<p class="inspector-empty">${escapeHtml(empty)}</p>`;
  return `<table class="inspector-table"><thead><tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("\n")}</tbody></table>`;
}

function badge(label: string, tone: "granted" | "requested" | "denied" = "requested"): string {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

export function inspectorRoutes(ctx: RouteContext): void {
  const { app, store, baseUrl } = ctx;
  const ss = () => getShopifyStore(store);

  app.post("/_inspector/webhooks/emit", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, string>;
    const topic = normalizeTopic(String(body.topic ?? "orders/updated"));
    const shop = ss().shops.all()[0];
    if (shop) {
      await dispatchShopifyWebhook(store, baseUrl, {
        shopDomain: shop.myshopify_domain,
        topic,
        payload: createDefaultWebhookPayload(topic, shop.myshopify_domain, store),
      });
    }
    return c.redirect(`/?tab=webhooks`, 302);
  });

  app.get("/", (c) => {
    const tab = TABS.some((candidate) => candidate.id === c.req.query("tab")) ? c.req.query("tab")! : "overview";
    const shop = ss().shops.all()[0];
    const appRecord = ss().oauthApps.all()[0];
    const staff = ss().staffUsers.all()[0];

    let body = "";

    if (tab === "auth") {
      const accessToken = ss().accessTokens.all()[0];
      const sessionToken = appRecord && shop && staff
        ? mintSessionToken(store, { clientId: appRecord.client_id, shopDomain: shop.myshopify_domain, staffGid: staff.staff_gid })
        : null;
      const sessionPayload = sessionToken ? decodeJwtPayload(sessionToken) : null;

      body = [
        section(
          "OAuth Apps",
          table(
            ["Client ID", "Name", "Scopes", "Redirect URIs"],
            ss().oauthApps.all().map((oauthApp) => [
              escapeHtml(oauthApp.client_id),
              escapeHtml(oauthApp.name),
              escapeHtml(oauthApp.scopes.join(", ")),
              escapeHtml(oauthApp.redirect_uris.join(", ")),
            ]),
            "No Shopify apps are configured.",
          ),
        ),
        section(
          "Access Tokens",
          table(
            ["Token", "Shop", "Scopes", "State"],
            ss().accessTokens.all().map((token) => [
              escapeHtml(token.token),
              escapeHtml(token.shop_domain),
              escapeHtml(token.scopes.join(", ")),
              token.revoked ? badge("revoked", "denied") : badge("active", "granted"),
            ]),
            "No access tokens have been issued.",
          ),
        ),
        section(
          "Session Token Preview",
          sessionToken && sessionPayload
            ? `${table(
                ["Field", "Value"],
                [
                  ["token", escapeHtml(sessionToken)],
                  ["aud", escapeHtml(String(sessionPayload.aud ?? ""))],
                  ["iss", escapeHtml(String(sessionPayload.iss ?? ""))],
                  ["dest", escapeHtml(String(sessionPayload.dest ?? ""))],
                  ["sub", escapeHtml(String(sessionPayload.sub ?? ""))],
                ],
                "",
              )}<p class="info-text">Use GET /auth/session-token with X-Shopify-Access-Token: ${escapeHtml(accessToken?.token ?? "shpat_test_admin")} to mint a fresh token for local embedded app flows.</p>`
            : '<p class="inspector-empty">Seed an app, shop, and staff user to preview session tokens.</p>',
        ),
      ].join("\n");
    } else if (tab === "webhooks") {
      const topics = [
        "products/update",
        "orders/updated",
        "bulk_operations/finish",
        "draft_orders/update",
        "customers/data_request",
        "customers/redact",
        "shop/redact",
        "app/uninstalled",
      ];
      const formRows = topics
        .map(
          (topic) => `<form method="post" action="/_inspector/webhooks/emit" class="user-form">
            <input type="hidden" name="topic" value="${escapeHtml(topic)}"/>
            <button type="submit" class="user-btn"><span class="user-login">Emit ${escapeHtml(topic)}</span></button>
          </form>`,
        )
        .join("\n");

      body = [
        section(
          "Subscriptions",
          table(
            ["Topic", "URL", "API Version", "State"],
            ss().webhookSubscriptions.all().map((subscription) => [
              escapeHtml(subscription.topic),
              escapeHtml(subscription.uri),
              escapeHtml(subscription.api_version),
              subscription.active ? badge("active", "granted") : badge("inactive", "denied"),
            ]),
            "No webhook subscriptions are registered.",
          ),
        ),
        section("Emit Test Topics", formRows),
        section(
          "Deliveries",
          table(
            ["Topic", "Target", "Status", "Duration", "Webhook ID"],
            ss().webhookDeliveries
              .all()
              .slice()
              .reverse()
              .map((delivery) => [
                escapeHtml(delivery.topic),
                escapeHtml(delivery.request_url ?? ""),
                delivery.success ? badge(String(delivery.status_code ?? 200), "granted") : badge(String(delivery.status_code ?? "failed"), "denied"),
                escapeHtml(delivery.duration_ms == null ? "" : `${delivery.duration_ms}ms`),
                escapeHtml(delivery.webhook_id_header),
              ]),
            "No webhook deliveries yet.",
          ),
        ),
      ].join("\n");
    } else if (tab === "bulk") {
      body = [
        section(
          "Bulk Operations",
          table(
            ["Model", "Status", "Objects", "Result URL", "Completed"],
            ss().bulkOperations
              .all()
              .slice()
              .reverse()
              .map((operation) => [
                escapeHtml(operation.model),
                escapeHtml(operation.status),
                escapeHtml(String(operation.object_count)),
                escapeHtml(operation.url ?? ""),
                escapeHtml(operation.completed_at ?? ""),
              ]),
            "No bulk operations have run.",
          ),
        ),
        section(
          "Draft Orders",
          table(
            ["ID", "Customer", "Status", "Invoice URL"],
            ss().draftOrders.all().map((draftOrder) => [
              escapeHtml(draftOrder.draft_order_gid),
              escapeHtml(draftOrder.customer_gid),
              escapeHtml(draftOrder.status),
              escapeHtml(draftOrder.invoice_url ?? ""),
            ]),
            "No draft orders have been created.",
          ),
        ),
      ].join("\n");
    } else {
      body = [
        section(
          "Shop",
          table(
            ["Name", "Domain", "Currency", "Plan"],
            shop
              ? [[escapeHtml(shop.name), escapeHtml(shop.myshopify_domain), escapeHtml(shop.currency_code), escapeHtml(shop.plan_display_name)]]
              : [],
            "No shop is seeded.",
          ),
        ),
        section(
          "B2B Signals",
          table(
            ["Customer", "Company", "Tags", "Orders", "Spent"],
            ss().customers.all().map((customer) => [
              escapeHtml(customer.email ?? customer.customer_gid),
              escapeHtml(customer.default_address?.company ?? ""),
              escapeHtml(customer.tags.join(", ")),
              escapeHtml(String(customer.number_of_orders)),
              escapeHtml(customer.amount_spent ?? "0.00"),
            ]),
            "No customers are seeded.",
          ),
        ),
        section(
          "Catalog",
          table(
            ["Product", "Variants", "Status", "Updated"],
            ss().products.all().map((product) => [
              escapeHtml(product.title),
              escapeHtml(String(ss().variants.findBy("product_gid", product.product_gid).length)),
              escapeHtml(product.status),
              escapeHtml(product.updated_at_iso),
            ]),
            "No products are seeded.",
          ),
        ),
        section(
          "Orders",
          table(
            ["Order", "Customer", "Financial", "Fulfillment", "Lines"],
            ss().orders.all().map((order) => [
              escapeHtml(order.name),
              escapeHtml(order.email ?? order.customer_gid ?? ""),
              escapeHtml(order.display_financial_status ?? ""),
              escapeHtml(order.display_fulfillment_status ?? ""),
              escapeHtml(String(order.line_items.length)),
            ]),
            "No orders are seeded.",
          ),
        ),
      ].join("\n");
    }

    return c.html(renderInspectorPage("Shopify Inspector", TABS, tab, body, SERVICE_LABEL));
  });
}
