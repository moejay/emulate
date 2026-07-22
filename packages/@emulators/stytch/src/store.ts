import type { Collection, Store } from "@emulators/core";
import type {
  StytchAuthToken,
  StytchCredentials,
  StytchGoogleIdentity,
  StytchMember,
  StytchOrganization,
  StytchSession,
} from "./entities.js";

export interface StytchStore {
  organizations: Collection<StytchOrganization>;
  members: Collection<StytchMember>;
  sessions: Collection<StytchSession>;
  authTokens: Collection<StytchAuthToken>;
}

const CONFIG_KEY = "stytch.config";
const GOOGLE_IDENTITIES_KEY = "stytch.googleIdentities";

export function getStytchStore(store: Store): StytchStore {
  return {
    organizations: store.collection<StytchOrganization>("stytch.organizations", [
      "organization_id",
      "organization_slug",
    ]),
    members: store.collection<StytchMember>("stytch.members", [
      "organization_id",
      "member_id",
      "email_address",
      "external_id",
    ]),
    sessions: store.collection<StytchSession>("stytch.sessions", [
      "member_session_id",
      "session_token",
      "session_jwt",
      "member_id",
      "organization_id",
    ]),
    authTokens: store.collection<StytchAuthToken>("stytch.auth_tokens", [
      "token",
      "token_type",
      "email_address",
      "organization_id",
      "member_id",
    ]),
  };
}

export function getStytchConfig(store: Store): StytchCredentials | undefined {
  return store.getData<StytchCredentials>(CONFIG_KEY);
}

export function setStytchConfig(store: Store, config: StytchCredentials): void {
  store.setData(CONFIG_KEY, config);
}

export function getGoogleIdentities(store: Store): StytchGoogleIdentity[] {
  return store.getData<StytchGoogleIdentity[]>(GOOGLE_IDENTITIES_KEY) ?? [];
}

export function setGoogleIdentities(store: Store, identities: StytchGoogleIdentity[]): void {
  store.setData(GOOGLE_IDENTITIES_KEY, identities);
}
