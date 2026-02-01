import type { RetryConfig } from '../types/index.js';

const DEFAULT_CONFIG: RetryConfig = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatusCodes: [500, 502, 503, 504],
};

const DEFAULT_RETRYABLE_STATUS_CODES = [500, 502, 503, 504];

export interface RetryContext {
  attempt: number;
  maxRetries: number;
  error?: Error;
  statusCode?: number;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  lastStatusCode?: number;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (random 0-25% of the delay)
  const jitter = cappedDelay * Math.random() * 0.25;

  return Math.floor(cappedDelay + jitter);
}

/**
 * Check if a status code is retryable
 */
export function isRetryableStatusCode(
  statusCode: number,
  retryableCodes?: number[]
): boolean {
  const codes = retryableCodes ?? DEFAULT_RETRYABLE_STATUS_CODES;
  return codes.includes(statusCode);
}

/**
 * Check if an error is retryable (network errors, timeouts)
 */
export function isRetryableError(error: Error): boolean {
  // Network errors
  if (error.name === 'TypeError' && error.message.includes('fetch')) {
    return true;
  }

  // Timeout errors
  if (error.name === 'AbortError') {
    return true;
  }

  // Connection errors
  if (
    error.message.includes('ECONNREFUSED') ||
    error.message.includes('ECONNRESET') ||
    error.message.includes('ETIMEDOUT') ||
    error.message.includes('ENOTFOUND')
  ) {
    return true;
  }

  return false;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Merge user config with defaults
 */
export function mergeRetryConfig(config?: Partial<RetryConfig>): RetryConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: (context: RetryContext) => Promise<T>,
  config?: Partial<RetryConfig>,
  onRetry?: (context: RetryContext, delay: number) => void
): Promise<RetryResult<T>> {
  const mergedConfig = mergeRetryConfig(config);

  if (!mergedConfig.enabled) {
    try {
      const result = await fn({ attempt: 0, maxRetries: 0 });
      return { success: true, result, attempts: 1 };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        attempts: 1,
      };
    }
  }

  let lastError: Error | undefined;
  let lastStatusCode: number | undefined;

  for (let attempt = 0; attempt <= mergedConfig.maxRetries; attempt++) {
    const context: RetryContext = {
      attempt,
      maxRetries: mergedConfig.maxRetries,
      error: lastError,
      statusCode: lastStatusCode,
    };

    try {
      const result = await fn(context);
      return { success: true, result, attempts: attempt + 1, lastStatusCode };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Extract status code if available from error
      if (error && typeof error === 'object' && 'statusCode' in error) {
        lastStatusCode = (error as { statusCode: number }).statusCode;
      }

      // Check if we should retry
      const shouldRetry =
        attempt < mergedConfig.maxRetries &&
        (isRetryableError(lastError) ||
          (lastStatusCode !== undefined &&
            isRetryableStatusCode(lastStatusCode, mergedConfig.retryableStatusCodes)));

      if (!shouldRetry) {
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          lastStatusCode,
        };
      }

      // Calculate delay for next attempt
      const delay = calculateDelay(
        attempt,
        mergedConfig.baseDelayMs,
        mergedConfig.maxDelayMs ?? 30000
      );

      // Call retry callback if provided
      if (onRetry) {
        onRetry({ ...context, error: lastError, statusCode: lastStatusCode }, delay);
      }

      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: mergedConfig.maxRetries + 1,
    lastStatusCode,
  };
}

/**
 * Create a retryable fetch wrapper
 */
export function createRetryableFetch(config?: Partial<RetryConfig>) {
  return async function retryableFetch(
    url: string,
    options: RequestInit & { timeout?: number },
    onRetry?: (context: RetryContext, delay: number) => void
  ): Promise<Response> {
    const result = await withRetry<Response>(
      async (context) => {
        const controller = new AbortController();
        const timeoutId = options.timeout
          ? setTimeout(() => controller.abort(), options.timeout)
          : null;

        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
          });

          // If the response has a retryable status code, throw an error
          const mergedConfig = mergeRetryConfig(config);
          if (
            isRetryableStatusCode(response.status, mergedConfig.retryableStatusCodes) &&
            context.attempt < context.maxRetries
          ) {
            const error = new Error(`Upstream returned ${response.status}`) as Error & {
              statusCode: number;
            };
            error.statusCode = response.status;
            throw error;
          }

          return response;
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }
      },
      config,
      onRetry
    );

    if (!result.success || !result.result) {
      throw result.error ?? new Error('Request failed after retries');
    }

    return result.result;
  };
}
