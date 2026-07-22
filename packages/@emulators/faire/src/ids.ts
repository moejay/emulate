import { randomBytes } from "node:crypto";

function suffix(length = 10): string {
  return randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}

export function makeFaireToken(prefix: string, length = 10): string {
  return `${prefix}_${suffix(length)}`;
}

export function makeDisplayId(prefix = "BO"): string {
  return `${prefix}${suffix(8).toUpperCase()}`;
}
