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
- pnpm 9+
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
| `pnpm test` | Run tests |
| `pnpm test:coverage` | Run tests with coverage |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Fix auto-fixable lint issues |
| `pnpm format` | Format code with Prettier |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## Project Structure

```
src/
├── modules/
│   ├── tenant/           # Tenant management
│   │   ├── tenant.schema.ts
│   │   ├── tenant.repository.ts
│   │   ├── tenant.service.ts
│   │   └── tenant.types.ts
│   └── routing/          # Route matching & proxying
│       ├── routing.schema.ts
│       ├── routing.repository.ts
│       ├── routing.service.ts
│       ├── routing.handler.ts
│       └── routing.types.ts
├── shared/
│   ├── config/           # Environment configuration
│   ├── database/         # Drizzle client & schema
│   ├── redis/            # Redis client
│   ├── logger/           # Pino logger
│   └── types/            # Shared types
├── middleware/
│   └── tenant-auth.ts    # API key authentication
├── gateway.ts            # Main gateway server
└── index.ts              # Entry point
```

## API Endpoints

### Health Check

```bash
curl http://localhost:3000/health
```

### Proxy Requests

All other requests require the `X-API-Key` header for tenant authentication:

```bash
curl -H "X-API-Key: your-api-key" http://localhost:3000/your-route
```

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
3. Matches the request path against tenant's configured routes
4. Proxies the request to the matching upstream

### Route Matching

Routes support three path types:
- **exact**: Matches the path exactly
- **prefix**: Matches paths starting with the route path
- **regex**: (Phase 2) Matches paths using regex patterns

### Load Balancing

Routes can be configured with multiple upstreams and load balancing strategies:
- **round-robin**: (Phase 2)
- **weighted**: (Phase 2)
- **random**: (Phase 2)

Currently, the first upstream is always selected.

## License

MIT
