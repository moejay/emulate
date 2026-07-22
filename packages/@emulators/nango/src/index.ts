import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import type { Hono } from "@emulators/core";
import { createLogoDataUri, defaultRuntimeConfig, setRuntimeConfig, type NangoRuntimeConfig } from "./helpers.js";
import type { NangoAuthMode, NangoManualField, NangoProxyAuthMode, NangoProviderConfig } from "./entities.js";
import { apiRoutes } from "./routes/api.js";
import { connectRoutes } from "./routes/connect.js";
import { inspectorRoutes } from "./routes/inspector.js";
import { getNangoStore } from "./store.js";

export { getNangoStore, type NangoStore } from "./store.js";
export * from "./entities.js";

export interface NangoSeedProviderConfig {
  unique_key: string;
  provider: string;
  display_name?: string;
  logo?: string;
  auth_mode?: NangoAuthMode;
  proxy_auth_mode?: NangoProxyAuthMode;
  oauth_authorize_url?: string;
  oauth_token_url?: string;
  oauth_client_id?: string;
  oauth_client_secret?: string;
  oauth_scope?: string;
  proxy_base_url?: string;
  proxy_base_url_mapping_key?: string;
  static_bearer_token?: string;
  forward_webhooks?: boolean;
  webhook_url?: string;
  docs_connect?: string;
  connect_button_label?: string;
  manual_fields?: NangoManualField[];
  default_connection_config?: Record<string, unknown>;
  connect_metadata_defaults?: Record<string, unknown>;
}

export interface NangoSeedConnection {
  connection_id: string;
  provider_config_key: string;
  provider?: string;
  metadata?: Record<string, unknown>;
  end_user?: {
    id: string;
    email?: string;
    display_name?: string;
    tags?: Record<string, string>;
  };
  tags?: Record<string, string>;
  connection_config?: Record<string, unknown>;
  credentials?: {
    type: "OAUTH2" | "STATIC_BEARER" | "NONE";
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    raw?: Record<string, unknown>;
  };
  errors?: Array<{ type: string; log_id: string; message?: string }>;
}

export interface NangoSeedConfig {
  secret_key?: string;
  base_url_mappings?: Record<string, string>;
  connect_ui_settings?: NangoRuntimeConfig["connect_ui_settings"];
  integrations?: NangoSeedProviderConfig[];
  connections?: NangoSeedConnection[];
}

function seedDefaults(store: Store, _baseUrl: string): void {
  seedFromConfig(store, _baseUrl, {
    integrations: [
      {
        unique_key: "google-mail",
        provider: "google",
        display_name: "Google Mail",
        logo: createLogoDataUri("GM", "#ea4335"),
        auth_mode: "oauth2",
        proxy_auth_mode: "oauth2-bearer",
        oauth_authorize_url: "http://localhost:4002/o/oauth2/v2/auth",
        oauth_token_url: "http://localhost:4002/oauth2/token",
        oauth_client_id: "emu_google_client_id",
        oauth_client_secret: "emu_google_client_secret",
        oauth_scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify",
        proxy_base_url_mapping_key: "google",
        connect_button_label: "Connect Gmail",
      },
      {
        unique_key: "shopify",
        provider: "shopify",
        display_name: "Shopify",
        logo: createLogoDataUri("SH", "#95bf47"),
        auth_mode: "manual",
        proxy_auth_mode: "none",
        proxy_base_url_mapping_key: "shopify",
        connect_button_label: "Save Shopify connection",
        manual_fields: [
          { name: "config.shopDomain", label: "Shop domain", required: true, placeholder: "brand.myshopify.com" },
          { name: "metadata.displayName", label: "Store name", placeholder: "Brand Store" },
          { name: "config.targetBaseUrl", label: "Target base URL", type: "url", placeholder: "http://localhost:4010" },
        ],
      },
      {
        unique_key: "quickbooks",
        provider: "quickbooks",
        display_name: "QuickBooks",
        logo: createLogoDataUri("QB", "#2ca01c"),
        auth_mode: "manual",
        proxy_auth_mode: "none",
        proxy_base_url_mapping_key: "quickbooks",
        connect_button_label: "Save QuickBooks connection",
        manual_fields: [
          { name: "config.realmId", label: "Realm ID", required: true, placeholder: "1234567890" },
          { name: "config.companyName", label: "Company name", placeholder: "Acme Foods" },
          { name: "metadata.displayName", label: "Display name", placeholder: "Acme Foods" },
          { name: "config.targetBaseUrl", label: "Target base URL", type: "url", placeholder: "http://localhost:4011" },
        ],
      },
      {
        unique_key: "opener",
        provider: "opener",
        display_name: "Opener",
        logo: createLogoDataUri("OP", "#111111", "#33ff00"),
        auth_mode: "manual",
        proxy_auth_mode: "none",
        connect_button_label: "Save Opener connection",
        manual_fields: [
          { name: "connection_id", label: "Connection ID", placeholder: "org-id-or-slug" },
          { name: "config.targetBaseUrl", label: "Target base URL", type: "url", placeholder: "http://localhost:3000" },
        ],
      },
    ],
  });
}

export function seedFromConfig(store: Store, _baseUrl: string, config: NangoSeedConfig): void {
  const runtime = defaultRuntimeConfig();
  setRuntimeConfig(store, {
    secret_key: config.secret_key ?? runtime.secret_key,
    base_url_mappings: {
      ...runtime.base_url_mappings,
      ...(config.base_url_mappings ?? {}),
    },
    connect_ui_settings: config.connect_ui_settings ?? runtime.connect_ui_settings,
  });

  const ns = getNangoStore(store);
  for (const integration of config.integrations ?? []) {
    const existing = ns.providerConfigs.findOneBy("unique_key", integration.unique_key);
    const values: Omit<NangoProviderConfig, "id" | "created_at" | "updated_at"> = {
      unique_key: integration.unique_key,
      provider: integration.provider,
      display_name: integration.display_name ?? integration.provider,
      logo: integration.logo ?? createLogoDataUri(integration.provider.slice(0, 2), "#444444"),
      auth_mode: integration.auth_mode ?? "manual",
      proxy_auth_mode: integration.proxy_auth_mode ?? (integration.auth_mode === "oauth2" ? "oauth2-bearer" : "none"),
      oauth_authorize_url: integration.oauth_authorize_url ?? null,
      oauth_token_url: integration.oauth_token_url ?? null,
      oauth_client_id: integration.oauth_client_id ?? null,
      oauth_client_secret: integration.oauth_client_secret ?? null,
      oauth_scope: integration.oauth_scope ?? null,
      proxy_base_url: integration.proxy_base_url ?? null,
      proxy_base_url_mapping_key: integration.proxy_base_url_mapping_key ?? null,
      static_bearer_token: integration.static_bearer_token ?? null,
      forward_webhooks: integration.forward_webhooks ?? false,
      webhook_url: integration.webhook_url ?? null,
      docs_connect: integration.docs_connect ?? null,
      connect_button_label: integration.connect_button_label ?? null,
      manual_fields: integration.manual_fields ?? [],
      default_connection_config: integration.default_connection_config ?? null,
      connect_metadata_defaults: integration.connect_metadata_defaults ?? null,
    };
    if (existing) {
      ns.providerConfigs.update(existing.id, values);
    } else {
      ns.providerConfigs.insert(values);
    }
  }

  for (const connection of config.connections ?? []) {
    const integration = ns.providerConfigs.findOneBy("unique_key", connection.provider_config_key);
    const existing = ns.connections.findOneBy("connection_id", connection.connection_id);
    const values = {
      connection_id: connection.connection_id,
      provider_config_key: connection.provider_config_key,
      provider: connection.provider ?? integration?.provider ?? connection.provider_config_key,
      last_fetched_at: null,
      metadata: connection.metadata ?? null,
      errors: connection.errors ?? [],
      end_user: connection.end_user ?? null,
      tags: connection.tags ?? {},
      connection_config: connection.connection_config ?? null,
      credentials: toSeedCredentials(connection.credentials),
    };
    if (existing) {
      ns.connections.update(existing.id, values);
    } else {
      ns.connections.insert(values);
    }
  }
}

function toSeedCredentials(connection: NangoSeedConnection["credentials"] | undefined) {
  if (!connection || connection.type === "NONE") {
    return { type: "NONE" as const, raw: connection?.raw ?? {} };
  }
  if (connection.type === "STATIC_BEARER") {
    return {
      type: "STATIC_BEARER" as const,
      access_token: connection.access_token ?? "",
      raw: connection.raw ?? {},
    };
  }
  return {
    type: "OAUTH2" as const,
    access_token: connection.access_token ?? "",
    ...(connection.refresh_token ? { refresh_token: connection.refresh_token } : {}),
    ...(connection.expires_in ? { expires_in: connection.expires_in } : {}),
    raw: connection.raw ?? {},
  };
}

export const nangoPlugin: ServicePlugin = {
  name: "nango",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    void webhooks;
    void tokenMap;
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    inspectorRoutes(ctx);
    apiRoutes(ctx);
    connectRoutes(ctx);
  },
  seed(store: Store, baseUrl: string): void {
    seedDefaults(store, baseUrl);
  },
};

export default nangoPlugin;
