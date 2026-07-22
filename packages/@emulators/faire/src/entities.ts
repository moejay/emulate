import type { Entity } from "@emulators/core";

export type FaireTokenType = "oauth_access" | "api_token";
export type FaireOrderState =
  | "NEW"
  | "PROCESSING"
  | "PRE_TRANSIT"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELED"
  | "BACKORDERED"
  | "PENDING_RETAILER_CONFIRMATION";

export interface FaireBrand extends Entity {
  brand_id: string;
  name: string;
  profile: Record<string, unknown>;
}

export interface FaireUser extends Entity {
  user_id: string;
  email: string;
  password: string;
  name: string;
  brand_ids: string[];
  default_brand_id: string;
  mfa_required: boolean;
  mfa_title: string;
  mfa_description: string;
}

export interface FaireOAuthApp extends Entity {
  application_token: string;
  application_secret: string;
  name: string;
  redirect_urls: string[];
  scopes: string[];
}

export interface FaireToken extends Entity {
  access_token: string;
  token_type: FaireTokenType;
  brand_id: string;
  scopes: string[];
  application_token?: string;
  user_id?: string;
  revoked: boolean;
}

export interface FaireSession extends Entity {
  session_token: string;
  user_id: string;
  current_brand_id: string;
  brand_ids: string[];
  status: "active" | "revoked";
}

export interface FaireRetailer extends Entity {
  retailer_id: string;
  name: string;
  is_insider: boolean;
  accepting_messages: boolean;
  profile: Record<string, unknown>;
}

export interface FaireImage {
  id?: string;
  width?: number;
  height?: number;
  sequence?: number;
  url?: string;
  original_url?: string;
  tags?: string[];
}

export interface FaireMoney {
  amount_minor: number;
  currency: string;
}

export interface FaireVariantPrice {
  geo_constraint?: { region?: string; country_codes?: string[] };
  wholesale_price?: FaireMoney;
  retail_price?: FaireMoney;
}

export interface FaireProductVariant {
  id: string;
  product_id?: string;
  name?: string;
  sale_state?: string;
  lifecycle_state?: string;
  idempotence_token?: string;
  sku?: string;
  available_quantity?: number;
  backordered_until?: string;
  wholesale_price_cents?: number;
  retail_price_cents?: number;
  tariff_code?: string;
  images?: FaireImage[];
  options?: Array<{ name: string; value: string }>;
  prices?: FaireVariantPrice[];
  variant_preorder_details?: Record<string, unknown>;
  measurements?: Record<string, unknown>;
  case_measurements?: Record<string, unknown>;
  gtin?: string;
  orderability_type?: string;
  available?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface FaireProduct extends Entity {
  product_id: string;
  brand_id: string;
  name: string;
  description?: string | null;
  short_description?: string | null;
  sale_state?: string | null;
  lifecycle_state?: string | null;
  variants: FaireProductVariant[];
  idempotence_token?: string | null;
  unit_multiplier?: number | null;
  minimum_order_quantity?: number | null;
  per_style_minimum_order_quantity?: number | null;
  allow_sales_when_out_of_stock?: boolean | null;
  images?: FaireImage[];
  variant_option_sets?: Array<{ name: string; values: string[] }>;
  taxonomy_type?: { id: string; name: string } | null;
  preorderable?: boolean | null;
  preorder_details?: Record<string, unknown> | null;
  created_at_api: string;
  updated_at_api: string;
}

export interface FaireAddress {
  id?: string;
  name?: string;
  company_name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  state_code?: string;
  postal_code?: string;
  country?: string;
  country_code?: string;
  phone_number?: string;
  address_type?: string;
}

export interface FaireCustomer {
  first_name?: string;
  last_name?: string;
}

export interface FaireBrandDiscount {
  id?: string;
  code?: string;
  discount_type?: string;
  discount_amount_cents?: number;
  discount_percentage?: number;
  includes_free_shipping?: boolean;
  discount_amount?: FaireMoney;
}

export interface FairePayoutCosts {
  payout_fee_cents?: number;
  payout_fee_bps?: number;
  payout_flat_fee?: FaireMoney;
  commission_cents?: number;
  commission_bps?: number;
  commission_flat_fee?: FaireMoney;
  payout_fee?: FaireMoney;
  commission?: FaireMoney;
  total_payout?: FaireMoney;
  payout_protection_fee?: FaireMoney;
  damaged_and_missing_items?: FaireMoney;
  net_tax?: FaireMoney;
  shipping_subsidy?: FaireMoney;
  taxes?: Array<{ value?: FaireMoney }>;
  subtotal_after_brand_discounts?: FaireMoney;
  total_brand_discounts?: FaireMoney;
}

export interface FaireShipment {
  id?: string;
  order_id?: string;
  carrier?: string;
  tracking_code?: string;
  shipping_type?: string;
  shipping_label_url?: string;
  maker_cost_cents?: number;
  maker_cost?: FaireMoney;
  created_at?: string;
  updated_at?: string;
}

export interface FaireOrderItem {
  id: string;
  order_id?: string;
  product_id?: string;
  product_name?: string;
  variant_id?: string;
  variant_name?: string;
  sku?: string;
  quantity: number;
  price_cents: number;
  price?: FaireMoney;
  includes_tester?: boolean;
  tester_price_cents?: number;
  tester_price?: FaireMoney;
  customizations?: Array<Record<string, unknown>>;
  discounts?: Array<Record<string, unknown>>;
  state?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FaireOrder extends Entity {
  order_id: string;
  brand_id: string;
  display_id?: string | null;
  state: FaireOrderState;
  retailer_id?: string | null;
  customer?: FaireCustomer | null;
  source?: string | null;
  ship_after?: string | null;
  expected_ship_date?: string | null;
  requested_ship_date?: string | null;
  processing_at?: string | null;
  payment_initiated_at?: string | null;
  estimated_payout_at?: string | null;
  created_at_api: string;
  updated_at_api: string;
  address?: FaireAddress | null;
  purchase_order_number?: string | null;
  notes?: string | null;
  sales_rep_name?: string | null;
  original_order_id?: string | null;
  is_fulfilled_by_faire?: boolean | null;
  is_free_shipping?: boolean | null;
  free_shipping_reason?: string | null;
  faire_covered_shipping_cost?: FaireMoney | null;
  has_pending_retailer_cancellation_request?: boolean | null;
  brand_discounts?: FaireBrandDiscount[];
  payout_costs?: FairePayoutCosts | null;
  currency?: string | null;
  items: FaireOrderItem[];
  shipments: FaireShipment[];
}

export interface FaireConversation extends Entity {
  token: string;
  brand_id: string;
  retailer_token: string;
  retailer_name?: string | null;
  is_accepting_messages: boolean;
  include_in_list: boolean;
  total_messages: number;
  unread_messages: number;
  needs_reply: boolean;
  updated_at_ms: number;
  latest_message_text?: string | null;
  latest_message_token?: string | null;
  latest_message_created_at?: number | null;
}

export interface FaireMessage extends Entity {
  token: string;
  brand_id: string;
  conversation_token: string;
  message_type: "standard" | "inline";
  author_token?: string | null;
  author_name?: string | null;
  body?: string | null;
  image_urls?: string[] | null;
  timestamp_ms: number;
  inline_type?: string | null;
  inline_data?: Record<string, unknown> | null;
}

export interface FaireWebhook extends Entity {
  webhook_id: string;
  brand_id: string;
  label: string;
  url: string;
  events: string[];
  secret?: string | null;
  enabled: boolean;
}

export interface FaireWebhookDelivery extends Entity {
  delivery_id: string;
  webhook_id: string;
  event: string;
  url: string;
  status: number | null;
  success: boolean;
  error?: string | null;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  delivered_at_api: string;
}
