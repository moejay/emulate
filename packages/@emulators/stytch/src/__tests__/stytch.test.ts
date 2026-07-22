import { beforeEach, describe, expect, it } from "vitest";
import { createServer, type Store } from "@emulators/core";
import { decodeJwt } from "jose";
import { getStytchStore, seedFromConfig, stytchPlugin } from "../index.js";
import type { AuthTokenType } from "../entities.js";

const base = "http://localhost:4015";

function basicAuthHeaders(): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from("project-test-opener:secret-test-opener").toString("base64")}`,
    "Content-Type": "application/json",
  };
}

function createTestServer() {
  const server = createServer(stytchPlugin, { baseUrl: base });
  seedFromConfig(server.store, base, {
    credentials: {
      project_id: "project-test-opener",
      secret: "secret-test-opener",
      public_token: "public-token-test-opener",
    },
    organizations: [
      {
        organization_id: "organization-acme",
        organization_name: "Acme Foods",
        organization_slug: "acme-foods",
        email_allowed_domains: ["acme.com"],
        members: [
          {
            member_id: "member-alice-acme",
            email_address: "alice@acme.com",
            name: "Alice Acme",
            password: "alice-password",
            roles: ["stytch_admin"],
            is_admin: true,
            status: "active",
          },
          {
            member_id: "member-bob-acme",
            email_address: "bob@acme.com",
            name: "Bob Buyer",
            status: "invited",
          },
        ],
      },
      {
        organization_id: "organization-beta",
        organization_name: "Beta Market",
        organization_slug: "beta-market",
        members: [
          {
            member_id: "member-alice-beta",
            email_address: "alice@acme.com",
            name: "Alice Acme",
            status: "active",
          },
        ],
      },
    ],
    google_identities: [
      {
        email_address: "alice@acme.com",
        name: "Alice Acme",
        picture_url: null,
        hosted_domain: "acme.com",
      },
      {
        email_address: "bob@acme.com",
        name: "Bob Buyer",
        picture_url: null,
        hosted_domain: "acme.com",
      },
    ],
  });
  return server;
}

function getSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [];
}

function getCookieHeader(response: Response): string {
  return getSetCookies(response)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function findAuthToken(store: Store, type: AuthTokenType, email?: string): string {
  const token = getStytchStore(store)
    .authTokens
    .all()
    .find((entry) => entry.token_type === type && (!email || entry.email_address === email) && !entry.consumed_at);
  expect(token).toBeDefined();
  return token!.token;
}

describe("Stytch emulator", () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer();
  });

  it("supports organization search and CRUD", async () => {
    const searchRes = await server.app.request(`${base}/v1/b2b/organizations/search`, {
      method: "POST",
      headers: basicAuthHeaders(),
      body: JSON.stringify({
        query: {
          operator: "AND",
          operands: [{ filter_name: "member_emails", filter_value: ["alice@acme.com"] }],
        },
      }),
    });
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as {
      organizations: Array<{ organization_id: string }>;
      results_metadata: { total: number };
    };
    expect(searchBody.results_metadata.total).toBe(2);

    const createRes = await server.app.request(`${base}/v1/b2b/organizations`, {
      method: "POST",
      headers: basicAuthHeaders(),
      body: JSON.stringify({ organization_name: "Gamma Goods", organization_slug: "gamma-goods" }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { organization: { organization_id: string; organization_slug: string } };
    expect(created.organization.organization_slug).toBe("gamma-goods");

    const getRes = await server.app.request(`${base}/v1/b2b/organizations/gamma-goods`, {
      headers: basicAuthHeaders(),
    });
    expect(getRes.status).toBe(200);

    const updateRes = await server.app.request(`${base}/v1/b2b/organizations/${created.organization.organization_id}`, {
      method: "PUT",
      headers: basicAuthHeaders(),
      body: JSON.stringify({ organization_name: "Gamma Goods Updated" }),
    });
    expect(updateRes.status).toBe(200);
    expect(((await updateRes.json()) as { organization: { organization_name: string } }).organization.organization_name).toBe(
      "Gamma Goods Updated",
    );
  });

  it("supports member CRUD and search", async () => {
    const getRes = await server.app.request(
      `${base}/v1/b2b/organizations/organization-acme/member?email_address=${encodeURIComponent("alice@acme.com")}`,
      { headers: basicAuthHeaders() },
    );
    expect(getRes.status).toBe(200);
    const memberBody = (await getRes.json()) as { member: { member_id: string; is_admin: boolean } };
    expect(memberBody.member.member_id).toBe("member-alice-acme");
    expect(memberBody.member.is_admin).toBe(true);

    const createRes = await server.app.request(`${base}/v1/b2b/organizations/organization-acme/members`, {
      method: "POST",
      headers: basicAuthHeaders(),
      body: JSON.stringify({
        email_address: "carol@acme.com",
        name: "Carol Channel",
        create_member_as_pending: true,
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { member: { member_id: string; status: string } };
    expect(created.member.status).toBe("pending");

    const updateRes = await server.app.request(
      `${base}/v1/b2b/organizations/organization-acme/members/${created.member.member_id}`,
      {
        method: "PUT",
        headers: basicAuthHeaders(),
        body: JSON.stringify({ roles: ["stytch_admin"], is_admin: true, status: "active" }),
      },
    );
    expect(updateRes.status).toBe(200);
    expect(((await updateRes.json()) as { member: { is_admin: boolean; roles: Array<{ role_id: string }> } }).member.is_admin).toBe(
      true,
    );

    const searchRes = await server.app.request(`${base}/v1/b2b/organizations/members/search`, {
      method: "POST",
      headers: basicAuthHeaders(),
      body: JSON.stringify({ organization_ids: ["organization-acme"] }),
    });
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as { members: unknown[]; results_metadata: { total: number } };
    expect(searchBody.results_metadata.total).toBeGreaterThanOrEqual(3);

    const deleteRes = await server.app.request(
      `${base}/v1/b2b/organizations/organization-acme/members/${created.member.member_id}`,
      {
        method: "DELETE",
        headers: basicAuthHeaders(),
      },
    );
    expect(deleteRes.status).toBe(200);
  });

  it("authenticates password sessions and authenticates them again with the server SDK", async () => {
    const authRes = await server.app.request(`${base}/v1/b2b/passwords/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: "organization-acme",
        email_address: "alice@acme.com",
        password: "alice-password",
        session_duration_minutes: 120,
      }),
    });
    expect(authRes.status).toBe(200);
    const authBody = (await authRes.json()) as {
      session_jwt: string;
      member_session: { member_session_id: string };
    };
    const claims = decodeJwt(authBody.session_jwt);
    expect(claims.sub).toBe("member-alice-acme");
    expect(claims.organization_id).toBe("organization-acme");

    const sessionRes = await server.app.request(`${base}/v1/b2b/sessions/authenticate`, {
      method: "POST",
      headers: basicAuthHeaders(),
      body: JSON.stringify({ session_jwt: authBody.session_jwt }),
    });
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as { member_session: { member_session_id: string } };
    expect(sessionBody.member_session.member_session_id).toBe(authBody.member_session.member_session_id);
  });

  it("creates password reset tokens and completes the reset flow", async () => {
    const startRes = await server.app.request(`${base}/v1/b2b/passwords/email/reset/start`, {
      method: "POST",
      headers: basicAuthHeaders(),
      body: JSON.stringify({
        organization_id: "organization-acme",
        email_address: "bob@acme.com",
        reset_password_redirect_url: "http://localhost:3000/reset-password",
      }),
    });
    expect(startRes.status).toBe(200);

    const token = findAuthToken(server.store, "multi_tenant_passwords", "bob@acme.com");
    const resetRes = await server.app.request(`${base}/v1/b2b/passwords/email/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password_reset_token: token, password: "bob-password", session_duration_minutes: 30 }),
    });
    expect(resetRes.status).toBe(200);
    const resetBody = (await resetRes.json()) as { member: { status: string; member_password_id: string } };
    expect(resetBody.member.status).toBe("active");
    expect(resetBody.member.member_password_id).toBeTruthy();

    const loginRes = await server.app.request(`${base}/v1/b2b/passwords/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: "organization-acme", email_address: "bob@acme.com", password: "bob-password" }),
    });
    expect(loginRes.status).toBe(200);
  });

  it("sends and authenticates invite magic links", async () => {
    const inviteRes = await server.app.request(`${base}/v1/b2b/magic_links/email/invite`, {
      method: "POST",
      headers: basicAuthHeaders(),
      body: JSON.stringify({
        organization_id: "organization-acme",
        email_address: "newhire@acme.com",
        invite_redirect_url: "http://localhost:3000/authenticate",
      }),
    });
    expect(inviteRes.status).toBe(200);

    const token = findAuthToken(server.store, "multi_tenant_magic_links", "newhire@acme.com");
    const authRes = await server.app.request(`${base}/b2b/magic_links/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ magic_links_token: token, session_duration_minutes: 45 }),
    });
    expect(authRes.status).toBe(200);
    const authBody = (await authRes.json()) as { member: { status: string } };
    expect(authBody.member.status).toBe("active");
  });

  it("supports discovery magic links and intermediate session exchange", async () => {
    const sendRes = await server.app.request(`${base}/v1/b2b/magic_links/email/discovery/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_address: "alice@acme.com", discovery_redirect_url: "http://localhost:3000/authenticate" }),
    });
    expect(sendRes.status).toBe(200);

    const token = findAuthToken(server.store, "discovery", "alice@acme.com");
    const authRes = await server.app.request(`${base}/v1/b2b/magic_links/discovery/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discovery_magic_links_token: token }),
    });
    expect(authRes.status).toBe(200);
    const authBody = (await authRes.json()) as {
      intermediate_session_token: string;
      discovered_organizations: Array<{ organization: { organization_id: string } }>;
    };
    expect(authBody.discovered_organizations).toHaveLength(2);

    const exchangeRes = await server.app.request(`${base}/v1/b2b/discovery/intermediate_sessions/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intermediate_session_token: authBody.intermediate_session_token,
        organization_id: "organization-beta",
        session_duration_minutes: 30,
      }),
    });
    expect(exchangeRes.status).toBe(200);
    const exchangeBody = (await exchangeRes.json()) as { organization: { organization_id: string } };
    expect(exchangeBody.organization.organization_id).toBe("organization-beta");
  });

  it("supports google discovery start and discovery authenticate", async () => {
    const startRes = await server.app.request(
      `${base}/v1/b2b/public/oauth/google/discovery/start?public_token=public-token-test-opener&discovery_redirect_url=${encodeURIComponent("http://localhost:3000/authenticate")}`,
    );
    expect(startRes.status).toBe(200);
    const html = await startRes.text();
    expect(html).toContain("alice@acme.com");
    expect(html).toContain("Continue with Google");

    const callbackRes = await server.app.request(`${base}/v1/b2b/public/oauth/google/discovery/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email_address: "alice@acme.com",
        discovery_redirect_url: "http://localhost:3000/authenticate",
      }).toString(),
    });
    expect(callbackRes.status).toBe(302);
    const redirect = new URL(callbackRes.headers.get("location")!);
    expect(redirect.searchParams.get("stytch_token_type")).toBe("discovery_oauth");

    const authRes = await server.app.request(`${base}/v1/b2b/oauth/discovery/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discovery_oauth_token: redirect.searchParams.get("token") }),
    });
    expect(authRes.status).toBe(200);
    const authBody = (await authRes.json()) as {
      provider_type: string;
      discovered_organizations: unknown[];
    };
    expect(authBody.provider_type).toBe("google");
    expect(authBody.discovered_organizations).toHaveLength(2);
  });

  it("supports session exchange and revokes only the addressed session", async () => {
    const authRes = await server.app.request(`${base}/v1/b2b/passwords/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: "organization-acme", email_address: "alice@acme.com", password: "alice-password" }),
    });
    expect(authRes.status).toBe(200);
    const authBody = (await authRes.json()) as { session_jwt: string };
    const cookieHeader = getCookieHeader(authRes);

    const secondSessionRes = await server.app.request(`${base}/v1/b2b/passwords/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: "organization-acme", email_address: "alice@acme.com", password: "alice-password" }),
    });
    expect(secondSessionRes.status).toBe(200);
    const secondSessionBody = (await secondSessionRes.json()) as { session_jwt: string };

    const exchangeRes = await server.app.request(`${base}/v1/b2b/sessions/exchange`, {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ organization_id: "organization-beta", session_duration_minutes: 15 }),
    });
    expect(exchangeRes.status).toBe(200);
    const exchangeBody = (await exchangeRes.json()) as { organization: { organization_id: string } };
    expect(exchangeBody.organization.organization_id).toBe("organization-beta");

    const revokeRes = await server.app.request(`${base}/v1/b2b/sessions/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_jwt: authBody.session_jwt }),
    });
    expect(revokeRes.status).toBe(200);

    const failedAuthRes = await server.app.request(`${base}/v1/b2b/sessions/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_jwt: authBody.session_jwt }),
    });
    expect(failedAuthRes.status).toBe(401);

    const otherSessionRes = await server.app.request(`${base}/v1/b2b/sessions/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_jwt: secondSessionBody.session_jwt }),
    });
    expect(otherSessionRes.status).toBe(200);
  });

  it("renders the inspector", async () => {
    const res = await server.app.request(`${base}/?tab=auth`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Stytch Inspector");
    expect(html).toContain("public-token-test-opener");
  });
});
