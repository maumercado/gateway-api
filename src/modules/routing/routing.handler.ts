import type { FastifyReply, FastifyRequest } from 'fastify';

import { createCircuitBreaker } from '../../shared/circuit-breaker/index.js';
import { sendFallbackResponse, shouldUseFallback } from '../../shared/fallback/index.js';
import {
  normalizeUpstreamLabel,
  retryAttemptsTotal,
  upstreamRequestDurationSeconds,
  upstreamRequestsTotal,
} from '../../shared/metrics/index.js';
import {
  withRetry,
  isRetryableStatusCode,
  type RetryContext,
} from '../../shared/retry/index.js';
import {
  transformRequest,
  transformResponseHeaders,
} from '../../shared/transformer/index.js';
import type { TimeoutConfig } from '../../shared/types/index.js';
import type { Tenant } from '../tenant/tenant.types.js';
import type { Route } from './routing.types.js';

interface ProxyRequest extends FastifyRequest {
  tenant: Tenant;
}

/**
 * Resolve timeout based on configuration and HTTP method
 */
function resolveTimeout(
  method: string,
  upstreamTimeout: number | undefined,
  timeoutConfig: TimeoutConfig | undefined
): number {
  // Priority: method-specific > default config > upstream > hardcoded default
  if (timeoutConfig?.byMethod) {
    const methodTimeout = timeoutConfig.byMethod[method as keyof TimeoutConfig['byMethod']];
    if (methodTimeout !== undefined) {
      return methodTimeout;
    }
  }

  if (timeoutConfig?.default !== undefined) {
    return timeoutConfig.default;
  }

  return upstreamTimeout ?? 30000;
}

interface UpstreamRequestOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  timeout: number;
  tenantId: string;
}

interface UpstreamRequestResult {
  response: Response;
  durationSeconds: number;
}

/**
 * Make an upstream request with the given parameters
 * Also records timing metrics for the upstream call
 */
async function makeUpstreamRequest(
  options: UpstreamRequestOptions
): Promise<UpstreamRequestResult> {
  const { url, method, headers, body, timeout, tenantId } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const startTime = process.hrtime.bigint();

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
      signal: controller.signal,
    });

    const endTime = process.hrtime.bigint();
    const durationSeconds = Number(endTime - startTime) / 1e9;
    const upstreamLabel = normalizeUpstreamLabel(url);

    // Record upstream metrics
    upstreamRequestsTotal.inc({
      tenant_id: tenantId,
      upstream: upstreamLabel,
      method,
      status_code: response.status.toString(),
    });

    upstreamRequestDurationSeconds.observe(
      {
        tenant_id: tenantId,
        upstream: upstreamLabel,
        method,
        status_code: response.status.toString(),
      },
      durationSeconds
    );

    return { response, durationSeconds };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function handleProxy(
  request: ProxyRequest,
  reply: FastifyReply
): Promise<void> {
  const { tenant } = request;
  const { method, url, log, server } = request;
  const { routingService, redis, healthChecker } = server;

  // Parse the URL to get just the path
  const urlPath = url.split('?')[0] ?? '/';

  log.debug(
    { tenantId: tenant.id, method, path: urlPath },
    'Matching route for request'
  );

  const matched = await routingService.matchRoute(tenant.id, method, urlPath);

  if (!matched) {
    log.debug(
      { tenantId: tenant.id, method, path: urlPath },
      'No matching route found'
    );
    return reply.status(404).send({
      error: 'Not Found',
      message: 'No matching route found',
    });
  }

  const { route, upstream } = matched;
  const resilience = route.resilience;

  // Build the upstream URL
  let upstreamUrl = upstream.url;

  // Handle path prefix routes - append the remaining path
  if (route.pathType === 'prefix') {
    const remainingPath = urlPath.slice(route.path.length);
    upstreamUrl = `${upstream.url}${remainingPath}`;
  }

  // Preserve query string
  const queryString = url.includes('?') ? url.split('?')[1] : '';
  if (queryString) {
    upstreamUrl = `${upstreamUrl}?${queryString}`;
  }

  log.debug(
    {
      tenantId: tenant.id,
      upstreamUrl,
      routeId: route.id,
    },
    'Proxying request to upstream'
  );

  // Check health status if health checks are enabled
  if (resilience?.healthCheck?.enabled && healthChecker) {
    const isHealthy = await healthChecker.isUpstreamHealthy(
      tenant.id,
      route.id,
      upstream.url
    );

    if (!isHealthy) {
      log.warn(
        { tenantId: tenant.id, upstreamUrl, routeId: route.id },
        'Upstream marked as unhealthy by health check'
      );

      // Use fallback if configured, otherwise return 503
      if (shouldUseFallback(resilience.fallback)) {
        return sendFallbackResponse(reply, resilience.fallback);
      }

      return reply.status(503).send({
        error: 'Service Unavailable',
        message: 'Upstream service is unhealthy',
      });
    }
  }

  // Create circuit breaker if configured
  const circuitBreaker = resilience?.circuitBreaker?.enabled
    ? createCircuitBreaker(
        redis,
        tenant.id,
        route.id,
        upstream.url,
        resilience.circuitBreaker
      )
    : null;

  // Check circuit breaker state
  if (circuitBreaker) {
    const canExecute = await circuitBreaker.canExecute();
    if (!canExecute) {
      log.warn(
        { tenantId: tenant.id, upstreamUrl, routeId: route.id },
        'Circuit breaker is OPEN'
      );

      // Use fallback if configured
      if (shouldUseFallback(resilience?.fallback)) {
        return sendFallbackResponse(reply, resilience?.fallback);
      }

      return reply.status(503).send({
        error: 'Service Unavailable',
        message: 'Circuit breaker is open - upstream is temporarily unavailable',
      });
    }
  }

  // Prepare headers for upstream request
  const headers: Record<string, string> = {};

  // Copy relevant headers from the original request
  const headersToForward = [
    'content-type',
    'accept',
    'accept-language',
    'accept-encoding',
    'user-agent',
    'authorization',
  ];

  for (const header of headersToForward) {
    const value = request.headers[header];
    if (typeof value === 'string') {
      headers[header] = value;
    }
  }

  // Add forwarding headers
  headers['x-forwarded-for'] = request.ip;
  headers['x-forwarded-host'] = request.hostname;
  headers['x-forwarded-proto'] = request.protocol;
  headers['x-tenant-id'] = tenant.id;

  // Apply request transformations
  const transformed = transformRequest(headers, upstreamUrl, route.transform);
  const finalHeaders = transformed.headers;
  const finalUrl = transformed.path;

  // Resolve timeout
  const timeout = resolveTimeout(method, upstream.timeout, resilience?.timeout);

  // Get request body
  const requestBody = method !== 'GET' && method !== 'HEAD' ? (request.body as string) : undefined;

  // Execute request with retry logic if configured
  const retryConfig = resilience?.retry;

  try {
    let upstreamResponse: Response;

    if (retryConfig?.enabled) {
      // Use retry wrapper
      const result = await withRetry<Response>(
        async (context: RetryContext) => {
          if (context.attempt > 0) {
            // Track retry attempt in metrics
            retryAttemptsTotal.inc({
              tenant_id: tenant.id,
              route_id: route.id,
              attempt: context.attempt.toString(),
            });

            log.debug(
              {
                tenantId: tenant.id,
                upstreamUrl: finalUrl,
                routeId: route.id,
                attempt: context.attempt,
              },
              'Retrying upstream request'
            );
          }

          const { response } = await makeUpstreamRequest({
            url: finalUrl,
            method,
            headers: finalHeaders,
            body: requestBody,
            timeout,
            tenantId: tenant.id,
          });

          // If response is retryable and we have retries left, throw to trigger retry
          if (
            isRetryableStatusCode(response.status, retryConfig.retryableStatusCodes) &&
            context.attempt < context.maxRetries
          ) {
            const error = new Error(`Upstream returned ${response.status}`) as Error & {
              statusCode: number;
              response: Response;
            };
            error.statusCode = response.status;
            error.response = response;
            throw error;
          }

          return response;
        },
        retryConfig,
        (context, delay) => {
          log.debug(
            {
              tenantId: tenant.id,
              upstreamUrl: finalUrl,
              routeId: route.id,
              attempt: context.attempt,
              delay,
              error: context.error?.message,
            },
            'Scheduling retry after delay'
          );
        }
      );

      if (!result.success || !result.result) {
        // All retries exhausted
        log.error(
          {
            tenantId: tenant.id,
            upstreamUrl: finalUrl,
            routeId: route.id,
            attempts: result.attempts,
            error: result.error?.message,
          },
          'All retry attempts exhausted'
        );

        // Record failure in circuit breaker
        if (circuitBreaker) {
          await circuitBreaker.recordFailure();
        }

        // Use fallback if configured
        if (shouldUseFallback(resilience?.fallback)) {
          return sendFallbackResponse(reply, resilience?.fallback);
        }

        return reply.status(502).send({
          error: 'Bad Gateway',
          message: 'Failed to reach upstream server after retries',
        });
      }

      upstreamResponse = result.result;
    } else {
      // No retry, direct request
      const { response } = await makeUpstreamRequest({
        url: finalUrl,
        method,
        headers: finalHeaders,
        body: requestBody,
        timeout,
        tenantId: tenant.id,
      });
      upstreamResponse = response;
    }

    // Record success in circuit breaker
    if (circuitBreaker && upstreamResponse.ok) {
      await circuitBreaker.recordSuccess();
    } else if (circuitBreaker && !upstreamResponse.ok) {
      // Record failure for server errors
      if (upstreamResponse.status >= 500) {
        await circuitBreaker.recordFailure();
      }
    }

    // Forward the response
    let responseHeaders: Record<string, string> = {};
    upstreamResponse.headers.forEach((value, key) => {
      // Skip hop-by-hop headers
      if (
        !['connection', 'keep-alive', 'transfer-encoding'].includes(
          key.toLowerCase()
        )
      ) {
        responseHeaders[key] = value;
      }
    });

    // Apply response header transformations
    responseHeaders = transformResponseHeaders(responseHeaders, route.transform);

    const responseBody = await upstreamResponse.text();

    return reply
      .status(upstreamResponse.status)
      .headers(responseHeaders)
      .send(responseBody);
  } catch (error) {
    // Record failure in circuit breaker
    if (circuitBreaker) {
      await circuitBreaker.recordFailure();
    }

    if (error instanceof Error && error.name === 'AbortError') {
      log.error(
        { tenantId: tenant.id, upstreamUrl: finalUrl },
        'Upstream request timeout'
      );

      // Use fallback if configured
      if (shouldUseFallback(resilience?.fallback)) {
        return sendFallbackResponse(reply, resilience?.fallback);
      }

      return reply.status(504).send({
        error: 'Gateway Timeout',
        message: 'Upstream request timed out',
      });
    }

    log.error(
      { err: error, tenantId: tenant.id, upstreamUrl: finalUrl },
      'Upstream request failed'
    );

    // Use fallback if configured
    if (shouldUseFallback(resilience?.fallback)) {
      return sendFallbackResponse(reply, resilience?.fallback);
    }

    return reply.status(502).send({
      error: 'Bad Gateway',
      message: 'Failed to reach upstream server',
    });
  }
}

/**
 * Register health checks for a route's upstreams
 * Call this when routes are loaded or updated
 */
export function registerRouteHealthChecks(
  server: ProxyRequest['server'],
  route: Route
): void {
  const { healthChecker } = server;
  if (!healthChecker || !route.resilience?.healthCheck?.enabled) {
    return;
  }

  for (const upstream of route.upstreams) {
    const checker = healthChecker.registerUpstream(
      route.tenantId,
      route.id,
      upstream,
      route.resilience.healthCheck
    );
    checker.start();
  }
}
