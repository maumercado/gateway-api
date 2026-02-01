import { compare, hash } from 'bcrypt';
import type { Redis } from 'ioredis';

import type { TenantRepository } from './tenant.repository.js';
import type { TenantRow } from './tenant.schema.js';
import type { CreateTenantInput, Tenant } from './tenant.types.js';

const TENANT_CACHE_PREFIX = 'tenant:apikey:';
const TENANT_CACHE_TTL_SECONDS = 5;
const BCRYPT_ROUNDS = 12;

function mapToTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    defaultRateLimit: row.defaultRateLimit,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface TenantServiceDeps {
  repository: TenantRepository;
  redis: Redis;
}

export interface TenantService {
  getTenantById(id: string): Promise<Tenant | null>;
  getTenantByName(name: string): Promise<Tenant | null>;
  getAllTenants(): Promise<Tenant[]>;
  getActiveTenants(): Promise<Tenant[]>;
  createTenant(input: CreateTenantInput): Promise<Tenant>;
  validateApiKey(apiKey: string): Promise<Tenant | null>;
  deactivateTenant(id: string): Promise<Tenant | null>;
  activateTenant(id: string): Promise<Tenant | null>;
  deleteTenant(id: string): Promise<boolean>;
}

export function createTenantService(deps: TenantServiceDeps): TenantService {
  const { repository, redis } = deps;

  return {
    async getTenantById(id: string): Promise<Tenant | null> {
      const row = await repository.findTenantById(id);
      return row ? mapToTenant(row) : null;
    },

    async getTenantByName(name: string): Promise<Tenant | null> {
      const row = await repository.findTenantByName(name);
      return row ? mapToTenant(row) : null;
    },

    async getAllTenants(): Promise<Tenant[]> {
      const rows = await repository.findAllTenants();
      return rows.map(mapToTenant);
    },

    async getActiveTenants(): Promise<Tenant[]> {
      const rows = await repository.findActiveTenants();
      return rows.map(mapToTenant);
    },

    async createTenant(input: CreateTenantInput): Promise<Tenant> {
      const apiKeyHash = await hash(input.apiKey, BCRYPT_ROUNDS);

      const row = await repository.createTenant({
        name: input.name,
        apiKeyHash,
        defaultRateLimit: input.defaultRateLimit ?? null,
      });

      return mapToTenant(row);
    },

    async validateApiKey(apiKey: string): Promise<Tenant | null> {
      const cacheKey = `${TENANT_CACHE_PREFIX}${apiKey}`;

      const cached = await redis.get(cacheKey);
      if (cached) {
        const tenant = JSON.parse(cached) as Tenant;
        if (!tenant.isActive) {
          return null;
        }
        return {
          ...tenant,
          createdAt: new Date(tenant.createdAt),
          updatedAt: new Date(tenant.updatedAt),
        };
      }

      const tenants = await repository.findActiveTenants();

      for (const row of tenants) {
        const isMatch = await compare(apiKey, row.apiKeyHash);
        if (isMatch) {
          const tenant = mapToTenant(row);

          await redis.setex(cacheKey, TENANT_CACHE_TTL_SECONDS, JSON.stringify(tenant));

          return tenant;
        }
      }

      return null;
    },

    async deactivateTenant(id: string): Promise<Tenant | null> {
      const row = await repository.updateTenant(id, { isActive: false });
      return row ? mapToTenant(row) : null;
    },

    async activateTenant(id: string): Promise<Tenant | null> {
      const row = await repository.updateTenant(id, { isActive: true });
      return row ? mapToTenant(row) : null;
    },

    async deleteTenant(id: string): Promise<boolean> {
      return repository.deleteTenant(id);
    },
  };
}
