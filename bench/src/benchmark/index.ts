#!/usr/bin/env bun
/**
 * Benchmark Runner - Bun Implementation
 * 
 * High-performance load testing for AI gateways.
 */

import { parseArgs } from 'util';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

interface BenchmarkConfig {
  targets: TargetConfig[];
  scenarios: ScenarioConfig[];
  outputDir: string;
  warmupRequests: number;
  testStreaming: boolean;
  testFeatures: boolean;
  logErrors: boolean;
  logDir: string;
  mockServerConfig: MockServerConfig;
}

interface MockServerConfig {
  latencyMeanMs: number;
  latencyStdMs: number;
  tokensPerSecond: number;
  errorRate: number;
}

interface TargetConfig {
  name: string;
  url: string;
  apiKey: string;
  enabled: boolean;
}

interface ScenarioConfig {
  name: string;
  concurrency: number;
  requests: number;
  promptSize: number;
  contextSize: number;
  maxTokens: number;
  useStreaming: boolean;
  protocol?: ProtocolConfig;
}

interface ProtocolConfig {
  sourceFormat: 'openai' | 'anthropic';
  endpoint: string;
  description: string;
}

// Protocol combinations to test
const PROTOCOL_COMBINATIONS: ProtocolConfig[] = [
  { sourceFormat: 'openai', endpoint: '/v1/chat/completions', description: 'OpenAI→OpenAI' },
  { sourceFormat: 'anthropic', endpoint: '/v1/messages', description: 'Anthropic→OpenAI' },
];

interface LatencyResult {
  target: string;
  scenario: string;
  latencies: number[];
  errors: number;
  total: number;
}

interface ThroughputResult {
  target: string;
  scenario: string;
  requestsPerSecond: number;
  totalRequests: number;
  durationMs: number;
  errors: number;
}

interface StreamingMetrics {
  timeToFirstTokenMs: number;
  timeToLastTokenMs: number;
  tokensPerSec: number;
  totalTokens: number;
  chunkCount: number;
  meanChunkLatencyMs: number;
}

interface StreamingResult {
  target: string;
  timeToFirstTokenMs: number;
  timeToLastTokenMs: number;
  tokensPerSec: number;
  totalTokens: number;
  chunkCount: number;
  meanChunkLatencyMs: number;
  errors: number;
}

interface FeatureResult {
  feature: string;
  litellmSupport: 'full' | 'partial' | 'none';
  apimapSupport: 'full' | 'partial' | 'none';
  directSupport: 'full' | 'partial' | 'none';
  litellmNotes: string;
  apimapNotes: string;
  directNotes: string;
  winner: 'litellm' | 'apimap' | 'direct' | 'tie' | 'none';
}

interface ErrorLogEntry {
  timestamp: string;
  target: string;
  operation: string;
  error: string;
  details?: Record<string, unknown>;
}

interface BenchmarkResults {
  runId: string;
  timestamp: string;
  config: BenchmarkConfig;
  latency: LatencyResult[];
  throughput: ThroughputResult[];
  streaming: StreamingResult[];
  features: FeatureResult[];
  errors: ErrorLogEntry[];
}

// ============================================================================
// Error Logger
// ============================================================================

class ErrorLogger {
  private errors: ErrorLogEntry[] = [];
  private logDir: string;
  private enabled: boolean;

  constructor(logDir: string, enabled: boolean = true) {
    this.logDir = logDir;
    this.enabled = enabled;
    
    if (enabled && !existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  log(target: string, operation: string, error: Error | string, details?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const entry: ErrorLogEntry = {
      timestamp: new Date().toISOString(),
      target,
      operation,
      error: error instanceof Error ? error.message : error,
      details,
    };

    this.errors.push(entry);
    // Errors are logged to file only - no stdout output
  }

  getErrors(): ErrorLogEntry[] {
    return this.errors;
  }

  saveToFile(runId: string): void {
    if (!this.enabled || this.errors.length === 0) return;

    const errorLogPath = join(this.logDir, `errors_${runId}.json`);
    const errorData = {
      runId,
      timestamp: new Date().toISOString(),
      totalErrors: this.errors.length,
      errors: this.errors,
    };

    writeFileSync(errorLogPath, JSON.stringify(errorData, null, 2));
    console.log(`\n📄 Error log saved to: ${errorLogPath}`);
  }

  printSummary(): void {
    if (this.errors.length === 0) return;

    console.log('\n--- Error Summary ---');
    
    // Group errors by target
    const byTarget = new Map<string, number>();
    const byOperation = new Map<string, number>();
    
    for (const err of this.errors) {
      byTarget.set(err.target, (byTarget.get(err.target) || 0) + 1);
      byOperation.set(err.operation, (byOperation.get(err.operation) || 0) + 1);
    }

    console.log('  By Target:');
    for (const [target, count] of byTarget) {
      console.log(`    ${target}: ${count} errors`);
    }

    console.log('  By Operation:');
    for (const [op, count] of byOperation) {
      console.log(`    ${op}: ${count} errors`);
    }
  }
}

// ============================================================================
// Docker Compose Manager
// ============================================================================

class DockerComposeManager {
  private config: MockServerConfig;
  private isRunning: boolean = false;

  constructor(config: MockServerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    console.log('\n🚀 Starting services with docker compose...');
    
    // Set environment variables for docker compose
    const env = {
      ...process.env,
      MOCK_LATENCY_MEAN_MS: String(this.config.latencyMeanMs),
      MOCK_LATENCY_STD_MS: String(this.config.latencyStdMs),
      MOCK_TOKENS_PER_SEC: String(this.config.tokensPerSecond),
      MOCK_ERROR_RATE: String(this.config.errorRate),
      MOCK_INSTANT_MODE: this.config.latencyMeanMs === 0 && this.config.latencyStdMs === 0 ? 'true' : 'false',
    };

    // Try docker-compose first (works with podman-compose without daemon), then docker compose
    const exitCode = await this.tryComposeUp(env);
    if (exitCode !== 0) {
      throw new Error(`docker compose up failed with exit code ${exitCode}`);
    }

    this.isRunning = true;
    console.log('  ✅ Services started');
    
    // Wait for health checks to pass
    console.log('  Waiting for health checks...');
    await this.waitForServices();
  }

  private async tryComposeUp(env: NodeJS.ProcessEnv): Promise<number> {
    // Check which compose command is available
    const hasDockerCompose = await this.commandExists('docker-compose');
    const hasDockerPlugin = await this.commandExists('docker');
    
    if (hasDockerCompose) {
      // Try docker-compose first (podman-compose standalone works without daemon)
      const proc1 = Bun.spawn(['docker-compose', 'up', '-d', 'mock-server', 'litellm', 'apimap'], {
        env,
        stdout: 'inherit',
        stderr: 'pipe',
      });
      const exitCode1 = await proc1.exited;
      if (exitCode1 === 0) return 0;
    }
    
    if (hasDockerPlugin) {
      // Fall back to docker compose (Docker Compose plugin)
      if (hasDockerCompose) {
        console.log('  docker-compose failed, trying docker compose...');
      }
      const proc2 = Bun.spawn(['docker', 'compose', 'up', '-d', 'mock-server', 'litellm', 'apimap'], {
        env,
        stdout: 'inherit',
        stderr: 'inherit',
      });
      return await proc2.exited;
    }
    
    console.error('  ❌ Neither docker-compose nor docker compose found');
    return 1;
  }
  
  private async commandExists(cmd: string): Promise<boolean> {
    try {
      const proc = Bun.spawn(['which', cmd], { stdout: 'pipe', stderr: 'pipe' });
      const exitCode = await proc.exited;
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  private async waitForServices(): Promise<void> {
    const services = [
      { name: 'Mock Server', url: 'http://localhost:9999/health' },
      { name: 'LiteLLM', url: 'http://localhost:4000/v1/models', headers: { 'Authorization': 'Bearer sk-test-key' } },
      { name: 'API Map', url: 'http://localhost:3000/v1/models', headers: { 'Authorization': 'Bearer test-key' } },
    ];

    for (const service of services) {
      let retries = 0;
      const maxRetries = 60;
      
      while (retries < maxRetries) {
        try {
          const resp = await fetch(service.url, {
            headers: service.headers || {},
            signal: AbortSignal.timeout(2000),
          });
          if (resp.status === 200) {
            console.log(`    ✅ ${service.name} ready`);
            break;
          }
        } catch {
          // Not ready yet
        }
        await new Promise(r => setTimeout(r, 1000));
        retries++;
      }
      
      if (retries >= maxRetries) {
        throw new Error(`${service.name} failed to become healthy within 60 seconds`);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    console.log('\n🛑 Stopping services...');
    
    // Check which compose command to use
    const hasDockerCompose = await this.commandExists('docker-compose');
    let exitCode = 1;
    
    if (hasDockerCompose) {
      const proc = Bun.spawnSync(['docker-compose', 'down', '-v'], {
        stdout: 'inherit',
        stderr: 'pipe',
      });
      exitCode = proc.exitCode ?? 1;
    }
    
    if (exitCode !== 0 && await this.commandExists('docker')) {
      const proc = Bun.spawnSync(['docker', 'compose', 'down', '-v'], {
        stdout: 'inherit',
        stderr: 'inherit',
      });
      exitCode = proc.exitCode ?? 1;
    }
    
    if (exitCode === 0) {
      console.log('  ✅ Services stopped');
    } else {
      console.log('  ⚠️  Some services may still be running');
    }
    this.isRunning = false;
  }

  getConfig(): MockServerConfig {
    return this.config;
  }
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: BenchmarkConfig = {
  targets: [
    {
      name: 'LiteLLM',
      url: Bun.env.LITELLM_URL || 'http://localhost:4000',
      apiKey: Bun.env.LITELLM_API_KEY || 'sk-test-key',
      enabled: true,
    },
    {
      name: 'API Map',
      url: Bun.env.APIMAP_URL || 'http://localhost:3000',
      apiKey: Bun.env.APIMAP_API_KEY || 'test-key',
      enabled: true,
    },
    {
      name: 'Direct',
      url: Bun.env.MOCK_SERVER_URL || 'http://localhost:9999',
      apiKey: 'test-key',
      enabled: true,
    },
  ],
  scenarios: parseScenarios(Bun.env.BENCHMARK_SCENARIOS),
  outputDir: Bun.env.BENCHMARK_OUTPUT || './results',
  warmupRequests: parseInt(Bun.env.BENCHMARK_WARMUP || '5'),
  testStreaming: Bun.env.BENCHMARK_SKIP_STREAMING !== 'true',
  testFeatures: Bun.env.BENCHMARK_SKIP_FEATURES !== 'true',
  logErrors: true,
  logDir: './logs',
  mockServerConfig: {
    latencyMeanMs: parseFloat(Bun.env.MOCK_LATENCY_MEAN_MS || '0'),
    latencyStdMs: parseFloat(Bun.env.MOCK_LATENCY_STD_MS || '0'),
    tokensPerSecond: parseFloat(Bun.env.MOCK_TOKENS_PER_SEC || '100'),
    errorRate: parseFloat(Bun.env.MOCK_ERROR_RATE || '0'),
  },
};

function parseScenarios(env?: string): ScenarioConfig[] {
  const promptSize = parseInt(Bun.env.BENCHMARK_PROMPT_SIZE || '100');
  const contextSize = parseInt(Bun.env.BENCHMARK_CONTEXT_SIZE || '0');
  const maxTokens = parseInt(Bun.env.BENCHMARK_MAX_TOKENS || '500');
  
  // DEFAULT_CONFIG only uses openai protocol (backward compatibility)
  const testProtocols = [PROTOCOL_COMBINATIONS[0]!];
  
  let baseScenarios: Array<{name: string, concurrency: number, requests: number}>;
  
  if (!env) {
    baseScenarios = [
      { name: 'light', concurrency: 1, requests: 50 },
      { name: 'medium', concurrency: 10, requests: 100 },
      { name: 'heavy', concurrency: 50, requests: 200 },
      { name: 'extreme', concurrency: 100, requests: 300 },
    ];
  } else {
    baseScenarios = env.split(',').map((pair, i) => {
      const [conc, reqs] = pair.split(':');
      return {
        name: `scenario-${i + 1}`,
        concurrency: parseInt(conc),
        requests: parseInt(reqs),
      };
    });
  }
  
  // Create scenarios for each protocol combination
  const scenarios: ScenarioConfig[] = [];
  
  for (const base of baseScenarios) {
    // Divide requests by number of protocols to keep total benchmark time roughly constant
    const requestsPerProtocol = Math.max(5, Math.floor(base.requests / testProtocols.length));
    
    for (const protocol of testProtocols) {
      const protocolSuffix = testProtocols.length > 1 ? `-${protocol.sourceFormat}` : '';
      scenarios.push({
        name: `${base.name}${protocolSuffix}`,
        concurrency: base.concurrency,
        requests: requestsPerProtocol,
        promptSize,
        contextSize,
        maxTokens,
        useStreaming: false,
        protocol,
      });
    }
  }
  
  return scenarios;
}

// ============================================================================
// Prompt Generation
// ============================================================================

function generatePrompt(size: number): string {
  const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 
                 'hello', 'world', 'benchmark', 'testing', 'performance', 'analysis'];
  let result = '';
  while (result.length < size) {
    result += words[Math.floor(Math.random() * words.length)] + ' ';
  }
  return result.slice(0, size);
}

function generateContext(size: number): string {
  if (size === 0) return '';
  return generatePrompt(size);
}

function buildMessages(prompt: string, context: string): Array<{role: string, content: string}> {
  const messages = [];
  if (context) {
    messages.push({ role: 'system', content: context });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

// ============================================================================
// Gateway Client
// ============================================================================

class GatewayClient {
  constructor(
    private name: string,
    private url: string,
    private apiKey: string,
    private errorLogger?: ErrorLogger,
  ) {}

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.url}/v1/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return resp.status === 200;
    } catch (error) {
      this.errorLogger?.log(this.name, 'health_check', error instanceof Error ? error : String(error));
      return false;
    }
  }

  async chatCompletion(
    model: string,
    messages: Array<{role: string, content: string}>,
    maxTokens: number,
    stream: boolean,
    protocol?: ProtocolConfig,
  ): Promise<{ latencyMs: number; success: boolean; tokens?: number; streamingMetrics?: StreamingMetrics }> {
    const start = performance.now();
    
    // Determine endpoint and request format based on protocol
    const endpoint = protocol?.endpoint || '/v1/chat/completions';
    const isAnthropic = endpoint === '/v1/messages';
    
    try {
      const body = isAnthropic 
        ? this.buildAnthropicBody(model, messages, maxTokens, stream)
        : this.buildOpenAIBody(model, messages, maxTokens, stream);
        
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      };
      
      // Anthropic requires API version header
      if (isAnthropic) {
        headers['anthropic-version'] = '2023-06-01';
      }
      
      const resp = await fetch(`${this.url}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });

      const latencyMs = performance.now() - start;

      if (!resp.ok) {
        const text = await resp.text();
        this.errorLogger?.log(this.name, 'chat_completion', `HTTP ${resp.status}: ${text}`, {
          model,
          maxTokens,
          stream,
          endpoint,
        });
        return { latencyMs, success: false };
      }

      if (stream) {
        const streamingMetrics = await this.handleStreamingResponse(resp, start, isAnthropic);
        return { latencyMs: performance.now() - start, success: true, streamingMetrics };
      } else {
        await resp.text();
        return { latencyMs, success: true };
      }
    } catch (error) {
      const latencyMs = performance.now() - start;
      this.errorLogger?.log(this.name, 'chat_completion', error instanceof Error ? error : String(error), {
        model,
        maxTokens,
        stream,
        endpoint,
      });
      return { latencyMs, success: false };
    }
  }
  
  private buildOpenAIBody(
    model: string,
    messages: Array<{role: string, content: string}>,
    maxTokens: number,
    stream: boolean,
  ): Record<string, unknown> {
    return {
      model,
      messages,
      max_tokens: maxTokens,
      stream,
    };
  }
  
  private buildAnthropicBody(
    model: string,
    messages: Array<{role: string, content: string}>,
    maxTokens: number,
    stream: boolean,
  ): Record<string, unknown> {
    // Convert messages to Anthropic format (no system role in messages)
    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));
      
    // Extract system message if present
    const systemMessage = messages.find(m => m.role === 'system');
    const body: Record<string, unknown> = {
      model,
      messages: anthropicMessages,
      max_tokens: maxTokens,
      stream,
    };
    
    if (systemMessage) {
      body.system = systemMessage.content;
    }
    
    return body;
  }

  private async handleStreamingResponse(resp: Response, startTime: number, isAnthropic = false): Promise<StreamingMetrics> {
    const reader = resp.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    let firstTokenTime: number | null = null;
    let lastTokenTime = startTime;
    const chunkTimes: number[] = [];
    let totalTokens = 0;
    let chunkCount = 0;
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          if (line === 'data: [DONE]') continue;

          const now = performance.now();
          chunkTimes.push(now);
          chunkCount++;

          if (firstTokenTime === null) {
            firstTokenTime = now;
          }
          lastTokenTime = now;

          try {
            const data = JSON.parse(line.slice(6));
            
            // Handle OpenAI format
            if (data.choices?.[0]?.delta?.content) {
              totalTokens += data.choices[0].delta.content.split(/\s+/).length;
            }
            
            // Handle Anthropic format
            if (data.type === 'content_block_delta' && data.delta?.text) {
              totalTokens += data.delta.text.split(/\s+/).length;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const totalTime = lastTokenTime - startTime;
    
    // Calculate chunk latencies
    const chunkLatencies: number[] = [];
    let prevTime = startTime;
    for (const t of chunkTimes) {
      chunkLatencies.push(t - prevTime);
      prevTime = t;
    }

    return {
      timeToFirstTokenMs: firstTokenTime ? firstTokenTime - startTime : 0,
      timeToLastTokenMs: totalTime,
      tokensPerSec: totalTime > 0 ? (totalTokens / totalTime) * 1000 : 0,
      totalTokens,
      chunkCount,
      meanChunkLatencyMs: chunkLatencies.length > 0 
        ? chunkLatencies.reduce((a, b) => a + b, 0) / chunkLatencies.length 
        : 0,
    };
  }

  getName(): string {
    return this.name;
  }
}

// ============================================================================
// Benchmark Functions
// ============================================================================

async function runWarmup(client: GatewayClient, config: BenchmarkConfig, errorLogger?: ErrorLogger): Promise<void> {
  console.log(`  Warming up ${client.getName()}...`);
  const messages = buildMessages('Hello', '');
  
  const promises = Array(config.warmupRequests).fill(null).map(() =>
    client.chatCompletion('gpt-4o-mini', messages, 10, false)
  );
  
  await Promise.all(promises);
}

async function benchmarkLatency(
  client: GatewayClient,
  scenario: ScenarioConfig,
  errorLogger?: ErrorLogger,
): Promise<LatencyResult> {
  const protocolDesc = scenario.protocol ? ` (${scenario.protocol.description})` : '';
  console.log(`  Testing latency: ${client.getName()} - ${scenario.name}${protocolDesc} (${scenario.requests} requests)`);
  
  const prompt = generatePrompt(scenario.promptSize);
  const context = generateContext(scenario.contextSize);
  const messages = buildMessages(prompt, context);
  
  const latencies: number[] = [];
  let errors = 0;
  
  for (let i = 0; i < scenario.requests; i++) {
    const result = await client.chatCompletion(
      'gpt-4o-mini',
      messages,
      scenario.maxTokens,
      scenario.useStreaming,
      scenario.protocol,
    );
    
    if (result.success) {
      latencies.push(result.latencyMs);
    } else {
      errors++;
    }
  }
  
  return {
    target: client.getName(),
    scenario: scenario.name,
    latencies,
    errors,
    total: scenario.requests,
  };
}

async function benchmarkThroughput(
  client: GatewayClient,
  scenario: ScenarioConfig,
  errorLogger?: ErrorLogger,
): Promise<ThroughputResult> {
  const protocolDesc = scenario.protocol ? ` (${scenario.protocol.description})` : '';
  console.log(`  Testing throughput: ${client.getName()} - ${scenario.name}${protocolDesc} (${scenario.concurrency} concurrent)`);
  
  const prompt = generatePrompt(scenario.promptSize);
  const context = generateContext(scenario.contextSize);
  const messages = buildMessages(prompt, context);
  
  const startTime = performance.now();
  let completed = 0;
  let errors = 0;
  
  const totalRequests = scenario.requests;
  const concurrency = scenario.concurrency;
  
  for (let i = 0; i < totalRequests; i += concurrency) {
    const batch = Array(Math.min(concurrency, totalRequests - i)).fill(null).map(async () => {
      const result = await client.chatCompletion(
        'gpt-4o-mini',
        messages,
        scenario.maxTokens,
        scenario.useStreaming,
        scenario.protocol,
      );
      
      if (result.success) {
        completed++;
      } else {
        errors++;
      }
    });
    
    await Promise.all(batch);
  }
  
  const durationMs = performance.now() - startTime;
  const requestsPerSecond = (completed / durationMs) * 1000;
  
  return {
    target: client.getName(),
    scenario: scenario.name,
    requestsPerSecond,
    totalRequests: completed,
    durationMs,
    errors,
  };
}

async function benchmarkStreaming(
  client: GatewayClient,
  protocol?: ProtocolConfig,
  errorLogger?: ErrorLogger,
): Promise<StreamingResult> {
  const protocolDesc = protocol ? ` (${protocol.description})` : '';
  console.log(`  Testing streaming: ${client.getName()}${protocolDesc}`);
  
  const messages = [
    { role: 'system' as const, content: 'You are a helpful assistant.' },
    { role: 'user' as const, content: 'Write a short poem about AI in 4 lines.' },
  ];
  
  const results: StreamingMetrics[] = [];
  let errors = 0;
  
  for (let i = 0; i < 10; i++) {
    try {
      const result = await client.chatCompletion(
        'gpt-4o-mini',
        messages,
        1000,
        true,
        protocol,
      );
      
      if (result.success && result.streamingMetrics) {
        results.push(result.streamingMetrics);
      } else {
        errors++;
      }
    } catch (error) {
      errors++;
      errorLogger?.log(client.getName(), 'streaming', error instanceof Error ? error : String(error));
    }
  }
  
  if (results.length === 0) {
    return {
      target: client.getName(),
      timeToFirstTokenMs: 0,
      timeToLastTokenMs: 0,
      tokensPerSec: 0,
      totalTokens: 0,
      chunkCount: 0,
      meanChunkLatencyMs: 0,
      errors,
    };
  }
  
  return {
    target: client.getName(),
    timeToFirstTokenMs: mean(results.map(r => r.timeToFirstTokenMs)),
    timeToLastTokenMs: mean(results.map(r => r.timeToLastTokenMs)),
    tokensPerSec: mean(results.map(r => r.tokensPerSec)),
    totalTokens: Math.floor(mean(results.map(r => r.totalTokens))),
    chunkCount: Math.floor(mean(results.map(r => r.chunkCount))),
    meanChunkLatencyMs: mean(results.map(r => r.meanChunkLatencyMs)),
    errors,
  };
}

function runFeatureComparison(): FeatureResult[] {
  console.log('  Running feature comparison...');
  
  const features: FeatureResult[] = [
    // Core Features
    { feature: 'Unified API', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'none',
      litellmNotes: 'Single interface for 100+ providers',
      apimapNotes: 'Pattern-based routing for multiple providers',
      directNotes: 'Direct connection to single provider', winner: 'tie' },
    { feature: 'Python SDK', litellmSupport: 'full', apimapSupport: 'none', directSupport: 'none',
      litellmNotes: 'Direct Python library integration',
      apimapNotes: 'REST API only',
      directNotes: 'REST API only', winner: 'litellm' },
    { feature: 'Proxy Server', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'none',
      litellmNotes: 'OpenAI-compatible proxy server',
      apimapNotes: 'REST API server with GUI',
      directNotes: 'No proxy layer', winner: 'tie' },
    { feature: 'Streaming Support', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'full',
      litellmNotes: 'Full streaming across all providers',
      apimapNotes: 'Full streaming support',
      directNotes: 'Native streaming support', winner: 'tie' },
    
    // Provider Support
    { feature: 'Provider Count', litellmSupport: 'full', apimapSupport: 'partial', directSupport: 'none',
      litellmNotes: '100+ LLM providers supported',
      apimapNotes: '12+ major providers',
      directNotes: 'Single provider only', winner: 'litellm' },
    { feature: 'OpenAI', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'full',
      litellmNotes: '', apimapNotes: '', directNotes: 'Direct OpenAI API', winner: 'tie' },
    { feature: 'Anthropic', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'full',
      litellmNotes: '', apimapNotes: '', directNotes: 'Direct Anthropic API', winner: 'tie' },
    { feature: 'Local Models', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'full',
      litellmNotes: 'Ollama, LM Studio, etc.',
      apimapNotes: 'Ollama, LM Studio, llama.cpp, vLLM',
      directNotes: 'Direct connection', winner: 'tie' },
    
    // Protocol & Format
    { feature: 'OpenAI Format', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'full',
      litellmNotes: 'Native OpenAI compatibility',
      apimapNotes: 'Native with protocol bridging',
      directNotes: 'Native OpenAI format', winner: 'tie' },
    { feature: 'Anthropic Format', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'none',
      litellmNotes: 'Native Anthropic compatibility',
      apimapNotes: 'Native with protocol bridging',
      directNotes: 'OpenAI format only', winner: 'tie' },
    { feature: 'Protocol Bridging', litellmSupport: 'partial', apimapSupport: 'full', directSupport: 'none',
      litellmNotes: 'Limited bridging support',
      apimapNotes: 'Use Anthropic format to call OpenAI and vice versa',
      directNotes: 'No protocol translation', winner: 'apimap' },
    
    // Routing & Load Balancing
    { feature: 'Pattern Routing', litellmSupport: 'partial', apimapSupport: 'full', directSupport: 'none',
      litellmNotes: 'Basic model grouping',
      apimapNotes: 'Wildcard patterns, capture groups, priority system',
      directNotes: 'No routing layer', winner: 'apimap' },
    { feature: 'Fallback/Routing', litellmSupport: 'full', apimapSupport: 'partial', directSupport: 'none',
      litellmNotes: 'Router with retry/fallback logic',
      apimapNotes: 'Basic routing with default provider',
      directNotes: 'No fallback mechanism', winner: 'litellm' },
    { feature: 'Load Balancing', litellmSupport: 'full', apimapSupport: 'none', directSupport: 'none',
      litellmNotes: 'Built-in load balancing',
      apimapNotes: 'Not implemented',
      directNotes: 'No load balancing', winner: 'litellm' },
    
    // Management & UI
    { feature: 'Web GUI', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'none',
      litellmNotes: 'Admin dashboard for monitoring',
      apimapNotes: 'SvelteKit GUI with real-time monitoring',
      directNotes: 'No management UI', winner: 'tie' },
    { feature: 'Configuration UI', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'none',
      litellmNotes: 'Dashboard-based configuration',
      apimapNotes: 'Visual YAML editor with backups',
      directNotes: 'No configuration needed', winner: 'tie' },
    
    // Observability
    { feature: 'Request Logging', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'partial',
      litellmNotes: 'Comprehensive logging with callbacks',
      apimapNotes: 'Request/response logging with WebSocket updates',
      directNotes: 'Provider-dependent logging', winner: 'tie' },
    { feature: 'Cost Tracking', litellmSupport: 'full', apimapSupport: 'none', directSupport: 'none',
      litellmNotes: 'Built-in cost tracking and budgets',
      apimapNotes: 'Not implemented',
      directNotes: 'No built-in tracking', winner: 'litellm' },
    { feature: 'Metrics', litellmSupport: 'full', apimapSupport: 'partial', directSupport: 'none',
      litellmNotes: 'Prometheus metrics, detailed analytics',
      apimapNotes: 'Basic statistics dashboard',
      directNotes: 'No metrics aggregation', winner: 'litellm' },
    
    // Advanced Features
    { feature: 'Caching', litellmSupport: 'full', apimapSupport: 'none', directSupport: 'none',
      litellmNotes: 'Redis caching support',
      apimapNotes: 'Not implemented',
      directNotes: 'No caching layer', winner: 'litellm' },
    { feature: 'Guardrails', litellmSupport: 'full', apimapSupport: 'none', directSupport: 'none',
      litellmNotes: 'Content moderation, PII detection',
      apimapNotes: 'Not implemented',
      directNotes: 'No content filtering', winner: 'litellm' },
    { feature: 'A2A Protocol', litellmSupport: 'full', apimapSupport: 'none', directSupport: 'none',
      litellmNotes: 'Agent-to-Agent protocol support',
      apimapNotes: 'Not implemented',
      directNotes: 'Not implemented', winner: 'litellm' },
    { feature: 'MCP Tools', litellmSupport: 'full', apimapSupport: 'none', directSupport: 'none',
      litellmNotes: 'Model Context Protocol support',
      apimapNotes: 'Not implemented',
      directNotes: 'Not implemented', winner: 'litellm' },
    
    // Deployment
    { feature: 'Docker Support', litellmSupport: 'full', apimapSupport: 'full', directSupport: 'partial',
      litellmNotes: '', apimapNotes: '', directNotes: 'Depends on provider', winner: 'tie' },
    { feature: 'Helm Charts', litellmSupport: 'full', apimapSupport: 'none', directSupport: 'none',
      litellmNotes: 'Kubernetes deployment',
      apimapNotes: 'Not available',
      directNotes: 'Not applicable', winner: 'litellm' },
    
    // Performance (Baseline)
    { feature: 'Latency Overhead', litellmSupport: 'partial', apimapSupport: 'partial', directSupport: 'full',
      litellmNotes: 'Additional proxy hop',
      apimapNotes: 'Additional proxy hop',
      directNotes: 'No overhead - direct connection', winner: 'direct' },
    { feature: 'Baseline Comparison', litellmSupport: 'none', apimapSupport: 'none', directSupport: 'full',
      litellmNotes: 'Use for comparison',
      apimapNotes: 'Use for comparison',
      directNotes: 'Reference point for gateway overhead', winner: 'direct' },
  ];
  
  return features;
}

// ============================================================================
// Statistics
// ============================================================================

function calculatePercentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function analyzeLatencies(latencies: number[]) {
  if (latencies.length === 0) return null;
  
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  
  return {
    count: sorted.length,
    mean: sum / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: calculatePercentile(sorted, 50),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
  };
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ============================================================================
// Output
// ============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function generateReport(results: BenchmarkResults): string {
  let report = `# LiteLLM vs API Map - Benchmark Results\n\n`;
  report += `**Date:** ${results.timestamp}\n\n`;
  
  // Summary
  const latencyWinners = calculateLatencyWinners(results.latency);
  const throughputWinners = calculateThroughputWinners(results.throughput);
  const featureScores = calculateFeatureScores(results.features);
  
  report += `## Summary\n\n`;
  report += `- **Latency Winner:** ${latencyWinners.overall || 'N/A'}\n`;
  report += `- **Throughput Winner:** ${throughputWinners.overall || 'N/A'}\n`;
  report += `- **Feature Score:** LiteLLM ${featureScores.litellm} - API Map ${featureScores.apimap} - Direct ${featureScores.direct} - Tie ${featureScores.tie}\n`;
  if (results.errors.length > 0) {
    report += `- **Total Errors:** ${results.errors.length}\n`;
  }
  report += `\n`;
  
  // Latency section
  report += `## Latency Benchmark\n\n`;
  report += `| Target | Scenario | Mean | Median | P95 | P99 | Errors |\n`;
  report += `|--------|----------|------|--------|-----|-----|--------|\n`;
  
  for (const result of results.latency) {
    const stats = analyzeLatencies(result.latencies);
    if (stats) {
      report += `| ${result.target} | ${result.scenario} | ${stats.mean.toFixed(1)}ms | ${stats.median.toFixed(1)}ms | ${stats.p95.toFixed(1)}ms | ${stats.p99.toFixed(1)}ms | ${result.errors}/${result.total} |\n`;
    }
  }
  
  report += `\n`;
  
  // Throughput section
  report += `## Throughput Benchmark\n\n`;
  report += `| Target | Scenario | Concurrency | Req/sec | Duration | Success |\n`;
  report += `|--------|----------|-------------|---------|----------|----------|\n`;
  
  for (const result of results.throughput) {
    const scenario = results.config.scenarios.find(s => s.name === result.scenario);
    const concurrency = scenario?.concurrency || 1;
    report += `| ${result.target} | ${result.scenario} | ${concurrency} | ${result.requestsPerSecond.toFixed(1)} | ${formatDuration(result.durationMs)} | ${result.totalRequests}/${result.totalRequests + result.errors} |\n`;
  }
  
  report += `\n`;
  
  // Streaming section
  if (results.streaming.length > 0) {
    report += `## Streaming Benchmark\n\n`;
    report += `| Target | TTFT (ms) | TTLT (ms) | Tokens/sec | Chunks | Errors |\n`;
    report += `|--------|-----------|-----------|------------|--------|--------|\n`;
    
    for (const r of results.streaming) {
      report += `| ${r.target} | ${r.timeToFirstTokenMs.toFixed(2)} | ${r.timeToLastTokenMs.toFixed(2)} | ${r.tokensPerSec.toFixed(2)} | ${r.chunkCount} | ${r.errors} |\n`;
    }
    
    report += `\n`;
  }
  
  // Feature Comparison
  if (results.features.length > 0) {
    report += `## Feature Comparison\n\n`;
    report += `| Feature | LiteLLM | API Map | Direct | Winner |\n`;
    report += `|---------|---------|---------|--------|--------|\n`;
    
    const supportEmoji: Record<string, string> = { full: '✅', partial: '⚠️', none: '❌' };
    const winnerMap: Record<string, string> = { litellm: 'LiteLLM', apimap: 'API Map', direct: 'Direct', tie: 'Tie', none: '-' };
    
    for (const r of results.features) {
      const lSupport = supportEmoji[r.litellmSupport] || '❓';
      const aSupport = supportEmoji[r.apimapSupport] || '❓';
      const dSupport = supportEmoji[r.directSupport] || '❓';
      report += `| ${r.feature} | ${lSupport} | ${aSupport} | ${dSupport} | ${winnerMap[r.winner] || r.winner} |\n`;
    }
    
    report += `\n`;
  }
  
  // Errors section
  if (results.errors.length > 0) {
    report += `## Error Log\n\n`;
    report += `Total errors: ${results.errors.length}\n\n`;
    
    // Group by target
    const byTarget = new Map<string, ErrorLogEntry[]>();
    for (const err of results.errors) {
      const list = byTarget.get(err.target) || [];
      list.push(err);
      byTarget.set(err.target, list);
    }
    
    for (const [target, errors] of byTarget) {
      report += `### ${target} (${errors.length} errors)\n\n`;
      for (const err of errors.slice(0, 10)) { // Show first 10
        report += `- [${err.timestamp}] ${err.operation}: ${err.error}\n`;
      }
      if (errors.length > 10) {
        report += `- ... and ${errors.length - 10} more\n`;
      }
      report += `\n`;
    }
  }
  
  return report;
}

function calculateLatencyWinners(latencyResults: LatencyResult[]): { overall?: string; byScenario: Map<string, string> } {
  const byScenario = new Map<string, string>();
  
  // Group by scenario
  const byScenarioMap = new Map<string, Map<string, number[]>>();
  for (const r of latencyResults) {
    const scenarioMap = byScenarioMap.get(r.scenario) || new Map<string, number[]>();
    const latencies = scenarioMap.get(r.target) || [];
    latencies.push(...r.latencies);
    scenarioMap.set(r.target, latencies);
    byScenarioMap.set(r.scenario, scenarioMap);
  }
  
  // Determine winner per scenario
  for (const [scenario, targets] of byScenarioMap) {
    let bestTarget: string | null = null;
    let bestMean = Infinity;
    
    for (const [target, lats] of targets) {
      if (lats.length === 0) continue;
      const mean = lats.reduce((a, b) => a + b, 0) / lats.length;
      if (mean < bestMean) {
        bestMean = mean;
        bestTarget = target;
      }
    }
    
    if (bestTarget) {
      byScenario.set(scenario, bestTarget);
    }
  }
  
  // Overall winner
  const allMeans = new Map<string, number[]>();
  for (const r of latencyResults) {
    const all = allMeans.get(r.target) || [];
    all.push(...r.latencies);
    allMeans.set(r.target, all);
  }
  
  let overall: string | undefined;
  let bestOverallMean = Infinity;
  
  for (const [target, lats] of allMeans) {
    if (lats.length === 0) continue;
    const mean = lats.reduce((a, b) => a + b, 0) / lats.length;
    if (mean < bestOverallMean) {
      bestOverallMean = mean;
      overall = target;
    }
  }
  
  return { overall, byScenario };
}

function calculateThroughputWinners(throughputResults: ThroughputResult[]): { overall?: string; byScenario: Map<string, string> } {
  const byScenario = new Map<string, string>();
  
  // Group by scenario and find highest throughput
  const byScenarioMap = new Map<string, Map<string, number>>();
  for (const r of throughputResults) {
    const scenarioMap = byScenarioMap.get(r.scenario) || new Map<string, number>();
    const current = scenarioMap.get(r.target) || 0;
    scenarioMap.set(r.target, Math.max(current, r.requestsPerSecond));
    byScenarioMap.set(r.scenario, scenarioMap);
  }
  
  for (const [scenario, targets] of byScenarioMap) {
    let bestTarget: string | null = null;
    let bestRps = 0;
    
    for (const [target, rps] of targets) {
      if (rps > bestRps) {
        bestRps = rps;
        bestTarget = target;
      }
    }
    
    if (bestTarget) {
      byScenario.set(scenario, bestTarget);
    }
  }
  
  return { overall: byScenario.size > 0 ? Array.from(byScenario.values())[0] : undefined, byScenario };
}

function calculateFeatureScores(features: FeatureResult[]): { litellm: number; apimap: number; direct: number; tie: number } {
  const scores = { litellm: 0, apimap: 0, direct: 0, tie: 0 };
  
  for (const f of features) {
    if (f.winner === 'litellm') scores.litellm++;
    else if (f.winner === 'apimap') scores.apimap++;
    else if (f.winner === 'direct') scores.direct++;
    else if (f.winner === 'tie') scores.tie++;
  }
  
  return scores;
}

async function saveResults(results: BenchmarkResults): Promise<void> {
  if (!existsSync(results.config.outputDir)) {
    mkdirSync(results.config.outputDir, { recursive: true });
  }
  
  const basePath = join(results.config.outputDir, `benchmark_${results.runId}`);
  
  // Save JSON
  writeFileSync(`${basePath}.json`, JSON.stringify(results, null, 2));
  
  // Save Markdown
  writeFileSync(`${basePath}.md`, generateReport(results));
  
  console.log(`\n📄 Results saved to:`);
  console.log(`   JSON: ${basePath}.json`);
  console.log(`   Markdown: ${basePath}.md`);
  console.log(`   Run ID: ${results.runId}`);
}

// ============================================================================
// CLI Help
// ============================================================================

function showHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║    LiteLLM vs API Map vs Direct - Benchmark Runner              ║
╚══════════════════════════════════════════════════════════════════╝

USAGE:
    bun run src/benchmark/index.ts [OPTIONS]

TARGETS:
    --litellm-url URL       LiteLLM URL (default: http://localhost:4000)
    --apimap-url URL        API Map URL (default: http://localhost:3000)
    --direct-url URL        Direct URL for baseline comparison (default: http://localhost:9999)
    --skip-targets TARGETS  Comma-separated list of targets to skip (e.g., 'litellm,apimap')

SCENARIOS:
    --concurrency LEVELS    Comma-separated concurrency levels (default: 1,10,50,100)
    --requests COUNTS       Comma-separated request counts (default: 50,100,200,300)
    --prompt-size CHARS     Prompt size in characters (default: 100)
    --context-size CHARS    Context size in characters (default: 0)
    --max-tokens N          Max tokens in response (default: 50)

BENCHMARK TYPES:
    --skip-streaming        Skip streaming benchmarks
    --skip-features         Skip feature comparison
    --protocols MODE        Protocol tests: 'all' (default), 'openai', 'anthropic'

MOCK SERVER:
    --latency-mean MS       Mean response latency in ms (default: 0)
    --latency-std MS        Latency std dev in ms (default: 0)
    --tokens-per-sec N      Token generation speed (default: 100)
    --error-rate RATE       Error rate 0.0-1.0 (default: 0)

OUTPUT:
    --output DIR            Output directory for results (default: ./results)
    --run-id ID             Custom run ID (default: timestamp)
    --no-error-log          Disable error logging

OTHER:
    --quick                 Run quick test (fewer requests)
    --keep-services         Don't stop docker compose services after benchmark
    --help, -h              Show this help

EXAMPLES:
    # Default benchmark (all 3 targets, docker compose managed)
    bun run benchmark

    # Test with 0% error rate
    bun run benchmark --error-rate 0

    # Test with simulated latency
    bun run benchmark --latency-mean 50 --latency-std 10

    # Test only Direct (baseline comparison)
    bun run benchmark --skip-targets litellm,apimap

    # Test with specific concurrency levels
    bun run benchmark --concurrency 1,5,10 --requests 10,50,100

    # Quick validation test
    bun run benchmark --quick

    # Named run for easier identification
    bun run benchmark --run-id stress-test-100-concurrent
`);
}

// ============================================================================
// Parse Scenarios from CLI
// ============================================================================

function parseScenarioArgs(
  concurrencyArg?: string,
  requestsArg?: string,
  promptSizeArg?: string,
  contextSizeArg?: string,
  maxTokensArg?: string,
  protocolsArg?: string,
): ScenarioConfig[] {
  const concurrencyLevels = concurrencyArg 
    ? concurrencyArg.split(',').map(c => parseInt(c.trim()))
    : [1, 10, 50, 100];
    
  const requestCounts = requestsArg
    ? requestsArg.split(',').map(r => parseInt(r.trim()))
    : [50, 100, 200, 300];
    
  const promptSize = promptSizeArg ? parseInt(promptSizeArg) : 100;
  const contextSize = contextSizeArg ? parseInt(contextSizeArg) : 0;
  const maxTokens = maxTokensArg ? parseInt(maxTokensArg) : 50;
  
  // Parse protocols to test (default: 'all' for full benchmark)
  const testProtocols = protocolsArg === 'openai'
    ? [PROTOCOL_COMBINATIONS[0]!]
    : protocolsArg === 'anthropic'
    ? [PROTOCOL_COMBINATIONS[1]!]
    : PROTOCOL_COMBINATIONS; // default to all protocols
  
  const scenarios: ScenarioConfig[] = [];
  const maxLen = Math.max(concurrencyLevels.length, requestCounts.length);
  
  for (let i = 0; i < maxLen; i++) {
    const concurrency = concurrencyLevels[i] ?? concurrencyLevels[concurrencyLevels.length - 1];
    // Divide requests by number of protocols to keep total benchmark time roughly constant
    const baseRequests = requestCounts[i] ?? requestCounts[requestCounts.length - 1];
    const requests = Math.max(5, Math.floor(baseRequests / testProtocols.length));
    
    for (const protocol of testProtocols) {
      const protocolSuffix = testProtocols.length > 1 ? `-${protocol.sourceFormat}` : '';
      scenarios.push({
        name: `scenario-${i + 1}${protocolSuffix}`,
        concurrency,
        requests,
        promptSize,
        contextSize,
        maxTokens,
        useStreaming: false,
        protocol,
      });
    }
  }
  
  return scenarios;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { values } = parseArgs({
    args: Bun.argv,
    options: {
      'litellm-url': { type: 'string' },
      'apimap-url': { type: 'string' },
      'direct-url': { type: 'string' },
      'skip-targets': { type: 'string' },
      'concurrency': { type: 'string' },
      'requests': { type: 'string' },
      'prompt-size': { type: 'string' },
      'context-size': { type: 'string' },
      'max-tokens': { type: 'string' },
      'latency-mean': { type: 'string' },
      'latency-std': { type: 'string' },
      'tokens-per-sec': { type: 'string' },
      'error-rate': { type: 'string' },
      'quick': { type: 'boolean' },
      'output': { type: 'string' },
      'run-id': { type: 'string' },
      'skip-streaming': { type: 'boolean' },
      'skip-features': { type: 'boolean' },
      'protocols': { type: 'string' },
      'no-error-log': { type: 'boolean' },
      'keep-services': { type: 'boolean' },
      'help': { type: 'boolean', short: 'h' },
    },
    strict: false,
    allowPositionals: true,
  });
  
  const runId = values['run-id'] as string || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  if (values['help']) {
    showHelp();
    process.exit(0);
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  LiteLLM vs API Map vs Direct - Bun Benchmark Runner        ║
╚══════════════════════════════════════════════════════════════╝
`);

  const config = { ...DEFAULT_CONFIG };
  
  if (values['litellm-url']) {
    config.targets[0].url = values['litellm-url'] as string;
  }
  if (values['apimap-url']) {
    config.targets[1].url = values['apimap-url'] as string;
  }
  if (values['direct-url']) {
    config.targets[2].url = values['direct-url'] as string;
  }
  if (values['skip-targets']) {
    const skipList = (values['skip-targets'] as string).split(',').map(s => s.trim().toLowerCase());
    for (const target of config.targets) {
      if (skipList.includes(target.name.toLowerCase())) {
        target.enabled = false;
      }
    }
  }
  if (values['output']) {
    config.outputDir = values['output'] as string;
  }
  if (values['skip-streaming']) {
    config.testStreaming = false;
  }
  if (values['skip-features']) {
    config.testFeatures = false;
  }
  if (values['no-error-log']) {
    config.logErrors = false;
  }
  
  // Parse mock server config
  if (values['latency-mean']) {
    config.mockServerConfig.latencyMeanMs = parseFloat(values['latency-mean'] as string);
  }
  if (values['latency-std']) {
    config.mockServerConfig.latencyStdMs = parseFloat(values['latency-std'] as string);
  }
  if (values['tokens-per-sec']) {
    config.mockServerConfig.tokensPerSecond = parseFloat(values['tokens-per-sec'] as string);
  }
  if (values['error-rate']) {
    config.mockServerConfig.errorRate = parseFloat(values['error-rate'] as string);
  }
  
  config.scenarios = parseScenarioArgs(
    values['concurrency'] as string | undefined,
    values['requests'] as string | undefined,
    values['prompt-size'] as string | undefined,
    values['context-size'] as string | undefined,
    values['max-tokens'] as string | undefined,
    values['protocols'] as string | undefined,
  );
  
  if (values['quick']) {
    console.log('⚡ Quick mode enabled\n');
    // In quick mode, only test OpenAI protocol and first 2 scenarios
    config.scenarios = config.scenarios
      .filter(s => !s.protocol || s.protocol.sourceFormat === 'openai')
      .slice(0, 2)
      .map(s => ({
        ...s,
        requests: Math.max(5, Math.floor(s.requests / 5)),
      }));
  }

  // Initialize error logger
  const errorLogger = new ErrorLogger(config.logDir, config.logErrors);
  
  // Initialize Docker Compose manager
  const dockerManager = new DockerComposeManager(config.mockServerConfig);
  
  // Track whether we should keep services running
  const keepServices = values['keep-services'] as boolean || false;

  const protocolsTested = [...new Set(config.scenarios.map(s => s.protocol?.description || 'OpenAI→OpenAI'))];
  
  console.log('Configuration:');
  console.log(`  LiteLLM: ${config.targets[0].url} ${config.targets[0].enabled ? '' : '(skipped)'}`);
  console.log(`  API Map: ${config.targets[1].url} ${config.targets[1].enabled ? '' : '(skipped)'}`);
  console.log(`  Direct:  ${config.targets[2].url} ${config.targets[2].enabled ? '' : '(skipped)'}`);
  console.log(`  Protocols: ${protocolsTested.join(', ')}`);
  console.log(`  Scenarios (${config.scenarios.length}):`);
  config.scenarios.forEach(s => {
    const proto = s.protocol ? ` [${s.protocol.description}]` : '';
    console.log(`    - ${s.name}: ${s.concurrency} concurrent, ${s.requests} requests${proto}`);
  });
  console.log(`  Context size: ${config.scenarios[0]?.contextSize || 0} chars`);
  console.log(`  Max tokens: ${config.scenarios[0]?.maxTokens || 50}`);
  console.log(`  Test streaming: ${config.testStreaming}`);
  console.log(`  Test features: ${config.testFeatures}`);
  console.log(`  Error logging: ${config.logErrors}`);
  console.log(`  Mock latency: ${config.mockServerConfig.latencyMeanMs}ms ± ${config.mockServerConfig.latencyStdMs}ms`);
  console.log(`  Mock error rate: ${config.mockServerConfig.errorRate}`);
  console.log('');

  // Start services
  await dockerManager.start();
  
  // Ensure services are stopped on exit (unless --keep-services)
  if (!keepServices) {
    process.on('SIGINT', async () => {
      console.log('\n\nInterrupted by user, stopping services...');
      await dockerManager.stop();
      process.exit(130);
    });
    process.on('SIGTERM', async () => {
      await dockerManager.stop();
    });
  }

  try {
    // Initialize error logger
    
    // Check gateways
    console.log('\nChecking gateways...');
    const clients: GatewayClient[] = [];
    
    for (const target of config.targets) {
      if (!target.enabled) {
        continue;
      }
      
      const client = new GatewayClient(target.name, target.url, target.apiKey, errorLogger);
      const ok = await client.healthCheck();
      console.log(`  ${target.name} (${target.url}): ${ok ? '✅' : '❌'}`);
      
      if (ok) {
        clients.push(client);
      }
    }
    
    if (clients.length === 0) {
      console.error('\n❌ No gateways available for testing!');
      process.exit(1);
    }
    
    // Warmup all clients
    console.log('\nWarming up...');
    for (const client of clients) {
      await runWarmup(client, config, errorLogger);
    }
    console.log('  ✅ Warmup complete\n');

    // Run benchmarks
    const results: BenchmarkResults = {
      runId,
      timestamp: new Date().toISOString(),
      config,
      latency: [],
      throughput: [],
      streaming: [],
      features: [],
      errors: [],
    };

    for (const scenario of config.scenarios) {
      console.log(`\n--- Scenario: ${scenario.name} (${scenario.concurrency} concurrent, ${scenario.requests} requests) ---\n`);
      
      for (const client of clients) {
        // Latency test (sequential)
        const latencyResult = await benchmarkLatency(client, scenario, errorLogger);
        results.latency.push(latencyResult);
        
        const stats = analyzeLatencies(latencyResult.latencies);
        if (stats) {
          console.log(`    Latency: Mean=${stats.mean.toFixed(1)}ms, P95=${stats.p95.toFixed(1)}ms`);
        } else if (latencyResult.errors > 0) {
          console.log(`    Latency: ${latencyResult.errors}/${latencyResult.total} requests failed`);
        }
        
        // Throughput test (concurrent)
        const throughputResult = await benchmarkThroughput(client, scenario, errorLogger);
        results.throughput.push(throughputResult);
        
        console.log(`    Throughput: ${throughputResult.requestsPerSecond.toFixed(1)} req/sec`);
      }
    }

    // Streaming benchmarks - test all protocol combinations
    if (config.testStreaming) {
      console.log('\n--- Streaming Benchmarks ---\n');
      
      // Get unique protocols from scenarios
      const protocolsToTest: (ProtocolConfig | undefined)[] = [undefined]; // default OpenAI passthrough
      const hasAnthropic = config.scenarios.some(s => s.protocol?.sourceFormat === 'anthropic');
      if (hasAnthropic) {
        protocolsToTest.push(PROTOCOL_COMBINATIONS[1]);
      }
      
      for (const client of clients) {
        for (const protocol of protocolsToTest) {
          const streamingResult = await benchmarkStreaming(client, protocol, errorLogger);
          results.streaming.push(streamingResult);
          
          const protocolName = protocol ? ` (${protocol.description})` : '';
          console.log(`  ${client.getName()}${protocolName}: TTFT=${streamingResult.timeToFirstTokenMs.toFixed(1)}ms, ` +
                      `Tokens/sec=${streamingResult.tokensPerSec.toFixed(1)}`);
        }
      }
    }

    // Feature comparison
    if (config.testFeatures) {
      console.log('\n--- Feature Comparison ---\n');
      results.features = runFeatureComparison();
      
      const scores = calculateFeatureScores(results.features);
      console.log(`  Feature Score: LiteLLM ${scores.litellm} - API Map ${scores.apimap} - Direct ${scores.direct} - Tie ${scores.tie}`);
    }

    // Collect errors
    results.errors = errorLogger.getErrors();

    // Save results
    await saveResults(results);
    
    // Save error log
    errorLogger.saveToFile(runId);
    
    // Print error summary
    errorLogger.printSummary();
    
    console.log('\n✅ Benchmark complete!');
    
    // Auto-generate report
    console.log('\n📊 Generating report...');
    await generatePdfReport(runId);
    
  } finally {
    // Always stop services (unless --keep-services)
    if (!keepServices) {
      await dockerManager.stop();
    } else {
      console.log('\n🔌 Services left running (use --keep-services to stop them manually)');
    }
  }
}

async function generatePdfReport(runId: string): Promise<void> {
  try {
    const proc = Bun.spawn(['python3', 'visualize.py', '--run-id', runId], {
      stdout: 'inherit',
      stderr: 'inherit',
      cwd: process.cwd(),
    });
    
    await proc.exited;
    
    if (proc.exitCode === 0) {
      console.log(`\n📄 Report saved to: reports/benchmark_report_${runId}.pdf`);
    } else {
      console.log('\n⚠️  Report generation failed (non-critical)');
    }
  } catch (error) {
    // Silently ignore report generation errors - it's optional
    console.log('\n⚠️  Report generation skipped (visualize.py may not be available)');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
