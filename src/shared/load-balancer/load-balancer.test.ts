import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { UpstreamConfig } from '../types/index.js';

import {
  selectUpstream,
  resetRoundRobinCounter,
  resetAllRoundRobinCounters,
} from './index.js';

describe('Load Balancer', () => {
  beforeEach(() => {
    resetAllRoundRobinCounters();
  });

  describe('selectUpstream', () => {
    it('should throw error when no upstreams available', () => {
      expect(() => selectUpstream([], 'round-robin', 'test-route')).toThrow(
        'No upstreams available'
      );
    });

    it('should return single upstream when only one available', () => {
      const upstreams: UpstreamConfig[] = [{ url: 'http://server1:3000' }];
      const result = selectUpstream(upstreams, 'round-robin', 'test-route');
      expect(result.url).toBe('http://server1:3000');
    });

    describe('round-robin strategy', () => {
      it('should cycle through upstreams in order', () => {
        const upstreams: UpstreamConfig[] = [
          { url: 'http://server1:3000' },
          { url: 'http://server2:3000' },
          { url: 'http://server3:3000' },
        ];

        const routeId = 'test-route-rr';

        expect(selectUpstream(upstreams, 'round-robin', routeId).url).toBe(
          'http://server1:3000'
        );
        expect(selectUpstream(upstreams, 'round-robin', routeId).url).toBe(
          'http://server2:3000'
        );
        expect(selectUpstream(upstreams, 'round-robin', routeId).url).toBe(
          'http://server3:3000'
        );
        expect(selectUpstream(upstreams, 'round-robin', routeId).url).toBe(
          'http://server1:3000'
        );
      });

      it('should maintain separate counters per route', () => {
        const upstreams: UpstreamConfig[] = [
          { url: 'http://server1:3000' },
          { url: 'http://server2:3000' },
        ];

        expect(selectUpstream(upstreams, 'round-robin', 'route-a').url).toBe(
          'http://server1:3000'
        );
        expect(selectUpstream(upstreams, 'round-robin', 'route-b').url).toBe(
          'http://server1:3000'
        );
        expect(selectUpstream(upstreams, 'round-robin', 'route-a').url).toBe(
          'http://server2:3000'
        );
      });
    });

    describe('weighted strategy', () => {
      it('should favor upstreams with higher weights', () => {
        const upstreams: UpstreamConfig[] = [
          { url: 'http://server1:3000', weight: 1 },
          { url: 'http://server2:3000', weight: 9 },
        ];

        // Mock Math.random to return predictable values
        const mockRandom = vi.spyOn(Math, 'random');

        // When random is 0, should select first upstream
        mockRandom.mockReturnValue(0.05);
        expect(selectUpstream(upstreams, 'weighted', 'test-route').url).toBe(
          'http://server1:3000'
        );

        // When random is high, should select second upstream
        mockRandom.mockReturnValue(0.5);
        expect(selectUpstream(upstreams, 'weighted', 'test-route').url).toBe(
          'http://server2:3000'
        );

        mockRandom.mockRestore();
      });

      it('should use default weight of 1 when not specified', () => {
        const upstreams: UpstreamConfig[] = [
          { url: 'http://server1:3000' },
          { url: 'http://server2:3000' },
        ];

        const mockRandom = vi.spyOn(Math, 'random');
        mockRandom.mockReturnValue(0.25);

        // With equal weights, 0.25 should be in first half
        expect(selectUpstream(upstreams, 'weighted', 'test-route').url).toBe(
          'http://server1:3000'
        );

        mockRandom.mockReturnValue(0.75);
        expect(selectUpstream(upstreams, 'weighted', 'test-route').url).toBe(
          'http://server2:3000'
        );

        mockRandom.mockRestore();
      });
    });

    describe('random strategy', () => {
      it('should select upstream based on random index', () => {
        const upstreams: UpstreamConfig[] = [
          { url: 'http://server1:3000' },
          { url: 'http://server2:3000' },
          { url: 'http://server3:3000' },
        ];

        const mockRandom = vi.spyOn(Math, 'random');

        mockRandom.mockReturnValue(0);
        expect(selectUpstream(upstreams, 'random', 'test-route').url).toBe(
          'http://server1:3000'
        );

        mockRandom.mockReturnValue(0.5);
        expect(selectUpstream(upstreams, 'random', 'test-route').url).toBe(
          'http://server2:3000'
        );

        mockRandom.mockReturnValue(0.9);
        expect(selectUpstream(upstreams, 'random', 'test-route').url).toBe(
          'http://server3:3000'
        );

        mockRandom.mockRestore();
      });
    });

    describe('unknown strategy', () => {
      it('should fallback to first upstream for unknown strategy', () => {
        const upstreams: UpstreamConfig[] = [
          { url: 'http://server1:3000' },
          { url: 'http://server2:3000' },
        ];

        // @ts-expect-error - testing unknown strategy
        const result = selectUpstream(upstreams, 'unknown', 'test-route');
        expect(result.url).toBe('http://server1:3000');
      });
    });
  });

  describe('resetRoundRobinCounter', () => {
    it('should reset counter for specific route', () => {
      const upstreams: UpstreamConfig[] = [
        { url: 'http://server1:3000' },
        { url: 'http://server2:3000' },
      ];

      selectUpstream(upstreams, 'round-robin', 'test-route');
      expect(selectUpstream(upstreams, 'round-robin', 'test-route').url).toBe(
        'http://server2:3000'
      );

      resetRoundRobinCounter('test-route');

      expect(selectUpstream(upstreams, 'round-robin', 'test-route').url).toBe(
        'http://server1:3000'
      );
    });
  });
});
