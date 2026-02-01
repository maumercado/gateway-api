import type { Redis } from 'ioredis';
import crypto from 'crypto';

import { healthCheckStatus, normalizeUpstreamLabel } from '../metrics/index.js';
import type { HealthCheckConfig, HealthStatus, UpstreamConfig } from '../types/index.js';

const DEFAULT_CONFIG: HealthCheckConfig = {
  enabled: true,
  endpoint: '/health',
  intervalMs: 30000,
  timeoutMs: 5000,
  healthyThreshold: 2,
  unhealthyThreshold: 3,
};

const MIN_INTERVAL_MS = 5000;

function getRedisKey(tenantId: string, routeId: string, upstreamUrl: string): string {
  const urlHash = crypto.createHash('md5').update(upstreamUrl).digest('hex').slice(0, 8);
  return `health:${tenantId}:${routeId}:${urlHash}`;
}

function getDefaultStatus(): HealthStatus {
  return {
    healthy: true, // Assume healthy until proven otherwise
    consecutiveSuccesses: 0,
    consecutiveFailures: 0,
    lastCheckTime: null,
    lastSuccessTime: null,
    lastFailureTime: null,
  };
}

export class HealthChecker {
  private redis: Redis;
  private config: HealthCheckConfig;
  private tenantId: string;
  private routeId: string;
  private upstream: UpstreamConfig;
  private redisKey: string;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    redis: Redis,
    tenantId: string,
    routeId: string,
    upstream: UpstreamConfig,
    config?: Partial<HealthCheckConfig>
  ) {
    this.redis = redis;
    this.tenantId = tenantId;
    this.routeId = routeId;
    this.upstream = upstream;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      intervalMs: Math.max(config?.intervalMs ?? DEFAULT_CONFIG.intervalMs, MIN_INTERVAL_MS),
    };
    this.redisKey = getRedisKey(tenantId, routeId, upstream.url);
  }

  private getTtl(): number {
    // TTL is 3x the interval to allow for missed checks
    return Math.ceil((this.config.intervalMs * 3) / 1000);
  }

  async getStatus(): Promise<HealthStatus> {
    const data = await this.redis.get(this.redisKey);
    if (!data) {
      return getDefaultStatus();
    }

    try {
      return JSON.parse(data) as HealthStatus;
    } catch {
      return getDefaultStatus();
    }
  }

  private async setStatus(status: HealthStatus): Promise<void> {
    await this.redis.setex(this.redisKey, this.getTtl(), JSON.stringify(status));

    // Update health check status gauge
    const upstreamLabel = normalizeUpstreamLabel(this.upstream.url);
    healthCheckStatus.set(
      {
        tenant_id: this.tenantId,
        route_id: this.routeId,
        upstream: upstreamLabel,
      },
      status.healthy ? 1 : 0
    );
  }

  async isHealthy(): Promise<boolean> {
    if (!this.config.enabled) {
      return true;
    }

    const status = await this.getStatus();
    return status.healthy;
  }

  async check(): Promise<boolean> {
    if (!this.config.enabled) {
      return true;
    }

    const now = Date.now();
    const status = await this.getStatus();

    // Build health check URL
    const baseUrl = this.upstream.url.replace(/\/$/, '');
    const healthUrl = `${baseUrl}${this.config.endpoint}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return this.recordSuccess(status, now);
      } else {
        return this.recordFailure(status, now);
      }
    } catch {
      return this.recordFailure(status, now);
    }
  }

  private async recordSuccess(
    currentStatus: HealthStatus,
    timestamp: number
  ): Promise<boolean> {
    const healthyThreshold = this.config.healthyThreshold ?? 2;
    const newSuccesses = currentStatus.consecutiveSuccesses + 1;
    const isNowHealthy = newSuccesses >= healthyThreshold;

    const newStatus: HealthStatus = {
      healthy: currentStatus.healthy || isNowHealthy,
      consecutiveSuccesses: newSuccesses,
      consecutiveFailures: 0,
      lastCheckTime: timestamp,
      lastSuccessTime: timestamp,
      lastFailureTime: currentStatus.lastFailureTime,
    };

    await this.setStatus(newStatus);
    return newStatus.healthy;
  }

  private async recordFailure(
    currentStatus: HealthStatus,
    timestamp: number
  ): Promise<boolean> {
    const unhealthyThreshold = this.config.unhealthyThreshold ?? 3;
    const newFailures = currentStatus.consecutiveFailures + 1;
    const isNowUnhealthy = newFailures >= unhealthyThreshold;

    const newStatus: HealthStatus = {
      healthy: currentStatus.healthy && !isNowUnhealthy,
      consecutiveSuccesses: 0,
      consecutiveFailures: newFailures,
      lastCheckTime: timestamp,
      lastSuccessTime: currentStatus.lastSuccessTime,
      lastFailureTime: timestamp,
    };

    await this.setStatus(newStatus);
    return newStatus.healthy;
  }

  start(): void {
    if (this.intervalId || !this.config.enabled) {
      return;
    }

    // Perform initial check
    void this.check();

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      void this.check();
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async reset(): Promise<void> {
    this.stop();
    await this.redis.del(this.redisKey);
  }
}

export interface HealthCheckManagerOptions {
  redis: Redis;
}

export class HealthCheckManager {
  private redis: Redis;
  private checkers: Map<string, HealthChecker> = new Map();

  constructor(options: HealthCheckManagerOptions) {
    this.redis = options.redis;
  }

  private getCheckerKey(tenantId: string, routeId: string, upstreamUrl: string): string {
    return `${tenantId}:${routeId}:${upstreamUrl}`;
  }

  registerUpstream(
    tenantId: string,
    routeId: string,
    upstream: UpstreamConfig,
    config?: Partial<HealthCheckConfig>
  ): HealthChecker {
    const key = this.getCheckerKey(tenantId, routeId, upstream.url);

    // Return existing checker if already registered
    const existing = this.checkers.get(key);
    if (existing) {
      return existing;
    }

    const checker = new HealthChecker(
      this.redis,
      tenantId,
      routeId,
      upstream,
      config
    );

    this.checkers.set(key, checker);
    return checker;
  }

  getChecker(
    tenantId: string,
    routeId: string,
    upstreamUrl: string
  ): HealthChecker | undefined {
    const key = this.getCheckerKey(tenantId, routeId, upstreamUrl);
    return this.checkers.get(key);
  }

  async isUpstreamHealthy(
    tenantId: string,
    routeId: string,
    upstreamUrl: string
  ): Promise<boolean> {
    const checker = this.getChecker(tenantId, routeId, upstreamUrl);
    if (!checker) {
      return true; // Assume healthy if no checker registered
    }
    return checker.isHealthy();
  }

  startAll(): void {
    for (const checker of this.checkers.values()) {
      checker.start();
    }
  }

  stopAll(): void {
    for (const checker of this.checkers.values()) {
      checker.stop();
    }
  }

  async forceCheck(
    tenantId: string,
    routeId: string,
    upstreamUrl: string
  ): Promise<boolean> {
    const checker = this.getChecker(tenantId, routeId, upstreamUrl);
    if (!checker) {
      return true;
    }
    return checker.check();
  }

  async forceCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const [key, checker] of this.checkers.entries()) {
      results.set(key, await checker.check());
    }
    return results;
  }

  unregisterUpstream(
    tenantId: string,
    routeId: string,
    upstreamUrl: string
  ): void {
    const key = this.getCheckerKey(tenantId, routeId, upstreamUrl);
    const checker = this.checkers.get(key);
    if (checker) {
      checker.stop();
      this.checkers.delete(key);
    }
  }

  clear(): void {
    this.stopAll();
    this.checkers.clear();
  }
}

export function createHealthCheckManager(redis: Redis): HealthCheckManager {
  return new HealthCheckManager({ redis });
}
