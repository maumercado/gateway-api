import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compare, hash } from 'bcrypt';

// Mock bcrypt
vi.mock('bcrypt', () => ({
  hash: vi.fn(),
  compare: vi.fn(),
}));

import type { TenantRepository } from './tenant.repository.js';
import { createTenantService, type TenantService } from './tenant.service.js';
import type { TenantRow } from './tenant.schema.js';

const mockHash = hash as ReturnType<typeof vi.fn>;
const mockCompare = compare as ReturnType<typeof vi.fn>;

const createMockTenantRow = (overrides: Partial<TenantRow> = {}): TenantRow => ({
  id: 'tenant-1',
  name: 'Test Tenant',
  apiKeyHash: '$2b$12$hashedkey',
  isActive: true,
  defaultRateLimit: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

function createMockRepository(): TenantRepository {
  return {
    findTenantById: vi.fn(),
    findTenantByName: vi.fn(),
    findAllTenants: vi.fn(),
    findActiveTenants: vi.fn(),
    createTenant: vi.fn(),
    updateTenant: vi.fn(),
    deleteTenant: vi.fn(),
  };
}

function createMockRedis() {
  return {
    get: vi.fn(),
    setex: vi.fn(),
  };
}

describe('Tenant Service', () => {
  let mockRepository: TenantRepository;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let tenantService: TenantService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository = createMockRepository();
    mockRedis = createMockRedis();
    tenantService = createTenantService({
      repository: mockRepository,
      redis: mockRedis as never,
    });
  });

  describe('getTenantById', () => {
    it('should return tenant when found', async () => {
      const mockRow = createMockTenantRow();
      vi.mocked(mockRepository.findTenantById).mockResolvedValue(mockRow);

      const result = await tenantService.getTenantById('tenant-1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('tenant-1');
      expect(result?.name).toBe('Test Tenant');
      // apiKeyHash should not be exposed
      expect(result).not.toHaveProperty('apiKeyHash');
    });

    it('should return null when not found', async () => {
      vi.mocked(mockRepository.findTenantById).mockResolvedValue(null);

      const result = await tenantService.getTenantById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getTenantByName', () => {
    it('should return tenant when found', async () => {
      const mockRow = createMockTenantRow();
      vi.mocked(mockRepository.findTenantByName).mockResolvedValue(mockRow);

      const result = await tenantService.getTenantByName('Test Tenant');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Test Tenant');
    });
  });

  describe('getAllTenants', () => {
    it('should return all tenants', async () => {
      vi.mocked(mockRepository.findAllTenants).mockResolvedValue([
        createMockTenantRow({ id: 'tenant-1' }),
        createMockTenantRow({ id: 'tenant-2', name: 'Tenant 2' }),
      ]);

      const result = await tenantService.getAllTenants();

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('tenant-1');
      expect(result[1]?.id).toBe('tenant-2');
    });
  });

  describe('getActiveTenants', () => {
    it('should return only active tenants', async () => {
      vi.mocked(mockRepository.findActiveTenants).mockResolvedValue([
        createMockTenantRow({ id: 'tenant-1', isActive: true }),
      ]);

      const result = await tenantService.getActiveTenants();

      expect(result).toHaveLength(1);
      expect(result[0]?.isActive).toBe(true);
    });
  });

  describe('createTenant', () => {
    it('should hash API key and create tenant', async () => {
      mockHash.mockResolvedValue('$2b$12$hashedkey');
      vi.mocked(mockRepository.createTenant).mockResolvedValue(createMockTenantRow());

      const result = await tenantService.createTenant({
        name: 'Test Tenant',
        apiKey: 'my-secret-api-key',
      });

      expect(mockHash).toHaveBeenCalledWith('my-secret-api-key', 12);
      expect(mockRepository.createTenant).toHaveBeenCalledWith({
        name: 'Test Tenant',
        apiKeyHash: '$2b$12$hashedkey',
        defaultRateLimit: null,
      });
      expect(result.id).toBe('tenant-1');
    });

    it('should include rate limit config when provided', async () => {
      mockHash.mockResolvedValue('$2b$12$hashedkey');
      vi.mocked(mockRepository.createTenant).mockResolvedValue(
        createMockTenantRow({
          defaultRateLimit: { requestsPerSecond: 100, burstSize: 150 },
        })
      );

      await tenantService.createTenant({
        name: 'Test Tenant',
        apiKey: 'my-secret-api-key',
        defaultRateLimit: { requestsPerSecond: 100, burstSize: 150 },
      });

      expect(mockRepository.createTenant).toHaveBeenCalledWith({
        name: 'Test Tenant',
        apiKeyHash: '$2b$12$hashedkey',
        defaultRateLimit: { requestsPerSecond: 100, burstSize: 150 },
      });
    });
  });

  describe('validateApiKey', () => {
    it('should return cached tenant when available', async () => {
      const cachedTenant = {
        id: 'tenant-1',
        name: 'Test Tenant',
        isActive: true,
        defaultRateLimit: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedTenant));

      const result = await tenantService.validateApiKey('my-api-key');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('tenant-1');
      expect(result?.createdAt).toBeInstanceOf(Date);
      expect(mockRepository.findActiveTenants).not.toHaveBeenCalled();
    });

    it('should return null when cached tenant is inactive', async () => {
      const cachedTenant = {
        id: 'tenant-1',
        name: 'Test Tenant',
        isActive: false,
        defaultRateLimit: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedTenant));

      const result = await tenantService.validateApiKey('my-api-key');

      expect(result).toBeNull();
    });

    it('should validate against database when not cached', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(mockRepository.findActiveTenants).mockResolvedValue([createMockTenantRow()]);
      mockCompare.mockResolvedValue(true);
      mockRedis.setex.mockResolvedValue('OK');

      const result = await tenantService.validateApiKey('my-api-key');

      expect(result).not.toBeNull();
      expect(mockRepository.findActiveTenants).toHaveBeenCalled();
      expect(mockCompare).toHaveBeenCalledWith('my-api-key', '$2b$12$hashedkey');
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should return null when API key does not match', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(mockRepository.findActiveTenants).mockResolvedValue([createMockTenantRow()]);
      mockCompare.mockResolvedValue(false);

      const result = await tenantService.validateApiKey('wrong-api-key');

      expect(result).toBeNull();
    });

    it('should cache tenant after successful validation', async () => {
      mockRedis.get.mockResolvedValue(null);
      vi.mocked(mockRepository.findActiveTenants).mockResolvedValue([createMockTenantRow()]);
      mockCompare.mockResolvedValue(true);
      mockRedis.setex.mockResolvedValue('OK');

      await tenantService.validateApiKey('my-api-key');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'tenant:apikey:my-api-key',
        5,
        expect.any(String)
      );
    });
  });

  describe('deactivateTenant', () => {
    it('should deactivate tenant', async () => {
      vi.mocked(mockRepository.updateTenant).mockResolvedValue(
        createMockTenantRow({ isActive: false })
      );

      const result = await tenantService.deactivateTenant('tenant-1');

      expect(mockRepository.updateTenant).toHaveBeenCalledWith('tenant-1', {
        isActive: false,
      });
      expect(result?.isActive).toBe(false);
    });
  });

  describe('activateTenant', () => {
    it('should activate tenant', async () => {
      vi.mocked(mockRepository.updateTenant).mockResolvedValue(
        createMockTenantRow({ isActive: true })
      );

      const result = await tenantService.activateTenant('tenant-1');

      expect(mockRepository.updateTenant).toHaveBeenCalledWith('tenant-1', {
        isActive: true,
      });
      expect(result?.isActive).toBe(true);
    });
  });

  describe('deleteTenant', () => {
    it('should delete tenant', async () => {
      vi.mocked(mockRepository.deleteTenant).mockResolvedValue(true);

      const result = await tenantService.deleteTenant('tenant-1');

      expect(result).toBe(true);
      expect(mockRepository.deleteTenant).toHaveBeenCalledWith('tenant-1');
    });

    it('should return false when tenant not found', async () => {
      vi.mocked(mockRepository.deleteTenant).mockResolvedValue(false);

      const result = await tenantService.deleteTenant('non-existent');

      expect(result).toBe(false);
    });
  });
});
