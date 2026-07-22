import { ApiError, parseJsonBody, type RouteContext } from "@emulators/core";
import {
  appendDefaults,
  buildOutgoingProxyHeaders,
  buildSyntheticProxyResponse,
  connectionHasAuthError,
  deriveConnectionId,
  errorResponseBody,
  findProviderConfig,
  headersToRecord,
  makeInvalidCredentialsError,
  normalizeConnectionBodyText,
  requireApiAuth,
  resolveTargetBaseUrl,
  toFullConnectionShape,
  toListConnectionShape,
} from "../helpers.js";
import type { NangoConnection, NangoConnectionCredentials, NangoProviderConfig } from "../entities.js";
import { getNangoStore } from "../store.js";
import { dispatchConnectionWebhook, upsertConnection } from "./shared.js";

export function apiRoutes({ app, store }: RouteContext): void {
  const ns = () => getNangoStore(store);

  app.get("/integrations", (c) => {
    requireApiAuth(c, store);
    const data = ns().providerConfigs
      .all()
      .sort((a, b) => a.unique_key.localeCompare(b.unique_key))
      .map((integration) => publicIntegrationShape(integration));
    return c.json({ data });
  });

  app.get("/integrations/:uniqueKey", (c) => {
    requireApiAuth(c, store);
    const integration = findProviderConfig(store, c.req.param("uniqueKey"));
    return c.json({ data: publicIntegrationShape(integration, true) });
  });

  app.post("/integrations", async (c) => {
    requireApiAuth(c, store);
    const body = await parseJsonBody(c);
    const uniqueKey = stringBody(body.unique_key);
    const provider = stringBody(body.provider);
    if (!uniqueKey || !provider) {
      throw new ApiError(400, "unique_key and provider are required");
    }
    const existing = ns().providerConfigs.findOneBy("unique_key", uniqueKey);
    const integration = existing
      ? ns().providerConfigs.update(existing.id, integrationPatch(existing, body))!
      : ns().providerConfigs.insert({
          unique_key: uniqueKey,
          provider,
          display_name: stringBody(body.display_name) || provider,
          logo: stringBody(body.logo),
          auth_mode: authModeBody(body.auth_mode),
          proxy_auth_mode: proxyAuthModeBody(body.proxy_auth_mode),
          oauth_authorize_url: nullableStringBody(body.oauth_authorize_url),
          oauth_token_url: nullableStringBody(body.oauth_token_url),
          oauth_client_id: nullableStringBody(body.oauth_client_id),
          oauth_client_secret: nullableStringBody(body.oauth_client_secret),
          oauth_scope: nullableStringBody(body.oauth_scope),
          proxy_base_url: nullableStringBody(body.proxy_base_url),
          proxy_base_url_mapping_key: nullableStringBody(body.proxy_base_url_mapping_key),
          static_bearer_token: nullableStringBody(body.static_bearer_token),
          forward_webhooks: Boolean(body.forward_webhooks),
          webhook_url: nullableStringBody(body.webhook_url),
          docs_connect: nullableStringBody(body.docs_connect),
          connect_button_label: nullableStringBody(body.connect_button_label),
          manual_fields: Array.isArray(body.manual_fields) ? (body.manual_fields as NangoProviderConfig["manual_fields"]) : [],
          default_connection_config:
            body.default_connection_config && typeof body.default_connection_config === "object"
              ? (body.default_connection_config as Record<string, unknown>)
              : null,
          connect_metadata_defaults:
            body.connect_metadata_defaults && typeof body.connect_metadata_defaults === "object"
              ? (body.connect_metadata_defaults as Record<string, unknown>)
              : null,
        });
    return c.json({ data: publicIntegrationShape(integration, true) }, existing ? 200 : 201);
  });

  app.patch("/integrations/:uniqueKey", async (c) => {
    requireApiAuth(c, store);
    const existing = findProviderConfig(store, c.req.param("uniqueKey"));
    const body = await parseJsonBody(c);
    const integration = ns().providerConfigs.update(existing.id, integrationPatch(existing, body))!;
    return c.json({ data: publicIntegrationShape(integration, true) });
  });

  app.delete("/integrations/:uniqueKey", (c) => {
    requireApiAuth(c, store);
    const existing = findProviderConfig(store, c.req.param("uniqueKey"));
    ns().providerConfigs.delete(existing.id);
    return c.body(null, 204);
  });

  app.get("/connections", (c) => {
    requireApiAuth(c, store);
    const connectionId = c.req.query("connectionId") ?? "";
    const search = (c.req.query("search") ?? "").toLowerCase();
    const endUserId = c.req.query("endUserId") ?? "";
    const integrationId = c.req.query("integrationId") ?? "";
    const limit = Math.max(1, Math.min(100, Number(c.req.query("limit") ?? "100") || 100));
    const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
    const integrationIds = integrationId
      ? integrationId.split(",").map((value) => value.trim()).filter(Boolean)
      : [];
    const tagEntries = [...new URL(c.req.url).searchParams.entries()]
      .filter(([key]) => key.startsWith("tags["))
      .map(([key, value]) => [key.slice(5, -1), value] as const);

    const filtered = ns().connections.query({
      page,
      per_page: limit,
      sort: (a, b) => b.updated_at.localeCompare(a.updated_at),
      filter: (connection) => {
        if (connectionId && connection.connection_id !== connectionId) return false;
        if (endUserId && connection.end_user?.id !== endUserId) return false;
        if (integrationIds.length > 0 && !integrationIds.includes(connection.provider_config_key)) return false;
        if (tagEntries.some(([key, value]) => (connection.tags[key] ?? "") !== value)) return false;
        if (!search) return true;
        return [
          connection.connection_id,
          connection.provider_config_key,
          connection.end_user?.email ?? "",
          connection.end_user?.display_name ?? "",
        ].some((value) => value.toLowerCase().includes(search));
      },
    });

    return c.json({ connections: filtered.items.map(toListConnectionShape) });
  });

  app.post("/connections", async (c) => {
    requireApiAuth(c, store);
    const body = await parseJsonBody(c);
    const providerConfigKey = stringBody(body.provider_config_key);
    const integration = findProviderConfig(store, providerConfigKey);
    const credentials = normalizeCredentials(body.credentials);
    const connection = upsertConnection(store, {
      providerConfigKey,
      provider: integration.provider,
      existingConnectionId: null,
      connectionId: deriveConnectionId({
        providerConfigKey,
        requestedConnectionId: nullableStringBody(body.connection_id),
        endUser:
          body.end_user && typeof body.end_user === "object" ? (body.end_user as NangoConnectionFullShape["end_user"]) : null,
        connectionConfig:
          body.connection_config && typeof body.connection_config === "object"
            ? (body.connection_config as Record<string, unknown>)
            : null,
      }),
      connectionConfig:
        body.connection_config && typeof body.connection_config === "object"
          ? (body.connection_config as Record<string, unknown>)
          : null,
      credentials,
      endUser: body.end_user && typeof body.end_user === "object" ? (body.end_user as NangoConnectionFullShape["end_user"]) : null,
      tags: body.tags && typeof body.tags === "object" ? (body.tags as Record<string, string>) : {},
      metadata: body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : null,
    });
    await dispatchConnectionWebhook(store, integration, connection, "connection.created");
    return c.json(toFullConnectionShape(connection), 201);
  });

  app.get("/connections/:connectionId", (c) => {
    requireApiAuth(c, store);
    const connection = requireConnection(c.req.param("connectionId"));
    const providerConfigKey = c.req.query("provider_config_key") ?? connection.provider_config_key;
    if (connection.provider_config_key !== providerConfigKey) {
      return c.json({ error: { code: "unknown_provider_config" } }, 404);
    }
    if (connectionHasAuthError(connection)) {
      const body = errorResponseBody(makeInvalidCredentialsError(connection));
      return c.json(body.extra ?? { message: body.message }, 400);
    }
    return c.json(toFullConnectionShape(connection));
  });

  app.patch("/connections/:connectionId", async (c) => {
    requireApiAuth(c, store);
    const connection = requireConnection(c.req.param("connectionId"));
    const body = await parseJsonBody(c);
    const updated = ns().connections.update(connection.id, {
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>)
          : connection.metadata,
      end_user:
        body.end_user && typeof body.end_user === "object"
          ? (body.end_user as NangoConnectionFullShape["end_user"])
          : connection.end_user,
      tags: body.tags && typeof body.tags === "object" ? (body.tags as Record<string, string>) : connection.tags,
      connection_config:
        body.connection_config && typeof body.connection_config === "object"
          ? (body.connection_config as Record<string, unknown>)
          : connection.connection_config,
      errors: Array.isArray(body.errors) ? (body.errors as NangoConnection["errors"]) : connection.errors,
    })!;
    await dispatchConnectionWebhook(store, findProviderConfig(store, updated.provider_config_key), updated, "connection.updated");
    return c.json({ success: true });
  });

  app.delete("/connections/:connectionId", async (c) => {
    requireApiAuth(c, store);
    const connection = requireConnection(c.req.param("connectionId"));
    const providerConfigKey = c.req.query("provider_config_key") ?? "";
    if (providerConfigKey && providerConfigKey !== connection.provider_config_key) {
      return c.json({ error: { code: "unknown_provider_config" } }, 404);
    }
    ns().connections.delete(connection.id);
    await dispatchConnectionWebhook(store, findProviderConfig(store, connection.provider_config_key), connection, "connection.deleted");
    return c.body(null, 204);
  });

  app.post("/connections/metadata", async (c) => {
    requireApiAuth(c, store);
    const body = await parseJsonBody(c);
    const providerConfigKey = stringBody(body.provider_config_key);
    const connectionIds = Array.isArray(body.connection_id)
      ? body.connection_id.filter((value): value is string => typeof value === "string")
      : [stringBody(body.connection_id)].filter(Boolean);
    const metadata = body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : null;
    if (!providerConfigKey || connectionIds.length === 0 || !metadata) {
      throw new ApiError(400, "provider_config_key, connection_id, and metadata are required");
    }
    const updated = updateMetadata(connectionIds, providerConfigKey, metadata, false);
    return c.json({ success: true, updated });
  });

  app.patch("/connections/metadata", async (c) => {
    requireApiAuth(c, store);
    const body = await parseJsonBody(c);
    const providerConfigKey = stringBody(body.provider_config_key);
    const connectionIds = Array.isArray(body.connection_id)
      ? body.connection_id.filter((value): value is string => typeof value === "string")
      : [stringBody(body.connection_id)].filter(Boolean);
    const metadata = body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : null;
    if (!providerConfigKey || connectionIds.length === 0 || !metadata) {
      throw new ApiError(400, "provider_config_key, connection_id, and metadata are required");
    }
    const updated = updateMetadata(connectionIds, providerConfigKey, metadata, true);
    return c.json({ success: true, updated });
  });

  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) app.on(method, "/proxy/:path{.*}", async (c) => {
    requireApiAuth(c, store);
    const connectionId = c.req.header("Connection-Id") ?? "";
    const providerConfigKey = c.req.header("Provider-Config-Key") ?? "";
    if (!connectionId || !providerConfigKey) {
      return c.json({ error: "Connection-Id and Provider-Config-Key are required" }, 400);
    }

    const connection = requireConnection(connectionId);
    if (connection.provider_config_key !== providerConfigKey) {
      return c.json({ error: { code: "unknown_provider_config" } }, 404);
    }
    if (connectionHasAuthError(connection)) {
      const body = errorResponseBody(makeInvalidCredentialsError(connection));
      return c.json(body.extra ?? { message: body.message }, 400);
    }

    const integration = findProviderConfig(store, providerConfigKey);
    const endpoint = `/${c.req.param("path") ?? ""}`;
    const overrideBaseUrl = c.req.header("Base-Url-Override") ?? null;
    const targetBaseUrl = resolveTargetBaseUrl(store, integration, connection, overrideBaseUrl);
    const requestHeaders = collectProxyRequestHeaders(c.req.raw.headers);
    const requestBodyBytes = hasBody(c.req.method) ? new Uint8Array(await c.req.arrayBuffer()) : new Uint8Array();

    const synthetic = buildSyntheticProxyResponse(integration, connection, endpoint);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (synthetic) {
      const bodyText = JSON.stringify(synthetic.body);
      ns().proxyLogs.insert({
        request_id: requestId,
        provider_config_key: providerConfigKey,
        connection_id: connectionId,
        method: c.req.method,
        endpoint,
        resolved_url: synthetic.status === 200 ? `synthetic:${endpoint}` : `synthetic-error:${endpoint}`,
        synthetic: true,
        request_headers: requestHeaders,
        request_body: normalizeConnectionBodyText(requestBodyBytes, c.req.header("Content-Type") ?? null),
        response_status: synthetic.status,
        response_headers: { "content-type": "application/json" },
        response_body: bodyText,
        error: null,
      });
      ns().connections.update(connection.id, { last_fetched_at: new Date().toISOString() });
      return c.json(synthetic.body, synthetic.status);
    }

    if (!targetBaseUrl) {
      return c.json({ error: `No proxy target configured for ${providerConfigKey}` }, 501);
    }

    const targetUrl = new URL(endpoint, targetBaseUrl);
    for (const [key, value] of new URL(c.req.url).searchParams.entries()) {
      targetUrl.searchParams.set(key, value);
    }

    const outgoingHeaders = {
      ...buildOutgoingProxyHeaders(integration, connection),
      ...requestHeaders,
    };

    try {
      const upstream = await fetch(targetUrl, {
        method: c.req.method,
        headers: outgoingHeaders,
        body: hasBody(c.req.method) ? requestBodyBytes : undefined,
        signal: AbortSignal.timeout(60_000),
      });
      const responseBytes = new Uint8Array(await upstream.arrayBuffer());
      const responseHeaders = headersToRecord(upstream.headers);
      ns().proxyLogs.insert({
        request_id: requestId,
        provider_config_key: providerConfigKey,
        connection_id: connectionId,
        method: c.req.method,
        endpoint,
        resolved_url: targetUrl.toString(),
        synthetic: false,
        request_headers: requestHeaders,
        request_body: normalizeConnectionBodyText(requestBodyBytes, c.req.header("Content-Type") ?? null),
        response_status: upstream.status,
        response_headers: responseHeaders,
        response_body: normalizeConnectionBodyText(responseBytes, upstream.headers.get("Content-Type")),
        error: null,
      });
      ns().connections.update(connection.id, { last_fetched_at: new Date().toISOString() });
      return new Response(responseBytes, { status: upstream.status, headers: upstream.headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ns().proxyLogs.insert({
        request_id: requestId,
        provider_config_key: providerConfigKey,
        connection_id: connectionId,
        method: c.req.method,
        endpoint,
        resolved_url: targetUrl.toString(),
        synthetic: false,
        request_headers: requestHeaders,
        request_body: normalizeConnectionBodyText(requestBodyBytes, c.req.header("Content-Type") ?? null),
        response_status: null,
        response_headers: {},
        response_body: null,
        error: message,
      });
      return c.json({ error: message }, 502);
    }
  });

  function requireConnection(connectionId: string): NangoConnection {
    const connection = ns().connections.findOneBy("connection_id", connectionId);
    if (!connection) {
      throw new ApiError(404, `Connection not found: ${connectionId}`);
    }
    return connection;
  }

  function updateMetadata(connectionIds: string[], providerConfigKey: string, metadata: Record<string, unknown>, merge: boolean): number {
    let updated = 0;
    for (const connectionId of connectionIds) {
      const connection = ns().connections.findOneBy("connection_id", connectionId);
      if (!connection || connection.provider_config_key !== providerConfigKey) continue;
      ns().connections.update(connection.id, {
        metadata: merge ? appendDefaults(connection.metadata, metadata) : metadata,
      });
      updated++;
    }
    return updated;
  }
}

type NangoConnectionFullShape = ReturnType<typeof toFullConnectionShape>;

function publicIntegrationShape(integration: NangoProviderConfig, includeInternal = false) {
  const data = {
    created_at: integration.created_at,
    updated_at: integration.updated_at,
    unique_key: integration.unique_key,
    provider: integration.provider,
    display_name: integration.display_name,
    forward_webhooks: integration.forward_webhooks,
    logo: integration.logo,
    ...(integration.webhook_url ? { webhook_url: integration.webhook_url } : {}),
  } as Record<string, unknown>;

  if (includeInternal) {
    data.auth_mode = integration.auth_mode;
    data.proxy_auth_mode = integration.proxy_auth_mode;
    data.oauth_authorize_url = integration.oauth_authorize_url;
    data.oauth_token_url = integration.oauth_token_url;
    data.oauth_client_id = integration.oauth_client_id;
    data.oauth_scope = integration.oauth_scope;
    data.proxy_base_url = integration.proxy_base_url;
    data.proxy_base_url_mapping_key = integration.proxy_base_url_mapping_key;
    data.manual_fields = integration.manual_fields;
    data.default_connection_config = integration.default_connection_config;
    data.connect_metadata_defaults = integration.connect_metadata_defaults;
    data.docs_connect = integration.docs_connect;
    data.connect_button_label = integration.connect_button_label;
  }

  return data;
}

function integrationPatch(existing: NangoProviderConfig, body: Record<string, unknown>): Partial<NangoProviderConfig> {
  return {
    provider: stringBody(body.provider) || existing.provider,
    display_name: stringBody(body.display_name) || existing.display_name,
    logo: stringBody(body.logo) || existing.logo,
    auth_mode: authModeBody(body.auth_mode, existing.auth_mode),
    proxy_auth_mode: proxyAuthModeBody(body.proxy_auth_mode, existing.proxy_auth_mode),
    oauth_authorize_url: nullableStringBody(body.oauth_authorize_url) ?? existing.oauth_authorize_url,
    oauth_token_url: nullableStringBody(body.oauth_token_url) ?? existing.oauth_token_url,
    oauth_client_id: nullableStringBody(body.oauth_client_id) ?? existing.oauth_client_id,
    oauth_client_secret: nullableStringBody(body.oauth_client_secret) ?? existing.oauth_client_secret,
    oauth_scope: nullableStringBody(body.oauth_scope) ?? existing.oauth_scope,
    proxy_base_url: nullableStringBody(body.proxy_base_url) ?? existing.proxy_base_url,
    proxy_base_url_mapping_key:
      nullableStringBody(body.proxy_base_url_mapping_key) ?? existing.proxy_base_url_mapping_key,
    static_bearer_token: nullableStringBody(body.static_bearer_token) ?? existing.static_bearer_token,
    forward_webhooks: typeof body.forward_webhooks === "boolean" ? body.forward_webhooks : existing.forward_webhooks,
    webhook_url: nullableStringBody(body.webhook_url) ?? existing.webhook_url,
    docs_connect: nullableStringBody(body.docs_connect) ?? existing.docs_connect,
    connect_button_label: nullableStringBody(body.connect_button_label) ?? existing.connect_button_label,
    manual_fields: Array.isArray(body.manual_fields) ? (body.manual_fields as NangoProviderConfig["manual_fields"]) : existing.manual_fields,
    default_connection_config:
      body.default_connection_config && typeof body.default_connection_config === "object"
        ? (body.default_connection_config as Record<string, unknown>)
        : existing.default_connection_config,
    connect_metadata_defaults:
      body.connect_metadata_defaults && typeof body.connect_metadata_defaults === "object"
        ? (body.connect_metadata_defaults as Record<string, unknown>)
        : existing.connect_metadata_defaults,
  };
}

function collectProxyRequestHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (lower.startsWith("nango-proxy-")) {
      result[key.slice("Nango-Proxy-".length)] = value;
      continue;
    }
    if (["content-type", "accept"].includes(lower)) {
      result[key] = value;
    }
  }
  return result;
}

function normalizeCredentials(value: unknown): NangoConnectionCredentials {
  if (value && typeof value === "object" && "type" in value) {
    return value as NangoConnectionCredentials;
  }
  return { type: "NONE", raw: {} };
}

function stringBody(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStringBody(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function authModeBody(value: unknown, fallback: NangoProviderConfig["auth_mode"] = "manual"): NangoProviderConfig["auth_mode"] {
  return value === "oauth2" || value === "manual" || value === "none" ? value : fallback;
}

function proxyAuthModeBody(
  value: unknown,
  fallback: NangoProviderConfig["proxy_auth_mode"] = "none",
): NangoProviderConfig["proxy_auth_mode"] {
  return value === "oauth2-bearer" || value === "none" || value === "static-bearer" ? value : fallback;
}

function hasBody(method: string): boolean {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}
