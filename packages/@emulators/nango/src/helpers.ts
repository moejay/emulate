import { createHmac, randomBytes } from "node:crypto";
import { ApiError, escapeAttr, escapeHtml } from "@emulators/core";
import type { Context, Store } from "@emulators/core";
import type {
  NangoAuthMode,
  NangoConnectSession,
  NangoConnection,
  NangoConnectionCredentials,
  NangoEndUser,
  NangoManualField,
  NangoProviderConfig,
  NangoProxyLog,
} from "./entities.js";
import { getNangoStore } from "./store.js";

export interface NangoRuntimeConfig {
  secret_key: string;
  base_url_mappings: Record<string, string>;
  connect_ui_settings: {
    theme: {
      light: { primary: string };
      dark: { primary: string };
    };
    defaultTheme: "light" | "dark" | "system";
    showWatermark: boolean;
  };
}

const RUNTIME_KEY = "nango.runtime";

export function defaultRuntimeConfig(): NangoRuntimeConfig {
  return {
    secret_key: "nango_secret_test",
    base_url_mappings: {
      google: "http://localhost:4002",
      gmail: "http://localhost:4002",
    },
    connect_ui_settings: {
      theme: {
        light: { primary: "#111111" },
        dark: { primary: "#33ff00" },
      },
      defaultTheme: "dark",
      showWatermark: true,
    },
  };
}

export function getRuntimeConfig(store: Store): NangoRuntimeConfig {
  return (store.getData<NangoRuntimeConfig>(RUNTIME_KEY) ?? defaultRuntimeConfig());
}

export function setRuntimeConfig(store: Store, config: NangoRuntimeConfig): void {
  store.setData(RUNTIME_KEY, config);
}

export function parseBearerToken(c: Context): string | null {
  const auth = c.req.header("Authorization") ?? "";
  const match = auth.match(/^(Bearer|token)\s+(.+)$/i);
  return match?.[2]?.trim() ?? null;
}

export function requireApiAuth(c: Context, store: Store): void {
  const token = parseBearerToken(c);
  if (!token || token !== getRuntimeConfig(store).secret_key) {
    throw new ApiError(401, "Unauthorized");
  }
}

export function resolveSessionToken(c: Context): string {
  return c.req.query("session_token") ?? parseBearerToken(c) ?? "";
}

export function requireConnectSession(store: Store, token: string): NangoConnectSession {
  if (!token) {
    throw new ApiError(401, "Missing connect session token");
  }
  const session = getNangoStore(store).connectSessions.findOneBy("token", token);
  if (!session) {
    throw new ApiError(401, "Unknown connect session token");
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new ApiError(401, "Connect session token expired");
  }
  return session;
}

export function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function createLogoDataUri(label: string, background: string, foreground = "#ffffff"): string {
  const text = label.slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${background}"/><text x="32" y="39" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="${foreground}">${text}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function mergeEndUserFromSession(input: {
  end_user?: NangoEndUser | null;
  tags?: Record<string, string>;
}): NangoEndUser | null {
  if (input.end_user) return input.end_user;
  const endUserId = input.tags?.end_user_id ?? input.tags?.endUserId;
  if (!endUserId) return null;
  return { id: endUserId };
}

export function findProviderConfig(store: Store, uniqueKey: string): NangoProviderConfig {
  const integration = getNangoStore(store).providerConfigs.findOneBy("unique_key", uniqueKey);
  if (!integration) {
    throw new ApiError(404, `Unknown provider config: ${uniqueKey}`);
  }
  return integration;
}

export function pickConnectFields(integration: NangoProviderConfig): NangoManualField[] {
  return integration.manual_fields ?? [];
}

export function deriveConnectionId(input: {
  providerConfigKey: string;
  requestedConnectionId?: string | null;
  endUser?: NangoEndUser | null;
  connectionConfig?: Record<string, unknown> | null;
}): string {
  const requested = input.requestedConnectionId?.trim();
  if (requested) return requested;
  const shopDomain = typeof input.connectionConfig?.shopDomain === "string" ? input.connectionConfig.shopDomain : null;
  if (shopDomain) return shopDomain;
  const realmId = typeof input.connectionConfig?.realmId === "string" ? input.connectionConfig.realmId : null;
  if (realmId) return `${input.providerConfigKey}-${realmId}`;
  const endUserId = input.endUser?.id?.trim();
  if (endUserId) return `${input.providerConfigKey}-${endUserId}`;
  return randomToken("conn");
}

export function normalizeConnectionBodyText(value: Uint8Array | ArrayBuffer | null, contentType: string | null): string | null {
  if (!value) return null;
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.byteLength === 0) return "";
  const textTypes = ["application/json", "text/", "application/x-www-form-urlencoded", "application/graphql"];
  const isText = contentType ? textTypes.some((item) => contentType.includes(item)) : true;
  if (isText) {
    return Buffer.from(bytes).toString("utf8");
  }
  return Buffer.from(bytes).toString("base64");
}

export function headersToRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

export function decodeIdTokenEmail(credentials: NangoConnectionCredentials): string | null {
  if (credentials.type !== "OAUTH2") return null;
  const idToken = credentials.raw.id_token;
  if (typeof idToken !== "string") return null;
  try {
    const [, payload] = idToken.split(".");
    if (!payload) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return typeof parsed.email === "string" ? parsed.email : null;
  } catch {
    return null;
  }
}

export function resolveTargetBaseUrl(
  store: Store,
  integration: NangoProviderConfig,
  connection: NangoConnection,
  override: string | null,
): string | null {
  if (override) return override;
  const metadataUrl = typeof connection.metadata?.targetBaseUrl === "string" ? connection.metadata.targetBaseUrl : null;
  if (metadataUrl) return metadataUrl;
  const configUrl = typeof connection.connection_config?.targetBaseUrl === "string"
    ? connection.connection_config.targetBaseUrl
    : null;
  if (configUrl) return configUrl;
  if (integration.proxy_base_url) return integration.proxy_base_url;
  if (integration.proxy_base_url_mapping_key) {
    return getRuntimeConfig(store).base_url_mappings[integration.proxy_base_url_mapping_key] ?? null;
  }
  return null;
}

export function buildOutgoingProxyHeaders(integration: NangoProviderConfig, connection: NangoConnection): Record<string, string> {
  const headers: Record<string, string> = {};
  if (integration.proxy_auth_mode === "oauth2-bearer" && connection.credentials.type === "OAUTH2") {
    headers.Authorization = `Bearer ${connection.credentials.access_token}`;
  }
  if (integration.proxy_auth_mode === "shopify-access-token" && connection.credentials.type === "OAUTH2") {
    headers["X-Shopify-Access-Token"] = connection.credentials.access_token;
  }
  if (integration.proxy_auth_mode === "static-bearer" && integration.static_bearer_token) {
    headers.Authorization = `Bearer ${integration.static_bearer_token}`;
  }
  return headers;
}

export function buildSyntheticProxyResponse(
  integration: NangoProviderConfig,
  connection: NangoConnection,
  endpoint: string,
): { status: number; headers?: Record<string, string>; body: unknown } | null {
  if (integration.unique_key === "google-mail" && endpoint === "/gmail/v1/users/me/profile") {
    return {
      status: 200,
      body: {
        emailAddress:
          decodeIdTokenEmail(connection.credentials) ??
          connection.end_user?.email ??
          (typeof connection.metadata?.email === "string" ? connection.metadata.email : null) ??
          connection.connection_id,
      },
    };
  }

  if (integration.unique_key === "shopify" && /\/admin\/api\/[^/]+\/shop\.json$/.test(endpoint)) {
    const shopDomain =
      (typeof connection.metadata?.shopDomain === "string" ? connection.metadata.shopDomain : null) ??
      (typeof connection.connection_config?.shopDomain === "string" ? connection.connection_config.shopDomain : null) ??
      connection.connection_id;
    const storeName =
      (typeof connection.metadata?.displayName === "string" ? connection.metadata.displayName : null) ??
      (typeof connection.connection_config?.storeName === "string" ? connection.connection_config.storeName : null) ??
      shopDomain.replace(/\.myshopify\.com$/i, "");
    return {
      status: 200,
      body: {
        shop: {
          name: storeName,
          myshopify_domain: shopDomain,
        },
      },
    };
  }

  if ((integration.unique_key.includes("quickbooks") || integration.unique_key.includes("qbo")) && /\/v3\/company\/[^/]+\/companyinfo\/[^/]+$/.test(endpoint)) {
    const realmId =
      (typeof connection.connection_config?.realmId === "string" ? connection.connection_config.realmId : null) ??
      connection.connection_id;
    const companyName =
      (typeof connection.metadata?.displayName === "string" ? connection.metadata.displayName : null) ??
      (typeof connection.connection_config?.companyName === "string" ? connection.connection_config.companyName : null) ??
      `QuickBooks ${realmId}`;
    return {
      status: 200,
      body: {
        CompanyInfo: {
          CompanyName: companyName,
          RealmId: realmId,
        },
      },
    };
  }

  return null;
}

export function createConnectSessionResponse(baseUrl: string, token: string, expiresAt: string) {
  return {
    data: {
      token,
      connect_link: `${baseUrl}/connect?session_token=${encodeURIComponent(token)}`,
      expires_at: expiresAt,
    },
  };
}

export function toListConnectionShape(connection: NangoConnection) {
  return {
    id: connection.id,
    connection_id: connection.connection_id,
    provider_config_key: connection.provider_config_key,
    created: connection.created_at,
    metadata: connection.metadata,
    provider: connection.provider,
    errors: connection.errors,
    end_user: connection.end_user,
    tags: connection.tags,
  };
}

export function toFullConnectionShape(connection: NangoConnection) {
  return {
    id: connection.id,
    connection_id: connection.connection_id,
    provider_config_key: connection.provider_config_key,
    created_at: connection.created_at,
    updated_at: connection.updated_at,
    last_fetched_at: connection.last_fetched_at,
    metadata: connection.metadata,
    provider: connection.provider,
    errors: connection.errors,
    end_user: connection.end_user,
    tags: connection.tags,
    connection_config: connection.connection_config,
    credentials: connection.credentials,
  };
}

export function connectionHasAuthError(connection: NangoConnection): boolean {
  return connection.errors.some((error) => error.type === "auth");
}

export function makeInvalidCredentialsError(connection: NangoConnection): ApiError {
  const error = new ApiError(400, "Invalid credentials");
  (error as ApiError & { payload?: unknown; code?: string }).payload = {
    error: {
      code: "invalid_credentials",
      payload: {
        connection: {
          errors: connection.errors,
        },
      },
    },
  };
  return error;
}

export function errorResponseBody(err: unknown): { message: string; extra?: unknown } {
  if (err instanceof ApiError) {
    const maybe = err as ApiError & { payload?: unknown };
    return { message: err.message, extra: maybe.payload };
  }
  return { message: err instanceof Error ? err.message : "Internal Server Error" };
}

export function signWebhookBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function pageLink(basePath: string, params: Record<string, string | undefined>): string {
  const url = new URL(basePath, "http://localhost");
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

export function renderManualField(field: NangoManualField, value = ""): string {
  const required = field.required ? " required" : "";
  const type = field.type ?? "text";
  const placeholder = field.placeholder ? ` placeholder="${escapeAttr(field.placeholder)}"` : "";
  const help = field.help_text ? `<div class="info-text">${escapeHtml(field.help_text)}</div>` : "";
  return `<div class="checkout-form-section">
    <label class="checkout-form-label" for="${escapeAttr(field.name)}">${escapeHtml(field.label)}</label>
    <input class="checkout-input" id="${escapeAttr(field.name)}" name="${escapeAttr(field.name)}" type="${escapeAttr(type)}" value="${escapeAttr(value)}"${placeholder}${required}/>
    ${help}
  </div>`;
}

export function appendDefaults(
  base: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!base && !patch) return null;
  return {
    ...(base ?? {}),
    ...(patch ?? {}),
  };
}

export function trimRecentProxyLogs(logs: NangoProxyLog[], limit: number): NangoProxyLog[] {
  return logs
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}
