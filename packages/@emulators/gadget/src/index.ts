import type { Hono } from "@emulators/core";
import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import { ensureIso } from "./helpers.js";
import { inspectorRoutes } from "./routes/inspector.js";
import { graphqlRoutes } from "./routes/graphql.js";
import { type GadgetCustomerAddress } from "./entities.js";
import { getGadgetStore } from "./store.js";

export * from "./entities.js";
export { getGadgetStore, type GadgetStore } from "./store.js";

export interface GadgetSeedConfig {
  port?: number;
  baseUrl?: string;
  apiKeys?: Array<{
    token: string;
    label?: string;
    active?: boolean;
  }>;
  shops?: Array<{
    id?: string;
    domain?: string | null;
    myshopifyDomain?: string | null;
    name?: string | null;
    grantedScopes?: string[];
  }>;
  customers?: Array<{
    id?: string;
    shopId?: string;
    legacyResourceId?: string | null;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    tags?: unknown;
    numberOfOrders?: number | null;
    amountSpent?: unknown;
    note?: string | null;
    defaultAddress?: GadgetCustomerAddress | null;
    addresses?: GadgetCustomerAddress[];
    updatedAt?: string;
  }>;
  products?: Array<{
    id?: string;
    shopId?: string;
    title?: string | null;
    vendor?: string | null;
    productType?: string | null;
    body?: string | null;
    status?: string | null;
    tags?: unknown;
    featuredMedia?: { file: { url: string | null } | null } | null;
    updatedAt?: string;
  }>;
  productVariants?: Array<{
    id?: string;
    shopId?: string;
    productId?: string | null;
    title?: string | null;
    sku?: string | null;
    barcode?: string | null;
    price?: string | null;
    compareAtPrice?: string | null;
    inventoryQuantity?: number | null;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    updatedAt?: string;
  }>;
  orders?: Array<{
    id?: string;
    shopId?: string;
    legacyResourceId?: string | null;
    name?: string | null;
    email?: string | null;
    financialStatus?: string | null;
    fulfillmentStatus?: string | null;
    cancelledAt?: string | null;
    subtotalPriceSet?: unknown;
    currentSubtotalPriceSet?: unknown;
    currentTotalPriceSet?: unknown;
    currentTotalDiscountsSet?: unknown;
    totalTaxSet?: unknown;
    totalShippingPriceSet?: unknown;
    currency?: string | null;
    tags?: unknown;
    note?: string | null;
    customerId?: string | null;
    shippingAddress?: unknown;
    shopifyCreatedAt?: string | null;
    updatedAt?: string;
  }>;
  orderLineItems?: Array<{
    id?: string;
    shopId?: string;
    orderId?: string | null;
    productId?: string | null;
    variantId?: string | null;
    name?: string | null;
    title?: string | null;
    sku?: string | null;
    quantity?: number | null;
    price?: string | null;
    totalDiscountSet?: unknown;
    discountAllocations?: unknown;
    taxLines?: unknown;
    variantTitle?: string | null;
    vendor?: string | null;
    updatedAt?: string;
  }>;
  fulfillments?: Array<{
    id?: string;
    shopId?: string;
    orderId?: string | null;
    status?: string | null;
    shipmentStatus?: string | null;
    deliveredAt?: string | null;
    updatedAt?: string;
  }>;
  sampleRequests?: Array<{
    id?: string;
    status?: string;
    customerName?: string | null;
    customerEmail?: string | null;
    customerAddress?: string | null;
    shippingAddress?: Record<string, unknown> | null;
    requestedAt?: string | null;
    shippedAt?: string | null;
    notes?: string | null;
    orderId?: string | null;
    updatedAt?: string;
    brandId?: number;
    storeId?: number;
    activityId?: string;
  }>;
  webhooks?: Array<{
    id?: string;
    label?: string;
    url: string;
    eventTypes?: string[];
    headers?: Record<string, string>;
    active?: boolean;
  }>;
}

const DEFAULT_SHOP_ID = "gid://shopify/Shop/1";
const DEFAULT_PRODUCT_ID = "gid://shopify/Product/201";
const DEFAULT_VARIANT_ID = "gid://shopify/ProductVariant/401";
const DEFAULT_CUSTOMER_ID = "gid://shopify/Customer/101";
const DEFAULT_ORDER_ID = "gid://shopify/Order/301";

export function seedDefaults(store: Store): void {
  const gs = getGadgetStore(store);

  if (!gs.apiKeys.findOneBy("token", "gadget_test_api_key")) {
    gs.apiKeys.insert({ token: "gadget_test_api_key", label: "Local Gadget API key", active: true });
  }

  if (!gs.shops.findOneBy("gadget_id", DEFAULT_SHOP_ID)) {
    gs.shops.insert({
      gadget_id: DEFAULT_SHOP_ID,
      domain: null,
      myshopify_domain: "acme-snacks.myshopify.com",
      name: "Acme Snacks",
      granted_scopes: ["read_customers", "read_orders", "read_products"],
    });
  }

  if (!gs.customers.findOneBy("gadget_id", DEFAULT_CUSTOMER_ID)) {
    const defaultAddress: GadgetCustomerAddress = {
      address1: "179 Commercial St",
      address2: "Suite 4",
      city: "Boston",
      province: "Massachusetts",
      provinceCode: "MA",
      zipCode: "02109",
      country: "United States",
      countryCode: "US",
      company: "Harbor Market",
      phone: "+1 617-555-0101",
      latitude: 42.3631,
      longitude: -71.0537,
    };
    gs.customers.insert({
      gadget_id: DEFAULT_CUSTOMER_ID,
      shop_id: DEFAULT_SHOP_ID,
      legacy_resource_id: "101",
      email: "buyer@harbormarket.example",
      first_name: "Harper",
      last_name: "Lee",
      phone: "+1 617-555-0101",
      tags: ["b2b", "east-coast"],
      number_of_orders: 3,
      amount_spent: { amount: "245.50", currencyCode: "USD" },
      note: "Top wholesale account",
      default_address: defaultAddress,
      addresses: [defaultAddress],
      updatedAt: "2026-07-21T12:00:00.000Z",
    });
  }

  if (!gs.products.findOneBy("gadget_id", DEFAULT_PRODUCT_ID)) {
    gs.products.insert({
      gadget_id: DEFAULT_PRODUCT_ID,
      shop_id: DEFAULT_SHOP_ID,
      title: "Sea Salt Granola Bites",
      vendor: "Acme Snacks",
      product_type: "Snacks",
      body: "Crunchy wholesale snack pack.",
      status: "active",
      tags: ["wholesale", "granola"],
      featured_media: { file: { url: "https://cdn.emulate.dev/gadget/granola-bites.png" } },
      updatedAt: "2026-07-21T12:05:00.000Z",
    });
  }

  if (!gs.productVariants.findOneBy("gadget_id", DEFAULT_VARIANT_ID)) {
    gs.productVariants.insert({
      gadget_id: DEFAULT_VARIANT_ID,
      shop_id: DEFAULT_SHOP_ID,
      product_id: DEFAULT_PRODUCT_ID,
      title: "12 pack",
      sku: "GRANOLA-12",
      barcode: "0123456789012",
      price: "24.00",
      compare_at_price: "28.00",
      inventory_quantity: 144,
      option1: "12 pack",
      option2: null,
      option3: null,
      updatedAt: "2026-07-21T12:06:00.000Z",
    });
  }

  if (!gs.orders.findOneBy("gadget_id", DEFAULT_ORDER_ID)) {
    gs.orders.insert({
      gadget_id: DEFAULT_ORDER_ID,
      shop_id: DEFAULT_SHOP_ID,
      legacy_resource_id: "301",
      name: "#301",
      email: "buyer@harbormarket.example",
      financial_status: "paid",
      fulfillment_status: "fulfilled",
      cancelled_at: null,
      subtotal_price_set: { shopMoney: { amount: "24.00", currencyCode: "USD" } },
      current_subtotal_price_set: { shopMoney: { amount: "24.00", currencyCode: "USD" } },
      current_total_price_set: { shopMoney: { amount: "29.48", currencyCode: "USD" } },
      current_total_discounts_set: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
      total_tax_set: { shopMoney: { amount: "1.48", currencyCode: "USD" } },
      total_shipping_price_set: { shopMoney: { amount: "4.00", currencyCode: "USD" } },
      currency: "USD",
      tags: ["wholesale", "sample_followup"],
      note: "Leave at receiving",
      customer_id: DEFAULT_CUSTOMER_ID,
      shipping_address: {
        firstName: "Harper",
        lastName: "Lee",
        company: "Harbor Market",
        address1: "179 Commercial St",
        address2: "Suite 4",
        city: "Boston",
        province: "Massachusetts",
        provinceCode: "MA",
        country: "United States",
        countryCode: "US",
        zip: "02109",
        phone: "+1 617-555-0101",
      },
      shopify_created_at: "2026-07-20T09:30:00.000Z",
      updatedAt: "2026-07-21T12:07:00.000Z",
    });
  }

  if (!gs.orderLineItems.findOneBy("gadget_id", "gid://shopify/LineItem/501")) {
    gs.orderLineItems.insert({
      gadget_id: "gid://shopify/LineItem/501",
      shop_id: DEFAULT_SHOP_ID,
      order_id: DEFAULT_ORDER_ID,
      product_id: DEFAULT_PRODUCT_ID,
      variant_id: DEFAULT_VARIANT_ID,
      name: "Sea Salt Granola Bites",
      title: "Sea Salt Granola Bites",
      sku: "GRANOLA-12",
      quantity: 1,
      price: "24.00",
      total_discount_set: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
      discount_allocations: [],
      tax_lines: [{ rate: 0.06125 }],
      variant_title: "12 pack",
      vendor: "Acme Snacks",
      updatedAt: "2026-07-21T12:08:00.000Z",
    });
  }

  if (!gs.fulfillments.findOneBy("gadget_id", "gid://shopify/Fulfillment/601")) {
    gs.fulfillments.insert({
      gadget_id: "gid://shopify/Fulfillment/601",
      shop_id: DEFAULT_SHOP_ID,
      order_id: DEFAULT_ORDER_ID,
      status: "success",
      shipment_status: "delivered",
      delivered_at: "2026-07-22T15:00:00.000Z",
      updatedAt: "2026-07-22T15:00:00.000Z",
    });
  }

  if (!gs.sampleRequests.findOneBy("gadget_id", "sample_request_1")) {
    gs.sampleRequests.insert({
      gadget_id: "sample_request_1",
      status: "pending",
      customer_name: "Harper Lee",
      customer_email: "buyer@harbormarket.example",
      customer_address: "179 Commercial St, Boston, MA 02109, Canada",
      shipping_address: {
        first_name: "Harper",
        last_name: "Lee",
        address1: "179 Commercial St",
        address2: "Suite 4",
        city: "Boston",
        province: "Massachusetts",
        province_code: "MA",
        country: "Canada",
        country_code: "CA",
        zip: "02109",
      },
      requested_at: "2026-07-21T11:00:00.000Z",
      shipped_at: null,
      notes: "Pending address correction",
      order_id: null,
      updatedAt: "2026-07-21T11:05:00.000Z",
      brand_id: 42,
      store_id: 7,
      activity_id: "activity_abc",
    });
  }
}

export function seedFromConfig(store: Store, _baseUrl: string, config: GadgetSeedConfig): void {
  const gs = getGadgetStore(store);
  const defaultShopId = config.shops?.[0]?.id ?? gs.shops.all()[0]?.gadget_id ?? DEFAULT_SHOP_ID;

  for (const apiKey of config.apiKeys ?? []) {
    if (gs.apiKeys.findOneBy("token", apiKey.token)) continue;
    gs.apiKeys.insert({ token: apiKey.token, label: apiKey.label ?? apiKey.token, active: apiKey.active ?? true });
  }

  for (const shop of config.shops ?? []) {
    if (shop.id && gs.shops.findOneBy("gadget_id", shop.id)) continue;
    gs.shops.insert({
      gadget_id: shop.id ?? `gid://shopify/Shop/${gs.shops.all().length + 1}`,
      domain: shop.domain ?? null,
      myshopify_domain: shop.myshopifyDomain ?? null,
      name: shop.name ?? null,
      granted_scopes: shop.grantedScopes ?? [],
    });
  }

  for (const customer of config.customers ?? []) {
    const id = customer.id ?? `gid://shopify/Customer/${gs.customers.all().length + 1000}`;
    if (gs.customers.findOneBy("gadget_id", id)) continue;
    gs.customers.insert({
      gadget_id: id,
      shop_id: customer.shopId ?? defaultShopId,
      legacy_resource_id: customer.legacyResourceId ?? null,
      email: customer.email ?? null,
      first_name: customer.firstName ?? null,
      last_name: customer.lastName ?? null,
      phone: customer.phone ?? null,
      tags: customer.tags ?? [],
      number_of_orders: customer.numberOfOrders ?? null,
      amount_spent: customer.amountSpent ?? null,
      note: customer.note ?? null,
      default_address: customer.defaultAddress ?? null,
      addresses: customer.addresses ?? (customer.defaultAddress ? [customer.defaultAddress] : []),
      updatedAt: ensureIso(customer.updatedAt),
    });
  }

  for (const product of config.products ?? []) {
    const id = product.id ?? `gid://shopify/Product/${gs.products.all().length + 2000}`;
    if (gs.products.findOneBy("gadget_id", id)) continue;
    gs.products.insert({
      gadget_id: id,
      shop_id: product.shopId ?? defaultShopId,
      title: product.title ?? null,
      vendor: product.vendor ?? null,
      product_type: product.productType ?? null,
      body: product.body ?? null,
      status: product.status ?? null,
      tags: product.tags ?? [],
      featured_media: product.featuredMedia ?? null,
      updatedAt: ensureIso(product.updatedAt),
    });
  }

  for (const variant of config.productVariants ?? []) {
    const id = variant.id ?? `gid://shopify/ProductVariant/${gs.productVariants.all().length + 4000}`;
    if (gs.productVariants.findOneBy("gadget_id", id)) continue;
    gs.productVariants.insert({
      gadget_id: id,
      shop_id: variant.shopId ?? defaultShopId,
      product_id: variant.productId ?? null,
      title: variant.title ?? null,
      sku: variant.sku ?? null,
      barcode: variant.barcode ?? null,
      price: variant.price ?? null,
      compare_at_price: variant.compareAtPrice ?? null,
      inventory_quantity: variant.inventoryQuantity ?? null,
      option1: variant.option1 ?? null,
      option2: variant.option2 ?? null,
      option3: variant.option3 ?? null,
      updatedAt: ensureIso(variant.updatedAt),
    });
  }

  for (const order of config.orders ?? []) {
    const id = order.id ?? `gid://shopify/Order/${gs.orders.all().length + 3000}`;
    if (gs.orders.findOneBy("gadget_id", id)) continue;
    gs.orders.insert({
      gadget_id: id,
      shop_id: order.shopId ?? defaultShopId,
      legacy_resource_id: order.legacyResourceId ?? null,
      name: order.name ?? null,
      email: order.email ?? null,
      financial_status: order.financialStatus ?? null,
      fulfillment_status: order.fulfillmentStatus ?? null,
      cancelled_at: order.cancelledAt ?? null,
      subtotal_price_set: order.subtotalPriceSet ?? null,
      current_subtotal_price_set: order.currentSubtotalPriceSet ?? null,
      current_total_price_set: order.currentTotalPriceSet ?? null,
      current_total_discounts_set: order.currentTotalDiscountsSet ?? null,
      total_tax_set: order.totalTaxSet ?? null,
      total_shipping_price_set: order.totalShippingPriceSet ?? null,
      currency: order.currency ?? null,
      tags: order.tags ?? [],
      note: order.note ?? null,
      customer_id: order.customerId ?? null,
      shipping_address: order.shippingAddress ?? null,
      shopify_created_at: order.shopifyCreatedAt ?? null,
      updatedAt: ensureIso(order.updatedAt),
    });
  }

  for (const lineItem of config.orderLineItems ?? []) {
    const id = lineItem.id ?? `gid://shopify/LineItem/${gs.orderLineItems.all().length + 5000}`;
    if (gs.orderLineItems.findOneBy("gadget_id", id)) continue;
    gs.orderLineItems.insert({
      gadget_id: id,
      shop_id: lineItem.shopId ?? defaultShopId,
      order_id: lineItem.orderId ?? null,
      product_id: lineItem.productId ?? null,
      variant_id: lineItem.variantId ?? null,
      name: lineItem.name ?? null,
      title: lineItem.title ?? null,
      sku: lineItem.sku ?? null,
      quantity: lineItem.quantity ?? null,
      price: lineItem.price ?? null,
      total_discount_set: lineItem.totalDiscountSet ?? null,
      discount_allocations: lineItem.discountAllocations ?? [],
      tax_lines: lineItem.taxLines ?? [],
      variant_title: lineItem.variantTitle ?? null,
      vendor: lineItem.vendor ?? null,
      updatedAt: ensureIso(lineItem.updatedAt),
    });
  }

  for (const fulfillment of config.fulfillments ?? []) {
    const id = fulfillment.id ?? `gid://shopify/Fulfillment/${gs.fulfillments.all().length + 6000}`;
    if (gs.fulfillments.findOneBy("gadget_id", id)) continue;
    gs.fulfillments.insert({
      gadget_id: id,
      shop_id: fulfillment.shopId ?? defaultShopId,
      order_id: fulfillment.orderId ?? null,
      status: fulfillment.status ?? null,
      shipment_status: fulfillment.shipmentStatus ?? null,
      delivered_at: fulfillment.deliveredAt ?? null,
      updatedAt: ensureIso(fulfillment.updatedAt),
    });
  }

  for (const sampleRequest of config.sampleRequests ?? []) {
    const id = sampleRequest.id ?? `sample_request_${gs.sampleRequests.all().length + 1}`;
    if (gs.sampleRequests.findOneBy("gadget_id", id)) continue;
    gs.sampleRequests.insert({
      gadget_id: id,
      status: sampleRequest.status ?? "pending",
      customer_name: sampleRequest.customerName ?? null,
      customer_email: sampleRequest.customerEmail ?? null,
      customer_address: sampleRequest.customerAddress ?? null,
      shipping_address: sampleRequest.shippingAddress ?? null,
      requested_at: sampleRequest.requestedAt ?? null,
      shipped_at: sampleRequest.shippedAt ?? null,
      notes: sampleRequest.notes ?? null,
      order_id: sampleRequest.orderId ?? null,
      updatedAt: ensureIso(sampleRequest.updatedAt),
      brand_id: sampleRequest.brandId ?? 1,
      store_id: sampleRequest.storeId ?? 1,
      activity_id: sampleRequest.activityId ?? `activity_${id}`,
    });
  }

  for (const webhook of config.webhooks ?? []) {
    const id = webhook.id ?? `webhook_${gs.webhookEndpoints.all().length + 1}`;
    if (gs.webhookEndpoints.findOneBy("gadget_id", id)) continue;
    gs.webhookEndpoints.insert({
      gadget_id: id,
      label: webhook.label ?? id,
      url: webhook.url,
      event_types: webhook.eventTypes ?? ["shopify.integration_event", "sample_request.rejected"],
      headers: webhook.headers ?? {},
      active: webhook.active ?? true,
    });
  }
}

export const gadgetPlugin: ServicePlugin = {
  name: "gadget",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    void webhooks;
    void baseUrl;
    void tokenMap;
    const routeContext: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    graphqlRoutes(routeContext);
    inspectorRoutes(routeContext);
  },
  seed(store: Store): void {
    seedDefaults(store);
  },
};

export default gadgetPlugin;
