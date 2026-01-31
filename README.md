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
├── modules/
│   ├── tenant/           # Tenant management
│   │   ├── tenant.schema.ts
│   │   ├── tenant.repository.ts
│   │   ├── tenant.service.ts
│   │   ├── tenant.routes.ts
│   │   └── tenant.types.ts
│   └── routing/          # Route matching & proxying
│       ├── routing.schema.ts
│       ├── routing.repository.ts
│       ├── routing.service.ts
│       ├── routing.handler.ts
│       ├── routing.routes.ts
│       └── routing.types.ts
├── plugins/
│   ├── admin-auth.ts     # Admin API key authentication
│   ├── database.ts       # PostgreSQL connection lifecycle
│   ├── rate-limit.ts     # Rate limiting middleware
│   ├── redis.ts          # Redis connection lifecycle
│   ├── routing-service.ts # Routing service plugin
│   ├── tenant-auth.ts    # Tenant API key authentication
│   └── tenant-service.ts # Tenant service plugin
├── shared/
│   ├── config/           # Environment configuration
│   ├── database/         # Drizzle client & schema
│   ├── load-balancer/    # Load balancing strategies
│   ├── rate-limiter/     # Redis sliding window rate limiter
│   ├── redis/            # Redis client
│   ├── transformer/      # Request/response transformation
│   └── types/            # Shared types
├── gateway.ts            # Main gateway server
└── index.ts              # Entry point
```

## API Endpoints

### Health Check (No Auth)

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

### Admin API (X-Admin-Key Required)

Manage tenants and routes:

```bash
# Tenants
GET    /admin/tenants           # List all tenants
GET    /admin/tenants/:id       # Get tenant by ID
POST   /admin/tenants           # Create tenant
PATCH  /admin/tenants/:id       # Update tenant
DELETE /admin/tenants/:id       # Delete tenant

# Routes
GET    /admin/tenants/:id/routes  # List routes for tenant
GET    /admin/routes/:id          # Get route by ID
POST   /admin/routes              # Create route
PATCH  /admin/routes/:id          # Update route
DELETE /admin/routes/:id          # Delete route
```

Example:
```bash
curl -H "X-Admin-Key: your-admin-key" http://localhost:3000/admin/tenants
```

### Proxy Requests (X-API-Key Required)

All other requests require the `X-API-Key` header for tenant authentication:

```bash
curl -H "X-API-Key: your-tenant-api-key" http://localhost:3000/your-route
```

Responses include rate limit headers:
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

## Architecture

### Multi-tenant Design

Each tenant is identified by an API key. The gateway:
1. Validates the API key from `X-API-Key` header
2. Caches tenant data in Redis (5-second TTL)
3. Checks rate limits (Redis sliding window algorithm)
4. Matches the request path against tenant's configured routes
5. Selects upstream using configured load balancing strategy
6. Applies request transformations and proxies to upstream
7. Applies response transformations and returns to client

### Route Matching

Routes support three path types:
- **exact**: Matches the path exactly
- **prefix**: Matches paths starting with the route path
- **regex**: Matches paths using regex patterns

### Load Balancing

Routes can be configured with multiple upstreams and load balancing strategies:
- **round-robin**: Cycles through upstreams sequentially
- **weighted**: Random selection weighted by upstream weight
- **random**: Random upstream selection

### Rate Limiting

Per-tenant rate limiting using Redis sliding window:
- Configurable requests per second and burst size per tenant
- Returns `429 Too Many Requests` when exceeded
- Includes `Retry-After` header

### Request/Response Transformation

Routes support transformations:
- Add, remove, or set headers
- Rewrite paths using regex patterns

### Plugin Architecture

The gateway uses Fastify's plugin system with proper dependency management:
- Infrastructure plugins: `database`, `redis`
- Service plugins: `tenant-service`, `routing-service`
- Auth plugins: `tenant-auth`, `admin-auth`, `rate-limit`

Plugins declare dependencies ensuring correct initialization order.

## License

MIT
