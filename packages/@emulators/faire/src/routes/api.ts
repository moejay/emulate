import type { RouteContext } from "@emulators/core";
import { authenticateExternalApiRequest } from "../auth.js";
import { decodeCursor, encodeCursor, orderResponse, productResponse, queryLimit, retailerResponse, sortByUpdatedAtDesc, brandResponse } from "../helpers.js";
import { makeDisplayId, makeFaireToken } from "../ids.js";
import { getFaireStore } from "../store.js";
import { dispatchFaireWebhook } from "../webhooks.js";
import type { FaireOrder, FaireShipment } from "../entities.js";

function nowIso(): string {
  return new Date().toISOString();
}

function updatedAtAfter(value: string, min: string | null): boolean {
  if (!min) return true;
  const itemTs = Date.parse(value);
  const minTs = Date.parse(min);
  if (!Number.isFinite(itemTs) || !Number.isFinite(minTs)) return true;
  return itemTs >= minTs;
}

export function apiRoutes({ app, store }: RouteContext): void {
  const fs = () => getFaireStore(store);

  app.get("/external-api/v2/brands/profile", (c) => {
    const auth = authenticateExternalApiRequest(c, store);
    if (!auth.ok) return auth.response;
    const brand = fs().brands.findOneBy("brand_id", auth.brandId);
    if (!brand) return c.json({ message: "Brand not found" }, 404);
    return c.json(brandResponse(brand));
  });

  app.get("/external-api/v2/retailers/public/:id", (c) => {
    const auth = authenticateExternalApiRequest(c, store);
    if (!auth.ok) return auth.response;
    const retailer = fs().retailers.findOneBy("retailer_id", c.req.param("id"));
    if (!retailer) return c.json({ message: "Retailer not found" }, 404);
    return c.json(retailerResponse(retailer));
  });

  app.get("/external-api/v2/products", (c) => {
    const auth = authenticateExternalApiRequest(c, store);
    if (!auth.ok) return auth.response;
    const cursor = decodeCursor(c.req.query("cursor"));
    const limit = queryLimit(c, 250, 250);
    const updatedAtMin = c.req.query("updated_at_min");

    const products = sortByUpdatedAtDesc(
      fs()
        .products.all()
        .filter((product) => product.brand_id === auth.brandId && updatedAtAfter(product.updated_at_api, updatedAtMin ?? null)),
    );

    const page = products.slice(cursor, cursor + limit);
    const nextCursor = cursor + limit < products.length ? encodeCursor(cursor + limit) : undefined;
    return c.json({
      products: page.map(productResponse),
      ...(nextCursor ? { cursor: nextCursor } : {}),
    });
  });

  app.get("/external-api/v2/products/:id", (c) => {
    const auth = authenticateExternalApiRequest(c, store);
    if (!auth.ok) return auth.response;
    const product = fs().products.findOneBy("product_id", c.req.param("id"));
    if (!product || product.brand_id !== auth.brandId) return c.json({ message: "Product not found" }, 404);
    return c.json(productResponse(product));
  });

  app.get("/external-api/v2/orders", (c) => {
    const auth = authenticateExternalApiRequest(c, store);
    if (!auth.ok) return auth.response;
    const cursor = decodeCursor(c.req.query("cursor"));
    const limit = queryLimit(c, 50, 250);
    const updatedAtMin = c.req.query("updated_at_min");

    const orders = sortByUpdatedAtDesc(
      fs()
        .orders.all()
        .filter((order) => order.brand_id === auth.brandId && updatedAtAfter(order.updated_at_api, updatedAtMin ?? null)),
    );

    const page = orders.slice(cursor, cursor + limit);
    const nextCursor = cursor + limit < orders.length ? encodeCursor(cursor + limit) : undefined;
    return c.json({
      orders: page.map(orderResponse),
      ...(nextCursor ? { cursor: nextCursor } : {}),
    });
  });

  app.get("/external-api/v2/orders/:id", (c) => {
    const auth = authenticateExternalApiRequest(c, store);
    if (!auth.ok) return auth.response;
    const order = fs().orders.findOneBy("order_id", c.req.param("id"));
    if (!order || order.brand_id !== auth.brandId) return c.json({ message: "Order not found" }, 404);
    return c.json(orderResponse(order));
  });

  app.post("/external-api/v2/orders", async (c) => {
    const auth = authenticateExternalApiRequest(c, store);
    if (!auth.ok) return auth.response;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const createdAt = typeof body.created_at === "string" ? body.created_at : nowIso();
    const updatedAt = typeof body.updated_at === "string" ? body.updated_at : createdAt;
    const order = fs().orders.insert({
      order_id: typeof body.id === "string" && body.id.trim() ? body.id : makeFaireToken("bo", 10),
      brand_id: auth.brandId,
      display_id: typeof body.display_id === "string" ? body.display_id : makeDisplayId(),
      state: typeof body.state === "string" ? (body.state as FaireOrder["state"]) : "NEW",
      retailer_id: typeof body.retailer_id === "string" ? body.retailer_id : null,
      customer: typeof body.customer === "object" ? (body.customer as FaireOrder["customer"]) : undefined,
      source: typeof body.source === "string" ? body.source : "DIRECT",
      ship_after: typeof body.ship_after === "string" ? body.ship_after : null,
      expected_ship_date: typeof body.expected_ship_date === "string" ? body.expected_ship_date : null,
      requested_ship_date: typeof body.requested_ship_date === "string" ? body.requested_ship_date : null,
      processing_at: typeof body.processing_at === "string" ? body.processing_at : null,
      payment_initiated_at: typeof body.payment_initiated_at === "string" ? body.payment_initiated_at : null,
      estimated_payout_at: typeof body.estimated_payout_at === "string" ? body.estimated_payout_at : null,
      created_at_api: createdAt,
      updated_at_api: updatedAt,
      address: typeof body.address === "object" ? (body.address as FaireOrder["address"]) : null,
      purchase_order_number: typeof body.purchase_order_number === "string" ? body.purchase_order_number : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      sales_rep_name: typeof body.sales_rep_name === "string" ? body.sales_rep_name : null,
      original_order_id: typeof body.original_order_id === "string" ? body.original_order_id : null,
      is_fulfilled_by_faire: typeof body.is_fulfilled_by_faire === "boolean" ? body.is_fulfilled_by_faire : null,
      is_free_shipping: typeof body.is_free_shipping === "boolean" ? body.is_free_shipping : null,
      free_shipping_reason: typeof body.free_shipping_reason === "string" ? body.free_shipping_reason : null,
      faire_covered_shipping_cost: typeof body.faire_covered_shipping_cost === "object"
        ? (body.faire_covered_shipping_cost as FaireOrder["faire_covered_shipping_cost"])
        : null,
      has_pending_retailer_cancellation_request:
        typeof body.has_pending_retailer_cancellation_request === "boolean"
          ? body.has_pending_retailer_cancellation_request
          : null,
      brand_discounts: Array.isArray(body.brand_discounts) ? (body.brand_discounts as FaireOrder["brand_discounts"]) : [],
      payout_costs: typeof body.payout_costs === "object" ? (body.payout_costs as FaireOrder["payout_costs"]) : null,
      currency: typeof body.currency === "string" ? body.currency : "USD",
      items: Array.isArray(body.items) ? (body.items as FaireOrder["items"]) : [],
      shipments: Array.isArray(body.shipments) ? (body.shipments as FaireOrder["shipments"]) : [],
    });

    await dispatchFaireWebhook(store, {
      brandId: auth.brandId,
      event: "order.created",
      payload: orderResponse(order),
    });

    return c.json(orderResponse(order), 201);
  });

  app.patch("/external-api/v2/orders/:id", async (c) => {
    const auth = authenticateExternalApiRequest(c, store);
    if (!auth.ok) return auth.response;
    const order = fs().orders.findOneBy("order_id", c.req.param("id"));
    if (!order || order.brand_id !== auth.brandId) return c.json({ message: "Order not found" }, 404);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const updated = fs().orders.update(order.id, {
      display_id: typeof body.display_id === "string" ? body.display_id : order.display_id,
      state: typeof body.state === "string" ? (body.state as FaireOrder["state"]) : order.state,
      retailer_id: typeof body.retailer_id === "string" ? body.retailer_id : order.retailer_id,
      customer: typeof body.customer === "object" ? (body.customer as FaireOrder["customer"]) : order.customer,
      source: typeof body.source === "string" ? body.source : order.source,
      ship_after: typeof body.ship_after === "string" ? body.ship_after : order.ship_after,
      expected_ship_date: typeof body.expected_ship_date === "string" ? body.expected_ship_date : order.expected_ship_date,
      requested_ship_date: typeof body.requested_ship_date === "string" ? body.requested_ship_date : order.requested_ship_date,
      processing_at: typeof body.processing_at === "string" ? body.processing_at : order.processing_at,
      payment_initiated_at: typeof body.payment_initiated_at === "string" ? body.payment_initiated_at : order.payment_initiated_at,
      estimated_payout_at: typeof body.estimated_payout_at === "string" ? body.estimated_payout_at : order.estimated_payout_at,
      address: typeof body.address === "object" ? (body.address as FaireOrder["address"]) : order.address,
      purchase_order_number:
        typeof body.purchase_order_number === "string" ? body.purchase_order_number : order.purchase_order_number,
      notes: typeof body.notes === "string" ? body.notes : order.notes,
      sales_rep_name: typeof body.sales_rep_name === "string" ? body.sales_rep_name : order.sales_rep_name,
      original_order_id: typeof body.original_order_id === "string" ? body.original_order_id : order.original_order_id,
      is_fulfilled_by_faire:
        typeof body.is_fulfilled_by_faire === "boolean" ? body.is_fulfilled_by_faire : order.is_fulfilled_by_faire,
      is_free_shipping: typeof body.is_free_shipping === "boolean" ? body.is_free_shipping : order.is_free_shipping,
      free_shipping_reason:
        typeof body.free_shipping_reason === "string" ? body.free_shipping_reason : order.free_shipping_reason,
      faire_covered_shipping_cost:
        typeof body.faire_covered_shipping_cost === "object"
          ? (body.faire_covered_shipping_cost as FaireOrder["faire_covered_shipping_cost"])
          : order.faire_covered_shipping_cost,
      has_pending_retailer_cancellation_request:
        typeof body.has_pending_retailer_cancellation_request === "boolean"
          ? body.has_pending_retailer_cancellation_request
          : order.has_pending_retailer_cancellation_request,
      brand_discounts: Array.isArray(body.brand_discounts)
        ? (body.brand_discounts as FaireOrder["brand_discounts"])
        : order.brand_discounts,
      payout_costs: typeof body.payout_costs === "object" ? (body.payout_costs as FaireOrder["payout_costs"]) : order.payout_costs,
      currency: typeof body.currency === "string" ? body.currency : order.currency,
      items: Array.isArray(body.items) ? (body.items as FaireOrder["items"]) : order.items,
      shipments: Array.isArray(body.shipments) ? (body.shipments as FaireOrder["shipments"]) : order.shipments,
      updated_at_api: nowIso(),
    })!;

    await dispatchFaireWebhook(store, {
      brandId: auth.brandId,
      event: "order.updated",
      payload: orderResponse(updated),
    });

    return c.json(orderResponse(updated));
  });

  app.post("/external-api/v2/orders/:id/shipments", async (c) => {
    const auth = authenticateExternalApiRequest(c, store);
    if (!auth.ok) return auth.response;
    const order = fs().orders.findOneBy("order_id", c.req.param("id"));
    if (!order || order.brand_id !== auth.brandId) return c.json({ message: "Order not found" }, 404);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const shipment: FaireShipment = {
      id: typeof body.id === "string" && body.id.trim() ? body.id : makeFaireToken("ship", 10),
      order_id: order.order_id,
      carrier: typeof body.carrier === "string" ? body.carrier : undefined,
      tracking_code: typeof body.tracking_code === "string" ? body.tracking_code : undefined,
      shipping_type: typeof body.shipping_type === "string" ? body.shipping_type : undefined,
      shipping_label_url: typeof body.shipping_label_url === "string" ? body.shipping_label_url : undefined,
      maker_cost_cents: typeof body.maker_cost_cents === "number" ? body.maker_cost_cents : undefined,
      maker_cost: typeof body.maker_cost === "object" ? (body.maker_cost as FaireShipment["maker_cost"]) : undefined,
      created_at: typeof body.created_at === "string" ? body.created_at : nowIso(),
      updated_at: nowIso(),
    };

    const updated = fs().orders.update(order.id, {
      shipments: [...order.shipments, shipment],
      state: order.state === "NEW" ? "PRE_TRANSIT" : order.state,
      updated_at_api: nowIso(),
    })!;

    await dispatchFaireWebhook(store, {
      brandId: auth.brandId,
      event: "shipment.created",
      payload: { order: orderResponse(updated), shipment },
    });

    return c.json({ shipment, order: orderResponse(updated) }, 201);
  });
}
