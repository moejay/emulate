import { randomBytes } from "crypto";
import type { ContentfulStatusCode, Context, Store } from "@emulators/core";
import type {
  QBOCompanyInfo,
  QBOCustomer,
  QBOInvoice,
  QBOInvoiceLine,
  QBOItem,
  QBOMetaData,
  QBOPayment,
  QBOPhysicalAddress,
  QBORef,
  QBOSalesReceipt,
  QBOVendor,
  QuickBooksAccessTokenRecord,
  QuickBooksCompanyRecord,
  QuickBooksResourceName,
  QuickBooksScope,
} from "./entities.js";
import { getQuickBooksStore } from "./store.js";

export const SERVICE_LABEL = "QuickBooks";
export const DEFAULT_REALM_ID = "9130355372279406";
export const DEFAULT_COMPANY_NAME = "Emulate Sample Co";
export const DEFAULT_ACCESS_TOKEN = "qbo_access_emulate";
export const DEFAULT_REFRESH_TOKEN = "qbo_refresh_emulate";
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 100 * 24 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SCOPES: QuickBooksScope[] = ["com.intuit.quickbooks.accounting"];

export interface PendingAuthCode {
  client_id: string;
  redirect_uri: string;
  scope: QuickBooksScope[];
  state: string;
  realm_id: string;
  user_email: string;
  created_at: number;
}

export interface QuickBooksSeedConfig {
  port?: number;
  users?: Array<{
    email: string;
    name?: string;
    realm_ids?: string[];
  }>;
  oauth_apps?: Array<{
    client_id: string;
    client_secret: string;
    name?: string;
    redirect_uris: string[];
    scopes?: QuickBooksScope[] | string[] | string;
  }>;
  companies?: Array<{
    realm_id?: string;
    company_name: string;
    legal_name?: string;
    country?: string;
    email?: string;
    phone?: string;
    company_addr?: QBOPhysicalAddress;
    customers?: QBOCustomer[];
    vendors?: QBOVendor[];
    items?: QBOItem[];
    invoices?: QBOInvoice[];
    sales_receipts?: QBOSalesReceipt[];
    payments?: QBOPayment[];
    tokens?: Array<{
      access_token?: string;
      refresh_token?: string;
      user?: string;
      scopes?: QuickBooksScope[] | string[] | string;
    }>;
  }>;
  tokens?: Array<{
    access_token?: string;
    refresh_token?: string;
    realm_id: string;
    user: string;
    client_id?: string;
    scopes?: QuickBooksScope[] | string[] | string;
  }>;
}

export type QueryOperator = "=" | ">=" | "<=" | ">" | "<" | "IN";

export interface ParsedCondition {
  field: string;
  operator: QueryOperator;
  value: string | number | boolean | Array<string | number | boolean>;
}

export interface ParsedQuery {
  entity: QuickBooksResourceName;
  select: "*" | "COUNT(*)";
  startPosition: number;
  maxResults: number;
  conditions: ParsedCondition[];
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function qboError(
  c: Context,
  status: number,
  message: string,
  detail = message,
  code = "4000",
  type = "ValidationFault",
) {
  return c.json(
    {
      Fault: {
        Error: [
          {
            Message: message,
            Detail: detail,
            code,
          },
        ],
        type,
      },
      time: nowIso(),
    },
    status as ContentfulStatusCode,
  );
}

export function parseScopes(value: QuickBooksScope[] | string[] | string | undefined): QuickBooksScope[] {
  if (Array.isArray(value)) {
    return value
      .map((scope) => scope.trim())
      .filter(Boolean) as QuickBooksScope[];
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean) as QuickBooksScope[];
  }
  return [...DEFAULT_SCOPES];
}

export function getPendingCodes(store: Store): Map<string, PendingAuthCode> {
  let map = store.getData<Map<string, PendingAuthCode>>("quickbooks.oauth.pendingCodes");
  if (!map) {
    map = new Map();
    store.setData("quickbooks.oauth.pendingCodes", map);
  }
  return map;
}

export function getPendingCode(store: Store, code: string): PendingAuthCode | undefined {
  const map = getPendingCodes(store);
  const pending = map.get(code);
  if (!pending) return undefined;
  if (Date.now() - pending.created_at > AUTH_CODE_TTL_MS) {
    map.delete(code);
    return undefined;
  }
  return pending;
}

function counterKey(realmId: string, entity: string): string {
  return `quickbooks.counter.${realmId}.${entity}`;
}

export function nextRealmScopedId(store: Store, realmId: string, entity: string): string {
  const key = counterKey(realmId, entity);
  const next = (store.getData<number>(key) ?? 1) as number;
  store.setData(key, next + 1);
  return String(next);
}

export function makeMetaData(existing?: QBOMetaData): QBOMetaData {
  const now = nowIso();
  return {
    CreateTime: existing?.CreateTime ?? now,
    LastUpdatedTime: now,
  };
}

export function nextSyncToken(current?: string): string {
  const parsed = Number(current ?? "0");
  return String(Number.isFinite(parsed) ? parsed + 1 : 1);
}

export function createAccessTokenValue(): string {
  return `qbo_access_${randomBytes(18).toString("base64url")}`;
}

export function createRefreshTokenValue(): string {
  return `qbo_refresh_${randomBytes(18).toString("base64url")}`;
}

export function createAuthCodeValue(): string {
  return `qbo_code_${randomBytes(16).toString("hex")}`;
}

export function parseBearerToken(c: Context): string | undefined {
  const authHeader = c.req.header("Authorization") ?? "";
  if (!authHeader) return undefined;
  const match = authHeader.match(/^(Bearer|token)\s+(.+)$/i);
  return match?.[2]?.trim() || undefined;
}

function parseBasicAuth(c: Context): { clientId: string; clientSecret: string } | null {
  const authHeader = c.req.header("Authorization") ?? "";
  const match = authHeader.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx === -1) return null;
    return {
      clientId: decoded.slice(0, idx),
      clientSecret: decoded.slice(idx + 1),
    };
  } catch {
    return null;
  }
}

export function findAccessToken(store: Store, token: string | undefined): QuickBooksAccessTokenRecord | undefined {
  if (!token) return undefined;
  const record = getQuickBooksStore(store).accessTokens.findOneBy("token", token);
  if (!record || record.revoked) return undefined;
  if (record.expires_at < Date.now()) return undefined;
  return record;
}

export function requireQuickBooksAuth(c: Context, store: Store, realmId: string): QuickBooksAccessTokenRecord | Response {
  const token = c.get("authToken") ?? parseBearerToken(c);
  const access = findAccessToken(store, typeof token === "string" ? token : undefined);
  if (!access) {
    return qboError(c, 401, "AuthenticationFailed", "A valid QuickBooks bearer token is required.", "3200", "AuthenticationFault");
  }
  if (access.realm_id !== realmId) {
    return qboError(c, 403, "RealmAccessDenied", `Token cannot access realm '${realmId}'.`, "3200", "AuthenticationFault");
  }
  return access;
}

export async function parseQuickBooksBody(c: Context): Promise<Record<string, unknown>> {
  const contentType = c.req.header("Content-Type") ?? "";
  const rawText = await c.req.text();
  if (!rawText) return {};

  if (contentType.includes("application/json") || contentType.includes("application/text") || contentType.includes("text/plain")) {
    try {
      const parsed = JSON.parse(rawText);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      if (contentType.includes("text/plain") || contentType.includes("application/text")) {
        return { query: rawText.trim() };
      }
      return {};
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(rawText));
  }

  return {};
}

export function validateClientCredentials(store: Store, c: Context, body: Record<string, unknown>): boolean {
  const qs = getQuickBooksStore(store);
  if (qs.oauthApps.all().length === 0) return true;

  const basic = parseBasicAuth(c);
  const clientId = basic?.clientId ?? String(body.client_id ?? "");
  const clientSecret = basic?.clientSecret ?? String(body.client_secret ?? "");
  const app = qs.oauthApps.findOneBy("client_id", clientId);
  return Boolean(app && app.client_secret === clientSecret);
}

export function resolveClientId(c: Context, body: Record<string, unknown>): string {
  const basic = parseBasicAuth(c);
  return basic?.clientId ?? String(body.client_id ?? "");
}

export function matchesRedirectUri(requested: string, allowed: string[]): boolean {
  return allowed.includes(requested);
}

function sanitizeObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeObject);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "sparse" || key === "domain") continue;
    out[key] = sanitizeObject(child);
  }
  return out;
}

export function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (Array.isArray(base) || Array.isArray(patch)) return patch as T;
  if (!base || typeof base !== "object") return patch as T;
  if (!patch || typeof patch !== "object") return patch as T;

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = result[key];
    if (
      value &&
      current &&
      typeof value === "object" &&
      typeof current === "object" &&
      !Array.isArray(value) &&
      !Array.isArray(current)
    ) {
      result[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

export function ensureDisplayName(payload: Partial<QBOCustomer> | Partial<QBOVendor>, fallback: string): string {
  return payload.DisplayName ?? payload.CompanyName ?? ([payload.GivenName, payload.FamilyName].filter(Boolean).join(" ") || fallback);
}

export function ensureCompanyPayload(realmId: string, input: Partial<QBOCompanyInfo>): QBOCompanyInfo {
  const companyName = input.CompanyName ?? input.LegalName ?? DEFAULT_COMPANY_NAME;
  return {
    CompanyName: companyName,
    ...(input.LegalName ? { LegalName: input.LegalName } : {}),
    ...(input.CompanyAddr ? { CompanyAddr: input.CompanyAddr } : {}),
    ...(input.CustomerCommunicationAddr ? { CustomerCommunicationAddr: input.CustomerCommunicationAddr } : {}),
    ...(input.LegalAddr ? { LegalAddr: input.LegalAddr } : {}),
    ...(input.CustomerCommunicationEmailAddr ? { CustomerCommunicationEmailAddr: input.CustomerCommunicationEmailAddr } : {}),
    ...(input.Email ? { Email: input.Email } : {}),
    ...(input.PrimaryPhone ? { PrimaryPhone: input.PrimaryPhone } : {}),
    ...(input.CompanyStartDate ? { CompanyStartDate: input.CompanyStartDate } : {}),
    ...(input.Country ? { Country: input.Country } : {}),
    ...(input.NameValue ? { NameValue: input.NameValue } : {}),
    ...(input.WebAddr ? { WebAddr: input.WebAddr } : {}),
    MetaData: makeMetaData(input.MetaData),
    SyncToken: input.SyncToken ?? "0",
    Id: input.Id ?? realmId,
  };
}

function sumLineAmounts(lines: QBOInvoiceLine[] | undefined): number {
  return (lines ?? []).reduce((sum, line) => sum + Number(line.Amount ?? 0), 0);
}

function normalizeLine(line: QBOInvoiceLine, idx: number): QBOInvoiceLine {
  const detail = line.SalesItemLineDetail;
  const amount =
    line.Amount ??
    ((detail?.Qty ?? 1) * (detail?.UnitPrice ?? 0));
  return {
    ...line,
    Id: line.Id ?? String(idx + 1),
    LineNum: line.LineNum ?? idx + 1,
    Amount: amount,
  };
}

export function ensureCustomerPayload(store: Store, realmId: string, input: Partial<QBOCustomer>): QBOCustomer {
  const id = input.Id ?? nextRealmScopedId(store, realmId, "customer");
  return {
    Id: id,
    DisplayName: ensureDisplayName(input, `Customer ${id}`),
    ...(input.CompanyName ? { CompanyName: input.CompanyName } : {}),
    ...(input.GivenName ? { GivenName: input.GivenName } : {}),
    ...(input.FamilyName ? { FamilyName: input.FamilyName } : {}),
    ...(input.Title ? { Title: input.Title } : {}),
    ...(input.BillAddr ? { BillAddr: input.BillAddr } : {}),
    ...(input.ShipAddr ? { ShipAddr: input.ShipAddr } : {}),
    ...(input.PrimaryPhone ? { PrimaryPhone: input.PrimaryPhone } : {}),
    ...(input.Mobile ? { Mobile: input.Mobile } : {}),
    ...(input.PrimaryEmailAddr ? { PrimaryEmailAddr: input.PrimaryEmailAddr } : {}),
    ...(input.Notes ? { Notes: input.Notes } : {}),
    Active: input.Active ?? true,
    ...(input.Balance != null ? { Balance: input.Balance } : {}),
    ...(input.BalanceWithJobs != null ? { BalanceWithJobs: input.BalanceWithJobs } : {}),
    ...(input.PreferredDeliveryMethod ? { PreferredDeliveryMethod: input.PreferredDeliveryMethod } : {}),
    MetaData: makeMetaData(input.MetaData),
    SyncToken: input.SyncToken ?? "0",
  };
}

export function ensureVendorPayload(store: Store, realmId: string, input: Partial<QBOVendor>): QBOVendor {
  const id = input.Id ?? nextRealmScopedId(store, realmId, "vendor");
  return {
    Id: id,
    DisplayName: ensureDisplayName(input, `Vendor ${id}`),
    ...(input.CompanyName ? { CompanyName: input.CompanyName } : {}),
    ...(input.GivenName ? { GivenName: input.GivenName } : {}),
    ...(input.FamilyName ? { FamilyName: input.FamilyName } : {}),
    Active: input.Active ?? true,
    ...(input.PrimaryPhone ? { PrimaryPhone: input.PrimaryPhone } : {}),
    ...(input.Mobile ? { Mobile: input.Mobile } : {}),
    ...(input.PrimaryEmailAddr ? { PrimaryEmailAddr: input.PrimaryEmailAddr } : {}),
    ...(input.BillAddr ? { BillAddr: input.BillAddr } : {}),
    ...(input.Balance != null ? { Balance: input.Balance } : {}),
    ...(input.Vendor1099 != null ? { Vendor1099: input.Vendor1099 } : {}),
    ...(input.PrintOnCheckName ? { PrintOnCheckName: input.PrintOnCheckName } : {}),
    MetaData: makeMetaData(input.MetaData),
    SyncToken: input.SyncToken ?? "0",
  };
}

export function ensureItemPayload(store: Store, realmId: string, input: Partial<QBOItem>): QBOItem {
  const id = input.Id ?? nextRealmScopedId(store, realmId, "item");
  return {
    Id: id,
    Name: input.Name ?? `Item ${id}`,
    ...(input.FullyQualifiedName ? { FullyQualifiedName: input.FullyQualifiedName } : {}),
    ...(input.Sku ? { Sku: input.Sku } : {}),
    Type: input.Type ?? "NonInventory",
    ...(input.Description ? { Description: input.Description } : {}),
    Active: input.Active ?? true,
    ...(input.UnitPrice != null ? { UnitPrice: input.UnitPrice } : {}),
    ...(input.PurchaseCost != null ? { PurchaseCost: input.PurchaseCost } : {}),
    ...(input.QtyOnHand != null ? { QtyOnHand: input.QtyOnHand } : {}),
    ...(input.TrackQtyOnHand != null ? { TrackQtyOnHand: input.TrackQtyOnHand } : {}),
    ...(input.IncomeAccountRef ? { IncomeAccountRef: input.IncomeAccountRef } : {}),
    ...(input.ExpenseAccountRef ? { ExpenseAccountRef: input.ExpenseAccountRef } : {}),
    ...(input.AssetAccountRef ? { AssetAccountRef: input.AssetAccountRef } : {}),
    MetaData: makeMetaData(input.MetaData),
    SyncToken: input.SyncToken ?? "0",
  };
}

export function ensureInvoicePayload(store: Store, realmId: string, input: Partial<QBOInvoice>): QBOInvoice {
  const id = input.Id ?? nextRealmScopedId(store, realmId, "invoice");
  const lines = (input.Line ?? []).map((line, idx) => normalizeLine(line, idx));
  return {
    Id: id,
    ...(input.DocNumber ? { DocNumber: input.DocNumber } : {}),
    TxnDate: input.TxnDate ?? nowIso().slice(0, 10),
    ...(input.DueDate ? { DueDate: input.DueDate } : {}),
    CustomerRef: input.CustomerRef ?? { value: "1", name: "Default Customer" },
    ...(input.CurrencyRef ? { CurrencyRef: input.CurrencyRef } : {}),
    ...(input.ShipAddr ? { ShipAddr: input.ShipAddr } : {}),
    Line: lines,
    TotalAmt: input.TotalAmt ?? sumLineAmounts(lines),
    ...(input.Balance != null ? { Balance: input.Balance } : {}),
    ...(input.TxnTaxDetail ? { TxnTaxDetail: input.TxnTaxDetail } : {}),
    ...(input.EmailStatus ? { EmailStatus: input.EmailStatus } : {}),
    ...(input.PrivateNote ? { PrivateNote: input.PrivateNote } : {}),
    ...(input.CustomerMemo ? { CustomerMemo: input.CustomerMemo } : {}),
    MetaData: makeMetaData(input.MetaData),
    SyncToken: input.SyncToken ?? "0",
  };
}

export function ensureSalesReceiptPayload(store: Store, realmId: string, input: Partial<QBOSalesReceipt>): QBOSalesReceipt {
  const id = input.Id ?? nextRealmScopedId(store, realmId, "salesreceipt");
  const lines = (input.Line ?? []).map((line, idx) => normalizeLine(line, idx));
  return {
    Id: id,
    ...(input.DocNumber ? { DocNumber: input.DocNumber } : {}),
    TxnDate: input.TxnDate ?? nowIso().slice(0, 10),
    CustomerRef: input.CustomerRef ?? { value: "1", name: "Default Customer" },
    ...(input.CurrencyRef ? { CurrencyRef: input.CurrencyRef } : {}),
    ...(input.ShipAddr ? { ShipAddr: input.ShipAddr } : {}),
    Line: lines,
    TotalAmt: input.TotalAmt ?? sumLineAmounts(lines),
    ...(input.PrivateNote ? { PrivateNote: input.PrivateNote } : {}),
    ...(input.CustomerMemo ? { CustomerMemo: input.CustomerMemo } : {}),
    MetaData: makeMetaData(input.MetaData),
    SyncToken: input.SyncToken ?? "0",
  };
}

export function ensurePaymentPayload(store: Store, realmId: string, input: Partial<QBOPayment>): QBOPayment {
  const id = input.Id ?? nextRealmScopedId(store, realmId, "payment");
  const lineAmount = (input.Line ?? []).reduce((sum, line) => sum + Number(line.Amount ?? 0), 0);
  return {
    Id: id,
    TxnDate: input.TxnDate ?? nowIso().slice(0, 10),
    CustomerRef: input.CustomerRef ?? { value: "1", name: "Default Customer" },
    ...(input.CurrencyRef ? { CurrencyRef: input.CurrencyRef } : {}),
    TotalAmt: input.TotalAmt ?? lineAmount,
    ...(input.PaymentRefNum ? { PaymentRefNum: input.PaymentRefNum } : {}),
    ...(input.PrivateNote ? { PrivateNote: input.PrivateNote } : {}),
    ...(input.UnappliedAmt != null ? { UnappliedAmt: input.UnappliedAmt } : {}),
    ...(input.Line ? { Line: input.Line } : {}),
    MetaData: makeMetaData(input.MetaData),
    SyncToken: input.SyncToken ?? "0",
  };
}

export function parseQuery(query: string): ParsedQuery {
  const match = query
    .replace(/\s+/g, " ")
    .trim()
    .match(/^SELECT\s+(\*|COUNT\(\*\))\s+FROM\s+(Customer|Vendor|Item|Invoice|SalesReceipt|Payment)(?:\s+WHERE\s+(.+?))?(?:\s+STARTPOSITION\s+(\d+))?(?:\s+MAXRESULTS\s+(\d+))?$/i);

  if (!match) {
    throw new Error(`Unsupported QuickBooks query: ${query}`);
  }

  const [, selectRaw, entityRaw, whereRaw, startRaw, maxRaw] = match;
  return {
    select: selectRaw.toUpperCase() as "*" | "COUNT(*)",
    entity: entityRaw as QuickBooksResourceName,
    startPosition: Math.max(parseInt(startRaw ?? "1", 10), 1),
    maxResults: Math.max(parseInt(maxRaw ?? "1000", 10), 1),
    conditions: parseConditions(whereRaw ?? ""),
  };
}

function parseConditions(whereRaw: string): ParsedCondition[] {
  if (!whereRaw.trim()) return [];
  return whereRaw
    .split(/\s+AND\s+/i)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const inMatch = raw.match(/^([A-Za-z0-9_.]+)\s+IN\s+\((.+)\)$/i);
      if (inMatch) {
        return {
          field: inMatch[1],
          operator: "IN" as const,
          value: inMatch[2].split(",").map((part) => parseLiteral(part.trim())),
        };
      }

      const compareMatch = raw.match(/^([A-Za-z0-9_.]+)\s*(=|>=|<=|>|<)\s*(.+)$/);
      if (!compareMatch) {
        throw new Error(`Unsupported QuickBooks WHERE clause: ${raw}`);
      }
      return {
        field: compareMatch[1],
        operator: compareMatch[2] as QueryOperator,
        value: parseLiteral(compareMatch[3].trim()),
      };
    });
}

function parseLiteral(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1);
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== "") return num;
  return trimmed;
}

function getFieldValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  let current: unknown = obj;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function compareValues(left: unknown, operator: Exclude<QueryOperator, "IN">, right: string | number | boolean): boolean {
  if (left === undefined || left === null) return false;
  const normalizedLeft = typeof right === "number" ? Number(left) : typeof right === "boolean" ? left === true || left === "true" : String(left);

  switch (operator) {
    case "=":
      return normalizedLeft === right;
    case ">=":
      return normalizedLeft >= right;
    case "<=":
      return normalizedLeft <= right;
    case ">":
      return normalizedLeft > right;
    case "<":
      return normalizedLeft < right;
  }
}

export function filterByConditions<T>(items: T[], conditions: ParsedCondition[]): T[] {
  if (conditions.length === 0) return items;
  return items.filter((item) =>
    conditions.every((condition) => {
      const actual = getFieldValue(item, condition.field);
      if (condition.operator === "IN") {
        return (condition.value as Array<string | number | boolean>).some((candidate) => String(actual) === String(candidate));
      }
      return compareValues(actual, condition.operator, condition.value as string | number | boolean);
    }),
  );
}

export function paginate<T>(items: T[], startPosition: number, maxResults: number): T[] {
  const startIdx = Math.max(startPosition - 1, 0);
  return items.slice(startIdx, startIdx + maxResults);
}

export function recordQuery(store: Store, token: string, realmId: string, entity: string, query: string, resultCount: number): void {
  getQuickBooksStore(store).queryLogs.insert({
    realm_id: realmId,
    token,
    entity,
    query,
    result_count: resultCount,
  });
}

export function issueTokenPair(
  store: Store,
  realmId: string,
  userEmail: string,
  clientId: string,
  scopes: QuickBooksScope[],
): { accessToken: string; refreshToken: string } {
  const qs = getQuickBooksStore(store);
  const accessToken = createAccessTokenValue();
  const refreshToken = createRefreshTokenValue();
  qs.accessTokens.insert({
    token: accessToken,
    realm_id: realmId,
    user_email: userEmail,
    client_id: clientId,
    scopes,
    expires_at: Date.now() + ACCESS_TOKEN_TTL_MS,
    revoked: false,
  });
  qs.refreshTokens.insert({
    token: refreshToken,
    realm_id: realmId,
    user_email: userEmail,
    client_id: clientId,
    scopes,
    expires_at: Date.now() + REFRESH_TOKEN_TTL_MS,
    revoked: false,
  });
  return { accessToken, refreshToken };
}

export function rotateRefreshToken(
  store: Store,
  refreshToken: string,
  clientId?: string,
): { accessToken: string; refreshToken: string } | null {
  const qs = getQuickBooksStore(store);
  const record = qs.refreshTokens.findOneBy("token", refreshToken);
  if (!record || record.revoked || record.expires_at < Date.now()) return null;
  if (clientId && record.client_id !== clientId) return null;
  qs.refreshTokens.update(record.id, { revoked: true });
  return issueTokenPair(store, record.realm_id, record.user_email, record.client_id, record.scopes);
}

export function revokeToken(store: Store, token: string): boolean {
  const qs = getQuickBooksStore(store);
  const access = qs.accessTokens.findOneBy("token", token);
  if (access && !access.revoked) {
    qs.accessTokens.update(access.id, { revoked: true });
    return true;
  }
  const refresh = qs.refreshTokens.findOneBy("token", token);
  if (refresh && !refresh.revoked) {
    qs.refreshTokens.update(refresh.id, { revoked: true });
    return true;
  }
  return false;
}

export function sortByQboId<T extends { qbo_id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(a.qbo_id) - Number(b.qbo_id) || a.qbo_id.localeCompare(b.qbo_id));
}

export function sanitizePatch<T>(patch: Partial<T>): Partial<T> {
  return sanitizeObject(patch) as Partial<T>;
}

export function buildEnvelope(key: string, payload: unknown): Record<string, unknown> {
  return {
    [key]: payload,
    time: nowIso(),
  };
}

export function companySummary(record: QuickBooksCompanyRecord): { realmId: string; companyName: string } {
  return {
    realmId: record.realm_id,
    companyName: record.company_name,
  };
}

export function primaryDisplay(value: QBORef | undefined): string {
  if (!value) return "";
  return value.name ?? value.value;
}
