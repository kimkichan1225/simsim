const ALLOWED_RE =
  /^[\p{Script=Hangul}\p{ASCII}ㄱ-ㆎ가-힣\s_.-]+$/u;

export function canonicalizeNickname(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isAllowedNickname(input: string): boolean {
  if (input.length === 0) return false;
  return ALLOWED_RE.test(input);
}
