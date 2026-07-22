import { createHmac } from "node:crypto";
import type { Store } from "@emulators/core";
import { getFaireStore } from "./store.js";
import { makeFaireToken } from "./ids.js";

export async function dispatchFaireWebhook(
  store: Store,
  input: {
    brandId: string;
    event: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const fs = getFaireStore(store);
  const hooks = fs.webhooks
    .all()
    .filter((hook) => hook.enabled && hook.brand_id === input.brandId && (hook.events.includes("*") || hook.events.includes(input.event)));

  for (const hook of hooks) {
    const body = JSON.stringify(input.payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Faire-Webhook",
      "X-Faire-Event": input.event,
      "X-Faire-Delivery": makeFaireToken("delivery", 14),
      "X-Faire-Brand": input.brandId,
    };
    if (hook.secret) {
      headers["X-Faire-Signature-256"] = `sha256=${createHmac("sha256", hook.secret).update(body).digest("hex")}`;
    }

    let status: number | null = null;
    let success = false;
    let error: string | null = null;
    try {
      const response = await fetch(hook.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });
      status = response.status;
      success = response.ok;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    fs.webhookDeliveries.insert({
      delivery_id: makeFaireToken("delivery", 14),
      webhook_id: hook.webhook_id,
      event: input.event,
      url: hook.url,
      status,
      success,
      error,
      payload: input.payload,
      headers,
      delivered_at_api: new Date().toISOString(),
    });
  }
}
