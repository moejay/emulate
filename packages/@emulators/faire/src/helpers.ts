import type { Context } from "@emulators/core";
import type {
  FaireBrand,
  FaireConversation,
  FaireMessage,
  FaireOrder,
  FaireProduct,
  FaireRetailer,
  FaireToken,
} from "./entities.js";

export function encodeCursor(offset: number): string | undefined {
  if (!Number.isFinite(offset) || offset <= 0) return undefined;
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const value = parseInt(decoded, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function queryLimit(c: Context, fallback = 50, max = 250): number {
  const value = parseInt(c.req.query("limit") ?? String(fallback), 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, value);
}

export function parseJsonBody<T extends Record<string, unknown>>(text: string): T {
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

export function jsonBody<T extends Record<string, unknown>>(body: unknown): T {
  if (body && typeof body === "object" && !Array.isArray(body)) return body as T;
  return {} as T;
}

export function sortByUpdatedAtDesc<T extends { updated_at_api?: string; created_at_api?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const left = a.updated_at_api ?? a.created_at_api ?? "";
    const right = b.updated_at_api ?? b.created_at_api ?? "";
    return right.localeCompare(left);
  });
}

export function productResponse(product: FaireProduct): Record<string, unknown> {
  return {
    id: product.product_id,
    brand_id: product.brand_id,
    name: product.name,
    description: product.description ?? undefined,
    short_description: product.short_description ?? undefined,
    sale_state: product.sale_state ?? undefined,
    lifecycle_state: product.lifecycle_state ?? undefined,
    variants: product.variants,
    idempotence_token: product.idempotence_token ?? undefined,
    unit_multiplier: product.unit_multiplier ?? undefined,
    minimum_order_quantity: product.minimum_order_quantity ?? undefined,
    per_style_minimum_order_quantity: product.per_style_minimum_order_quantity ?? undefined,
    allow_sales_when_out_of_stock: product.allow_sales_when_out_of_stock ?? undefined,
    images: product.images ?? undefined,
    variant_option_sets: product.variant_option_sets ?? undefined,
    taxonomy_type: product.taxonomy_type ?? undefined,
    preorderable: product.preorderable ?? undefined,
    preorder_details: product.preorder_details ?? undefined,
    created_at: product.created_at_api,
    updated_at: product.updated_at_api,
  };
}

export function retailerResponse(retailer: FaireRetailer): Record<string, unknown> {
  return {
    retailer_id: retailer.retailer_id,
    id: retailer.retailer_id,
    name: retailer.name,
    is_insider: retailer.is_insider,
    ...retailer.profile,
  };
}

export function brandResponse(brand: FaireBrand): Record<string, unknown> {
  return {
    brand_id: brand.brand_id,
    name: brand.name,
    ...brand.profile,
  };
}

export function orderResponse(order: FaireOrder): Record<string, unknown> {
  return {
    id: order.order_id,
    display_id: order.display_id ?? undefined,
    state: order.state,
    retailer_id: order.retailer_id ?? undefined,
    customer: order.customer ?? undefined,
    source: order.source ?? undefined,
    ship_after: order.ship_after ?? undefined,
    expected_ship_date: order.expected_ship_date ?? undefined,
    requested_ship_date: order.requested_ship_date ?? undefined,
    processing_at: order.processing_at ?? undefined,
    payment_initiated_at: order.payment_initiated_at ?? undefined,
    estimated_payout_at: order.estimated_payout_at ?? undefined,
    created_at: order.created_at_api,
    updated_at: order.updated_at_api,
    address: order.address ?? undefined,
    purchase_order_number: order.purchase_order_number ?? undefined,
    notes: order.notes ?? undefined,
    sales_rep_name: order.sales_rep_name ?? undefined,
    original_order_id: order.original_order_id ?? undefined,
    is_fulfilled_by_faire: order.is_fulfilled_by_faire ?? undefined,
    is_free_shipping: order.is_free_shipping ?? undefined,
    free_shipping_reason: order.free_shipping_reason ?? undefined,
    faire_covered_shipping_cost: order.faire_covered_shipping_cost ?? undefined,
    has_pending_retailer_cancellation_request: order.has_pending_retailer_cancellation_request ?? undefined,
    brand_discounts: order.brand_discounts ?? undefined,
    payout_costs: order.payout_costs ?? undefined,
    currency: order.currency ?? undefined,
    items: order.items,
    shipments: order.shipments,
  };
}

export function conversationResponse(conversation: FaireConversation): Record<string, unknown> {
  return {
    token: conversation.token,
    retailer_token: conversation.retailer_token,
    retailer_name: conversation.retailer_name ?? undefined,
    other_party_company: conversation.retailer_name ?? undefined,
    total_messages: conversation.total_messages,
    unread_messages: conversation.unread_messages,
    needs_reply: conversation.needs_reply,
    updated_at: conversation.updated_at_ms,
    is_accepting_messages: conversation.is_accepting_messages,
    latest_message:
      conversation.latest_message_token && conversation.latest_message_created_at
        ? {
            token: conversation.latest_message_token,
            created_at: conversation.latest_message_created_at,
            text: conversation.latest_message_text ?? "",
          }
        : conversation.latest_message_text
          ? { text: conversation.latest_message_text }
          : undefined,
  };
}

export function messageResponse(message: FaireMessage): Record<string, unknown> {
  if (message.message_type === "inline") {
    return {
      token: message.token,
      inline_message: {
        token: message.token,
        type: message.inline_type ?? "UNKNOWN",
        data: message.inline_data ?? undefined,
        timestamp: message.timestamp_ms,
      },
    };
  }

  return {
    token: message.token,
    standard_message: {
      token: message.token,
      author_token: message.author_token ?? "r_unknown",
      author_name: message.author_name ?? undefined,
      body: message.body ?? "",
      image_urls: message.image_urls ?? undefined,
      timestamp_ms: message.timestamp_ms,
      created_at: message.timestamp_ms,
      text: message.body ?? "",
    },
  };
}

export function tokenScopeString(token: FaireToken): string {
  return token.scopes.join(",");
}
