type Bucket = { tokens: number; lastRefill: number };

const MAX_BUCKETS = 5_000;
const STALE_AFTER_MS = 60 * 60 * 1000;

const buckets = new Map<string, Bucket>();

function evictIfNeeded(now: number): void {
  if (buckets.size <= MAX_BUCKETS) return;
  let removed = 0;
  for (const [k, v] of buckets) {
    if (now - v.lastRefill > STALE_AFTER_MS) {
      buckets.delete(k);
      removed += 1;
    }
  }
  if (buckets.size > MAX_BUCKETS) {
    const overflow = buckets.size - MAX_BUCKETS;
    let i = 0;
    for (const k of buckets.keys()) {
      if (i >= overflow) break;
      buckets.delete(k);
      i += 1;
    }
  }
  void removed;
}

export type RateLimitConfig = {
  capacity: number;
  refillPerSec: number;
};

export function consumeToken(key: string, cfg: RateLimitConfig): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? {
    tokens: cfg.capacity,
    lastRefill: now,
  };
  const elapsedSec = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(
    cfg.capacity,
    bucket.tokens + elapsedSec * cfg.refillPerSec,
  );
  bucket.lastRefill = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    evictIfNeeded(now);
    return true;
  }
  buckets.set(key, bucket);
  evictIfNeeded(now);
  return false;
}

export function clientKey(request: Request): string {
  const trustProxy = process.env.TRUST_PROXY === "1";
  if (trustProxy) {
    const fwd = request.headers.get("x-forwarded-for");
    if (fwd) {
      const first = fwd.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = request.headers.get("x-real-ip");
    if (real) return real.trim();
  }
  return "anon";
}

export const RATE_GROUP_JOIN: RateLimitConfig = {
  capacity: 8,
  refillPerSec: 8 / 60,
};

export const RATE_GROUP_CREATE: RateLimitConfig = {
  capacity: 5,
  refillPerSec: 5 / 600,
};
