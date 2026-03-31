# LinkedIn Post

---

I built an API gateway from scratch, and the biggest surprise was how quickly Redis became critical infrastructure.

Not just for caching. It ended up holding rate-limit state, circuit-breaker state, health-check state, and short-lived tenant auth cache.

The project became a production-style, multi-tenant gateway built in four layers: foundation, traffic management, resilience, and observability.

**What shipped:**
→ API key auth per tenant (bcrypt + Redis cache)
→ Redis-backed sliding-window rate limiting
→ Load balancing across upstreams
→ Circuit breakers, retries, and background health checks
→ Prometheus metrics with tenant-aware labels

Two things I'm most proud of:

**1. Distributed circuit breaker state via Redis.** The circuit breaker isn't just in-memory — state is stored in Redis so every gateway instance shares the same view. One instance seeing failures opens the circuit for all of them.

**2. Per-tenant observability.** All tenant-aware gateway metrics carry a `tenant_id` label. That means you can run a single Grafana dashboard and drill into any tenant's request rate, error rate, p99 latency, or rate limit hits independently.

The biggest lesson: once Redis becomes load-bearing for traffic control and resilience, it stops being “just a cache.” It becomes part of the gateway's correctness story, and that changes how you have to think about failure modes.

Would I choose this over Kong or AWS API Gateway in production? Usually no. But building it once made the trade-offs inside those tools much more concrete to me.

Full write-up (circuit breaker deep-dive, rate limiter internals, observability stack): [TODO: insert blog post URL before publishing]

Source: https://github.com/maumercado/gateway-api

#nodejs #typescript #softwarearchitecture #backend #devops

---

<!-- NOTES FOR PUBLISHING:
- Replace "[link to blog post]" with the actual published URL on maumercado.com
- The post is ~1,850 characters — LinkedIn shows "see more" around 210 chars, so the hook lands above the fold
- Consider attaching the request flow diagram image for visual engagement
- Best posting times: Tuesday–Thursday, 8–10am or 12–1pm in your timezone
-->
