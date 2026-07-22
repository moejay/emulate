import type { Context, Store } from "@emulators/core";
import { getGadgetStore } from "./store.js";

export function applyGadgetApiKeyAuth(c: Context, store: Store): Response | undefined {
  const token = requestToken(c);
  if (!token) return unauthorized(c, "Missing Gadget API key.");

  const key = getGadgetStore(store).apiKeys.findOneBy("token", token);
  if (!key || !key.active) return unauthorized(c, "Invalid Gadget API key.");

  c.set("authToken", token);
  c.set("authScopes", ["gadget"]);
  c.set("authUser", {
    login: key.label,
    id: key.id,
    scopes: ["gadget"],
  });
  return undefined;
}

function requestToken(c: Context): string | undefined {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) return undefined;
  const token = authHeader.replace(/^(Bearer|token)\s+/i, "").trim();
  return token || undefined;
}

function unauthorized(c: Context, message: string): Response {
  return c.json(
    {
      errors: [{ message }],
    },
    401,
  );
}
