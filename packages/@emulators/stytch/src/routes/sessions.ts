import type { Context, RouteContext, AppEnv } from "@emulators/core";
import {
  clearSessionCookies,
  createSession,
  defaultCredentials,
  discoveredOrganizations,
  getSessionFromRequest,
  memberResponse,
  memberSessionResponse,
  organizationResponse,
  revokeSessionsForMember,
  touchSession,
  withSessionCookies,
} from "../helpers.js";
import { readJsonBody, requireServerAuth, stytchError, success } from "../route-helpers.js";
import { getStytchConfig, getStytchStore } from "../store.js";

export function sessionRoutes({ app, store }: RouteContext): void {
  const ss = getStytchStore(store);

  const authenticateHandler = async (c: Context<AppEnv>) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    return authenticateFromSession(c, body);
  };

  app.post("/v1/b2b/sessions/authenticate", authenticateHandler);
  app.post("/b2b/sessions/authenticate", authenticateHandler);

  const revokeHandler = async (c: Context<AppEnv>) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    return revokeSession(c, body);
  };

  app.post("/v1/b2b/sessions/revoke", revokeHandler);
  app.post("/b2b/sessions/revoke", revokeHandler);

  const exchangeHandler = async (c: Context<AppEnv>) => {
    const body = await readJsonBody<Record<string, unknown>>(c);
    const resolved = getSessionFromRequest(c, store, body);
    if (!resolved) return stytchError(c, 401, "session_not_found", "Session not found.");

    const organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
    const organization = ss.organizations.findOneBy("organization_id", organizationId);
    if (!organization) return stytchError(c, 404, "organization_not_found", "Organization not found.");

    const candidates = discoveredOrganizations(store, resolved.member.email_address);
    const target = candidates.find((candidate) => candidate.organization.organization_id === organization.organization_id);
    if (!target) {
      return stytchError(c, 404, "member_not_found", "Member does not belong to the requested organization.");
    }

    const next = await createSession(
      store,
      target.member,
      organization,
      typeof body.session_duration_minutes === "number" ? body.session_duration_minutes : 60 * 24 * 7,
      resolved.session.authentication_types,
      body.session_custom_claims && typeof body.session_custom_claims === "object"
        ? (body.session_custom_claims as Record<string, unknown>)
        : {},
    );

    const response = c.json(
      success({
        member_id: next.member.member_id,
        session_token: next.session.session_token,
        session_jwt: next.session.session_jwt,
        member: memberResponse(next.member),
        organization: organizationResponse(organization),
        member_authenticated: true,
        intermediate_session_token: "",
        member_session: memberSessionResponse(next.session),
      }),
    );
    return withSessionCookies(response, getStytchConfig(store) ?? defaultCredentials(), next.session);
  };

  app.post("/v1/b2b/sessions/exchange", exchangeHandler);
  app.post("/b2b/sessions/exchange", exchangeHandler);

  async function authenticateFromSession(c: Context<AppEnv>, body: Record<string, unknown>) {
    const resolved = getSessionFromRequest(c, store, body);
    if (!resolved) return stytchError(c, 401, "session_not_found", "Session not found.");

    const updatedSession = touchSession(store, resolved.session.id) ?? resolved.session;
    const response = c.json(
      success({
        member_session: memberSessionResponse(updatedSession),
        session_token: updatedSession.session_token,
        session_jwt: updatedSession.session_jwt,
        member: memberResponse(resolved.member),
        organization: organizationResponse(resolved.organization),
      }),
    );
    return withSessionCookies(response, getStytchConfig(store) ?? defaultCredentials(), updatedSession);
  }

  async function revokeSession(c: Context<AppEnv>, body: Record<string, unknown>) {
    const resolved = getSessionFromRequest(c, store, body);
    const memberId = typeof body.member_id === "string" ? body.member_id : "";
    const explicitSession =
      (typeof body.member_session_id === "string" ? ss.sessions.findOneBy("member_session_id", body.member_session_id) : undefined) ??
      (typeof body.session_token === "string" ? ss.sessions.findOneBy("session_token", body.session_token) : undefined) ??
      (typeof body.session_jwt === "string" ? ss.sessions.findOneBy("session_jwt", body.session_jwt) : undefined);
    const session = resolved?.session ?? explicitSession;

    if (memberId && !session) {
      const auth = requireServerAuth(c, store);
      if (auth !== true) return auth;
      revokeSessionsForMember(store, memberId);
      const response = c.json(success({ member_id: memberId }));
      return clearSessionCookies(response, getStytchConfig(store) ?? defaultCredentials());
    }

    if (!session) return stytchError(c, 401, "session_not_found", "Session not found.");

    ss.sessions.update(session.id, { revoked_at: new Date().toISOString() });
    const response = c.json(success({ member_id: session.member_id, member_session_id: session.member_session_id }));
    return clearSessionCookies(response, getStytchConfig(store) ?? defaultCredentials());
  }
}
