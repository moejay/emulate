import type { InspectorTab, RouteContext } from "@emulators/core";
import { escapeAttr, escapeHtml, renderInspectorPage } from "@emulators/core";
import { ensureIso } from "../helpers.js";
import { getGadgetStore } from "../store.js";
import { dispatchIntegrationEvent, dispatchSampleRequestRejected, type GadgetIntegrationModel, type GadgetIntegrationOperation } from "../webhooks.js";

const SERVICE_LABEL = "Gadget";

const TABS: InspectorTab[] = [
  { id: "shops", label: "Shops", href: "/?tab=shops" },
  { id: "customers", label: "Customers", href: "/?tab=customers" },
  { id: "products", label: "Products", href: "/?tab=products" },
  { id: "orders", label: "Orders", href: "/?tab=orders" },
  { id: "samples", label: "Sample Requests", href: "/?tab=samples" },
  { id: "auth", label: "Auth", href: "/?tab=auth" },
  { id: "webhooks", label: "Webhooks", href: "/?tab=webhooks" },
];

type TabId = (typeof TABS)[number]["id"];

export function inspectorRoutes({ app, store }: RouteContext): void {
  const gs = () => getGadgetStore(store);

  app.get("/", (c) => {
    const requested = c.req.query("tab") ?? "shops";
    const active = TABS.some((tab) => tab.id === requested) ? (requested as TabId) : "shops";
    const flash = c.req.query("flash");
    const body =
      (flash ? `<p class="info-text">${escapeHtml(flash)}</p>` : "") +
      (active === "customers"
        ? customersView()
        : active === "products"
          ? productsView()
          : active === "orders"
            ? ordersView()
            : active === "samples"
              ? samplesView()
              : active === "auth"
                ? authView()
                : active === "webhooks"
                  ? webhooksView()
                  : shopsView());
    return c.html(renderInspectorPage("Gadget Inspector", TABS, active, body, SERVICE_LABEL));
  });

  app.post("/inspector/integration-event", async (c) => {
    const body = await c.req.parseBody();
    const model = bodyStr(body.model) as GadgetIntegrationModel;
    const operation = bodyStr(body.operation) as GadgetIntegrationOperation;
    const recordId = bodyStr(body.recordId);
    if (!recordId || !["shopifyCustomer", "shopifyProduct", "shopifyOrder"].includes(model) || !["create", "update", "delete"].includes(operation)) {
      return c.redirect("/?tab=webhooks&flash=Invalid+integration+event+request", 303);
    }

    const collection =
      model === "shopifyCustomer"
        ? gs().customers
        : model === "shopifyProduct"
          ? gs().products
          : gs().orders;
    const record = collection.findOneBy("gadget_id", recordId);
    if (!record) {
      return c.redirect(`/?tab=webhooks&flash=${encodeURIComponent(`Record not found: ${recordId}`)}`, 303);
    }

    if (operation !== "delete") {
      collection.update(record.id, { updatedAt: ensureIso(undefined) } as never);
    }

    const latest = collection.findOneBy("gadget_id", recordId);
    if (!latest) {
      return c.redirect(`/?tab=webhooks&flash=${encodeURIComponent(`Record not found: ${recordId}`)}`, 303);
    }

    await dispatchIntegrationEvent(store, {
      model,
      operation,
      record: latest,
      triggerType: "emulator.inspector",
      triggerMetadata: { source: "inspector" },
    });

    return c.redirect("/?tab=webhooks&flash=Integration+event+dispatched", 303);
  });

  app.post("/inspector/sample-requests/:id/reject", async (c) => {
    const id = c.req.param("id");
    const sampleRequest = gs().sampleRequests.findOneBy("gadget_id", id);
    if (!sampleRequest) {
      return c.redirect(`/?tab=samples&flash=${encodeURIComponent(`Sample request not found: ${id}`)}`, 303);
    }
    const updated = gs().sampleRequests.update(sampleRequest.id, {
      status: "rejected",
      updatedAt: ensureIso(undefined),
    });
    if (!updated) {
      return c.redirect(`/?tab=samples&flash=${encodeURIComponent(`Sample request not found: ${id}`)}`, 303);
    }
    await dispatchSampleRequestRejected(store, updated);
    return c.redirect("/?tab=webhooks&flash=Sample+request+rejection+dispatched", 303);
  });

  function shopsView(): string {
    const rows = gs()
      .shops.all()
      .sort((left, right) => left.gadget_id.localeCompare(right.gadget_id))
      .map((shop) => [escapeHtml(shop.gadget_id), escapeHtml(shop.myshopify_domain ?? ""), escapeHtml(shop.domain ?? ""), escapeHtml(shop.name ?? "")]);
    return section("Shops", table(["ID", "MyShopify Domain", "Domain", "Name"], rows, "No shops."));
  }

  function customersView(): string {
    const rows = gs()
      .customers.all()
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((customer) => [
        escapeHtml(customer.gadget_id),
        escapeHtml(customer.legacy_resource_id ?? ""),
        escapeHtml(customer.email ?? ""),
        escapeHtml([customer.first_name, customer.last_name].filter(Boolean).join(" ")),
        escapeHtml(customer.shop_id),
        escapeHtml(customer.updatedAt),
      ]);
    return section(
      "Customers",
      table(["ID", "Legacy", "Email", "Name", "Shop", "Updated"], rows, "No customers."),
    );
  }

  function productsView(): string {
    const productRows = gs()
      .products.all()
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((product) => [
        escapeHtml(product.gadget_id),
        escapeHtml(product.title ?? ""),
        escapeHtml(product.vendor ?? ""),
        escapeHtml(product.status ?? ""),
        escapeHtml(product.updatedAt),
      ]);
    const variantRows = gs()
      .productVariants.all()
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((variant) => [
        escapeHtml(variant.gadget_id),
        escapeHtml(variant.product_id ?? ""),
        escapeHtml(variant.sku ?? ""),
        escapeHtml(variant.price ?? ""),
        escapeHtml(variant.updatedAt),
      ]);
    return (
      section("Products", table(["ID", "Title", "Vendor", "Status", "Updated"], productRows, "No products.")) +
      section("Variants", table(["ID", "Product", "SKU", "Price", "Updated"], variantRows, "No variants."))
    );
  }

  function ordersView(): string {
    const orderRows = gs()
      .orders.all()
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((order) => [
        escapeHtml(order.gadget_id),
        escapeHtml(order.legacy_resource_id ?? ""),
        escapeHtml(order.name ?? ""),
        escapeHtml(order.customer_id ?? ""),
        escapeHtml(order.fulfillment_status ?? ""),
        escapeHtml(order.updatedAt),
      ]);
    const lineItemRows = gs()
      .orderLineItems.all()
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .map((lineItem) => [
        escapeHtml(lineItem.gadget_id),
        escapeHtml(lineItem.order_id ?? ""),
        escapeHtml(lineItem.product_id ?? ""),
        escapeHtml(lineItem.variant_id ?? ""),
        escapeHtml(String(lineItem.quantity ?? "")),
      ]);
    const fulfillmentRows = gs()
      .fulfillments.all()
      .map((fulfillment) => [
        escapeHtml(fulfillment.gadget_id),
        escapeHtml(fulfillment.order_id ?? ""),
        escapeHtml(fulfillment.shipment_status ?? fulfillment.status ?? ""),
        escapeHtml(fulfillment.delivered_at ?? ""),
      ]);
    return (
      section("Orders", table(["ID", "Legacy", "Name", "Customer", "Fulfillment", "Updated"], orderRows, "No orders.")) +
      section("Line Items", table(["ID", "Order", "Product", "Variant", "Qty"], lineItemRows, "No line items.")) +
      section("Fulfillments", table(["ID", "Order", "Status", "Delivered"], fulfillmentRows, "No fulfillments."))
    );
  }

  function samplesView(): string {
    const rows = gs()
      .sampleRequests.all()
      .map((sampleRequest) => [
        escapeHtml(sampleRequest.gadget_id),
        escapeHtml(sampleRequest.status),
        escapeHtml(sampleRequest.customer_name ?? ""),
        escapeHtml(sampleRequest.customer_email ?? ""),
        escapeHtml(sampleRequest.customer_address ?? ""),
        `<form class="user-form" method="POST" action="/inspector/sample-requests/${escapeAttr(sampleRequest.gadget_id)}/reject"><button class="user-btn" type="submit"><span class="user-login">Reject + webhook</span></button></form>`,
      ]);
    return section(
      "Sample Requests",
      table(["ID", "Status", "Customer", "Email", "Address", "Actions"], rows, "No sample requests."),
    );
  }

  function authView(): string {
    const rows = gs().apiKeys.all().map((apiKey) => [
      escapeHtml(maskToken(apiKey.token)),
      escapeHtml(apiKey.label),
      escapeHtml(apiKey.active ? "active" : "inactive"),
    ]);
    return section("API Keys", table(["Token", "Label", "Status"], rows, "No API keys."));
  }

  function webhooksView(): string {
    const endpointRows = gs().webhookEndpoints.all().map((endpoint) => [
      escapeHtml(endpoint.label),
      escapeHtml(endpoint.url),
      escapeHtml(endpoint.event_types.join(", ")),
      escapeHtml(endpoint.active ? "active" : "inactive"),
    ]);
    const deliveryRows = gs()
      .webhookDeliveries.all()
      .slice(-30)
      .reverse()
      .map((delivery) => [
        escapeHtml(delivery.event_type),
        escapeHtml(delivery.webhook_id),
        escapeHtml(delivery.status == null ? "pending" : String(delivery.status)),
        escapeHtml(delivery.error ?? ""),
        escapeHtml(delivery.created_at),
      ]);
    const controls = `${section(
      "Dispatch Integration Event",
      `<form method="POST" action="/inspector/integration-event">
        <div class="checkout-form-section">
          <label class="checkout-form-label" for="model">Model</label>
          <input class="checkout-input" id="model" name="model" value="shopifyOrder" />
        </div>
        <div class="checkout-form-section">
          <label class="checkout-form-label" for="operation">Operation</label>
          <input class="checkout-input" id="operation" name="operation" value="update" />
        </div>
        <div class="checkout-form-section">
          <label class="checkout-form-label" for="recordId">Record ID</label>
          <input class="checkout-input" id="recordId" name="recordId" placeholder="gid://shopify/Order/301" />
        </div>
        <button class="checkout-pay-btn" type="submit">Dispatch</button>
      </form>`,
    )}`;
    return (
      controls +
      section("Webhook Endpoints", table(["Label", "URL", "Events", "Status"], endpointRows, "No webhook endpoints.")) +
      section("Webhook Deliveries", table(["Event", "Webhook", "Status", "Error", "Created"], deliveryRows, "No deliveries."))
    );
  }
}

function section(title: string, body: string): string {
  return `<section class="inspector-section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function table(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `<p class="inspector-empty">${escapeHtml(empty)}</p>`;
  return `<table class="inspector-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function maskToken(token: string): string {
  if (token.length <= 12) return token;
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function bodyStr(value: string | File | (string | File)[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return "";
}
