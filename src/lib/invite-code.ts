import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 10;

export function generateInviteCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function normalizeInviteCode(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}

export function isValidInviteCodeShape(code: string): boolean {
  if (code.length !== CODE_LEN) return false;
  for (const ch of code) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}
