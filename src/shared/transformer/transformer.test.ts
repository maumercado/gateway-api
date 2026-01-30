import { describe, it, expect } from 'vitest';

import type { TransformConfig } from '../types/index.js';

import {
  applyHeaderTransform,
  applyPathRewrite,
  transformRequest,
  transformResponseHeaders,
} from './index.js';

describe('Transformer', () => {
  describe('applyHeaderTransform', () => {
    describe('remove headers', () => {
      it('should remove specified headers', () => {
        const headers = {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
          'X-Custom': 'value',
        };

        const result = applyHeaderTransform(headers, {
          remove: ['Authorization', 'X-Custom'],
        });

        expect(result).toEqual({
          'Content-Type': 'application/json',
        });
      });

      it('should handle case-insensitive header removal', () => {
        const headers = {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        };

        const result = applyHeaderTransform(headers, {
          remove: ['authorization'],
        });

        expect(result).toEqual({
          'Content-Type': 'application/json',
        });
      });

      it('should not fail when removing non-existent headers', () => {
        const headers = { 'Content-Type': 'application/json' };

        const result = applyHeaderTransform(headers, {
          remove: ['Non-Existent'],
        });

        expect(result).toEqual({ 'Content-Type': 'application/json' });
      });
    });

    describe('set headers', () => {
      it('should set new headers', () => {
        const headers = { 'Content-Type': 'application/json' };

        const result = applyHeaderTransform(headers, {
          set: { 'X-Custom': 'custom-value' },
        });

        expect(result).toEqual({
          'Content-Type': 'application/json',
          'X-Custom': 'custom-value',
        });
      });

      it('should overwrite existing headers', () => {
        const headers = { 'Content-Type': 'text/plain' };

        const result = applyHeaderTransform(headers, {
          set: { 'Content-Type': 'application/json' },
        });

        expect(result).toEqual({ 'Content-Type': 'application/json' });
      });
    });

    describe('add headers', () => {
      it('should add new headers', () => {
        const headers = { 'Content-Type': 'application/json' };

        const result = applyHeaderTransform(headers, {
          add: { 'X-New-Header': 'new-value' },
        });

        expect(result).toEqual({
          'Content-Type': 'application/json',
          'X-New-Header': 'new-value',
        });
      });

      it('should not overwrite existing headers', () => {
        const headers = { 'Content-Type': 'application/json' };

        const result = applyHeaderTransform(headers, {
          add: { 'Content-Type': 'text/plain' },
        });

        expect(result).toEqual({ 'Content-Type': 'application/json' });
      });

      it('should handle case-insensitive header check', () => {
        const headers = { 'content-type': 'application/json' };

        const result = applyHeaderTransform(headers, {
          add: { 'Content-Type': 'text/plain' },
        });

        expect(result).toEqual({ 'content-type': 'application/json' });
      });
    });

    describe('combined operations', () => {
      it('should apply remove, set, then add in correct order', () => {
        const headers = {
          Authorization: 'Bearer token',
          'X-Old': 'old-value',
          'Content-Type': 'text/plain',
        };

        const result = applyHeaderTransform(headers, {
          remove: ['Authorization'],
          set: { 'Content-Type': 'application/json' },
          add: { 'X-New': 'new-value', 'X-Old': 'should-not-add' },
        });

        expect(result).toEqual({
          'Content-Type': 'application/json',
          'X-Old': 'old-value',
          'X-New': 'new-value',
        });
      });
    });
  });

  describe('applyPathRewrite', () => {
    it('should rewrite path with simple pattern', () => {
      const result = applyPathRewrite('/api/v1/users', {
        pattern: '^/api/v1',
        replacement: '/api/v2',
      });

      expect(result).toBe('/api/v2/users');
    });

    it('should rewrite with capture groups', () => {
      const result = applyPathRewrite('/users/123/profile', {
        pattern: '/users/(\\d+)/profile',
        replacement: '/profile/$1',
      });

      expect(result).toBe('/profile/123');
    });

    it('should strip prefix', () => {
      const result = applyPathRewrite('/service-a/endpoint', {
        pattern: '^/service-a',
        replacement: '',
      });

      expect(result).toBe('/endpoint');
    });

    it('should return original path for invalid regex', () => {
      const result = applyPathRewrite('/api/users', {
        pattern: '[invalid',
        replacement: '/new',
      });

      expect(result).toBe('/api/users');
    });

    it('should return original path when pattern does not match', () => {
      const result = applyPathRewrite('/api/users', {
        pattern: '^/different',
        replacement: '/new',
      });

      expect(result).toBe('/api/users');
    });
  });

  describe('transformRequest', () => {
    it('should return original values when transform is null', () => {
      const headers = { 'Content-Type': 'application/json' };
      const path = '/api/users';

      const result = transformRequest(headers, path, null);

      expect(result).toEqual({ headers, path });
    });

    it('should return original values when request transform is not defined', () => {
      const headers = { 'Content-Type': 'application/json' };
      const path = '/api/users';
      const transform: TransformConfig = { response: { headers: {} } };

      const result = transformRequest(headers, path, transform);

      expect(result).toEqual({ headers, path });
    });

    it('should transform headers and path', () => {
      const headers = {
        'Content-Type': 'application/json',
        'X-Remove': 'value',
      };
      const path = '/api/v1/users';
      const transform: TransformConfig = {
        request: {
          headers: {
            remove: ['X-Remove'],
            set: { 'X-Custom': 'custom' },
          },
          pathRewrite: {
            pattern: '^/api/v1',
            replacement: '/api/v2',
          },
        },
      };

      const result = transformRequest(headers, path, transform);

      expect(result.headers).toEqual({
        'Content-Type': 'application/json',
        'X-Custom': 'custom',
      });
      expect(result.path).toBe('/api/v2/users');
    });

    it('should transform only headers when pathRewrite is not defined', () => {
      const headers = { 'Content-Type': 'application/json' };
      const path = '/api/users';
      const transform: TransformConfig = {
        request: {
          headers: { set: { 'X-New': 'value' } },
        },
      };

      const result = transformRequest(headers, path, transform);

      expect(result.headers).toEqual({
        'Content-Type': 'application/json',
        'X-New': 'value',
      });
      expect(result.path).toBe('/api/users');
    });

    it('should transform only path when headers transform is not defined', () => {
      const headers = { 'Content-Type': 'application/json' };
      const path = '/old/path';
      const transform: TransformConfig = {
        request: {
          pathRewrite: {
            pattern: '/old',
            replacement: '/new',
          },
        },
      };

      const result = transformRequest(headers, path, transform);

      expect(result.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(result.path).toBe('/new/path');
    });
  });

  describe('transformResponseHeaders', () => {
    it('should return original headers when transform is null', () => {
      const headers = { 'Content-Type': 'application/json' };

      const result = transformResponseHeaders(headers, null);

      expect(result).toEqual(headers);
    });

    it('should return original headers when response transform is not defined', () => {
      const headers = { 'Content-Type': 'application/json' };
      const transform: TransformConfig = { request: { headers: {} } };

      const result = transformResponseHeaders(headers, transform);

      expect(result).toEqual(headers);
    });

    it('should transform response headers', () => {
      const headers = {
        'Content-Type': 'application/json',
        'X-Internal': 'secret',
      };
      const transform: TransformConfig = {
        response: {
          headers: {
            remove: ['X-Internal'],
            set: { 'X-Public': 'public-value' },
          },
        },
      };

      const result = transformResponseHeaders(headers, transform);

      expect(result).toEqual({
        'Content-Type': 'application/json',
        'X-Public': 'public-value',
      });
    });
  });
});
