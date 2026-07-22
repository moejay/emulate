import { Store, type Collection } from "@emulators/core";
import type {
  GadgetApiKey,
  GadgetCustomer,
  GadgetFulfillment,
  GadgetOrder,
  GadgetOrderLineItem,
  GadgetProduct,
  GadgetProductVariant,
  GadgetSampleRequest,
  GadgetShop,
  GadgetWebhookDelivery,
  GadgetWebhookEndpoint,
} from "./entities.js";

export interface GadgetStore {
  apiKeys: Collection<GadgetApiKey>;
  webhookEndpoints: Collection<GadgetWebhookEndpoint>;
  webhookDeliveries: Collection<GadgetWebhookDelivery>;
  shops: Collection<GadgetShop>;
  customers: Collection<GadgetCustomer>;
  products: Collection<GadgetProduct>;
  productVariants: Collection<GadgetProductVariant>;
  orders: Collection<GadgetOrder>;
  orderLineItems: Collection<GadgetOrderLineItem>;
  fulfillments: Collection<GadgetFulfillment>;
  sampleRequests: Collection<GadgetSampleRequest>;
}

export function getGadgetStore(store: Store): GadgetStore {
  return {
    apiKeys: store.collection<GadgetApiKey>("gadget.api_keys", ["token"]),
    webhookEndpoints: store.collection<GadgetWebhookEndpoint>("gadget.webhook_endpoints", ["gadget_id"]),
    webhookDeliveries: store.collection<GadgetWebhookDelivery>("gadget.webhook_deliveries", ["gadget_id", "webhook_id"]),
    shops: store.collection<GadgetShop>("gadget.shops", ["gadget_id", "domain", "myshopify_domain"]),
    customers: store.collection<GadgetCustomer>("gadget.customers", ["gadget_id", "shop_id", "email"]),
    products: store.collection<GadgetProduct>("gadget.products", ["gadget_id", "shop_id"]),
    productVariants: store.collection<GadgetProductVariant>("gadget.product_variants", ["gadget_id", "shop_id", "product_id"]),
    orders: store.collection<GadgetOrder>("gadget.orders", ["gadget_id", "shop_id", "customer_id"]),
    orderLineItems: store.collection<GadgetOrderLineItem>("gadget.order_line_items", ["gadget_id", "shop_id", "order_id", "product_id", "variant_id"]),
    fulfillments: store.collection<GadgetFulfillment>("gadget.fulfillments", ["gadget_id", "shop_id", "order_id"]),
    sampleRequests: store.collection<GadgetSampleRequest>("gadget.sample_requests", ["gadget_id", "order_id"]),
  };
}
