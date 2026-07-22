import type { Entity } from "@emulators/core";

export interface ShopifyAddress {
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  zip: string | null;
  country: string | null;
  countryCodeV2: string | null;
  phone: string | null;
}

export interface ShopifyShippingAddressSummary {
  company: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface ShopifyShop extends Entity {
  shop_gid: string;
  numeric_id: number;
  name: string;
  email: string;
  myshopify_domain: string;
  primary_domain: string;
  currency_code: string;
  timezone: string;
  plan_display_name: string;
  plan_partner_development: boolean;
}

export interface ShopifyStaffUser extends Entity {
  staff_gid: string;
  numeric_id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export interface ShopifyOAuthApp extends Entity {
  client_id: string;
  client_secret: string;
  name: string;
  redirect_uris: string[];
  scopes: string[];
  embedded: boolean;
}

export interface ShopifyAuthCode extends Entity {
  code: string;
  client_id: string;
  shop_domain: string;
  redirect_uri: string;
  staff_gid: string;
  scopes: string[];
  expires_at: string;
}

export interface ShopifyAccessToken extends Entity {
  token: string;
  client_id: string;
  shop_domain: string;
  staff_gid: string;
  scopes: string[];
  revoked: boolean;
}

export interface ShopifyWebhookSubscription extends Entity {
  subscription_gid: string;
  numeric_id: number;
  topic: string;
  uri: string;
  client_id: string;
  shop_domain: string;
  format: "JSON";
  api_version: string;
  include_fields: string[];
  metafield_namespaces: string[];
  active: boolean;
}

export interface ShopifyWebhookDelivery extends Entity {
  delivery_gid: string;
  webhook_id_header: string;
  subscription_gid: string | null;
  topic: string;
  shop_domain: string;
  request_url: string | null;
  request_body: string;
  status_code: number | null;
  success: boolean;
  duration_ms: number | null;
  response_body: string | null;
  error_message: string | null;
}

export interface ShopifyCustomer extends Entity {
  customer_gid: string;
  numeric_id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  state: string;
  note: string | null;
  tags: string[];
  number_of_orders: number;
  amount_spent: string | null;
  default_address: ShopifyAddress | null;
  addresses: ShopifyAddress[];
  company_id: string | null;
  company_contact_profile_ids: string[];
  created_at_iso: string;
  updated_at_iso: string;
}

export interface ShopifyCompany extends Entity {
  company_gid: string;
  numeric_id: number;
  name: string;
  external_id: string | null;
  note: string | null;
  main_contact_customer_gid: string | null;
  tags: string[];
  created_at_iso: string;
  updated_at_iso: string;
}

export interface ShopifyCompanyLocation extends Entity {
  location_gid: string;
  numeric_id: number;
  company_gid: string;
  name: string;
  shipping_address: ShopifyAddress;
  billing_same_as_shipping: boolean;
}

export interface ShopifyCompanyContactProfile extends Entity {
  profile_gid: string;
  numeric_id: number;
  company_gid: string;
  customer_gid: string;
  title: string | null;
  locale: string;
}

export interface ShopifyProduct extends Entity {
  product_gid: string;
  numeric_id: number;
  title: string;
  vendor: string | null;
  product_type: string | null;
  description_html: string | null;
  status: string;
  tags: string[];
  featured_image_url: string | null;
  updated_at_iso: string;
}

export interface ShopifyVariant extends Entity {
  variant_gid: string;
  numeric_id: number;
  product_gid: string;
  title: string;
  sku: string | null;
  price: string | null;
  compare_at_price: string | null;
  barcode: string | null;
  inventory_quantity: number | null;
  weight_value: number | null;
  weight_unit: string | null;
}

export interface ShopifyOrderLineItem {
  id: string;
  variant_id: string | null;
  sku: string | null;
  name: string | null;
  title: string | null;
  quantity: number;
  original_unit_price: string | null;
  total_discount: string | null;
  discount_allocations: string[];
  tax_rates: number[];
}

export interface ShopifyRefundLineItem {
  line_item: {
    id: string;
    variant_id: string | null;
    sku: string | null;
    name: string | null;
    title: string | null;
    quantity: number;
    original_unit_price: string | null;
  };
  quantity: number;
  subtotal: string | null;
  total_tax: string | null;
}

export interface ShopifyRefund {
  id: string;
  created_at_iso: string;
  note: string | null;
  refund_line_items: ShopifyRefundLineItem[];
}

export interface ShopifyFulfillmentOrderLineItem {
  id: string;
  line_item_gid: string;
  total_quantity: number;
  remaining_quantity: number;
}

export interface ShopifyFulfillmentOrder extends Entity {
  fulfillment_order_gid: string;
  numeric_id: number;
  order_gid: string;
  status: string;
  request_status: string;
  supported_actions: string[];
  assigned_location_name: string;
  line_items: ShopifyFulfillmentOrderLineItem[];
}

export interface ShopifyFulfillment extends Entity {
  fulfillment_gid: string;
  numeric_id: number;
  order_gid: string;
  status: string;
  tracking_company: string | null;
  tracking_numbers: string[];
  line_item_gids: string[];
  notify_customer: boolean;
  created_at_iso: string;
}

export interface ShopifyOrder extends Entity {
  order_gid: string;
  numeric_id: number;
  name: string;
  email: string | null;
  customer_gid: string | null;
  display_financial_status: string | null;
  display_fulfillment_status: string | null;
  cancelled_at: string | null;
  created_at_iso: string;
  updated_at_iso: string;
  currency_code: string;
  subtotal_amount: string | null;
  total_tax_amount: string | null;
  total_price_amount: string | null;
  total_discounts_amount: string | null;
  shipping_price_amount: string | null;
  note: string | null;
  tags: string[];
  shipping_address: ShopifyShippingAddressSummary | null;
  line_items: ShopifyOrderLineItem[];
  refunds: ShopifyRefund[];
  fulfillment_order_gids: string[];
  fulfillment_gids: string[];
}

export interface ShopifyDraftOrderLineItem {
  variant_gid: string;
  title: string;
  quantity: number;
  original_unit_price: string | null;
}

export interface ShopifyDraftOrder extends Entity {
  draft_order_gid: string;
  numeric_id: number;
  customer_gid: string;
  line_items: ShopifyDraftOrderLineItem[];
  note: string | null;
  invoice_url: string | null;
  status: string;
  total_price_amount: string;
  subtotal_price_amount: string;
  total_tax_amount: string;
  created_at_iso: string;
}

export interface ShopifyBulkOperation extends Entity {
  bulk_operation_gid: string;
  numeric_id: number;
  shop_domain: string;
  client_id: string;
  status: string;
  type: "QUERY";
  model: string;
  query: string;
  object_count: number;
  url: string | null;
  error_code: string | null;
  completed_at: string | null;
}
