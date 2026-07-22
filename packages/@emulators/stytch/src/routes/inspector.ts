import type { InspectorTab, RouteContext } from "@emulators/core";
import { escapeHtml, renderInspectorPage } from "@emulators/core";
import { deriveGoogleIdentities, discoveredOrganizations } from "../helpers.js";
import { getStytchConfig, getStytchStore } from "../store.js";

const SERVICE_LABEL = "Stytch";
const TABS: InspectorTab[] = [
  { id: "organizations", label: "Organizations", href: "/?tab=organizations" },
  { id: "members", label: "Members", href: "/?tab=members" },
  { id: "sessions", label: "Sessions", href: "/?tab=sessions" },
  { id: "auth", label: "Auth", href: "/?tab=auth" },
];

type TabId = (typeof TABS)[number]["id"];

export function inspectorRoutes({ app, store }: RouteContext): void {
  const ss = getStytchStore(store);

  app.get("/", (c) => {
    const requested = c.req.query("tab") ?? "organizations";
    const active = TABS.some((tab) => tab.id === requested) ? (requested as TabId) : "organizations";
    const body =
      active === "members"
        ? membersView()
        : active === "sessions"
          ? sessionsView()
          : active === "auth"
            ? authView()
            : organizationsView();
    return c.html(renderInspectorPage("Stytch Inspector", TABS, active, body, SERVICE_LABEL));
  });

  function organizationsView(): string {
    const rows = ss.organizations.all().map((organization) => [
      escapeHtml(organization.organization_name),
      escapeHtml(organization.organization_slug),
      escapeHtml(organization.organization_id),
      escapeHtml(String(ss.members.findBy("organization_id", organization.organization_id).length)),
      escapeHtml(organization.email_allowed_domains.join(", ")),
    ]);
    return section("Organizations", table(["Name", "Slug", "ID", "Members", "Allowed domains"], rows, "No organizations."));
  }

  function membersView(): string {
    const rows = ss.members.all().map((member) => {
      const org = ss.organizations.findOneBy("organization_id", member.organization_id);
      return [
        escapeHtml(member.email_address),
        escapeHtml(member.name ?? ""),
        escapeHtml(org?.organization_slug ?? member.organization_id),
        escapeHtml(member.status),
        escapeHtml(member.roles.join(", ") || "member"),
        escapeHtml(member.member_password_id ? "yes" : "no"),
      ];
    });
    return section("Members", table(["Email", "Name", "Organization", "Status", "Roles", "Password"], rows, "No members."));
  }

  function sessionsView(): string {
    const rows = ss.sessions
      .all()
      .slice()
      .reverse()
      .map((session) => {
        const member = ss.members.findOneBy("member_id", session.member_id);
        return [
          escapeHtml(session.member_session_id),
          escapeHtml(member?.email_address ?? session.member_id),
          escapeHtml(session.organization_slug),
          escapeHtml(session.authentication_types.join(", ")),
          escapeHtml(session.revoked_at ? "revoked" : "active"),
          escapeHtml(session.expires_at),
        ];
      });
    return section("Sessions", table(["Session", "Member", "Organization", "Factors", "Status", "Expires"], rows, "No sessions."));
  }

  function authView(): string {
    const credentials = getStytchConfig(store);
    const identities = deriveGoogleIdentities(store);
    const tokenRows = ss.authTokens
      .all()
      .slice()
      .reverse()
      .map((token) => [
        escapeHtml(token.token_type),
        escapeHtml(token.email_address),
        escapeHtml(token.organization_id ?? ""),
        escapeHtml(token.redirect_url ?? ""),
        escapeHtml(token.consumed_at ? "consumed" : "active"),
        escapeHtml(token.expires_at),
      ]);

    const identityRows = identities.map((identity) => [
      escapeHtml(identity.email_address),
      escapeHtml(identity.name ?? ""),
      escapeHtml(identity.hosted_domain ?? ""),
      escapeHtml(String(discoveredOrganizations(store, identity.email_address).length)),
    ]);

    const creds = credentials
      ? `<div class="inspector-section"><h2>Credentials</h2><table class="inspector-table"><tbody>
<tr><th>project_id</th><td>${escapeHtml(credentials.project_id)}</td></tr>
<tr><th>secret</th><td>${escapeHtml(credentials.secret)}</td></tr>
<tr><th>public_token</th><td>${escapeHtml(credentials.public_token)}</td></tr>
<tr><th>jwt cookie</th><td>${escapeHtml(credentials.jwt_cookie_name)}</td></tr>
<tr><th>session cookie</th><td>${escapeHtml(credentials.session_cookie_name)}</td></tr>
</tbody></table></div>`
      : "";

    return (
      creds +
      section("Google identities", table(["Email", "Name", "Hosted domain", "Discovered orgs"], identityRows, "No identities.")) +
      section("Auth tokens", table(["Type", "Email", "Organization", "Redirect URL", "Status", "Expires"], tokenRows, "No auth tokens."))
    );
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
