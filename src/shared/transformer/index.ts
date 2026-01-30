import type { HeaderTransform, TransformConfig } from '../types/index.js';

/**
 * Apply header transformations
 */
export function applyHeaderTransform(
  headers: Record<string, string>,
  transform: HeaderTransform
): Record<string, string> {
  const result = { ...headers };

  // Remove headers first
  if (transform.remove) {
    for (const key of transform.remove) {
      const lowerKey = key.toLowerCase();
      for (const headerKey of Object.keys(result)) {
        if (headerKey.toLowerCase() === lowerKey) {
          delete result[headerKey];
        }
      }
    }
  }

  // Set headers (overwrites existing)
  if (transform.set) {
    for (const [key, value] of Object.entries(transform.set)) {
      result[key] = value;
    }
  }

  // Add headers (only if not present)
  if (transform.add) {
    for (const [key, value] of Object.entries(transform.add)) {
      const lowerKey = key.toLowerCase();
      const exists = Object.keys(result).some(
        (k) => k.toLowerCase() === lowerKey
      );
      if (!exists) {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Apply path rewrite transformation
 */
export function applyPathRewrite(
  path: string,
  rewrite: { pattern: string; replacement: string }
): string {
  try {
    const regex = new RegExp(rewrite.pattern);
    return path.replace(regex, rewrite.replacement);
  } catch {
    // Invalid regex, return original path
    return path;
  }
}

/**
 * Transform request before sending to upstream
 */
export function transformRequest(
  headers: Record<string, string>,
  path: string,
  transform: TransformConfig | null
): { headers: Record<string, string>; path: string } {
  if (!transform?.request) {
    return { headers, path };
  }

  let transformedHeaders = headers;
  let transformedPath = path;

  if (transform.request.headers) {
    transformedHeaders = applyHeaderTransform(headers, transform.request.headers);
  }

  if (transform.request.pathRewrite) {
    transformedPath = applyPathRewrite(path, transform.request.pathRewrite);
  }

  return { headers: transformedHeaders, path: transformedPath };
}

/**
 * Transform response headers before sending to client
 */
export function transformResponseHeaders(
  headers: Record<string, string>,
  transform: TransformConfig | null
): Record<string, string> {
  if (!transform?.response?.headers) {
    return headers;
  }

  return applyHeaderTransform(headers, transform.response.headers);
}
