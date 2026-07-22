import type { RouteContext } from "@emulators/core";
import { generateId, jwksResponse, normalizeEmail, organizationResponse, slugify } from "../helpers.js";
import { stytchError, readJsonBody, requireServerAuth, success } from "../route-helpers.js";
import { getStytchConfig, getStytchStore } from "../store.js";

export function organizationRoutes({ app, store }: RouteContext): void {
  const ss = getStytchStore(store);

  app.post("/v1/b2b/organizations", async (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const body = await readJsonBody<Record<string, unknown>>(c);
    const organizationName = typeof body.organization_name === "string" ? body.organization_name.trim() : "";
    if (!organizationName) {
      return stytchError(c, 400, "missing_required_field", "organization_name is required.");
    }

    const organizationSlug =
      typeof body.organization_slug === "string" && body.organization_slug.trim().length > 0
        ? body.organization_slug.trim()
        : slugify(organizationName);

    if (ss.organizations.findOneBy("organization_slug", organizationSlug)) {
      return stytchError(c, 409, "organization_slug_in_use", "Organization slug already exists.");
    }

    const organization = ss.organizations.insert({
      organization_id:
        typeof body.organization_id === "string" && body.organization_id.trim().length > 0
          ? body.organization_id
          : generateId("organization"),
      organization_name: organizationName,
      organization_slug: organizationSlug,
      organization_logo_url:
        typeof body.organization_logo_url === "string" && body.organization_logo_url.length > 0
          ? body.organization_logo_url
          : null,
      trusted_metadata:
        body.trusted_metadata && typeof body.trusted_metadata === "object"
          ? (body.trusted_metadata as Record<string, unknown>)
          : {},
      sso_jit_provisioning: Boolean(body.sso_jit_provisioning),
      email_allowed_domains: Array.isArray(body.email_allowed_domains)
        ? body.email_allowed_domains.filter((value): value is string => typeof value === "string").map(normalizeEmail)
        : [],
    });

    return c.json(success({ organization: organizationResponse(organization) }));
  });

  app.get("/v1/b2b/organizations/:organizationRef", (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const organizationRef = c.req.param("organizationRef");
    const organization =
      ss.organizations.findOneBy("organization_id", organizationRef) ??
      ss.organizations.findOneBy("organization_slug", organizationRef);
    if (!organization) {
      return stytchError(c, 404, "organization_not_found", "Organization not found.");
    }

    return c.json(success({ organization: organizationResponse(organization) }));
  });

  app.put("/v1/b2b/organizations/:organizationRef", async (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const organizationRef = c.req.param("organizationRef");
    const organization =
      ss.organizations.findOneBy("organization_id", organizationRef) ??
      ss.organizations.findOneBy("organization_slug", organizationRef);
    if (!organization) {
      return stytchError(c, 404, "organization_not_found", "Organization not found.");
    }

    const body = await readJsonBody<Record<string, unknown>>(c);
    const nextSlug =
      typeof body.organization_slug === "string" && body.organization_slug.trim().length > 0
        ? body.organization_slug.trim()
        : organization.organization_slug;
    const existingSlug = ss.organizations.findOneBy("organization_slug", nextSlug);
    if (existingSlug && existingSlug.id !== organization.id) {
      return stytchError(c, 409, "organization_slug_in_use", "Organization slug already exists.");
    }

    ss.organizations.update(organization.id, {
      organization_name:
        typeof body.organization_name === "string" && body.organization_name.trim().length > 0
          ? body.organization_name.trim()
          : organization.organization_name,
      organization_slug: nextSlug,
      organization_logo_url:
        typeof body.organization_logo_url === "string"
          ? body.organization_logo_url || null
          : organization.organization_logo_url,
      trusted_metadata:
        body.trusted_metadata && typeof body.trusted_metadata === "object"
          ? (body.trusted_metadata as Record<string, unknown>)
          : organization.trusted_metadata,
      sso_jit_provisioning:
        typeof body.sso_jit_provisioning === "boolean"
          ? body.sso_jit_provisioning
          : organization.sso_jit_provisioning,
      email_allowed_domains: Array.isArray(body.email_allowed_domains)
        ? body.email_allowed_domains.filter((value): value is string => typeof value === "string").map(normalizeEmail)
        : organization.email_allowed_domains,
    });

    const updated = ss.organizations.get(organization.id)!;
    return c.json(success({ organization: organizationResponse(updated) }));
  });

  app.delete("/v1/b2b/organizations/:organizationRef", (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const organizationRef = c.req.param("organizationRef");
    const organization =
      ss.organizations.findOneBy("organization_id", organizationRef) ??
      ss.organizations.findOneBy("organization_slug", organizationRef);
    if (!organization) {
      return stytchError(c, 404, "organization_not_found", "Organization not found.");
    }

    for (const member of ss.members.findBy("organization_id", organization.organization_id)) {
      for (const session of ss.sessions.findBy("member_id", member.member_id)) {
        ss.sessions.delete(session.id);
      }
      ss.members.delete(member.id);
    }
    for (const authToken of ss.authTokens.findBy("organization_id", organization.organization_id)) {
      ss.authTokens.delete(authToken.id);
    }
    ss.organizations.delete(organization.id);

    return c.json(success({ organization_id: organization.organization_id }));
  });

  app.post("/v1/b2b/organizations/search", async (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const body = await readJsonBody<Record<string, unknown>>(c);
    const query = body.query && typeof body.query === "object" ? (body.query as Record<string, unknown>) : {};
    const operands = Array.isArray(query.operands) ? query.operands : [];

    let organizations = ss.organizations.all();

    for (const operand of operands) {
      if (!operand || typeof operand !== "object") continue;
      const filterName = (operand as Record<string, unknown>).filter_name;
      const filterValue = (operand as Record<string, unknown>).filter_value;

      if (filterName === "member_emails" && Array.isArray(filterValue)) {
        const emails = new Set(filterValue.filter((value): value is string => typeof value === "string").map(normalizeEmail));
        organizations = organizations.filter((organization) =>
          ss.members
            .findBy("organization_id", organization.organization_id)
            .some((member) => emails.has(member.email_address)),
        );
      }
    }

    organizations.sort((a, b) => a.organization_name.localeCompare(b.organization_name));

    return c.json(
      success({
        organizations: organizations.map(organizationResponse),
        results_metadata: {
          total: organizations.length,
          next_cursor: null,
        },
      }),
    );
  });

  app.get("/v1/b2b/sessions/jwks/:projectId", async (c) => {
    const projectId = c.req.param("projectId");
    const config = getStytchConfig(store);
    if (!config || projectId !== config.project_id) {
      return stytchError(c, 404, "project_not_found", "Project not found.");
    }
    return c.json({ ...(await jwksResponse()), request_id: "request-id-jwks", status_code: 200 });
  });

  app.get("/v1/b2b/sessions", (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const organizationId = c.req.query("organization_id") ?? "";
    const memberId = c.req.query("member_id") ?? "";
    const memberSessions = ss.sessions
      .all()
      .filter((session) => (!organizationId || session.organization_id === organizationId) && (!memberId || session.member_id === memberId))
      .map((session) => ({
        member_session_id: session.member_session_id,
        member_id: session.member_id,
        started_at: session.started_at,
        last_accessed_at: session.last_accessed_at,
        expires_at: session.expires_at,
        authentication_factors: session.authentication_types.map((type) => ({ type })),
        organization_id: session.organization_id,
        roles: session.roles,
        organization_slug: session.organization_slug,
      }));

    return c.json(success({ member_sessions: memberSessions }));
  });
}
