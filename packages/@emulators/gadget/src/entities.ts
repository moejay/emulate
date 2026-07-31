import type { Entity } from "@emulators/core";

export interface GadgetApiKey extends Entity {
  token: string;
  label: string;
  active: boolean;
}

export interface GadgetWebhookEndpoint extends Entity {
  gadget_id: string;
  label: string;
  url: string;
  event_types: string[];
  headers: Record<string, string>;
  active: boolean;
}

export interface GadgetWebhookDelivery extends Entity {
  gadget_id: string;
  webhook_id: string;
  event_type: string;
  status: number | null;
  error: string | null;
  request_headers: Record<string, string>;
  payload: unknown;
}

export interface GadgetShop extends Entity {
  gadget_id: string;
  domain: string | null;
  myshopify_domain: string | null;
  name: string | null;
  granted_scopes: string[];
}

export interface GadgetCustomerAddress {
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  zipCode: string | null;
  country: string | null;
  countryCode: string | null;
  company: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface GadgetCustomer extends Entity {
  gadget_id: string;
  shop_id: string;
  legacy_resource_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  tags: unknown;
  number_of_orders: number | null;
  amount_spent: unknown;
  note: string | null;
  default_address: GadgetCustomerAddress | null;
  addresses: GadgetCustomerAddress[];
  updatedAt: string;
}

export interface GadgetProduct extends Entity {
  gadget_id: string;
  shop_id: string;
  title: string | null;
  vendor: string | null;
  product_type: string | null;
  body: string | null;
  status: string | null;
  tags: unknown;
  featured_media: { file: { url: string | null } | null } | null;
  updatedAt: string;
}

export interface GadgetProductVariant extends Entity {
  gadget_id: string;
  shop_id: string;
  product_id: string | null;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compare_at_price: string | null;
  inventory_quantity: number | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  updatedAt: string;
}

export interface GadgetOrder extends Entity {
  gadget_id: string;
  shop_id: string;
  legacy_resource_id: string | null;
  name: string | null;
  email: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  subtotal_price_set: unknown;
  current_subtotal_price_set: unknown;
  current_total_price_set: unknown;
  current_total_discounts_set: unknown;
  total_tax_set: unknown;
  total_shipping_price_set: unknown;
  currency: string | null;
  tags: unknown;
  note: string | null;
  customer_id: string | null;
  shipping_address: unknown;
  shopify_created_at: string | null;
  updatedAt: string;
}

export interface GadgetOrderLineItem extends Entity {
  gadget_id: string;
  shop_id: string;
  order_id: string | null;
  product_id: string | null;
  variant_id: string | null;
  name: string | null;
  title: string | null;
  sku: string | null;
  quantity: number | null;
  price: string | null;
  total_discount_set: unknown;
  discount_allocations: unknown;
  tax_lines: unknown;
  variant_title: string | null;
  vendor: string | null;
  updatedAt: string;
}

export interface GadgetFulfillment extends Entity {
  gadget_id: string;
  shop_id: string;
  order_id: string | null;
  status: string | null;
  shipment_status: string | null;
  delivered_at: string | null;
  updatedAt: string;
}

export interface GadgetSampleRequest extends Entity {
  gadget_id: string;
  status: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_address: string | null;
  shipping_address: Record<string, unknown> | null;
  requested_at: string | null;
  shipped_at: string | null;
  notes: string | null;
  order_id: string | null;
  updatedAt: string;
  brand_id: number;
  store_id: number;
  activity_id: string;
}
