import type { InspectorTab, RouteContext } from "@emulators/core";
import { escapeHtml, renderErrorPage, renderInspectorPage } from "@emulators/core";
import { consumePendingMfaLink, createSession } from "../auth.js";
import { orderResponse, productResponse } from "../helpers.js";
import { getFaireStore } from "../store.js";

const SERVICE_LABEL = "Faire";
const TABS: InspectorTab[] = [
  { id: "auth", label: "Auth", href: "/?tab=auth" },
  { id: "catalog", label: "Catalog", href: "/?tab=catalog" },
  { id: "orders", label: "Orders", href: "/?tab=orders" },
  { id: "messenger", label: "Messenger", href: "/?tab=messenger" },
  { id: "webhooks", label: "Webhooks", href: "/?tab=webhooks" },
];

type TabId = (typeof TABS)[number]["id"];

function section(title: string, body: string): string {
  return `<section class="inspector-section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function table(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `<p class="inspector-empty">${escapeHtml(empty)}</p>`;
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("\n");
  return `<table class="inspector-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function badge(label: string, tone: "granted" | "requested" | "denied" = "requested"): string {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

function jsonPreview(value: unknown): string {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function mask(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function inspectorRoutes({ app, store }: RouteContext): void {
  const fs = () => getFaireStore(store);

  app.get("/", (c) => {
    const iflt = c.req.query("iflt");
    const iflc = c.req.query("iflc");
    if (iflt && iflc) {
      const pending = consumePendingMfaLink(store, iflt, iflc);
      if (!pending) {
        return c.html(renderErrorPage("MFA link invalid", "This Faire MFA link is missing or expired.", SERVICE_LABEL), 400);
      }
      const user = fs().users.findOneBy("user_id", pending.userId);
      if (!user) {
        return c.html(renderErrorPage("MFA link invalid", "The Faire user no longer exists.", SERVICE_LABEL), 400);
      }
      const session = createSession(store, user, pending.brandId);
      return new Response("Faire MFA verified. Return to your app and paste this link into Grow.", {
        status: 200,
        headers: {
          "x-if-wsat": session.session_token,
          "set-cookie": `indigofair_session=${session.session_token}; Path=/; HttpOnly`,
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    const requested = c.req.query("tab") ?? "auth";
    const active = TABS.some((tab) => tab.id === requested) ? (requested as TabId) : "auth";
    const body =
      active === "catalog"
        ? renderCatalog()
        : active === "orders"
          ? renderOrders()
          : active === "messenger"
            ? renderMessenger()
            : active === "webhooks"
              ? renderWebhooks()
              : renderAuth();

    return c.html(renderInspectorPage("Faire Inspector", TABS, active, body, SERVICE_LABEL));
  });

  function renderAuth(): string {
    return [
      section(
        "Brands",
        table(
          ["Brand", "Profile"],
          fs().brands.all().map((brand) => [escapeHtml(brand.brand_id), jsonPreview(brand.profile)]),
          "No brands seeded.",
        ),
      ),
      section(
        "Users",
        table(
          ["Email", "Name", "Brands", "MFA"],
          fs().users.all().map((user) => [
            escapeHtml(user.email),
            escapeHtml(user.name),
            escapeHtml(user.brand_ids.join(", ")),
            user.mfa_required ? badge("required", "requested") : badge("off", "granted"),
          ]),
          "No users seeded.",
        ),
      ),
      section(
        "OAuth Apps",
        table(
          ["Application", "Name", "Redirect URLs", "Scopes"],
          fs().oauthApps.all().map((app) => [
            escapeHtml(app.application_token),
            escapeHtml(app.name),
            escapeHtml(app.redirect_urls.join(", ")),
            escapeHtml(app.scopes.join(", ")),
          ]),
          "No OAuth apps seeded.",
        ),
      ),
      section(
        "Tokens",
        table(
          ["Token", "Type", "Brand", "User", "Scopes"],
          fs().tokens.all().map((token) => [
            escapeHtml(mask(token.access_token)),
            escapeHtml(token.token_type),
            escapeHtml(token.brand_id),
            escapeHtml(token.user_id ?? ""),
            escapeHtml(token.scopes.join(", ")),
          ]),
          "No tokens issued.",
        ),
      ),
      section(
        "Sessions",
        table(
          ["Session", "User", "Current Brand", "State"],
          fs().sessions.all().map((session) => [
            escapeHtml(mask(session.session_token)),
            escapeHtml(session.user_id),
            escapeHtml(session.current_brand_id),
            session.status === "active" ? badge("active", "granted") : badge(session.status, "denied"),
          ]),
          "No active sessions.",
        ),
      ),
    ].join("\n");
  }

  function renderCatalog(): string {
    return [
      section(
        "Retailers",
        table(
          ["Retailer", "Name", "Insider", "Accepting Messages"],
          fs().retailers.all().map((retailer) => [
            escapeHtml(retailer.retailer_id),
            escapeHtml(retailer.name),
            retailer.is_insider ? badge("insider", "granted") : "",
            retailer.accepting_messages ? badge("yes", "granted") : badge("no", "denied"),
          ]),
          "No retailers seeded.",
        ),
      ),
      section(
        "Products",
        table(
          ["Product", "Brand", "Name", "Variants", "Updated"],
          fs().products.all().map((product) => [
            escapeHtml(product.product_id),
            escapeHtml(product.brand_id),
            escapeHtml(product.name),
            escapeHtml(String(product.variants.length)),
            escapeHtml(product.updated_at_api),
          ]),
          "No products seeded.",
        ),
      ),
      section(
        "Selected Product",
        fs().products.all()[0] ? jsonPreview(productResponse(fs().products.all()[0]) as unknown) : '<p class="inspector-empty">No product selected.</p>',
      ),
    ].join("\n");
  }

  function renderOrders(): string {
    const orders = fs().orders.all().sort((a, b) => b.updated_at_api.localeCompare(a.updated_at_api));
    return [
      section(
        "Orders",
        table(
          ["Order", "Display", "Brand", "Retailer", "State", "Source", "Updated"],
          orders.map((order) => [
            escapeHtml(order.order_id),
            escapeHtml(order.display_id ?? ""),
            escapeHtml(order.brand_id),
            escapeHtml(order.retailer_id ?? ""),
            escapeHtml(order.state),
            escapeHtml(order.source ?? ""),
            escapeHtml(order.updated_at_api),
          ]),
          "No orders seeded.",
        ),
      ),
      section(
        "Selected Order",
        orders[0] ? jsonPreview(orderResponse(orders[0]) as unknown) : '<p class="inspector-empty">No order selected.</p>',
      ),
    ].join("\n");
  }

  function renderMessenger(): string {
    const conversations = fs().conversations.all().sort((a, b) => b.updated_at_ms - a.updated_at_ms);
    const messages = fs().messages.all().sort((a, b) => b.timestamp_ms - a.timestamp_ms);
    return [
      section(
        "Conversations",
        table(
          ["Token", "Brand", "Retailer", "Messages", "Unread", "State", "Updated"],
          conversations.map((conversation) => [
            escapeHtml(conversation.token || "(no token)"),
            escapeHtml(conversation.brand_id),
            escapeHtml(conversation.retailer_name ?? conversation.retailer_token),
            escapeHtml(String(conversation.total_messages)),
            escapeHtml(String(conversation.unread_messages)),
            conversation.is_accepting_messages ? badge("open", "granted") : badge("blocked", "denied"),
            escapeHtml(new Date(conversation.updated_at_ms).toISOString()),
          ]),
          "No conversations seeded.",
        ),
      ),
      section(
        "Messages",
        table(
          ["Token", "Conversation", "Type", "Author", "Preview", "Sent"],
          messages.slice(0, 50).map((message) => [
            escapeHtml(message.token),
            escapeHtml(message.conversation_token),
            escapeHtml(message.message_type),
            escapeHtml(message.author_token ?? "system"),
            escapeHtml(message.body ?? message.inline_type ?? ""),
            escapeHtml(new Date(message.timestamp_ms).toISOString()),
          ]),
          "No messages seeded.",
        ),
      ),
    ].join("\n");
  }

  function renderWebhooks(): string {
    return [
      section(
        "Subscriptions",
        table(
          ["Webhook", "Brand", "Events", "URL", "State"],
          fs().webhooks.all().map((hook) => [
            escapeHtml(hook.webhook_id),
            escapeHtml(hook.brand_id),
            escapeHtml(hook.events.join(", ")),
            escapeHtml(hook.url),
            hook.enabled ? badge("enabled", "granted") : badge("disabled", "denied"),
          ]),
          "No webhook subscriptions seeded.",
        ),
      ),
      section(
        "Deliveries",
        table(
          ["Delivery", "Event", "Webhook", "Status", "Delivered"],
          fs().webhookDeliveries.all().map((delivery) => [
            escapeHtml(delivery.delivery_id),
            escapeHtml(delivery.event),
            escapeHtml(delivery.webhook_id),
            delivery.success ? badge(String(delivery.status ?? 200), "granted") : badge(String(delivery.status ?? "failed"), "denied"),
            escapeHtml(delivery.delivered_at_api),
          ]),
          "No webhook deliveries yet.",
        ),
      ),
    ].join("\n");
  }
}
