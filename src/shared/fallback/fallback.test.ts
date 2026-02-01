import { describe, it, expect, vi } from 'vitest';

import {
  generateFallbackResponse,
  shouldUseFallback,
  createJsonFallback,
  createHtmlFallback,
  createTextFallback,
} from './index.js';

describe('Fallback Module', () => {
  describe('generateFallbackResponse', () => {
    it('should return default fallback when no config', () => {
      const response = generateFallbackResponse();

      expect(response.statusCode).toBe(503);
      expect(response.contentType).toBe('application/json');
      expect(response.body).toContain('Service Unavailable');
    });

    it('should use custom config', () => {
      const response = generateFallbackResponse({
        statusCode: 500,
        contentType: 'text/plain',
        body: 'Custom error',
      });

      expect(response.statusCode).toBe(500);
      expect(response.contentType).toBe('text/plain');
      expect(response.body).toBe('Custom error');
    });
  });

  describe('shouldUseFallback', () => {
    it('should return false when config is undefined', () => {
      expect(shouldUseFallback(undefined)).toBe(false);
    });

    it('should return false when not enabled', () => {
      expect(
        shouldUseFallback({
          enabled: false,
          statusCode: 503,
          contentType: 'application/json',
          body: '{}',
        })
      ).toBe(false);
    });

    it('should return true when enabled', () => {
      expect(
        shouldUseFallback({
          enabled: true,
          statusCode: 503,
          contentType: 'application/json',
          body: '{}',
        })
      ).toBe(true);
    });
  });

  describe('createJsonFallback', () => {
    it('should create JSON fallback config', () => {
      const config = createJsonFallback('Error', 'Something went wrong');

      expect(config.enabled).toBe(true);
      expect(config.statusCode).toBe(503);
      expect(config.contentType).toBe('application/json');
      expect(JSON.parse(config.body)).toEqual({
        error: 'Error',
        message: 'Something went wrong',
      });
    });

    it('should use custom status code', () => {
      const config = createJsonFallback('Error', 'Not found', 404);

      expect(config.statusCode).toBe(404);
    });
  });

  describe('createHtmlFallback', () => {
    it('should create HTML fallback config', () => {
      const config = createHtmlFallback('Error', 'Something went wrong');

      expect(config.enabled).toBe(true);
      expect(config.statusCode).toBe(503);
      expect(config.contentType).toBe('text/html');
      expect(config.body).toContain('<title>Error</title>');
      expect(config.body).toContain('Something went wrong');
    });
  });

  describe('createTextFallback', () => {
    it('should create plain text fallback config', () => {
      const config = createTextFallback('Service unavailable');

      expect(config.enabled).toBe(true);
      expect(config.statusCode).toBe(503);
      expect(config.contentType).toBe('text/plain');
      expect(config.body).toBe('Service unavailable');
    });
  });

  describe('sendFallbackResponse', () => {
    it('should send fallback response to reply', async () => {
      const { sendFallbackResponse } = await import('./index.js');

      const mockReply = {
        status: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      sendFallbackResponse(mockReply as never, {
        enabled: true,
        statusCode: 500,
        contentType: 'application/json',
        body: '{"error":"test"}',
      });

      expect(mockReply.status).toHaveBeenCalledWith(500);
      expect(mockReply.header).toHaveBeenCalledWith('content-type', 'application/json');
      expect(mockReply.send).toHaveBeenCalledWith('{"error":"test"}');
    });
  });
});
