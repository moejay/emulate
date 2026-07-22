import type { Hono } from "@emulators/core";
import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import {
  createDefaultConfig,
  defaultCredentials,
  generateId,
  normalizeRoles,
  slugify,
} from "./helpers.js";
import { inspectorRoutes } from "./routes/inspector.js";
import { magicLinkRoutes } from "./routes/magic-links.js";
import { memberRoutes } from "./routes/members.js";
import { oauthRoutes } from "./routes/oauth.js";
import { organizationRoutes } from "./routes/organizations.js";
import { passwordRoutes } from "./routes/passwords.js";
import { sessionRoutes } from "./routes/sessions.js";
import { getGoogleIdentities, getStytchConfig, getStytchStore, setGoogleIdentities, setStytchConfig } from "./store.js";
import type { StytchCredentials, StytchGoogleIdentity, StytchSeedConfig } from "./entities.js";

export { getStytchStore, getStytchConfig, type StytchStore } from "./store.js";
export * from "./entities.js";

function seedDefaults(store: Store, baseUrl: string): void {
  if (getStytchConfig(store)) return;
  seedFromConfig(store, baseUrl, createDefaultConfig(baseUrl));
}

export function seedFromConfig(store: Store, _baseUrl: string, config: StytchSeedConfig): void {
  const ss = getStytchStore(store);
  const current = getStytchConfig(store) ?? defaultCredentials();
  const credentials: StytchCredentials = {
    ...current,
    ...(config.credentials ?? {}),
  };
  setStytchConfig(store, credentials);

  if (config.organizations) {
    for (const organizationCfg of config.organizations) {
      const organizationSlug = organizationCfg.organization_slug ?? slugify(organizationCfg.organization_name);
      let organization =
        (organizationCfg.organization_id
          ? ss.organizations.findOneBy("organization_id", organizationCfg.organization_id)
          : undefined) ?? ss.organizations.findOneBy("organization_slug", organizationSlug);

      if (!organization) {
        organization = ss.organizations.insert({
          organization_id: organizationCfg.organization_id ?? generateId("organization"),
          organization_name: organizationCfg.organization_name,
          organization_slug: organizationSlug,
          organization_logo_url: organizationCfg.organization_logo_url ?? null,
          trusted_metadata: organizationCfg.trusted_metadata ?? {},
          sso_jit_provisioning: organizationCfg.sso_jit_provisioning ?? false,
          email_allowed_domains: organizationCfg.email_allowed_domains?.map((value) => value.toLowerCase()) ?? [],
        });
      }

      for (const memberCfg of organizationCfg.members ?? []) {
        const emailAddress = memberCfg.email_address.trim().toLowerCase();
        const existing = ss
          .members
          .findBy("organization_id", organization.organization_id)
          .find((member) => member.email_address === emailAddress);
        if (existing) continue;

        const isAdmin = Boolean(memberCfg.is_admin) || (memberCfg.roles ?? []).includes("stytch_admin");
        ss.members.insert({
          organization_id: organization.organization_id,
          member_id: memberCfg.member_id ?? generateId("member"),
          email_address: emailAddress,
          status: memberCfg.status ?? "active",
          name: memberCfg.name ?? null,
          is_breakglass: false,
          member_password_id: memberCfg.password ? generateId("member-password") : null,
          password: memberCfg.password ?? null,
          email_address_verified: memberCfg.status !== "invited" && memberCfg.status !== "pending",
          mfa_phone_number_verified: false,
          is_admin: isAdmin,
          totp_registration_id: null,
          retired_email_addresses: [],
          is_locked: false,
          mfa_enrolled: false,
          mfa_phone_number: memberCfg.mfa_phone_number ?? null,
          default_mfa_method: null,
          roles: normalizeRoles(memberCfg.roles ?? [], isAdmin),
          trusted_metadata: memberCfg.trusted_metadata ?? {},
          untrusted_metadata: memberCfg.untrusted_metadata ?? {},
          external_id: memberCfg.external_id ?? null,
          lock_created_at: null,
          lock_expires_at: null,
        });
      }
    }
  }

  if (config.google_identities) {
    const merged = new Map<string, StytchGoogleIdentity>();
    for (const identity of [...getGoogleIdentities(store), ...config.google_identities]) {
      merged.set(identity.email_address.toLowerCase(), {
        email_address: identity.email_address.toLowerCase(),
        name: identity.name ?? null,
        picture_url: identity.picture_url ?? null,
        hosted_domain: identity.hosted_domain ?? identity.email_address.split("@")[1] ?? null,
      });
    }
    setGoogleIdentities(store, [...merged.values()].sort((a, b) => a.email_address.localeCompare(b.email_address)));
  }
}

export const stytchPlugin: ServicePlugin = {
  name: "stytch",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    inspectorRoutes(ctx);
    organizationRoutes(ctx);
    memberRoutes(ctx);
    sessionRoutes(ctx);
    passwordRoutes(ctx);
    magicLinkRoutes(ctx);
    oauthRoutes(ctx);
  },
  seed(store: Store, baseUrl: string): void {
    seedDefaults(store, baseUrl);
  },
};

export default stytchPlugin;
