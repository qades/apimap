/**
 * Shared Throttling Utilities for Mock LLM Server
 * 
 * Provides consistent rate limiting and latency simulation across all endpoints.
 */

// ============================================================================
// Configuration
// ============================================================================

export interface ThrottleConfig {
  /** Mean latency in milliseconds (base response time) */
  latencyMeanMs: number;
  /** Standard deviation for latency (jitter) */
  latencyStdMs: number;
  /** Tokens per second for streaming rate simulation */
  tokensPerSecond: number;
  /** Whether streaming is enabled */
  streamingEnabled: boolean;
}

// Default configuration (can be overridden)
export const defaultConfig: ThrottleConfig = {
  latencyMeanMs: parseFloat(Bun.env.MOCK_LATENCY_MEAN_MS || '0'),
  latencyStdMs: parseFloat(Bun.env.MOCK_LATENCY_STD_MS || '0'),
  tokensPerSecond: parseFloat(Bun.env.MOCK_TOKENS_PER_SEC || '100'),
  streamingEnabled: Bun.env.MOCK_STREAMING_ENABLED !== 'false',
};

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a random value from a Gaussian (normal) distribution
 */
export function gaussianRandom(mean: number, std: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * std;
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Simple token counter (approximate: 4 chars = 1 token)
 */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Count tokens in an array of messages
 */
export function countMessageTokens(messages: Array<{ role: string; content: unknown }>): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += countTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === 'object' && block !== null) {
          if ('text' in block && typeof block.text === 'string') {
            total += countTokens(block.text);
          } else if ('content' in block && typeof block.content === 'string') {
            total += countTokens(block.content);
          }
        }
      }
    }
  }
  return total;
}

// ============================================================================
// Throttling Functions
// ============================================================================

/**
 * Calculate simulated latency based on input/output tokens
 * 
 * Formula: input_processing_time + output_generation_time + base_latency
 * - Input: 1 second per 1000 tokens
 * - Output: based on tokensPerSecond config
 * - Base: Gaussian random around latencyMeanMs
 */
export function calculateLatency(
  inputTokens: number,
  outputTokens: number,
  config: ThrottleConfig = defaultConfig
): number {
  // Instant mode for testing
  if (Bun.env.MOCK_INSTANT_MODE === 'true') {
    return 0;
  }

  // Input processing: ~1ms per token (1 second per 1000 tokens)
  const inputLatency = inputTokens;

  // Output generation: based on tokens per second
  const outputLatency = (outputTokens / config.tokensPerSecond) * 1000;

  // Base latency with Gaussian jitter
  const baseLatency = config.latencyMeanMs > 0
    ? Math.max(0, gaussianRandom(config.latencyMeanMs, config.latencyStdMs))
    : 0;

  return inputLatency + outputLatency + baseLatency;
}

/**
 * Calculate delay between streaming chunks
 * 
 * Returns the time to wait between tokens based on tokensPerSecond
 */
export function calculateChunkDelay(config: ThrottleConfig = defaultConfig): number {
  if (Bun.env.MOCK_INSTANT_MODE === 'true') {
    return 0;
  }
  return (1 / config.tokensPerSecond) * 1000;
}

/**
 * Apply throttling by sleeping for the calculated latency
 * 
 * @returns The actual latency applied (may differ from calculated due to jitter)
 */
export async function applyThrottle(
  inputTokens: number,
  outputTokens: number,
  config: ThrottleConfig = defaultConfig
): Promise<number> {
  const latency = calculateLatency(inputTokens, outputTokens, config);
  if (latency > 0) {
    await sleep(latency);
  }
  return latency;
}

// ============================================================================
// Request Throttler (for concurrent request limiting)
// ============================================================================

interface QueueEntry {
  resolve: () => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * Request throttler to limit concurrent requests
 * 
 * Simulates real-world behavior where LLM providers have capacity limits
 */
export class RequestThrottler {
  private maxConcurrent: number;
  private currentRequests = 0;
  private queue: QueueEntry[] = [];
  private config: ThrottleConfig;

  constructor(maxConcurrent: number = 100, config: ThrottleConfig = defaultConfig) {
    this.maxConcurrent = maxConcurrent;
    this.config = config;
  }

  /**
   * Acquire permission to make a request
   * Will queue if at max concurrency
   */
  async acquire(timeoutMs: number = 30000): Promise<void> {
    // If under limit, allow immediately
    if (this.currentRequests < this.maxConcurrent) {
      this.currentRequests++;
      return;
    }

    // Otherwise, queue and wait
    return new Promise((resolve, reject) => {
      const entry: QueueEntry = { resolve, reject, timestamp: Date.now() };
      this.queue.push(entry);

      // Timeout handling
      if (timeoutMs > 0) {
        setTimeout(() => {
          const index = this.queue.indexOf(entry);
          if (index !== -1) {
            this.queue.splice(index, 1);
            entry.reject(new Error(`Request throttler timeout after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }
    });
  }

  /**
   * Release a request slot
   * Will process next queued request if any
   */
  release(): void {
    this.currentRequests = Math.max(0, this.currentRequests - 1);

    // Process next in queue
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        this.currentRequests++;
        next.resolve();
      }
    }
  }

  /**
   * Execute a function with throttling
   */
  async execute<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    await this.acquire(timeoutMs);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Get current stats
   */
  getStats(): { current: number; queued: number; max: number } {
    return {
      current: this.currentRequests,
      queued: this.queue.length,
      max: this.maxConcurrent,
    };
  }
}

// Global request throttler instance
export const globalThrottler = new RequestThrottler(100, defaultConfig);

// ============================================================================
// Convenience Exports
// ============================================================================

export const throttle = {
  sleep,
  countTokens,
  countMessageTokens,
  calculateLatency,
  calculateChunkDelay,
  applyThrottle,
  gaussianRandom,
};

export default throttle;
