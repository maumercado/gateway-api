import { vi } from 'vitest';

// Mock Redis client
vi.mock('../shared/redis/client.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    zrange: vi.fn(),
    zremrangebyscore: vi.fn(),
    eval: vi.fn(),
    pipeline: vi.fn(() => ({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      zcount: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([null, null, [null, 1], null]),
    })),
  },
  connectRedis: vi.fn(),
  closeRedis: vi.fn(),
}));

// Mock database client
vi.mock('../shared/database/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  closeDatabase: vi.fn(),
}));
