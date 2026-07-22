import { Store, type Collection } from "@emulators/core";
import type {
  FaireBrand,
  FaireConversation,
  FaireMessage,
  FaireOAuthApp,
  FaireOrder,
  FaireProduct,
  FaireRetailer,
  FaireSession,
  FaireToken,
  FaireUser,
  FaireWebhook,
  FaireWebhookDelivery,
} from "./entities.js";

export interface FaireStore {
  brands: Collection<FaireBrand>;
  users: Collection<FaireUser>;
  oauthApps: Collection<FaireOAuthApp>;
  tokens: Collection<FaireToken>;
  sessions: Collection<FaireSession>;
  retailers: Collection<FaireRetailer>;
  products: Collection<FaireProduct>;
  orders: Collection<FaireOrder>;
  conversations: Collection<FaireConversation>;
  messages: Collection<FaireMessage>;
  webhooks: Collection<FaireWebhook>;
  webhookDeliveries: Collection<FaireWebhookDelivery>;
}

export function getFaireStore(store: Store): FaireStore {
  return {
    brands: store.collection<FaireBrand>("faire.brands", ["brand_id", "name"]),
    users: store.collection<FaireUser>("faire.users", ["user_id", "email"]),
    oauthApps: store.collection<FaireOAuthApp>("faire.oauth_apps", ["application_token"]),
    tokens: store.collection<FaireToken>("faire.tokens", ["access_token", "brand_id", "application_token"]),
    sessions: store.collection<FaireSession>("faire.sessions", ["session_token", "user_id", "current_brand_id"]),
    retailers: store.collection<FaireRetailer>("faire.retailers", ["retailer_id", "name"]),
    products: store.collection<FaireProduct>("faire.products", ["product_id", "brand_id", "name"]),
    orders: store.collection<FaireOrder>("faire.orders", ["order_id", "brand_id", "retailer_id"]),
    conversations: store.collection<FaireConversation>("faire.conversations", [
      "token",
      "brand_id",
      "retailer_token",
    ]),
    messages: store.collection<FaireMessage>("faire.messages", ["token", "brand_id", "conversation_token"]),
    webhooks: store.collection<FaireWebhook>("faire.webhooks", ["webhook_id", "brand_id"]),
    webhookDeliveries: store.collection<FaireWebhookDelivery>("faire.webhook_deliveries", ["delivery_id", "webhook_id"]),
  };
}
