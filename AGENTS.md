# API Gateway - Codex Context

## Project Overview

Multi-tenant API Gateway built with Node.js 24+, TypeScript, and Fastify.

## Architectural Decisions

### Modular Monolith Structure
- Code organized into `modules/` (tenant, routing) and `shared/` (config, database, redis, logger)
- Each module has schema, repository, service, and types files
- Clear separation between database layer (repository) and business logic (service)

### Database: Drizzle ORM with PostgreSQL
- Type-safe schema definitions
- Migrations managed via drizzle-kit
- Using postgres.js driver for connection pooling

**Migration Workflow (IMPORTANT):**
1. Modify schema files in `src/modules/*/*.schema.ts`
2. Generate migration: `pnpm db:generate` (creates SQL + updates `drizzle/meta/_journal.json`)
3. Apply migration: `pnpm db:migrate`

Never create migration SQL files manually - always use `db:generate`. Drizzle tracks migrations via the `_journal.json` file; manually created SQL files won't be recognized.

### Caching: Redis with ioredis
- Tenant data cached for 5 seconds after API key validation
- Helps reduce database load for repeated requests
- Circuit breaker state stored in Redis (`cb:{tenantId}:{routeId}:{urlHash}`)
- Health check status stored in Redis (`health:{tenantId}:{routeId}:{urlHash}`)

### Authentication
- API key based authentication via `X-API-Key` header
- Keys are bcrypt hashed in database
- Validation compares against all active tenants (can be optimized with indexed lookup)

### Proxy Implementation
- Uses native `fetch` API for upstream requests
- Supports exact and prefix path matching
- Headers forwarded: content-type, accept, authorization, etc.
- Adds x-forwarded-* headers and x-tenant-id

### Resilience (Phase 3)
- **Circuit Breaker**: Tracks failures per upstream, opens after threshold, auto-recovers via half-open state
- **Retry Policy**: Exponential backoff with jitter, configurable retryable status codes
- **Configurable Timeouts**: Per-route and per-HTTP-method timeout configuration
- **Health Checks**: Active probing of upstream health endpoints, marks unhealthy upstreams
- **Fallback Responses**: Configurable fallback when upstreams fail
- All features are opt-in via route's `resilience` JSONB field
- Distributed state via Redis enables multi-instance deployments

### Observability (Phase 4)
- **Prometheus Metrics**: Exposes `/metrics` endpoint for Prometheus scraping
- Uses `prom-client` library with custom registry
- **Request Metrics**: `gateway_http_requests_total`, `gateway_http_request_duration_seconds`
- **Upstream Metrics**: `gateway_upstream_requests_total`, `gateway_upstream_request_duration_seconds`
- **Circuit Breaker Metrics**: `gateway_circuit_breaker_state`, `gateway_circuit_breaker_transitions_total`
- **Rate Limit Metrics**: `gateway_rate_limit_hits_total`, `gateway_rate_limit_remaining`
- **Health Check Metrics**: `gateway_health_check_status`
- **Retry Metrics**: `gateway_retry_attempts_total`
- All metrics labeled by tenant_id for multi-tenant observability
- Histogram buckets optimized for low-latency measurements (1ms-10s)

### Configuration
- Environment variables validated with Zod
- Fails fast on startup if required vars are missing

## Commands

```bash
pnpm dev         # Development with hot reload
pnpm build       # TypeScript compilation
pnpm lint        # ESLint check
pnpm test        # Run tests
pnpm db:generate # Generate migration from schema changes
pnpm db:migrate  # Apply pending migrations
pnpm db:seed     # Seed test data
pnpm load-test   # Generate traffic for metrics testing
```

## Key Files

- `src/gateway.ts` - Main Fastify server setup
- `src/middleware/tenant-auth.ts` - API key authentication
- `src/modules/routing/routing.handler.ts` - Request proxying logic with resilience
- `src/shared/config/index.ts` - Environment configuration
- `src/shared/circuit-breaker/index.ts` - Circuit breaker implementation
- `src/shared/retry/index.ts` - Retry with exponential backoff
- `src/shared/health-check/index.ts` - Upstream health checking
- `src/shared/fallback/index.ts` - Fallback response generation
- `src/plugins/health-check.ts` - Health check Fastify plugin
- `src/shared/metrics/index.ts` - Prometheus metrics definitions
- `src/plugins/metrics.ts` - Metrics Fastify plugin with /metrics endpoint

## Phase Status

- Phase 1 (Foundation): Complete
- Phase 2 (Rate Limiting): Complete
- Phase 3 (Resilience): Complete
- Phase 4 (Observability): Complete
