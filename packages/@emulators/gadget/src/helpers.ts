import type { Store } from "@emulators/core";

export interface ConnectionArgs {
  first?: number | null;
  after?: string | null;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function ensureIso(value: string | undefined | null, fallback = isoNow()): string {
  return value && !Number.isNaN(new Date(value).getTime()) ? value : fallback;
}

export function encodeCursor(index: number): string {
  return Buffer.from(String(index), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function connectionFromArray<T>(items: T[], args: ConnectionArgs) {
  const startIndex = Math.max(0, (decodeCursor(args.after) ?? -1) + 1);
  const first = Math.max(0, Math.min(args.first ?? items.length, 250));
  const sliced = items.slice(startIndex, startIndex + first);
  const edges = sliced.map((node, offset) => ({
    node,
    cursor: encodeCursor(startIndex + offset),
  }));
  const pageInfo: PageInfo = {
    hasNextPage: startIndex + sliced.length < items.length,
    endCursor: edges.length > 0 ? edges[edges.length - 1]!.cursor : null,
  };
  return { edges, pageInfo };
}

export function getEventCounter(store: Store): number {
  return store.getData<number>("gadget.event_counter") ?? 0;
}

export function nextEventCounter(store: Store): number {
  const next = getEventCounter(store) + 1;
  store.setData("gadget.event_counter", next);
  return next;
}

export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function defaultString(value: string | null | undefined, fallback: string): string {
  return value == null || value === "" ? fallback : value;
}

export function toTagList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}
