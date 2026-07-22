import { createHmac, randomBytes } from "node:crypto";

export function normalizeScopes(value: string[] | string | undefined, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value.map((scope) => scope.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }
  return [...fallback];
}

export function normalizeStringList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizeTopic(topic: string): string {
  if (topic.includes("/")) return topic.toLowerCase();
  const normalized = topic.toLowerCase();
  const lastUnderscore = normalized.lastIndexOf("_");
  if (lastUnderscore === -1) return normalized;
  return `${normalized.slice(0, lastUnderscore)}/${normalized.slice(lastUnderscore + 1)}`;
}

export function topicToEnum(topic: string): string {
  return normalizeTopic(topic).toUpperCase().replace(/\//g, "_");
}

export function numberFromGid(gidOrId: string | number): number {
  if (typeof gidOrId === "number") return gidOrId;
  const last = gidOrId.split("/").pop() ?? gidOrId;
  const parsed = parseInt(last, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ensureGid(type: string, value: string | number): string {
  if (typeof value === "string" && value.startsWith("gid://")) return value;
  const numeric = typeof value === "number" ? value : numberFromGid(value);
  return `gid://shopify/${type}/${numeric}`;
}

export function randomToken(prefix: string, bytes = 18): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

export function randomHex(bytes = 20): string {
  return randomBytes(bytes).toString("hex");
}

export function encodeCursor(kind: string, index: number): string {
  return Buffer.from(`${kind}:${index}`, "utf8").toString("base64");
}

export function decodeCursor(kind: string, cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const [cursorKind, rawIndex] = decoded.split(":");
    if (cursorKind !== kind) return 0;
    const parsed = parseInt(rawIndex ?? "0", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function paginateArray<T>(kind: string, items: T[], first = 50, after?: string | null) {
  const limit = Math.max(1, Math.min(250, first));
  const start = decodeCursor(kind, after);
  const sliced = items.slice(start, start + limit);
  const nextIndex = start + sliced.length;
  return {
    items: sliced,
    pageInfo: {
      hasNextPage: nextIndex < items.length,
      endCursor: nextIndex < items.length ? encodeCursor(kind, nextIndex) : sliced.length > 0 ? encodeCursor(kind, nextIndex) : null,
    },
  };
}

export function toIsoDate(value: string | undefined | null, fallback?: string): string {
  if (value) return new Date(value).toISOString();
  return fallback ?? new Date().toISOString();
}

export function todayMinusDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

export function normalizeMoney(value: string | number | null | undefined, fallback = "0.00"): string {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numeric)) return fallback;
  return numeric.toFixed(2);
}

export function parseSearchQuery(query: string | undefined | null): {
  updatedAtGte?: string;
  createdAtGte?: string;
  status?: string;
  vendor?: string;
  tag?: string;
  freeText: string[];
} {
  const text = (query ?? "").trim();
  const result: ReturnType<typeof parseSearchQuery> = { freeText: [] };
  if (!text) return result;

  const updatedMatch = text.match(/updated_at:>='([^']+)'/i);
  if (updatedMatch) result.updatedAtGte = updatedMatch[1];

  const createdMatch = text.match(/created_at:>='([^']+)'/i);
  if (createdMatch) result.createdAtGte = createdMatch[1];

  const statusMatch = text.match(/status:([^\s]+)/i);
  if (statusMatch) result.status = statusMatch[1]?.replace(/['"]/g, "").toLowerCase();

  const vendorMatch = text.match(/vendor:([^\s]+)/i);
  if (vendorMatch) result.vendor = vendorMatch[1]?.replace(/['"]/g, "");

  const tagMatch = text.match(/tag:([^\s]+)/i);
  if (tagMatch) result.tag = tagMatch[1]?.replace(/['"]/g, "");

  const stripped = text
    .replace(/updated_at:>='[^']+'/gi, " ")
    .replace(/created_at:>='[^']+'/gi, " ")
    .replace(/status:[^\s]+/gi, " ")
    .replace(/vendor:[^\s]+/gi, " ")
    .replace(/tag:[^\s]+/gi, " ")
    .trim();

  if (stripped) {
    result.freeText = stripped
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return result;
}

export function isoAtLeast(value: string, threshold: string | undefined): boolean {
  if (!threshold) return true;
  return new Date(value).getTime() >= new Date(threshold).getTime();
}

export function includesAllTerms(haystacks: Array<string | null | undefined>, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const flattened = haystacks
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => flattened.includes(term.toLowerCase()));
}

export function callbackHmac(secret: string, params: URLSearchParams): string {
  const entries = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b));
  const message = entries.map(([key, value]) => `${key}=${value}`).join("&");
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

export function webhookHmacBase64(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function encodeJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function signHs256Jwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = encodeJson(header);
  const encodedPayload = encodeJson(payload);
  const content = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(content, "utf8").digest("base64url");
  return `${content}.${signature}`;
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function verifyHs256Jwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const content = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret).update(content, "utf8").digest("base64url");
  if (expected !== parts[2]) return null;
  return decodeJwtPayload(token);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shopHost(shopDomain: string): string {
  return Buffer.from(`${shopDomain}/admin`, "utf8").toString("base64");
}

export function jwtId(): string {
  return base64url(randomBytes(18).toString("hex"));
}
