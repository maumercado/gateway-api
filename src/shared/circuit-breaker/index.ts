import type { Redis } from 'ioredis';
import crypto from 'crypto';

import type {
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitBreakerStatus,
} from '../types/index.js';

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  enabled: true,
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000,
};

function getRedisKey(tenantId: string, routeId: string, upstreamUrl: string): string {
  const urlHash = crypto.createHash('md5').update(upstreamUrl).digest('hex').slice(0, 8);
  return `cb:${tenantId}:${routeId}:${urlHash}`;
}

function getDefaultStatus(): CircuitBreakerStatus {
  return {
    state: 'CLOSED',
    failures: 0,
    successes: 0,
    lastFailureTime: null,
    lastStateChange: Date.now(),
  };
}

export class CircuitBreaker {
  private redis: Redis;
  private config: CircuitBreakerConfig;
  private tenantId: string;
  private routeId: string;
  private upstreamUrl: string;
  private redisKey: string;

  constructor(
    redis: Redis,
    tenantId: string,
    routeId: string,
    upstreamUrl: string,
    config?: Partial<CircuitBreakerConfig>
  ) {
    this.redis = redis;
    this.tenantId = tenantId;
    this.routeId = routeId;
    this.upstreamUrl = upstreamUrl;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.redisKey = getRedisKey(tenantId, routeId, upstreamUrl);
  }

  private getTtl(): number {
    // TTL is timeout + 60 seconds buffer
    return Math.ceil((this.config.timeout + 60000) / 1000);
  }

  async getStatus(): Promise<CircuitBreakerStatus> {
    const data = await this.redis.get(this.redisKey);
    if (!data) {
      return getDefaultStatus();
    }

    try {
      return JSON.parse(data) as CircuitBreakerStatus;
    } catch {
      return getDefaultStatus();
    }
  }

  private async setStatus(status: CircuitBreakerStatus): Promise<void> {
    await this.redis.setex(this.redisKey, this.getTtl(), JSON.stringify(status));
  }

  async canExecute(): Promise<boolean> {
    if (!this.config.enabled) {
      return true;
    }

    const status = await this.getStatus();

    switch (status.state) {
      case 'CLOSED':
        return true;

      case 'OPEN': {
        // Check if timeout has passed to transition to HALF_OPEN
        const timeSinceOpen = Date.now() - status.lastStateChange;
        if (timeSinceOpen >= this.config.timeout) {
          // Transition to HALF_OPEN
          await this.setStatus({
            ...status,
            state: 'HALF_OPEN',
            successes: 0,
            lastStateChange: Date.now(),
          });
          return true;
        }
        return false;
      }

      case 'HALF_OPEN':
        // Allow limited requests in HALF_OPEN state
        return true;

      default:
        return true;
    }
  }

  async recordSuccess(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const status = await this.getStatus();

    if (status.state === 'HALF_OPEN') {
      const newSuccesses = status.successes + 1;

      if (newSuccesses >= this.config.successThreshold) {
        // Transition to CLOSED
        await this.setStatus({
          state: 'CLOSED',
          failures: 0,
          successes: 0,
          lastFailureTime: status.lastFailureTime,
          lastStateChange: Date.now(),
        });
      } else {
        await this.setStatus({
          ...status,
          successes: newSuccesses,
        });
      }
    } else if (status.state === 'CLOSED' && status.failures > 0) {
      // Reset failure count on success in CLOSED state
      await this.setStatus({
        ...status,
        failures: 0,
      });
    }
  }

  async recordFailure(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const status = await this.getStatus();
    const now = Date.now();

    if (status.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN transitions back to OPEN
      await this.setStatus({
        state: 'OPEN',
        failures: status.failures + 1,
        successes: 0,
        lastFailureTime: now,
        lastStateChange: now,
      });
    } else if (status.state === 'CLOSED') {
      const newFailures = status.failures + 1;

      if (newFailures >= this.config.failureThreshold) {
        // Transition to OPEN
        await this.setStatus({
          state: 'OPEN',
          failures: newFailures,
          successes: 0,
          lastFailureTime: now,
          lastStateChange: now,
        });
      } else {
        await this.setStatus({
          ...status,
          failures: newFailures,
          lastFailureTime: now,
        });
      }
    }
  }

  async reset(): Promise<void> {
    await this.redis.del(this.redisKey);
  }

  getState(): Promise<CircuitBreakerState> {
    return this.getStatus().then((s) => s.state);
  }
}

export function createCircuitBreaker(
  redis: Redis,
  tenantId: string,
  routeId: string,
  upstreamUrl: string,
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  return new CircuitBreaker(redis, tenantId, routeId, upstreamUrl, config);
}
