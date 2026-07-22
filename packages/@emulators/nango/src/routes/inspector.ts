import { escapeAttr, escapeHtml, renderInspectorPage, type InspectorTab, type RouteContext } from "@emulators/core";
import { trimRecentProxyLogs } from "../helpers.js";
import { getNangoStore } from "../store.js";

const SERVICE_LABEL = "Nango";

const TABS: InspectorTab[] = [
  { id: "integrations", label: "Integrations", href: "/?tab=integrations" },
  { id: "connections", label: "Connections", href: "/?tab=connections" },
  { id: "sessions", label: "Sessions", href: "/?tab=sessions" },
  { id: "proxy", label: "Proxy", href: "/?tab=proxy" },
  { id: "webhooks", label: "Webhooks", href: "/?tab=webhooks" },
];

type TabId = (typeof TABS)[number]["id"];

export function inspectorRoutes({ app, store }: RouteContext): void {
  const ns = () => getNangoStore(store);

  app.get("/", (c) => {
    const requested = c.req.query("tab") ?? "integrations";
    const active = TABS.some((tab) => tab.id === requested) ? (requested as TabId) : "integrations";
    const body =
      active === "connections"
        ? connectionsView()
        : active === "sessions"
          ? sessionsView()
          : active === "proxy"
            ? proxyView()
            : active === "webhooks"
              ? webhooksView()
              : integrationsView();
    return c.html(renderInspectorPage("Nango Inspector", TABS, active, body, SERVICE_LABEL));
  });

  function integrationsView(): string {
    const rows = ns()
      .providerConfigs.all()
      .sort((a, b) => a.unique_key.localeCompare(b.unique_key))
      .map((integration) => [
        escapeHtml(integration.unique_key),
        escapeHtml(integration.provider),
        escapeHtml(integration.display_name),
        escapeHtml(integration.auth_mode),
        escapeHtml(integration.proxy_base_url_mapping_key ?? integration.proxy_base_url ?? ""),
        escapeHtml(integration.forward_webhooks ? integration.webhook_url ?? "enabled" : "off"),
      ]);
    return section("Provider configs", table(["Unique key", "Provider", "Display", "Auth", "Proxy target", "Webhooks"], rows, "No integrations."));
  }

  function connectionsView(): string {
    const rows = ns()
      .connections.all()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((connection) => [
        escapeHtml(connection.connection_id),
        escapeHtml(connection.provider_config_key),
        escapeHtml(connection.end_user?.email ?? connection.end_user?.id ?? ""),
        escapeHtml(connection.credentials.type),
        escapeHtml(connection.last_fetched_at ?? "never"),
        escapeHtml(connection.errors.length > 0 ? connection.errors.map((error) => error.type).join(", ") : "ok"),
      ]);
    return section("Connections", table(["Connection ID", "Provider config", "End user", "Credentials", "Last proxy", "Errors"], rows, "No connections."));
  }

  function sessionsView(): string {
    const sessionRows = ns()
      .connectSessions.all()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((session) => [
        escapeHtml(mask(session.token)),
        escapeHtml(session.allowed_integrations.join(", ")),
        escapeHtml(session.end_user?.email ?? session.end_user?.id ?? ""),
        escapeHtml(session.is_reconnecting ? "reconnect" : "connect"),
        escapeHtml(session.expires_at),
      ]);
    const oauthRows = ns()
      .oauthStates.all()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((state) => [
        escapeHtml(mask(state.state)),
        escapeHtml(state.provider_config_key),
        escapeHtml(state.connection_id),
        escapeHtml(mask(state.session_token)),
      ]);
    return (
      section("Connect sessions", table(["Token", "Allowed integrations", "End user", "Mode", "Expires"], sessionRows, "No sessions.")) +
      section("OAuth states", table(["State", "Provider config", "Connection ID", "Session"], oauthRows, "No OAuth states."))
    );
  }

  function proxyView(): string {
    const rows = trimRecentProxyLogs(ns().proxyLogs.all(), 40).map((log) => [
      escapeHtml(log.created_at),
      escapeHtml(log.provider_config_key),
      escapeHtml(log.connection_id),
      escapeHtml(log.method),
      linkCell(log.resolved_url, log.synthetic ? `${log.endpoint} (synthetic)` : log.endpoint),
      escapeHtml(log.response_status == null ? "ERR" : String(log.response_status)),
      escapeHtml(log.error ?? shortBody(log.response_body)),
    ]);
    return section("Recent proxy traffic", table(["At", "Provider", "Connection", "Method", "Target", "Status", "Result"], rows, "No proxy requests."));
  }

  function webhooksView(): string {
    const rows = ns()
      .webhookDeliveries.all()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((delivery) => [
        escapeHtml(delivery.created_at),
        escapeHtml(delivery.event),
        escapeHtml(delivery.provider_config_key),
        escapeHtml(delivery.connection_id ?? ""),
        linkCell(delivery.url, delivery.url),
        escapeHtml(delivery.response_status == null ? "ERR" : String(delivery.response_status)),
        escapeHtml(delivery.success ? "ok" : delivery.error ?? "failed"),
      ]);
    return section("Webhook deliveries", table(["At", "Event", "Provider", "Connection", "URL", "Status", "Result"], rows, "No webhook deliveries."));
  }
}

function section(title: string, body: string): string {
  return `<section class="inspector-section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function table(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `<p class="inspector-empty">${escapeHtml(empty)}</p>`;
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const rowHtml = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("\n");
  return `<table class="inspector-table"><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table>`;
}

function linkCell(href: string, label: string): string {
  return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
}

function mask(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function shortBody(value: string | null): string {
  if (!value) return "";
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}
