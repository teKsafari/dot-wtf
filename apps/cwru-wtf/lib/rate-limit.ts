// A fixed-window counter per client address, held in this process. The site runs
// as one container, so this is the whole limit; it is a speed bump for a public
// form, not an account control, and it resets on deploy.
export interface RateLimiter {
  take(key: string, now?: number): boolean;
}

export function createRateLimiter(limit: number, windowMilliseconds: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMilliseconds);
      // Bound the map so a flood of addresses cannot grow it without end.
      if (hits.size > 10_000 && !hits.has(key)) hits.clear();
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}

// Behind the Coolify proxy the first entry is the client; direct requests have none.
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || headers.get('x-real-ip')?.trim() || 'unknown';
}
