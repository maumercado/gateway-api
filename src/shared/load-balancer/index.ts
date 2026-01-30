import type { UpstreamConfig } from '../types/index.js';

export type LoadBalancingStrategy = 'round-robin' | 'weighted' | 'random';

// Store round-robin counters per route
const roundRobinCounters = new Map<string, number>();

/**
 * Select an upstream using round-robin strategy
 */
function selectRoundRobin(
  upstreams: UpstreamConfig[],
  routeId: string
): UpstreamConfig {
  const currentIndex = roundRobinCounters.get(routeId) ?? 0;
  const upstream = upstreams[currentIndex % upstreams.length]!;

  roundRobinCounters.set(routeId, currentIndex + 1);

  return upstream;
}

/**
 * Select an upstream using weighted random strategy
 * Upstreams with higher weights are more likely to be selected
 */
function selectWeighted(upstreams: UpstreamConfig[]): UpstreamConfig {
  // Calculate total weight (default weight is 1)
  const totalWeight = upstreams.reduce(
    (sum, upstream) => sum + (upstream.weight ?? 1),
    0
  );

  // Generate random number between 0 and totalWeight
  let random = Math.random() * totalWeight;

  // Find the upstream that corresponds to the random number
  for (const upstream of upstreams) {
    const weight = upstream.weight ?? 1;
    random -= weight;

    if (random <= 0) {
      return upstream;
    }
  }

  // Fallback to first upstream (shouldn't reach here)
  return upstreams[0]!;
}

/**
 * Select an upstream using random strategy
 */
function selectRandom(upstreams: UpstreamConfig[]): UpstreamConfig {
  const index = Math.floor(Math.random() * upstreams.length);
  return upstreams[index]!;
}

/**
 * Select an upstream based on the load balancing strategy
 */
export function selectUpstream(
  upstreams: UpstreamConfig[],
  strategy: LoadBalancingStrategy,
  routeId: string
): UpstreamConfig {
  if (upstreams.length === 0) {
    throw new Error('No upstreams available');
  }

  if (upstreams.length === 1) {
    return upstreams[0]!;
  }

  switch (strategy) {
    case 'round-robin':
      return selectRoundRobin(upstreams, routeId);

    case 'weighted':
      return selectWeighted(upstreams);

    case 'random':
      return selectRandom(upstreams);

    default:
      return upstreams[0]!;
  }
}

/**
 * Reset the round-robin counter for a route
 * Useful for testing or when route configuration changes
 */
export function resetRoundRobinCounter(routeId: string): void {
  roundRobinCounters.delete(routeId);
}

/**
 * Reset all round-robin counters
 */
export function resetAllRoundRobinCounters(): void {
  roundRobinCounters.clear();
}
