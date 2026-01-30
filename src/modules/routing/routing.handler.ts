import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  transformRequest,
  transformResponseHeaders,
} from '../../shared/transformer/index.js';
import type { Tenant } from '../tenant/tenant.types.js';

interface ProxyRequest extends FastifyRequest {
  tenant: Tenant;
}

export async function handleProxy(
  request: ProxyRequest,
  reply: FastifyReply
): Promise<void> {
  const { tenant } = request;
  const { method, url, log, server } = request;
  const { routingService } = server;

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

  const { upstream } = matched;

  // Build the upstream URL
  let upstreamUrl = upstream.url;

  // Handle path prefix routes - append the remaining path
  if (matched.route.pathType === 'prefix') {
    const remainingPath = urlPath.slice(matched.route.path.length);
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
      routeId: matched.route.id,
    },
    'Proxying request to upstream'
  );

  try {
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
    const transformed = transformRequest(
      headers,
      upstreamUrl,
      matched.route.transform
    );
    const finalHeaders = transformed.headers;
    const finalUrl = transformed.path;

    // Make the upstream request
    const timeout = upstream.timeout ?? 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const upstreamResponse = await fetch(finalUrl, {
      method,
      headers: finalHeaders,
      body: method !== 'GET' && method !== 'HEAD' ? (request.body as string) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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
    responseHeaders = transformResponseHeaders(
      responseHeaders,
      matched.route.transform
    );

    const responseBody = await upstreamResponse.text();

    return reply
      .status(upstreamResponse.status)
      .headers(responseHeaders)
      .send(responseBody);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      log.error(
        { tenantId: tenant.id, upstreamUrl },
        'Upstream request timeout'
      );
      return reply.status(504).send({
        error: 'Gateway Timeout',
        message: 'Upstream request timed out',
      });
    }

    log.error(
      { err: error, tenantId: tenant.id, upstreamUrl },
      'Upstream request failed'
    );

    return reply.status(502).send({
      error: 'Bad Gateway',
      message: 'Failed to reach upstream server',
    });
  }
}
