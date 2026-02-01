# Multi-tenant API Gateway

A production-ready, multi-tenant API Gateway built with Node.js, TypeScript, and Fastify.

## Tech Stack

- **Runtime:** Node.js 24+ with TypeScript 5+
- **Framework:** Fastify
- **Database:** PostgreSQL with Drizzle ORM
- **Cache:** Redis (ioredis)
- **Validation:** Zod
- **Testing:** Vitest
- **Package Manager:** pnpm

## Prerequisites

- Node.js 24+
- pnpm 10+
- Docker & Docker Compose (for local development)

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Start Infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL and Redis containers.

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 4. Run Database Migrations

```bash
pnpm db:migrate
```

### 5. Start Development Server

```bash
pnpm dev
```

The gateway will be available at `http://localhost:3000`.

## Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start development server with hot reload |
| `pnpm build` | Build TypeScript to JavaScript |
| `pnpm start` | Run production build |
| `pnpm test` | Run tests (single run) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Fix auto-fixable lint issues |
| `pnpm format` | Format code with Prettier |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:seed` | Seed database with sample data |

## Project Structure

```
src/
├── modules/                    # Domain modules
│   ├── tenant/                 # Tenant management (CRUD, auth)
│   │   ├── tenant.schema.ts    # Database schema (Drizzle)
│   │   ├── tenant.repository.ts # Data access layer
│   │   ├── tenant.service.ts   # Business logic
│   │   ├── tenant.routes.ts    # HTTP routes
│   │   └── tenant.types.ts     # TypeScript types
│   └── routing/                # Route matching & proxying
│       ├── routing.schema.ts
│       ├── routing.repository.ts
│       ├── routing.service.ts
│       ├── routing.handler.ts  # Proxy handler with resilience
│       ├── routing.routes.ts
│       └── routing.types.ts
├── plugins/                    # Fastify plugins
│   ├── admin-auth.ts           # Admin API key validation
│   ├── database.ts             # PostgreSQL connection
│   ├── health-check.ts         # Upstream health monitoring
│   ├── rate-limit.ts           # Per-tenant rate limiting
│   ├── redis.ts                # Redis connection
│   ├── routing-service.ts      # Routing service injection
│   ├── tenant-auth.ts          # Tenant API key validation
│   └── tenant-service.ts       # Tenant service injection
├── shared/                     # Shared utilities
│   ├── circuit-breaker/        # Circuit breaker pattern
│   ├── config/                 # Environment configuration
│   ├── database/               # Drizzle client & schema
│   ├── fallback/               # Fallback response generation
│   ├── health-check/           # Upstream health checking
│   ├── load-balancer/          # Load balancing strategies
│   ├── rate-limiter/           # Sliding window rate limiter
│   ├── redis/                  # Redis client
│   ├── retry/                  # Retry with exponential backoff
│   ├── transformer/            # Request/response transformation
│   └── types/                  # Shared TypeScript types
├── gateway.ts                  # Main Fastify server
└── index.ts                    # Entry point
```

## Architecture

### Overview

The gateway uses a **modular monolith** architecture with clear separation:
- **Modules**: Domain logic (tenant, routing)
- **Plugins**: Fastify integration with dependency injection
- **Shared**: Reusable utilities across modules

### Request Flow

```
Client Request
     ↓
┌────────────────┐
│  Tenant Auth   │  → Validates X-API-Key header against database
└────────────────┘
     ↓
┌────────────────┐
│  Rate Limiter  │  → Checks Redis sliding window counter
└────────────────┘
     ↓
┌────────────────┐
│ Route Matcher  │  → Finds matching route by method/path
└────────────────┘
     ↓
┌────────────────┐
│ Health Check   │  → Skips unhealthy upstreams
└────────────────┘
     ↓
┌────────────────┐
│Circuit Breaker │  → Blocks if upstream is failing
└────────────────┘
     ↓
┌────────────────┐
│  Retry Logic   │  → Retries with exponential backoff
└────────────────┘
     ↓
┌────────────────┐
│ Load Balancer  │  → Selects upstream (round-robin/weighted/random)
└────────────────┘
     ↓
┌────────────────┐
│  Transformer   │  → Applies header/path transformations
└────────────────┘
     ↓
Upstream Response (or Fallback)
```

### Dependency Injection

Services use factory functions for testability:

```typescript
// Repository accepts db client
const repository = createTenantRepository(db);

// Service accepts dependencies
const service = createTenantService({ repository, redis });

// Plugin injects from Fastify instance
fastify.decorate('tenantService', service);
```

### Plugins

| Plugin | Purpose | Dependencies |
|--------|---------|--------------|
| `database` | Manages PostgreSQL connection lifecycle | - |
| `redis` | Manages Redis connection lifecycle | - |
| `tenant-service` | Provides tenant CRUD operations | database, redis |
| `routing-service` | Provides route matching and CRUD | database |
| `health-check` | Monitors upstream health | redis, routing-service |
| `tenant-auth` | Validates tenant API keys | tenant-service |
| `admin-auth` | Validates admin API key | - |
| `rate-limit` | Enforces per-tenant rate limits | redis, tenant-service |

### Resilience Features

All resilience features are **opt-in** per route via the `resilience` field:

#### Circuit Breaker
Prevents cascading failures by stopping requests to failing upstreams.
- **CLOSED**: Normal operation, requests flow through
- **OPEN**: Requests blocked after `failureThreshold` failures
- **HALF_OPEN**: Limited requests allowed after `timeout` expires
- State stored in Redis for distributed deployments

#### Retry Policy
Automatically retries failed requests with exponential backoff.
- Configurable `maxRetries`, `baseDelayMs`, `maxDelayMs`
- Jitter added to prevent thundering herd
- Only retries on `retryableStatusCodes` (default: 500, 502, 503, 504)

#### Health Checks
Actively probes upstream health endpoints.
- Periodic HTTP GET to configured `endpoint`
- Tracks consecutive successes/failures
- Marks upstream unhealthy after `unhealthyThreshold` failures
- Healthy again after `healthyThreshold` successes

#### Configurable Timeouts
Per-route and per-method timeout configuration.
- Global default timeout
- Method-specific overrides (e.g., longer for POST)
- Falls back to upstream timeout if not configured

#### Fallback Responses
Returns cached/static response when upstream fails.
- Configurable status code, content type, body
- Supports JSON, HTML, and plain text
- Used when circuit breaker open or all retries exhausted

### Route Configuration Example

```json
{
  "method": "GET",
  "path": "/api/users",
  "pathType": "prefix",
  "upstreams": [
    { "url": "http://users-service:3000", "weight": 3 },
    { "url": "http://users-backup:3000", "weight": 1 }
  ],
  "loadBalancing": "weighted",
  "resilience": {
    "circuitBreaker": {
      "enabled": true,
      "failureThreshold": 5,
      "successThreshold": 2,
      "timeout": 30000
    },
    "retry": {
      "enabled": true,
      "maxRetries": 3,
      "baseDelayMs": 1000,
      "retryableStatusCodes": [500, 502, 503, 504]
    },
    "timeout": {
      "default": 10000,
      "byMethod": { "GET": 5000, "POST": 30000 }
    },
    "healthCheck": {
      "enabled": true,
      "endpoint": "/health",
      "intervalMs": 30000,
      "timeoutMs": 5000,
      "healthyThreshold": 2,
      "unhealthyThreshold": 3
    },
    "fallback": {
      "enabled": true,
      "statusCode": 503,
      "contentType": "application/json",
      "body": "{\"error\":\"Service temporarily unavailable\"}"
    }
  }
}
```

## API Endpoints

### Health Check (No Auth)

```bash
curl http://localhost:3000/health   # Gateway health
curl http://localhost:3000/ready    # Gateway readiness
```

### Admin API (X-Admin-Key Required)

```bash
# Tenants
GET    /admin/tenants              # List all tenants
GET    /admin/tenants/:id          # Get tenant by ID
POST   /admin/tenants              # Create tenant
PATCH  /admin/tenants/:id          # Update tenant
DELETE /admin/tenants/:id          # Delete tenant

# Routes
GET    /admin/tenants/:id/routes   # List routes for tenant
GET    /admin/routes/:id           # Get route by ID
POST   /admin/routes               # Create route
PATCH  /admin/routes/:id           # Update route
DELETE /admin/routes/:id           # Delete route
```

### Proxy Requests (X-API-Key Required)

All other requests proxy to configured upstreams:

```bash
curl -H "X-API-Key: your-tenant-key" http://localhost:3000/your-route
```

Response headers include rate limit info:
- `X-RateLimit-Limit` - Maximum requests allowed
- `X-RateLimit-Remaining` - Remaining requests in window
- `X-RateLimit-Reset` - Unix timestamp when limit resets

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `DATABASE_URL` | PostgreSQL connection URL | - |
| `REDIS_URL` | Redis connection URL | - |
| `ADMIN_API_KEY` | Admin API key | - |
| `LOG_LEVEL` | Pino log level | `info` |

## Redis Key Patterns

| Feature | Key Pattern | TTL |
|---------|-------------|-----|
| Tenant Cache | `tenant:apikey:{key}` | 5s |
| Rate Limit | `ratelimit:{tenantId}` | 1s |
| Circuit Breaker | `cb:{tenantId}:{routeId}:{urlHash}` | timeout + 60s |
| Health Status | `health:{tenantId}:{routeId}:{urlHash}` | interval × 3 |

## Gateway Components

### Modules

#### Tenant Module (`src/modules/tenant/`)
Manages multi-tenant isolation. Each tenant has a unique API key, rate limits, and route configurations. Handles CRUD operations for tenants and validates API keys using bcrypt comparison with Redis caching to reduce database load.

#### Routing Module (`src/modules/routing/`)
Matches incoming requests to configured routes and proxies them to upstream services. Supports exact, prefix, and regex path matching. Coordinates with load balancer, circuit breaker, and transformer to deliver requests reliably.

### Plugins

#### Database Plugin (`src/plugins/database.ts`)
Initializes PostgreSQL connection using Drizzle ORM. Manages connection lifecycle and provides the `db` instance to other plugins via Fastify decoration.

#### Redis Plugin (`src/plugins/redis.ts`)
Initializes Redis connection using ioredis. Used for caching, rate limiting, circuit breaker state, and health check status. Handles graceful disconnection on shutdown.

#### Tenant Service Plugin (`src/plugins/tenant-service.ts`)
Wires up the tenant repository and service with their dependencies (database, redis). Exposes `tenantService` on the Fastify instance for tenant CRUD and API key validation.

#### Routing Service Plugin (`src/plugins/routing-service.ts`)
Wires up the routing repository and service. Exposes `routingService` on the Fastify instance for route CRUD and matching operations.

#### Tenant Auth Plugin (`src/plugins/tenant-auth.ts`)
Validates the `X-API-Key` header on proxy requests. Caches validated tenants in Redis for 5 seconds. Returns 401 for missing keys, 403 for invalid/inactive tenants.

#### Admin Auth Plugin (`src/plugins/admin-auth.ts`)
Validates the `X-Admin-Key` header on admin API requests. Compares against the configured `ADMIN_API_KEY` environment variable.

#### Rate Limit Plugin (`src/plugins/rate-limit.ts`)
Enforces per-tenant request limits using a Redis sliding window algorithm. Adds `X-RateLimit-*` headers to responses. Returns 429 when limits are exceeded.

#### Health Check Plugin (`src/plugins/health-check.ts`)
Runs background health checks against upstream endpoints. Tracks consecutive successes/failures and marks upstreams as healthy or unhealthy. Status stored in Redis for distributed deployments.

### Shared Utilities

#### Circuit Breaker (`src/shared/circuit-breaker/`)
Implements the circuit breaker pattern to prevent cascading failures. Tracks failures per upstream, opens circuit after threshold, and allows limited requests in half-open state to test recovery. State persisted in Redis.

#### Retry (`src/shared/retry/`)
Provides retry logic with exponential backoff and jitter. Determines if errors are retryable (connection errors, 5xx status codes). Prevents thundering herd with randomized delays.

#### Health Check (`src/shared/health-check/`)
Periodically probes upstream `/health` endpoints. Tracks health status and exposes it for routing decisions. Upstreams marked unhealthy are skipped during load balancing.

#### Fallback (`src/shared/fallback/`)
Generates static fallback responses when upstreams fail. Supports JSON, HTML, and plain text. Used when circuit breaker is open or all retries are exhausted.

#### Load Balancer (`src/shared/load-balancer/`)
Selects upstream targets using configurable strategies: round-robin (sequential), weighted (probability-based), or random. Maintains per-route state for round-robin index.

#### Transformer (`src/shared/transformer/`)
Modifies requests and responses. Adds/removes/sets headers, rewrites paths using regex patterns. Applied before proxying (request) and after receiving upstream response.

#### Rate Limiter (`src/shared/rate-limiter/`)
Implements sliding window rate limiting algorithm. Stores request counts in Redis with automatic expiration. Returns remaining quota and reset time.

#### Config (`src/shared/config/`)
Loads and validates environment variables using Zod schemas. Fails fast on startup if required configuration is missing or invalid.

## License

MIT
