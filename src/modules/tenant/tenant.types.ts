import type { RateLimitConfig } from '../../shared/types/index.js';

export interface Tenant {
  id: string;
  name: string;
  isActive: boolean;
  defaultRateLimit: RateLimitConfig | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantInput {
  name: string;
  apiKey: string;
  defaultRateLimit?: RateLimitConfig;
}

export interface TenantWithApiKeyHash extends Tenant {
  apiKeyHash: string;
}
