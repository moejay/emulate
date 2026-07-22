import type { RouteContext } from "@emulators/core";
import {
  generateId,
  memberResponse,
  normalizeEmail,
  normalizeRoles,
  organizationResponse,
  revokeSessionsForMember,
} from "../helpers.js";
import { readJsonBody, requireServerAuth, stytchError, success } from "../route-helpers.js";
import { getStytchStore } from "../store.js";

export function memberRoutes({ app, store }: RouteContext): void {
  const ss = getStytchStore(store);

  app.post("/v1/b2b/organizations/:organizationRef/members", async (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const organizationRef = c.req.param("organizationRef");
    const organization =
      ss.organizations.findOneBy("organization_id", organizationRef) ??
      ss.organizations.findOneBy("organization_slug", organizationRef);
    if (!organization) return stytchError(c, 404, "organization_not_found", "Organization not found.");

    const body = await readJsonBody<Record<string, unknown>>(c);
    const emailAddress = typeof body.email_address === "string" ? normalizeEmail(body.email_address) : "";
    if (!emailAddress) return stytchError(c, 400, "missing_required_field", "email_address is required.");

    const duplicate = ss
      .members
      .findBy("organization_id", organization.organization_id)
      .find((member) => member.email_address === emailAddress || member.external_id === body.external_id);
    if (duplicate) {
      return stytchError(c, 409, "duplicate_member_email", "A member with that email already exists.");
    }

    const isAdmin = Boolean(body.is_admin) || (Array.isArray(body.roles) && body.roles.includes("stytch_admin"));
    const member = ss.members.insert({
      organization_id: organization.organization_id,
      member_id: typeof body.member_id === "string" && body.member_id.length > 0 ? body.member_id : generateId("member"),
      email_address: emailAddress,
      status: body.create_member_as_pending ? "pending" : "active",
      name: typeof body.name === "string" ? body.name : null,
      is_breakglass: Boolean(body.is_breakglass),
      member_password_id: typeof body.password === "string" && body.password.length > 0 ? generateId("member-password") : null,
      password: typeof body.password === "string" && body.password.length > 0 ? body.password : null,
      email_address_verified: !body.create_member_as_pending,
      mfa_phone_number_verified: false,
      is_admin: isAdmin,
      totp_registration_id: null,
      retired_email_addresses: [],
      is_locked: false,
      mfa_enrolled: Boolean(body.mfa_enrolled),
      mfa_phone_number: typeof body.mfa_phone_number === "string" ? body.mfa_phone_number : null,
      default_mfa_method: null,
      roles: normalizeRoles(Array.isArray(body.roles) ? body.roles.filter((value): value is string => typeof value === "string") : [], isAdmin),
      trusted_metadata:
        body.trusted_metadata && typeof body.trusted_metadata === "object"
          ? (body.trusted_metadata as Record<string, unknown>)
          : {},
      untrusted_metadata:
        body.untrusted_metadata && typeof body.untrusted_metadata === "object"
          ? (body.untrusted_metadata as Record<string, unknown>)
          : {},
      external_id: typeof body.external_id === "string" ? body.external_id : null,
      lock_created_at: null,
      lock_expires_at: null,
    });

    return c.json(success({ member_id: member.member_id, member: memberResponse(member), organization: organizationResponse(organization) }));
  });

  app.get("/v1/b2b/organizations/:organizationRef/member", (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const organizationRef = c.req.param("organizationRef");
    const organization =
      ss.organizations.findOneBy("organization_id", organizationRef) ??
      ss.organizations.findOneBy("organization_slug", organizationRef);
    if (!organization) return stytchError(c, 404, "organization_not_found", "Organization not found.");

    const memberId = c.req.query("member_id") ?? "";
    const emailAddress = c.req.query("email_address") ? normalizeEmail(c.req.query("email_address") as string) : "";

    const member = ss
      .members
      .findBy("organization_id", organization.organization_id)
      .find((entry) => (memberId ? entry.member_id === memberId || entry.external_id === memberId : entry.email_address === emailAddress));
    if (!member) return stytchError(c, 404, "member_not_found", "Member not found.");

    return c.json(success({ member_id: member.member_id, member: memberResponse(member), organization: organizationResponse(organization) }));
  });

  app.put("/v1/b2b/organizations/:organizationRef/members/:memberRef", async (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const organizationRef = c.req.param("organizationRef");
    const memberRef = c.req.param("memberRef");
    const organization =
      ss.organizations.findOneBy("organization_id", organizationRef) ??
      ss.organizations.findOneBy("organization_slug", organizationRef);
    if (!organization) return stytchError(c, 404, "organization_not_found", "Organization not found.");

    const member = ss
      .members
      .findBy("organization_id", organization.organization_id)
      .find((entry) => entry.member_id === memberRef || entry.external_id === memberRef);
    if (!member) return stytchError(c, 404, "member_not_found", "Member not found.");

    const body = await readJsonBody<Record<string, unknown>>(c);
    const nextEmail = typeof body.email_address === "string" ? normalizeEmail(body.email_address) : member.email_address;
    const duplicate = ss
      .members
      .findBy("organization_id", organization.organization_id)
      .find((entry) => entry.id !== member.id && entry.email_address === nextEmail);
    if (duplicate) return stytchError(c, 409, "duplicate_member_email", "A member with that email already exists.");

    const nextRoles = Array.isArray(body.roles)
      ? body.roles.filter((value): value is string => typeof value === "string")
      : member.roles;
    const nextIsAdmin = typeof body.is_admin === "boolean" ? body.is_admin : nextRoles.includes("stytch_admin") || member.is_admin;
    const updatedRoles = normalizeRoles(nextRoles, nextIsAdmin);

    ss.members.update(member.id, {
      email_address: nextEmail,
      name: typeof body.name === "string" ? body.name : member.name,
      roles: updatedRoles,
      is_admin: updatedRoles.includes("stytch_admin") || nextIsAdmin,
      status:
        body.status === "active" || body.status === "invited" || body.status === "pending"
          ? body.status
          : member.status,
      trusted_metadata:
        body.trusted_metadata && typeof body.trusted_metadata === "object"
          ? (body.trusted_metadata as Record<string, unknown>)
          : member.trusted_metadata,
      untrusted_metadata:
        body.untrusted_metadata && typeof body.untrusted_metadata === "object"
          ? (body.untrusted_metadata as Record<string, unknown>)
          : member.untrusted_metadata,
      mfa_phone_number: typeof body.mfa_phone_number === "string" ? body.mfa_phone_number : member.mfa_phone_number,
      external_id: typeof body.external_id === "string" ? body.external_id : member.external_id,
      member_password_id:
        typeof body.password === "string" && body.password.length > 0
          ? member.member_password_id ?? generateId("member-password")
          : member.member_password_id,
      password: typeof body.password === "string" && body.password.length > 0 ? body.password : member.password,
    });

    const fresh = ss.members.get(member.id)!;
    return c.json(success({ member_id: fresh.member_id, member: memberResponse(fresh), organization: organizationResponse(organization) }));
  });

  app.delete("/v1/b2b/organizations/:organizationRef/members/:memberRef", (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const organizationRef = c.req.param("organizationRef");
    const memberRef = c.req.param("memberRef");
    const organization =
      ss.organizations.findOneBy("organization_id", organizationRef) ??
      ss.organizations.findOneBy("organization_slug", organizationRef);
    if (!organization) return stytchError(c, 404, "organization_not_found", "Organization not found.");

    const member = ss
      .members
      .findBy("organization_id", organization.organization_id)
      .find((entry) => entry.member_id === memberRef || entry.external_id === memberRef);
    if (!member) return stytchError(c, 404, "member_not_found", "Member not found.");

    revokeSessionsForMember(store, member.member_id, organization.organization_id);
    for (const session of ss.sessions.findBy("member_id", member.member_id)) {
      if (session.organization_id === organization.organization_id) ss.sessions.delete(session.id);
    }
    ss.members.delete(member.id);

    return c.json(success({ member_id: member.member_id }));
  });

  app.post("/v1/b2b/organizations/members/search", async (c) => {
    const auth = requireServerAuth(c, store);
    if (auth !== true) return auth;

    const body = await readJsonBody<Record<string, unknown>>(c);
    const organizationIds = Array.isArray(body.organization_ids)
      ? body.organization_ids.filter((value): value is string => typeof value === "string")
      : [];
    const members = ss.members
      .all()
      .filter((member) => organizationIds.length === 0 || organizationIds.includes(member.organization_id))
      .sort((a, b) => a.email_address.localeCompare(b.email_address));

    const organizations = Object.fromEntries(
      ss.organizations
        .all()
        .filter((organization) => organizationIds.length === 0 || organizationIds.includes(organization.organization_id))
        .map((organization) => [organization.organization_id, organizationResponse(organization)]),
    );

    return c.json(
      success({
        members: members.map(memberResponse),
        organizations,
        results_metadata: { total: members.length, next_cursor: null },
      }),
    );
  });
}
