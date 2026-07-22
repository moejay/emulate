import { bodyStr, escapeAttr, escapeHtml, renderCardPage, renderErrorPage, type RouteContext } from "@emulators/core";
import { ApiError } from "@emulators/core";
import {
  appendDefaults,
  createConnectSessionResponse,
  decodeIdTokenEmail,
  deriveConnectionId,
  findProviderConfig,
  getRuntimeConfig,
  pageLink,
  pickConnectFields,
  randomToken,
  renderManualField,
  requireConnectSession,
  resolveSessionToken,
  toFullConnectionShape,
} from "../helpers.js";
import type { NangoConnectSession, NangoConnection, NangoConnectionCredentials, NangoEndUser } from "../entities.js";
import { getNangoStore } from "../store.js";
import { dispatchConnectionWebhook, upsertConnection } from "./shared.js";

const SERVICE_LABEL = "Nango";

export function connectRoutes({ app, store, baseUrl }: RouteContext): void {
  const ns = () => getNangoStore(store);

  app.post("/connect/sessions", async (c) => {
    const authHeader = c.req.header("Authorization") ?? "";
    if (!authHeader.match(/^(Bearer|token)\s+/i) || !authHeader.endsWith(getRuntimeConfig(store).secret_key)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const allowedIntegrations = Array.isArray(body.allowed_integrations)
      ? body.allowed_integrations.filter((value): value is string => typeof value === "string")
      : [];
    if (allowedIntegrations.length === 0) {
      return c.json({ error: "allowed_integrations is required" }, 400);
    }

    const tags = (body.tags && typeof body.tags === "object" ? body.tags : {}) as Record<string, string>;
    const endUserInput = (body.end_user && typeof body.end_user === "object" ? body.end_user : null) as NangoEndUser | null;
    const endUser = endUserInput ?? (tags.end_user_id ? { id: tags.end_user_id } : null);
    const organization = (body.organization && typeof body.organization === "object"
      ? (body.organization as { id: string; display_name?: string })
      : null);

    const token = randomToken("cs");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    ns().connectSessions.insert({
      token,
      expires_at: expiresAt,
      allowed_integrations: allowedIntegrations,
      end_user: endUser,
      organization,
      tags,
      overrides: (body.overrides && typeof body.overrides === "object"
        ? (body.overrides as Record<string, { docs_connect?: string }>)
        : {}),
      integrations_config_defaults:
        (body.integrations_config_defaults && typeof body.integrations_config_defaults === "object"
          ? (body.integrations_config_defaults as Record<
              string,
              {
                user_scopes?: string;
                authorization_params?: Record<string, string>;
                connection_config?: Record<string, unknown>;
              }
            >)
          : {}),
      is_reconnecting: false,
      reconnect_connection_id: null,
      reconnect_integration_id: null,
    });

    return c.json(createConnectSessionResponse(baseUrl, token, expiresAt));
  });

  app.post("/connect/sessions/reconnect", async (c) => {
    const authHeader = c.req.header("Authorization") ?? "";
    if (!authHeader.match(/^(Bearer|token)\s+/i) || !authHeader.endsWith(getRuntimeConfig(store).secret_key)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const connectionId = typeof body.connection_id === "string" ? body.connection_id : "";
    const integrationId = typeof body.integration_id === "string" ? body.integration_id : "";
    if (!connectionId || !integrationId) {
      return c.json({ error: "connection_id and integration_id are required" }, 400);
    }

    const token = randomToken("cs");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    ns().connectSessions.insert({
      token,
      expires_at: expiresAt,
      allowed_integrations: [integrationId],
      end_user: (body.end_user && typeof body.end_user === "object" ? (body.end_user as NangoEndUser) : null),
      organization:
        (body.organization && typeof body.organization === "object"
          ? (body.organization as { id: string; display_name?: string })
          : null),
      tags: (body.tags && typeof body.tags === "object" ? (body.tags as Record<string, string>) : {}),
      overrides: (body.overrides && typeof body.overrides === "object"
        ? (body.overrides as Record<string, { docs_connect?: string }>)
        : {}),
      integrations_config_defaults:
        (body.integrations_config_defaults && typeof body.integrations_config_defaults === "object"
          ? (body.integrations_config_defaults as Record<
              string,
              {
                user_scopes?: string;
                authorization_params?: Record<string, string>;
                connection_config?: Record<string, unknown>;
              }
            >)
          : {}),
      is_reconnecting: true,
      reconnect_connection_id: connectionId,
      reconnect_integration_id: integrationId,
    });

    return c.json(createConnectSessionResponse(baseUrl, token, expiresAt));
  });

  app.get("/connect/session", (c) => {
    try {
      const session = requireConnectSession(store, resolveSessionToken(c));
      return c.json({
        data: {
          allowed_integrations: session.allowed_integrations,
          endUser: session.end_user,
          organization: session.organization,
          tags: session.tags,
          overrides: session.overrides,
          integrations_config_defaults: session.integrations_config_defaults,
          isReconnecting: session.is_reconnecting,
          connectUISettings: getRuntimeConfig(store).connect_ui_settings,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid session";
      return c.json({ error: message }, 401);
    }
  });

  app.delete("/connect/session", (c) => {
    try {
      const token = resolveSessionToken(c);
      const session = requireConnectSession(store, token);
      ns().connectSessions.delete(session.id);
      return c.body(null, 204);
    } catch {
      return c.body(null, 204);
    }
  });

  app.post("/connect/telemetry", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    ns().telemetryEvents.insert({
      token: typeof body.token === "string" ? body.token : "",
      event: typeof body.event === "string" ? body.event : "unknown",
      integration:
        body.dimensions && typeof body.dimensions === "object" && typeof (body.dimensions as { integration?: unknown }).integration === "string"
          ? ((body.dimensions as { integration?: string }).integration ?? null)
          : null,
    });
    return c.body(null, 204);
  });

  app.get("/connect", (c) => {
    return c.html(renderCardPage(
      "Nango Connect",
      "Preparing your local connection flow.",
      `<div class="info-text" style="margin-bottom:16px">This window will load as soon as the session token arrives from the parent app.</div>
<button class="user-btn" type="button" onclick="window.parent.postMessage({ type: 'close' }, '*')"><span class="user-login">Close</span></button>
<script>
window.parent.postMessage({ type: 'ready' }, '*');
window.addEventListener('message', function(event) {
  if (!event.data || event.data.type !== 'session_token' || !event.data.sessionToken) return;
  window.location.href = '/connect/panel?session_token=' + encodeURIComponent(event.data.sessionToken);
});
</script>`,
      SERVICE_LABEL,
    ));
  });

  app.get("/connect/panel", (c) => {
    try {
      const session = requireConnectSession(store, c.req.query("session_token") ?? "");
      const integrations = session.allowed_integrations.map((key) => findProviderConfig(store, key));
      const body = integrations
        .map((integration) => renderIntegrationPanel(session, integration))
        .join("\n");
      return c.html(renderCardPage(
        session.is_reconnecting ? "Reconnect integration" : "Connect integration",
        session.is_reconnecting
          ? "Reconnect the selected local integration."
          : "Choose a seeded local connection flow.",
        `${body}<div class="info-text" style="margin-top:16px">Session expires at ${escapeHtml(session.expires_at)}.</div>`,
        SERVICE_LABEL,
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid connect session";
      return c.html(renderErrorPage("Connect session error", message, SERVICE_LABEL), 401);
    }
  });

  app.get("/connect/oauth/start", (c) => {
    try {
      const session = requireConnectSession(store, c.req.query("session_token") ?? "");
      const integration = findProviderConfig(store, c.req.query("integration_id") ?? "");
      if (!session.allowed_integrations.includes(integration.unique_key)) {
        throw new ApiError(403, "Integration not allowed in this connect session");
      }
      if (integration.auth_mode !== "oauth2" || !integration.oauth_authorize_url || !integration.oauth_client_id) {
        throw new ApiError(400, `Integration ${integration.unique_key} is not configured for OAuth`);
      }

      const defaults = session.integrations_config_defaults[integration.unique_key] ?? {};
      const connectionId = session.reconnect_connection_id ?? deriveConnectionId({
        providerConfigKey: integration.unique_key,
        endUser: session.end_user,
        connectionConfig: defaults.connection_config ?? integration.default_connection_config,
      });
      const state = randomToken("oauth");
      ns().oauthStates.insert({
        state,
        session_token: session.token,
        provider_config_key: integration.unique_key,
        connection_id: connectionId,
      });

      const redirectUrl = new URL(integration.oauth_authorize_url);
      redirectUrl.searchParams.set("client_id", integration.oauth_client_id);
      redirectUrl.searchParams.set("redirect_uri", `${baseUrl}/connect/oauth/callback`);
      redirectUrl.searchParams.set("response_type", "code");
      redirectUrl.searchParams.set("state", state);
      if (integration.oauth_scope) redirectUrl.searchParams.set("scope", integration.oauth_scope);
      redirectUrl.searchParams.set("access_type", "offline");
      redirectUrl.searchParams.set("prompt", "consent");
      if (defaults.authorization_params) {
        for (const [key, value] of Object.entries(defaults.authorization_params)) {
          redirectUrl.searchParams.set(key, value);
        }
      }
      return c.redirect(redirectUrl.toString(), 302);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start OAuth flow";
      return c.html(renderErrorPage("OAuth start failed", message, SERVICE_LABEL), 400);
    }
  });

  app.get("/connect/oauth/callback", async (c) => {
    try {
      const code = c.req.query("code") ?? "";
      const stateValue = c.req.query("state") ?? "";
      const error = c.req.query("error");
      if (error) {
        throw new ApiError(400, `Provider returned error: ${error}`);
      }
      const state = ns().oauthStates.findOneBy("state", stateValue);
      if (!state) {
        throw new ApiError(400, "Unknown OAuth state");
      }
      const session = requireConnectSession(store, state.session_token);
      const integration = findProviderConfig(store, state.provider_config_key);
      if (!integration.oauth_token_url || !integration.oauth_client_id || !integration.oauth_client_secret) {
        throw new ApiError(400, `Integration ${integration.unique_key} is missing OAuth token settings`);
      }

      const tokenRes = await fetch(integration.oauth_token_url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: integration.oauth_client_id,
          client_secret: integration.oauth_client_secret,
          redirect_uri: `${baseUrl}/connect/oauth/callback`,
          grant_type: "authorization_code",
        }).toString(),
      });
      if (!tokenRes.ok) {
        throw new ApiError(tokenRes.status, `Token exchange failed with ${tokenRes.status}`);
      }
      const tokenBody = (await tokenRes.json()) as Record<string, unknown>;
      const credentials: NangoConnectionCredentials = {
        type: "OAUTH2",
        access_token: typeof tokenBody.access_token === "string" ? tokenBody.access_token : "",
        refresh_token: typeof tokenBody.refresh_token === "string" ? tokenBody.refresh_token : undefined,
        expires_in: typeof tokenBody.expires_in === "number" ? tokenBody.expires_in : undefined,
        raw: tokenBody,
      };

      const defaults = session.integrations_config_defaults[integration.unique_key] ?? {};
      const metadata = appendDefaults(integration.connect_metadata_defaults, {
        email: decodeIdTokenEmail(credentials) ?? session.end_user?.email ?? null,
        targetBaseUrl: undefined,
      });
      const connection = upsertConnection(store, {
        existingConnectionId: session.reconnect_connection_id,
        providerConfigKey: integration.unique_key,
        provider: integration.provider,
        connectionId: state.connection_id,
        connectionConfig: appendDefaults(integration.default_connection_config, defaults.connection_config ?? null),
        credentials,
        endUser: session.end_user,
        tags: session.tags,
        metadata,
      });

      ns().oauthStates.delete(state.id);
      ns().connectSessions.delete(session.id);
      await dispatchConnectionWebhook(store, integration, connection, session.is_reconnecting ? "connection.updated" : "connection.created");
      return c.redirect(pageLink("/connect/finalize", {
        provider_config_key: integration.unique_key,
        connection_id: connection.connection_id,
      }), 302);
    } catch (err) {
      const message = err instanceof Error ? err.message : "OAuth callback failed";
      return c.html(renderErrorPage("OAuth callback failed", message, SERVICE_LABEL), 400);
    }
  });

  app.post("/connect/manual", async (c) => {
    try {
      const body = await c.req.parseBody();
      const session = requireConnectSession(store, bodyStr(body.session_token));
      const integration = findProviderConfig(store, bodyStr(body.integration_id));
      if (!session.allowed_integrations.includes(integration.unique_key)) {
        throw new ApiError(403, "Integration not allowed in this connect session");
      }
      if (integration.auth_mode === "oauth2") {
        throw new ApiError(400, "Use the OAuth flow for this integration");
      }

      const connectionConfig: Record<string, unknown> = {};
      const metadataPatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        const str = bodyStr(value as never);
        if (!str) continue;
        if (key.startsWith("config.")) {
          connectionConfig[key.slice("config.".length)] = str;
        }
        if (key.startsWith("metadata.")) {
          metadataPatch[key.slice("metadata.".length)] = str;
        }
      }

      const defaults = session.integrations_config_defaults[integration.unique_key] ?? {};
      const finalConnectionConfig = appendDefaults(
        appendDefaults(integration.default_connection_config, defaults.connection_config ?? null),
        connectionConfig,
      );
      const metadata = appendDefaults(integration.connect_metadata_defaults, metadataPatch);
      const connectionId = session.reconnect_connection_id ?? deriveConnectionId({
        providerConfigKey: integration.unique_key,
        requestedConnectionId: bodyStr(body.connection_id),
        endUser: session.end_user,
        connectionConfig: finalConnectionConfig,
      });
      const connection = upsertConnection(store, {
        existingConnectionId: session.reconnect_connection_id,
        providerConfigKey: integration.unique_key,
        provider: integration.provider,
        connectionId,
        connectionConfig: finalConnectionConfig,
        credentials: { type: "NONE", raw: {} },
        endUser: session.end_user,
        tags: session.tags,
        metadata,
      });

      ns().connectSessions.delete(session.id);
      await dispatchConnectionWebhook(store, integration, connection, session.is_reconnecting ? "connection.updated" : "connection.created");
      return c.redirect(pageLink("/connect/finalize", {
        provider_config_key: integration.unique_key,
        connection_id: connection.connection_id,
      }), 302);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create connection";
      return c.html(renderErrorPage("Connection failed", message, SERVICE_LABEL), 400);
    }
  });

  app.get("/connect/finalize", (c) => {
    const providerConfigKey = c.req.query("provider_config_key") ?? "";
    const connectionId = c.req.query("connection_id") ?? "";
    const body = `<div class="info-text" style="margin-bottom:16px">Connection created for ${escapeHtml(providerConfigKey)}.</div>
<button class="user-btn" type="button" onclick="window.parent.postMessage({ type: 'connect', payload: { providerConfigKey: ${JSON.stringify(providerConfigKey)}, connectionId: ${JSON.stringify(connectionId)}, isPending: false } }, '*')"><span class="user-login">Send connect event</span></button>
<div class="info-text" style="margin-top:16px">If the parent app does not close automatically, use the button below.</div>
<button class="user-btn" type="button" onclick="window.parent.postMessage({ type: 'close' }, '*')" style="margin-top:8px"><span class="user-login">Close</span></button>
<script>
window.parent.postMessage({ type: 'connect', payload: { providerConfigKey: ${JSON.stringify(providerConfigKey)}, connectionId: ${JSON.stringify(connectionId)}, isPending: false } }, '*');
</script>`;
    return c.html(renderCardPage("Connection ready", "Return the connection id to the parent app.", body, SERVICE_LABEL));
  });
}

function renderIntegrationPanel(session: NangoConnectSession, integration: ReturnType<typeof findProviderConfig>): string {
  const docsUrl = session.overrides[integration.unique_key]?.docs_connect ?? integration.docs_connect;
  const action = integration.auth_mode === "oauth2"
    ? `<form method="GET" action="/connect/oauth/start" class="user-form">
        <input type="hidden" name="session_token" value="${escapeAttr(session.token)}"/>
        <input type="hidden" name="integration_id" value="${escapeAttr(integration.unique_key)}"/>
        <button class="user-btn" type="submit"><span class="user-login">${escapeHtml(integration.connect_button_label ?? `Connect ${integration.display_name}`)}</span></button>
      </form>`
    : `<form method="POST" action="/connect/manual" class="user-form">
        <input type="hidden" name="session_token" value="${escapeAttr(session.token)}"/>
        <input type="hidden" name="integration_id" value="${escapeAttr(integration.unique_key)}"/>
        ${pickConnectFields(integration).map((field) => renderManualField(field)).join("\n")}
        <button class="user-btn" type="submit"><span class="user-login">${escapeHtml(integration.connect_button_label ?? `Connect ${integration.display_name}`)}</span></button>
      </form>`;
  const docs = docsUrl ? `<div class="info-text" style="margin-top:10px"><a href="${escapeAttr(docsUrl)}" target="_blank" rel="noopener">Open provider docs</a></div>` : "";
  return `<section style="margin-bottom:18px">
    <div class="card-title" style="font-size:1rem">${escapeHtml(integration.display_name)}</div>
    <div class="card-subtitle">Provider key: <strong>${escapeHtml(integration.unique_key)}</strong></div>
    ${action}
    ${docs}
  </section>`;
}
