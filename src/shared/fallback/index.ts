import type { FastifyReply } from 'fastify';

import type { FallbackConfig } from '../types/index.js';

export interface FallbackResponse {
  statusCode: number;
  contentType: string;
  body: string;
}

const DEFAULT_FALLBACK: FallbackConfig = {
  enabled: false,
  statusCode: 503,
  contentType: 'application/json',
  body: JSON.stringify({
    error: 'Service Unavailable',
    message: 'The upstream service is temporarily unavailable',
  }),
};

/**
 * Generate a fallback response based on configuration
 */
export function generateFallbackResponse(
  config?: Partial<FallbackConfig>
): FallbackResponse {
  const mergedConfig = { ...DEFAULT_FALLBACK, ...config };

  return {
    statusCode: mergedConfig.statusCode,
    contentType: mergedConfig.contentType,
    body: mergedConfig.body,
  };
}

/**
 * Send a fallback response to the client
 */
export function sendFallbackResponse(
  reply: FastifyReply,
  config?: Partial<FallbackConfig>
): FastifyReply {
  const fallback = generateFallbackResponse(config);

  return reply
    .status(fallback.statusCode)
    .header('content-type', fallback.contentType)
    .send(fallback.body);
}

/**
 * Check if fallback is enabled and should be used
 */
export function shouldUseFallback(config?: FallbackConfig): boolean {
  return config?.enabled ?? false;
}

/**
 * Create a default JSON error fallback response
 */
export function createJsonFallback(
  error: string,
  message: string,
  statusCode = 503
): FallbackConfig {
  return {
    enabled: true,
    statusCode,
    contentType: 'application/json',
    body: JSON.stringify({ error, message }),
  };
}

/**
 * Create a default HTML fallback response
 */
export function createHtmlFallback(
  title: string,
  message: string,
  statusCode = 503
): FallbackConfig {
  return {
    enabled: true,
    statusCode,
    contentType: 'text/html',
    body: `<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
<h1>${title}</h1>
<p>${message}</p>
</body>
</html>`,
  };
}

/**
 * Create a default plain text fallback response
 */
export function createTextFallback(
  message: string,
  statusCode = 503
): FallbackConfig {
  return {
    enabled: true,
    statusCode,
    contentType: 'text/plain',
    body: message,
  };
}
