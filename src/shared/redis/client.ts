import { Redis } from 'ioredis';

import { config } from '../config/index.js';
import { logger } from '../logger/index.js';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true,
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err: Error) => {
  logger.error({ err }, 'Redis error');
});

redis.on('close', () => {
  logger.info('Redis connection closed');
});

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

export async function closeRedis(): Promise<void> {
  logger.info('Closing Redis connection...');
  await redis.quit();
  logger.info('Redis connection closed');
}
