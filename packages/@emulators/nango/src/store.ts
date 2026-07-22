import { Store, type Collection } from "@emulators/core";
import type {
  NangoConnectSession,
  NangoConnection,
  NangoOAuthState,
  NangoProviderConfig,
  NangoProxyLog,
  NangoTelemetryEvent,
  NangoWebhookDelivery,
} from "./entities.js";

export interface NangoStore {
  providerConfigs: Collection<NangoProviderConfig>;
  connections: Collection<NangoConnection>;
  connectSessions: Collection<NangoConnectSession>;
  oauthStates: Collection<NangoOAuthState>;
  proxyLogs: Collection<NangoProxyLog>;
  webhookDeliveries: Collection<NangoWebhookDelivery>;
  telemetryEvents: Collection<NangoTelemetryEvent>;
}

export function getNangoStore(store: Store): NangoStore {
  return {
    providerConfigs: store.collection<NangoProviderConfig>("nango.provider_configs", ["unique_key", "provider"]),
    connections: store.collection<NangoConnection>("nango.connections", ["connection_id", "provider_config_key"]),
    connectSessions: store.collection<NangoConnectSession>("nango.connect_sessions", ["token"]),
    oauthStates: store.collection<NangoOAuthState>("nango.oauth_states", ["state", "session_token"]),
    proxyLogs: store.collection<NangoProxyLog>("nango.proxy_logs", ["request_id", "connection_id", "provider_config_key"]),
    webhookDeliveries: store.collection<NangoWebhookDelivery>("nango.webhook_deliveries", ["provider_config_key", "event"]),
    telemetryEvents: store.collection<NangoTelemetryEvent>("nango.telemetry_events", ["token", "event"]),
  };
}
