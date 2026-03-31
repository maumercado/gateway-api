# Code Accuracy Fixes

Status: **Planned**

## Goal

Fix three implementation gaps in the API gateway so the code matches what a production gateway should actually do — and so the blog post describes real behavior. Once the code is fixed, the blog content updates become straightforward corrections rather than softening inaccurate claims.

Three fixes:
1. **Health-check failover** — filter unhealthy upstreams *before* load balancing instead of checking one after selection
2. **Response streaming** — pipe the upstream response body as a stream instead of buffering with `.text()`
3. **Rate-limiter atomicity** — replace the Redis pipeline + follow-up calls with a single Lua script

---

## Architecture

### Fix 1: Health-check failover

**Current flow:**
```
matchRoute() → [route matching + selectUpstream()] → returns { route, upstream }
handler → checks health of the ONE selected upstream
         → if unhealthy: 503/fallback (no retry with another upstream)
```

**New flow:**
```
matchRoute() → [route matching only] → returns { route }
handler → if health checks enabled: query health of ALL upstreams
        → filter to healthy pool
        → if pool empty: 503/fallback
        → selectUpstream(healthyPool, ...) → upstream
        → if health checks disabled: selectUpstream(route.upstreams, ...)
```

**Files changed:**
- `src/modules/routing/routing.types.ts` — remove `upstream` from `MatchedRoute`
- `src/modules/routing/routing.service.ts` — `matchRoute` returns `{ route }` only; remove `selectUpstream` call
- `src/modules/routing/routing.handler.ts` — import `selectUpstream`; add upstream health filtering before selection
- `src/modules/routing/routing.service.test.ts` — remove `vi.mock` for load-balancer (no longer called in service)

### Fix 2: Response streaming

**Current:** `const responseBody = await upstreamResponse.text()` — buffers entire body in memory.

**New:** `Readable.fromWeb(upstreamResponse.body)` — pipes the fetch ReadableStream as a Node.js Readable directly into Fastify's reply. Fastify detects streams and pipes without serialization.

Edge cases to handle:
- `upstreamResponse.body === null` (no-body responses)
- Status 204 No Content (send with no body)
- HEAD requests (send with no body)

**Files changed:**
- `src/modules/routing/routing.handler.ts` — add `import { Readable } from 'node:stream'`; replace `.text()` buffering with stream piping

### Fix 3: Rate-limiter Lua script

**Current:** 4-op pipeline + separate `zrange` call + conditional `zremrangebyscore` = 3 round trips, not atomic.

**New:** Single Lua script executed with `redis.eval()` — all operations atomic, single round trip.

Lua script does:
1. `ZREMRANGEBYSCORE` — expire old entries
2. `ZCARD` — count current window
3. `ZADD` + `EXPIRE` only if allowed (conditional add — no cleanup needed)
4. `ZRANGE WITHSCORES` on index 0 — get oldest entry for `resetAt`
5. Return `[allowed, remaining, oldest_score, limit]`

**Files changed:**
- `src/shared/rate-limiter/index.ts` — replace pipeline + extra calls with `redis.eval()`

---

## Setup Steps

### Step 1 — Fix `MatchedRoute` type (`routing.types.ts`)

Remove `upstream` from the interface:

```typescript
export interface MatchedRoute {
  route: Route;
  pathParams?: Record<string, string>;
}
```

---

### Step 2 — Simplify `matchRoute` in service (`routing.service.ts`)

Remove the `selectUpstream` import and call. `matchRoute` now only finds the route:

```typescript
// Remove import: import { selectUpstream } from '../../shared/load-balancer/index.js';

async matchRoute(tenantId, method, path): Promise<MatchedRoute | null> {
  const routes = await getActiveRoutesByTenantId(tenantId);
  for (const route of routes) {
    if (route.method !== '*' && route.method !== method) continue;
    if (!matchPath(route.path, path, route.pathType)) continue;
    return { route };  // Just the route — no upstream selection here
  }
  return null;
}
```

---

### Step 3 — Add upstream health filtering + selection to handler (`routing.handler.ts`)

After `matchRoute`, add the upstream selection logic:

```typescript
import { selectUpstream } from '../../shared/load-balancer/index.js';

// ... after const { route } = matched; ...

// Determine candidate upstreams (filter by health if enabled)
let candidateUpstreams = route.upstreams;

if (resilience?.healthCheck?.enabled && healthChecker) {
  const healthResults = await Promise.all(
    route.upstreams.map(async (u) => ({
      upstream: u,
      healthy: await healthChecker.isUpstreamHealthy(tenant.id, route.id, u.url),
    }))
  );
  const healthyUpstreams = healthResults.filter((r) => r.healthy).map((r) => r.upstream);

  if (healthyUpstreams.length === 0) {
    log.warn({ tenantId: tenant.id, routeId: route.id }, 'All upstreams are unhealthy');
    if (shouldUseFallback(resilience.fallback)) {
      return sendFallbackResponse(reply, resilience.fallback);
    }
    return reply.status(503).send({ error: 'Service Unavailable', message: 'All upstream services are unhealthy' });
  }
  candidateUpstreams = healthyUpstreams;
}

const upstream = selectUpstream(candidateUpstreams, route.loadBalancing, route.id);
```

Remove the old per-upstream health check block (lines 169–193 in current handler).

---

### Step 4 — Replace `.text()` buffering with streaming (`routing.handler.ts`)

```typescript
import { Readable } from 'node:stream';

// Replace the body forwarding block:
const noBodyStatuses = new Set([101, 204, 205, 304]);
if (!upstreamResponse.body || noBodyStatuses.has(upstreamResponse.status) || method === 'HEAD') {
  return reply.status(upstreamResponse.status).headers(responseHeaders).send();
}

return reply
  .status(upstreamResponse.status)
  .headers(responseHeaders)
  .send(Readable.fromWeb(upstreamResponse.body as import('stream/web').ReadableStream));
```

---

### Step 5 — Replace pipeline with Lua script (`rate-limiter/index.ts`)

```typescript
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttl = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

local count = redis.call('ZCARD', key)
local allowed = 0
local remaining = 0

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, ttl)
  allowed = 1
  remaining = limit - count - 1
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldest_score = now
if #oldest >= 2 then
  oldest_score = tonumber(oldest[2])
end

return {allowed, remaining, oldest_score, limit}
`;

export async function checkRateLimit(key, config): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = DEFAULT_WINDOW_MS;
  const windowStart = now - windowMs;
  const limit = config.burstSize ?? config.requestsPerSecond;
  const redisKey = `ratelimit:${key}`;
  const member = `${now}:${Math.random()}`;
  const ttl = Math.ceil(windowMs / 1000) + 1;

  const result = await redis.eval(
    RATE_LIMIT_SCRIPT, 1, redisKey,
    now, windowStart, limit, member, ttl
  ) as [number, number, number, number];

  const [allowedInt, remaining, oldestScore] = result;
  return {
    allowed: allowedInt === 1,
    remaining,
    resetAt: oldestScore + windowMs,
    limit,
  };
}
```

---

### Step 6 — Update service test (`routing.service.test.ts`)

Remove the `vi.mock` for `load-balancer` since `matchRoute` no longer calls `selectUpstream`:

```diff
- vi.mock('../../shared/load-balancer/index.js', () => ({
-   selectUpstream: vi.fn((upstreams) => upstreams[0]),
- }));
```

No test assertions need changing (tests only check `result?.route.id` / `result?.route.path`).

---

### Step 7 — Update blog post (`content/blog-post.md`)

After code is fixed, update the blog post to accurately describe the new behavior:
- Health checks: "filters all upstreams, selects from healthy pool, falls back if none healthy"
- Rate limiter: remove the atomicity contradiction (the Lua script IS atomic — the lesson about replacing the pipeline is now past tense)
- Streaming: update proxy description to say "streams the upstream response"
- Also apply the other non-code fixes (PromQL `by (le)`, "every metric" wording, bucket resolution wording, demo section, LinkedIn URL placeholder)

---

## What Does NOT Change

- Circuit breaker logic
- Retry logic
- Health checker internals (`HealthChecker`, `HealthCheckManager` classes)
- Load balancer strategies
- Database schema / migrations
- Any other test files

## Future Improvements

- Add integration tests for `checkRateLimit` using a real Redis (testcontainers or a test Redis instance)
- Add a gateway integration test covering the health-check failover path (mock unhealthy upstream, verify traffic routes to healthy one)
- Consider response streaming with proper backpressure handling for very large payloads
