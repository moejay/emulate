import { Store, type Collection } from "@emulators/core";
import type {
  ShopifyAccessToken,
  ShopifyAuthCode,
  ShopifyBulkOperation,
  ShopifyCompany,
  ShopifyCompanyContactProfile,
  ShopifyCompanyLocation,
  ShopifyCustomer,
  ShopifyDraftOrder,
  ShopifyFulfillment,
  ShopifyFulfillmentOrder,
  ShopifyOAuthApp,
  ShopifyOrder,
  ShopifyProduct,
  ShopifyShop,
  ShopifyStaffUser,
  ShopifyVariant,
  ShopifyWebhookDelivery,
  ShopifyWebhookSubscription,
} from "./entities.js";

export interface ShopifyStore {
  shops: Collection<ShopifyShop>;
  staffUsers: Collection<ShopifyStaffUser>;
  oauthApps: Collection<ShopifyOAuthApp>;
  authCodes: Collection<ShopifyAuthCode>;
  accessTokens: Collection<ShopifyAccessToken>;
  webhookSubscriptions: Collection<ShopifyWebhookSubscription>;
  webhookDeliveries: Collection<ShopifyWebhookDelivery>;
  customers: Collection<ShopifyCustomer>;
  companies: Collection<ShopifyCompany>;
  companyLocations: Collection<ShopifyCompanyLocation>;
  companyContactProfiles: Collection<ShopifyCompanyContactProfile>;
  products: Collection<ShopifyProduct>;
  variants: Collection<ShopifyVariant>;
  orders: Collection<ShopifyOrder>;
  fulfillmentOrders: Collection<ShopifyFulfillmentOrder>;
  fulfillments: Collection<ShopifyFulfillment>;
  draftOrders: Collection<ShopifyDraftOrder>;
  bulkOperations: Collection<ShopifyBulkOperation>;
}

export function getShopifyStore(store: Store): ShopifyStore {
  return {
    shops: store.collection<ShopifyShop>("shopify.shops", ["shop_gid", "myshopify_domain"]),
    staffUsers: store.collection<ShopifyStaffUser>("shopify.staff_users", ["staff_gid", "email"]),
    oauthApps: store.collection<ShopifyOAuthApp>("shopify.oauth_apps", ["client_id"]),
    authCodes: store.collection<ShopifyAuthCode>("shopify.auth_codes", ["code", "client_id", "shop_domain"]),
    accessTokens: store.collection<ShopifyAccessToken>("shopify.access_tokens", ["token", "client_id", "shop_domain"]),
    webhookSubscriptions: store.collection<ShopifyWebhookSubscription>("shopify.webhook_subscriptions", [
      "subscription_gid",
      "topic",
      "shop_domain",
      "client_id",
    ]),
    webhookDeliveries: store.collection<ShopifyWebhookDelivery>("shopify.webhook_deliveries", [
      "delivery_gid",
      "topic",
      "shop_domain",
      "subscription_gid",
    ]),
    customers: store.collection<ShopifyCustomer>("shopify.customers", ["customer_gid", "email", "company_id"]),
    companies: store.collection<ShopifyCompany>("shopify.companies", ["company_gid", "name"]),
    companyLocations: store.collection<ShopifyCompanyLocation>("shopify.company_locations", ["location_gid", "company_gid"]),
    companyContactProfiles: store.collection<ShopifyCompanyContactProfile>("shopify.company_contact_profiles", [
      "profile_gid",
      "company_gid",
      "customer_gid",
    ]),
    products: store.collection<ShopifyProduct>("shopify.products", ["product_gid", "title", "status"]),
    variants: store.collection<ShopifyVariant>("shopify.variants", ["variant_gid", "product_gid", "sku"]),
    orders: store.collection<ShopifyOrder>("shopify.orders", ["order_gid", "customer_gid", "name"]),
    fulfillmentOrders: store.collection<ShopifyFulfillmentOrder>("shopify.fulfillment_orders", [
      "fulfillment_order_gid",
      "order_gid",
      "status",
    ]),
    fulfillments: store.collection<ShopifyFulfillment>("shopify.fulfillments", ["fulfillment_gid", "order_gid"]),
    draftOrders: store.collection<ShopifyDraftOrder>("shopify.draft_orders", ["draft_order_gid", "customer_gid"]),
    bulkOperations: store.collection<ShopifyBulkOperation>("shopify.bulk_operations", [
      "bulk_operation_gid",
      "shop_domain",
      "client_id",
      "status",
      "model",
    ]),
  };
}
