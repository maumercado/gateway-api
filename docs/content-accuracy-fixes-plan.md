# Content Accuracy Fixes

Status: **Planned**

## Goal

Fix seven technical inaccuracies in `content/blog-post.md` and `content/linkedin-post.md` so the published content accurately reflects the current implementation. Also add a "Try it yourself" demo section to the blog post. All fixes must be defensible against the actual source code — no claims that overstate what the implementation does.

---

## Setup Steps

### 1. Fix: "Streams the response" → "Returns/forwards the response" (`blog-post.md` line 101)

**Problem:** The proxy section says the gateway "streams the upstream response back to the client." The handler actually buffers the body with `await upstreamResponse.text()` before sending — no true streaming.

**Fix:** Change step 4 of the proxy bullet list:

```diff
- 4. Streams the upstream response back to the client
+ 4. Returns the upstream response to the client
```

---

### 2. Fix: Remove false atomicity claim in rate-limiter snippet (`blog-post.md` line 119)

**Problem:** The comment says `// All four operations in a single pipeline — atomic from Redis's perspective`. This is false — a follow-up `zrange` call and conditional cleanup run *after* the pipeline. The Lessons Learned section later correctly calls this a gap, creating an internal contradiction.

**Fix:** Replace the misleading comment:

```diff
- // All four operations in a single pipeline — atomic from Redis's perspective
+ // Four operations queued in a single pipeline (a follow-up zrange call runs separately — see Lessons Learned on atomicity)
```

---

### 3. Fix: Health-check failover description overstates behavior (`blog-post.md` line 281)

**Problem:** The post says "the routing handler filters out unhealthy upstreams *before* running load balancing." The actual implementation selects one upstream via load balancing *first*, then checks only that upstream's health. If it's unhealthy, it returns a 503/fallback — it does **not** try another upstream.

**Fix:** Replace the paragraph:

```diff
- When the routing handler selects an upstream, it filters out unhealthy ones before running load balancing. If all upstreams are unhealthy, the fallback response is returned.
+ When the routing handler selects an upstream, it checks that specific upstream's health status. If it's marked unhealthy, the request returns the configured fallback immediately — the current implementation does not attempt failover to another upstream. Health checks are most useful for avoiding routing to a known-bad host when combined with a single upstream per route, or as an early warning signal when multiple upstreams are configured.
```

---

### 4. Fix: "Every metric carries tenant_id" overstates (`blog-post.md` line 303, `linkedin-post.md` line 22)

**Problem:** `gateway_active_connections` and all metrics from `collectDefaultMetrics()` (Node.js heap, event loop lag, GC, etc.) do **not** carry `tenant_id`. The claim is false as written.

**Fix in blog-post.md:**

```diff
- The key design decision: every metric carries a `tenant_id` label.
+ The key design decision: all tenant-aware gateway business metrics carry a `tenant_id` label.
```

**Fix in linkedin-post.md:**

```diff
- **2. Per-tenant observability.** Every Prometheus metric carries a `tenant_id` label.
+ **2. Per-tenant observability.** All tenant-aware gateway metrics carry a `tenant_id` label.
```

---

### 5. Fix: PromQL `histogram_quantile` missing `by (le)` (`blog-post.md` line 345)

**Problem:** The example omits the required `by (le)` aggregation. Without it, Prometheus can't reconstruct the histogram from the bucket series and the result will be wrong or empty.

**Fix:**

```diff
- histogram_quantile(0.99, rate(gateway_http_request_duration_seconds_bucket[5m]))
+ histogram_quantile(0.99, sum(rate(gateway_http_request_duration_seconds_bucket[5m])) by (le))
```

---

### 6. Fix: "Sub-millisecond" → "millisecond-level" resolution (`blog-post.md` line 339)

**Problem:** The smallest bucket is `0.001s` = 1ms. Saying the buckets help with "sub-millisecond" resolution is inaccurate — the finest resolution is 1ms.

**Fix:**

```diff
- the default `prom-client` buckets (which start at 0.005s) would lose resolution in the sub-millisecond range.
+ the default `prom-client` buckets (which start at 0.005s) would lose resolution at the low-millisecond end.
```

---

### 7. Fix: LinkedIn URL placeholder (`linkedin-post.md` line 28)

**Problem:** `[link to blog post]` is an unfinished placeholder. Needs a clear TODO before publishing.

**Fix:**

```diff
- Full write-up (circuit breaker deep-dive, rate limiter internals, observability stack): [link to blog post]
+ Full write-up (circuit breaker deep-dive, rate limiter internals, observability stack): [TODO: insert blog post URL before publishing]
```

---

### 8. Add: "Try it yourself" demo section to `blog-post.md`

**Where:** Insert a new section between "Lessons Learned" and "Conclusion."

**Content:**

````markdown
## Try It Yourself

The repo ships with a full observability stack you can run locally. Four commands get you from zero to watching circuit breakers trip in Grafana in real time:

```bash
# 1. Start the gateway
pnpm dev

# 2. Start Prometheus + Grafana (in a second terminal)
docker compose -f docker-compose.observability.yml up -d

# 3. Seed the database (creates test tenant + routes)
pnpm db:seed

# 4. Generate traffic — including intentional 4xx/5xx errors
pnpm load-test
```

Then open **Grafana at http://localhost:3001** (login: admin/admin). The pre-loaded dashboard shows request rate, error rate, p50/p95/p99 latency, circuit breaker states, rate limit hits, and upstream health — all updating live as the load test runs.

The load test intentionally hits endpoints that return 500s, so you'll see the circuit breaker transition from CLOSED → OPEN → HALF_OPEN within a few seconds of starting. That's the behavior the metrics were designed to surface.
````

---

## What Does NOT Change

- The overall blog post structure and section ordering
- All code snippets (other than the comment and PromQL corrections above)
- The LinkedIn post tone and length
- Any content in `README.md`, `content-plan.md`, or source code files

## Future Improvements

- Add actual failover behavior to the routing handler so the health-check section describes what the code actually does (select next healthy upstream instead of returning 503 immediately)
- Replace the rate-limiter pipeline with a Lua script for true atomicity
- Implement OpenTelemetry tracing (flag already exists in config)
