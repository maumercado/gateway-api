import { compare, hash } from 'bcrypt';

import * as tenantRepository from './tenant.repository.js';
import type { TenantRow } from './tenant.schema.js';
import type { CreateTenantInput, Tenant } from './tenant.types.js';
import { redis } from '../../shared/redis/client.js';

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

export async function getTenantById(id: string): Promise<Tenant | null> {
  const row = await tenantRepository.findTenantById(id);
  return row ? mapToTenant(row) : null;
}

export async function getTenantByName(name: string): Promise<Tenant | null> {
  const row = await tenantRepository.findTenantByName(name);
  return row ? mapToTenant(row) : null;
}

export async function getAllTenants(): Promise<Tenant[]> {
  const rows = await tenantRepository.findAllTenants();
  return rows.map(mapToTenant);
}

export async function getActiveTenants(): Promise<Tenant[]> {
  const rows = await tenantRepository.findActiveTenants();
  return rows.map(mapToTenant);
}

export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const apiKeyHash = await hash(input.apiKey, BCRYPT_ROUNDS);

  const row = await tenantRepository.createTenant({
    name: input.name,
    apiKeyHash,
    defaultRateLimit: input.defaultRateLimit ?? null,
  });

  return mapToTenant(row);
}

export async function validateApiKey(
  apiKey: string
): Promise<Tenant | null> {
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

  const tenants = await tenantRepository.findActiveTenants();

  for (const row of tenants) {
    const isMatch = await compare(apiKey, row.apiKeyHash);
    if (isMatch) {
      const tenant = mapToTenant(row);

      await redis.setex(cacheKey, TENANT_CACHE_TTL_SECONDS, JSON.stringify(tenant));

      return tenant;
    }
  }

  return null;
}

export async function deactivateTenant(id: string): Promise<Tenant | null> {
  const row = await tenantRepository.updateTenant(id, { isActive: false });
  return row ? mapToTenant(row) : null;
}

export async function activateTenant(id: string): Promise<Tenant | null> {
  const row = await tenantRepository.updateTenant(id, { isActive: true });
  return row ? mapToTenant(row) : null;
}

export async function deleteTenant(id: string): Promise<boolean> {
  return tenantRepository.deleteTenant(id);
}
