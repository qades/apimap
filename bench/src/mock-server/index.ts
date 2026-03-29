#!/usr/bin/env bun
/**
 * Multi-Provider Mock LLM Server
 * 
 * Supports OpenAI, Anthropic, Gemini, DeepSeek, vLLM, Ollama, and generic OpenAI-compatible endpoints.
 * Validates requests according to each provider's schema.
 * 
 * All endpoints are always enabled - the server handles all API formats simultaneously
 * so clients can use whatever endpoint their programs expect.
 * 
 * Environment Variables:
 *   MOCK_STRICT_VALIDATION=true  - Throw errors on malformed requests (default: true)
 */

import { Elysia, t } from 'elysia';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  sleep,
  countTokens,
  countMessageTokens,
  calculateLatency,
  calculateStreamingLatency,
  calculateChunkDelay,
  applyThrottle,
  gaussianRandom,
  defaultConfig,
  globalThrottler,
  type ThrottleConfig,
} from './throttle';

// ============================================================================
// Configuration
// ============================================================================

interface Config {
  port: number;
  host: string;
  latencyMeanMs: number;
  latencyStdMs: number;
  tokensPerSecond: number;
  errorRate: number;
  maxContextLength: number;
  streamingEnabled: boolean;
  logDir: string;
  logRequests: boolean;
  logErrors: boolean;
  strictValidation: boolean;
}

const config: Config = {
  port: parseInt(Bun.env.MOCK_SERVER_PORT || '9999'),
  host: Bun.env.MOCK_SERVER_HOST || '0.0.0.0',
  latencyMeanMs: defaultConfig.latencyMeanMs,
  latencyStdMs: defaultConfig.latencyStdMs,
  tokensPerSecond: defaultConfig.tokensPerSecond,
  errorRate: parseFloat(Bun.env.MOCK_ERROR_RATE || '0.01'),
  maxContextLength: parseInt(Bun.env.MOCK_MAX_CONTEXT || '8192'),
  streamingEnabled: defaultConfig.streamingEnabled,
  logDir: Bun.env.MOCK_LOG_DIR || './logs',
  logRequests: Bun.env.MOCK_LOG_REQUESTS !== 'false',
  logErrors: Bun.env.MOCK_LOG_ERRORS !== 'false',
  strictValidation: Bun.env.MOCK_STRICT_VALIDATION !== 'false',
};

// Create throttling config that matches our environment
const throttleConfig: ThrottleConfig = {
  latencyMeanMs: config.latencyMeanMs,
  latencyStdMs: config.latencyStdMs,
  tokensPerSecond: config.tokensPerSecond,
  streamingEnabled: config.streamingEnabled,
};

// ============================================================================
// Types
// ============================================================================

interface RequestLog {
  timestamp: string;
  method: string;
  path: string;
  provider: string;
  requestId: string;
  durationMs: number;
  statusCode: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  userAgent?: string;
}

interface ErrorLog {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  provider: string;
  error: string;
  stack?: string;
  context?: Record<string, unknown>;
}

interface ValidationError {
  field: string;
  message: string;
  value?: unknown;
}

// ============================================================================
// Logger
// ============================================================================

class RequestLogger {
  private requests: RequestLog[] = [];
  private errors: ErrorLog[] = [];
  private readonly logDir: string;
  private readonly enabled: boolean;
  private readonly errorEnabled: boolean;

  constructor(logDir: string, enabled: boolean = true, errorEnabled: boolean = true) {
    this.logDir = logDir;
    this.enabled = enabled;
    this.errorEnabled = errorEnabled;
    
    if ((enabled || errorEnabled) && !existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  logRequest(log: RequestLog): void {
    if (!this.enabled) return;
    this.requests.push(log);
  }

  logError(log: ErrorLog): void {
    if (!this.errorEnabled) return;
    this.errors.push(log);
    console.error(`[${log.timestamp}] ERROR ${log.provider} ${log.method} ${log.path}: ${log.error}`);
  }

  saveLogs(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    
    if (this.enabled && this.requests.length > 0) {
      const requestPath = join(this.logDir, `mock_requests_${timestamp}.json`);
      const stats = this.getStats();
      const requestData = {
        timestamp: new Date().toISOString(),
        totalRequests: stats.total,
        errors: stats.errors,
        avgDurationMs: stats.avgDuration,
        byProvider: stats.byProvider,
        requests: this.requests,
      };
      writeFileSync(requestPath, JSON.stringify(requestData, null, 2));
      console.log(`📄 Request log saved to: ${requestPath}`);
    }
    
    if (this.errorEnabled && this.errors.length > 0) {
      const errorPath = join(this.logDir, `mock_errors_${timestamp}.json`);
      const errorData = {
        timestamp: new Date().toISOString(),
        totalErrors: this.errors.length,
        errors: this.errors,
      };
      writeFileSync(errorPath, JSON.stringify(errorData, null, 2));
      console.log(`📄 Error log saved to: ${errorPath}`);
    }
  }

  getStats(): { 
    total: number; 
    errors: number; 
    avgDuration: number;
    byProvider: Record<string, { total: number; errors: number }>;
  } {
    if (this.requests.length === 0) {
      return { total: 0, errors: 0, avgDuration: 0, byProvider: {} };
    }
    
    const byProvider: Record<string, { total: number; errors: number }> = {};
    
    for (const req of this.requests) {
      if (!byProvider[req.provider]) {
        byProvider[req.provider] = { total: 0, errors: 0 };
      }
      byProvider[req.provider].total++;
      if (req.statusCode >= 400) {
        byProvider[req.provider].errors++;
      }
    }
    
    return {
      total: this.requests.length,
      errors: this.requests.filter(r => r.statusCode >= 400).length,
      avgDuration: this.requests.reduce((a, b) => a + b.durationMs, 0) / this.requests.length,
      byProvider,
    };
  }
}

const requestLogger = new RequestLogger(config.logDir, config.logRequests, config.logErrors);

process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  requestLogger.saveLogs();
  process.exit(0);
});

process.on('SIGTERM', () => {
  requestLogger.saveLogs();
  process.exit(0);
});

// ============================================================================
// Utils
// ============================================================================

function generateId(): string {
  return `mock-${Math.floor(10000 + Math.random() * 90000)}`;
}

function generateRequestId(): string {
  return `req-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

// Re-export throttling functions with config pre-applied
function localCalculateLatency(inputTokens: number, outputTokens: number): number {
  return calculateLatency(inputTokens, outputTokens, throttleConfig);
}

function localCalculateStreamingLatency(inputTokens: number): number {
  return calculateStreamingLatency(inputTokens, throttleConfig);
}

function localCalculateChunkDelay(): number {
  return calculateChunkDelay(throttleConfig);
}

function shouldError(): boolean {
  return Math.random() < config.errorRate;
}

// ============================================================================
// Validation Functions
// ============================================================================

class ValidationResult {
  errors: ValidationError[] = [];
  
  addError(field: string, message: string, value?: unknown): void {
    this.errors.push({ field, message, value });
  }
  
  isValid(): boolean {
    return this.errors.length === 0;
  }
  
  toResponse() {
    return {
      error: 'Validation failed',
      details: this.errors,
    };
  }
}

function validateOpenAIRequest(body: Record<string, unknown>): ValidationResult {
  const result = new ValidationResult();
  
  if (!body.model) {
    result.addError('model', 'model is required');
  } else if (typeof body.model !== 'string') {
    result.addError('model', 'model must be a string', body.model);
  }
  
  if (!body.messages) {
    result.addError('messages', 'messages is required');
  } else if (!Array.isArray(body.messages)) {
    result.addError('messages', 'messages must be an array', body.messages);
  } else {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i] as Record<string, unknown>;
      if (!msg.role) {
        result.addError(`messages[${i}].role`, 'role is required');
      } else if (!['system', 'user', 'assistant', 'tool'].includes(msg.role as string)) {
        result.addError(`messages[${i}].role`, 'role must be system, user, assistant, or tool', msg.role);
      }
      
      if (!msg.content && msg.role !== 'assistant') {
        result.addError(`messages[${i}].content`, 'content is required for non-assistant messages');
      }
    }
  }
  
  if (body.temperature !== undefined) {
    const temp = Number(body.temperature);
    if (isNaN(temp) || temp < 0 || temp > 2) {
      result.addError('temperature', 'temperature must be between 0 and 2', body.temperature);
    }
  }
  
  if (body.top_p !== undefined) {
    const topP = Number(body.top_p);
    if (isNaN(topP) || topP < 0 || topP > 1) {
      result.addError('top_p', 'top_p must be between 0 and 1', body.top_p);
    }
  }
  
  if (body.max_tokens !== undefined) {
    const maxTokens = Number(body.max_tokens);
    if (isNaN(maxTokens) || maxTokens < 1) {
      result.addError('max_tokens', 'max_tokens must be a positive integer', body.max_tokens);
    }
  }
  
  if (body.n !== undefined) {
    const n = Number(body.n);
    if (isNaN(n) || n < 1 || n > 128) {
      result.addError('n', 'n must be between 1 and 128', body.n);
    }
  }
  
  if (body.seed !== undefined) {
    const seed = Number(body.seed);
    if (isNaN(seed)) {
      result.addError('seed', 'seed must be an integer', body.seed);
    }
  }
  
  if (body.presence_penalty !== undefined) {
    const penalty = Number(body.presence_penalty);
    if (isNaN(penalty) || penalty < -2 || penalty > 2) {
      result.addError('presence_penalty', 'presence_penalty must be between -2 and 2', body.presence_penalty);
    }
  }
  
  if (body.frequency_penalty !== undefined) {
    const penalty = Number(body.frequency_penalty);
    if (isNaN(penalty) || penalty < -2 || penalty > 2) {
      result.addError('frequency_penalty', 'frequency_penalty must be between -2 and 2', body.frequency_penalty);
    }
  }
  
  if (body.logprobs !== undefined && typeof body.logprobs !== 'boolean') {
    result.addError('logprobs', 'logprobs must be a boolean', body.logprobs);
  }
  
  if (body.top_logprobs !== undefined) {
    const topLogprobs = Number(body.top_logprobs);
    if (isNaN(topLogprobs) || topLogprobs < 0 || topLogprobs > 20) {
      result.addError('top_logprobs', 'top_logprobs must be between 0 and 20', body.top_logprobs);
    }
  }
  
  return result;
}

function validateAnthropicRequest(body: Record<string, unknown>): ValidationResult {
  const result = new ValidationResult();
  
  if (!body.model) {
    result.addError('model', 'model is required');
  }
  
  if (!body.messages) {
    result.addError('messages', 'messages is required');
  } else if (!Array.isArray(body.messages)) {
    result.addError('messages', 'messages must be an array');
  } else {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i] as Record<string, unknown>;
      if (!msg.role) {
        result.addError(`messages[${i}].role`, 'role is required');
      } else if (!['user', 'assistant'].includes(msg.role as string)) {
        result.addError(`messages[${i}].role`, 'role must be user or assistant', msg.role);
      }
    }
  }
  
  if (!body.max_tokens) {
    result.addError('max_tokens', 'max_tokens is required for Anthropic');
  } else {
    const maxTokens = Number(body.max_tokens);
    if (isNaN(maxTokens) || maxTokens < 1) {
      result.addError('max_tokens', 'max_tokens must be a positive integer', body.max_tokens);
    }
  }
  
  if (body.thinking) {
    const thinking = body.thinking as Record<string, unknown>;
    if (thinking.type !== 'enabled' && thinking.type !== 'disabled') {
      result.addError('thinking.type', 'thinking.type must be enabled or disabled', thinking.type);
    }
    if (thinking.budget_tokens !== undefined) {
      const budget = Number(thinking.budget_tokens);
      if (isNaN(budget) || budget < 1) {
        result.addError('thinking.budget_tokens', 'budget_tokens must be a positive integer', thinking.budget_tokens);
      }
    }
  }
  
  return result;
}

function validateGeminiRequest(body: Record<string, unknown>): ValidationResult {
  const result = new ValidationResult();
  
  if (!body.model) {
    result.addError('model', 'model is required');
  }
  
  if (!body.contents && !body.messages) {
    result.addError('contents|messages', 'Either contents or messages is required');
  }
  
  if (body.top_k !== undefined) {
    const topK = Number(body.top_k);
    if (isNaN(topK) || topK < 1) {
      result.addError('top_k', 'top_k must be a positive integer', body.top_k);
    }
  }
  
  return result;
}

function validateDeepSeekRequest(body: Record<string, unknown>): ValidationResult {
  const result = validateOpenAIRequest(body);
  
  if (body.thinking) {
    const thinking = body.thinking as Record<string, unknown>;
    if (thinking.type !== 'enabled' && thinking.type !== 'disabled') {
      result.addError('thinking.type', 'thinking.type must be enabled or disabled', thinking.type);
    }
  }
  
  if (body.chat_template_kwargs) {
    const kwargs = body.chat_template_kwargs as Record<string, unknown>;
    if (kwargs.enable_thinking !== undefined && typeof kwargs.enable_thinking !== 'boolean') {
      result.addError('chat_template_kwargs.enable_thinking', 'enable_thinking must be a boolean', kwargs.enable_thinking);
    }
  }
  
  return result;
}

function validateGenericRequest(body: Record<string, unknown>): ValidationResult {
  const result = new ValidationResult();
  
  if (!body.model) {
    result.addError('model', 'model is required');
  }
  
  if (!body.messages && !body.prompt && !body.input) {
    result.addError('messages|prompt|input', 'One of messages, prompt, or input is required');
  }
  
  return result;
}

// ============================================================================
// Sample Responses
// ============================================================================

const sampleResponses = {
  openai: [
    "Artificial intelligence represents one of the most transformative technologies of our era. Machine learning systems can now process natural language with remarkable sophistication. These models learn patterns from vast amounts of text data, enabling them to generate coherent and contextually appropriate responses. The underlying neural networks use attention mechanisms to weigh the importance of different input tokens. As these systems scale, they demonstrate emergent capabilities that weren't explicitly programmed. Researchers continue to push the boundaries of what's possible with large language models.",
    "The development of transformer architectures revolutionized natural language processing. Unlike recurrent neural networks, transformers can process all tokens in parallel, dramatically speeding up training. The self-attention mechanism allows the model to capture long-range dependencies in text. This innovation enabled the creation of models with billions of parameters. Such scale requires sophisticated distributed training techniques and significant computational resources. The results, however, demonstrate unprecedented capabilities in understanding and generating human language.",
    "Modern AI systems employ reinforcement learning from human feedback to align their outputs with human preferences. This training methodology helps models become more helpful, harmless, and honest. The process involves collecting comparisons between different model outputs and training a reward model. The language model is then fine-tuned to maximize the predicted human preference scores. Iterative refinement through this process leads to significant improvements in model behavior. However, challenges remain in ensuring robust alignment across diverse contexts and applications.",
  ],
  anthropic: [
    "Claude is designed to be helpful, harmless, and honest through constitutional AI principles. The training process emphasizes safety and beneficial interactions with users. Constitutional AI uses a set of principles to guide the model's behavior. These principles help the model navigate complex ethical considerations and potential edge cases. The approach has shown promising results in reducing harmful outputs while maintaining helpful capabilities. Ongoing research aims to improve these safety techniques further.",
    "The field of AI safety encompasses multiple important research directions. Interpretability research seeks to understand the internal mechanisms of neural networks. Robustness research focuses on ensuring models behave reliably across different situations. Alignment research addresses the challenge of ensuring AI systems pursue intended goals. These areas are crucial as AI systems become more powerful and widely deployed. Collaboration between researchers, policymakers, and industry is essential for responsible development.",
    "Large language models demonstrate impressive few-shot learning capabilities. Given just a few examples, they can adapt to new tasks without explicit fine-tuning. This flexibility emerges from pre-training on diverse internet text. The models learn to recognize patterns and relationships that transfer across domains. Prompt engineering has become an important skill for eliciting desired behaviors. Techniques like chain-of-thought prompting further enhance reasoning capabilities.",
  ],
  gemini: [
    "This is a mock response from the Gemini endpoint.",
    "Processing your request with simulated Gemini capabilities.",
    "Mock LLM output for Gemini-style benchmarking.",
  ],
  deepseek: [
    "This is a mock response from the DeepSeek endpoint.",
    "Processing with simulated DeepSeek R1 capabilities.",
    "Mock LLM output for DeepSeek-style benchmarking.",
  ],
  vllm: [
    "This is a mock response from the vLLM endpoint.",
    "Processing with simulated vLLM capabilities.",
    "Mock LLM output for vLLM benchmarking.",
  ],
  ollama: [
    "This is a mock response from the Ollama endpoint.",
    "Processing with simulated local model capabilities.",
    "Mock LLM output for Ollama benchmarking.",
  ],
  generic: [
    "This is a generic mock response.",
    "Processing your request.",
    "Mock LLM output for generic benchmarking.",
  ],
};

// ============================================================================
// OpenAI Responses API Support
// ============================================================================

interface OpenAIResponsesInputItem {
  role?: string;
  content?: string | unknown[];
  type?: string;
}

function validateOpenAIResponsesRequest(body: Record<string, unknown>): ValidationResult {
  const result = new ValidationResult();
  
  if (!body.model) {
    result.addError('model', 'model is required');
  } else if (typeof body.model !== 'string') {
    result.addError('model', 'model must be a string', body.model);
  }
  
  if (!body.input) {
    result.addError('input', 'input is required');
  } else if (typeof body.input !== 'string' && !Array.isArray(body.input)) {
    result.addError('input', 'input must be a string or array', body.input);
  }
  
  if (body.temperature !== undefined) {
    const temp = Number(body.temperature);
    if (isNaN(temp) || temp < 0 || temp > 2) {
      result.addError('temperature', 'temperature must be between 0 and 2', body.temperature);
    }
  }
  
  if (body.max_tokens !== undefined) {
    const maxTokens = Number(body.max_tokens);
    if (isNaN(maxTokens) || maxTokens < 1) {
      result.addError('max_tokens', 'max_tokens must be a positive integer', body.max_tokens);
    }
  }
  
  if (body.reasoning) {
    const reasoning = body.reasoning as Record<string, unknown>;
    if (reasoning.effort && !['low', 'medium', 'high'].includes(reasoning.effort as string)) {
      result.addError('reasoning.effort', 'effort must be low, medium, or high', reasoning.effort);
    }
  }
  
  return result;
}

function countInputTokens(input: string | OpenAIResponsesInputItem[]): number {
  if (typeof input === 'string') {
    return countTokens(input);
  }
  let total = 0;
  for (const item of input) {
    if (typeof item.content === 'string') {
      total += countTokens(item.content);
    } else if (Array.isArray(item.content)) {
      for (const block of item.content) {
        if (typeof block === 'object' && block !== null && 'text' in block) {
          total += countTokens(String(block.text));
        }
      }
    }
  }
  return total;
}

function generateOpenAIResponsesResponse(
  model: string,
  input: string | OpenAIResponsesInputItem[],
  maxTokens: number,
  includeReasoning?: boolean
): {
  id: string;
  object: 'response';
  created_at: number;
  model: string;
  output: Array<{
    type: 'message';
    id: string;
    status: 'completed';
    role: 'assistant';
    content: Array<{ type: 'output_text'; text: string }>;
  }>;
  output_text?: string;
  reasoning?: { effort: string; generate_summary?: boolean };
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
} {
  const responses = sampleResponses.openai;
  const responseText = responses[Math.floor(Math.random() * responses.length)];
  const truncatedResponse = responseText.split(' ').slice(0, maxTokens).join(' ');
  const inputTokens = countInputTokens(input);
  const outputTokens = countTokens(truncatedResponse);
  
  const result: {
    id: string;
    object: 'response';
    created_at: number;
    model: string;
    output: Array<{
      type: 'message';
      id: string;
      status: 'completed';
      role: 'assistant';
      content: Array<{ type: 'output_text'; text: string }>;
    }>;
    output_text?: string;
    reasoning?: { effort: string; generate_summary?: boolean };
    usage: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
  } = {
    id: `resp_${generateId()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model,
    output: [{
      type: 'message',
      id: `msg_${generateId()}`,
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: truncatedResponse,
      }],
    }],
    output_text: truncatedResponse,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
  
  if (includeReasoning) {
    result.reasoning = { effort: 'medium', generate_summary: false };
  }
  
  return result;
}

async function* openAIResponsesStreamGenerator(
  model: string,
  input: string | OpenAIResponsesInputItem[],
  maxTokens: number,
  includeReasoning?: boolean
): AsyncGenerator<string> {
  const responses = sampleResponses.openai;
  const responseText = responses[Math.floor(Math.random() * responses.length)];
  const truncatedResponse = responseText.split(' ').slice(0, maxTokens).join(' ');
  const words = truncatedResponse.split(' ');
  const responseId = `resp_${generateId()}`;
  const messageId = `msg_${generateId()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const newline = '\n';
  
  // Initial response.created event
  yield `data: ${JSON.stringify({
    type: 'response.created',
    response: {
      id: responseId,
      object: 'response',
      created_at: timestamp,
      model,
      output: [],
      status: 'in_progress',
    },
  })}${newline}${newline}`;
  
  // Output item added
  yield `data: ${JSON.stringify({
    type: 'response.output_item.added',
    output_index: 0,
    item: {
      type: 'message',
      id: messageId,
      status: 'in_progress',
      role: 'assistant',
    },
  })}${newline}${newline}`;
  
  // Content part added
  yield `data: ${JSON.stringify({
    type: 'response.content_part.added',
    item_id: messageId,
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '' },
  })}${newline}${newline}`;
  
  // Stream words
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const prefix = i > 0 ? ' ' : '';
    
    yield `data: ${JSON.stringify({
      type: 'response.output_text.delta',
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      delta: prefix + word,
    })}${newline}${newline}`;
    
    await sleep(localCalculateChunkDelay());
  }
  
  // Content part done
  yield `data: ${JSON.stringify({
    type: 'response.content_part.done',
    item_id: messageId,
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: truncatedResponse },
  })}${newline}${newline}`;
  
  // Output item done
  yield `data: ${JSON.stringify({
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      type: 'message',
      id: messageId,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: truncatedResponse }],
    },
  })}${newline}${newline}`;
  
  // Response completed
  const inputTokens = countInputTokens(input);
  const outputTokens = countTokens(truncatedResponse);
  
  yield `data: ${JSON.stringify({
    type: 'response.completed',
    response: {
      id: responseId,
      object: 'response',
      created_at: timestamp,
      model,
      output: [{
        type: 'message',
        id: messageId,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: truncatedResponse }],
      }],
      output_text: truncatedResponse,
      status: 'completed',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    },
  })}${newline}${newline}`;
  
  yield `data: [DONE]${newline}${newline}`;
}

async function handleOpenAIResponsesRequest(
  body: Record<string, unknown>,
  request: Request,
  startTime: number
): Promise<Response> {
  const requestId = generateRequestId();
  const provider = 'openai-responses';
  
  // Apply request throttling for concurrency limiting
  await globalThrottler.acquire();
  
  try {
    if (config.strictValidation) {
      const validation = validateOpenAIResponsesRequest(body);
      if (!validation.isValid()) {
        requestLogger.logError({
          timestamp: new Date().toISOString(),
          requestId,
          method: 'POST',
          path: '/v1/responses',
          provider,
          error: 'Validation failed',
          context: { errors: validation.errors },
        });
        
        requestLogger.logRequest({
          timestamp: new Date().toISOString(),
          method: 'POST',
          path: '/v1/responses',
          provider,
          requestId,
          durationMs: performance.now() - startTime,
          statusCode: 400,
          error: 'Validation failed',
        });
        
        return new Response(JSON.stringify(validation.toResponse()), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
        });
      }
    }
    
    if (shouldError()) {
      const error = 'Simulated LLM error';
      requestLogger.logError({
        timestamp: new Date().toISOString(),
        requestId,
        method: 'POST',
        path: '/v1/responses',
        provider,
        error,
        context: { model: body.model, simulated: true },
      });
      
      requestLogger.logRequest({
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/responses',
        provider,
        requestId,
        durationMs: performance.now() - startTime,
        statusCode: 500,
        error,
      });
      
      return new Response(JSON.stringify({ error, requestId }), {
        status: 500,
        headers: { 'X-Request-Id': requestId },
      });
    }
    
    const input = body.input as string | OpenAIResponsesInputItem[];
    const maxTokens = Number(body.max_tokens) || 50;
    const stream = body.stream === true;
    const reasoning = body.reasoning as { effort?: string } | undefined;
    const includeReasoning = reasoning?.effort !== undefined;
    
    const inputTokens = countInputTokens(input);
    // For streaming, only apply input latency; output is distributed across chunks
    const latency = stream && config.streamingEnabled
      ? localCalculateStreamingLatency(inputTokens)
      : localCalculateLatency(inputTokens, maxTokens);
    await sleep(latency);
    
    if (stream && config.streamingEnabled) {
      const generator = openAIResponsesStreamGenerator(
        body.model as string,
        input,
        maxTokens,
        includeReasoning
      );
      
      requestLogger.logRequest({
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/responses',
        provider,
        requestId,
        durationMs: performance.now() - startTime,
        statusCode: 200,
        inputTokens,
      });
      
      const streamResponse = new ReadableStream({
        async pull(controller) {
          const result = await generator.next();
          if (result.done) {
            controller.close();
          } else {
            controller.enqueue(new TextEncoder().encode(result.value));
          }
        },
      });
      
      return new Response(streamResponse, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Request-Id': requestId,
        },
      });
    }
    
    const response = generateOpenAIResponsesResponse(
      body.model as string,
      input,
      maxTokens,
      includeReasoning
    );
    
    requestLogger.logRequest({
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/v1/responses',
      provider,
      requestId,
      durationMs: performance.now() - startTime,
      statusCode: 200,
      inputTokens,
      outputTokens: response.usage.output_tokens,
    });
    
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Mock Server Error] POST /v1/responses: ${errorMessage}`, { body: JSON.stringify(body), stack: error instanceof Error ? error.stack : undefined });
    requestLogger.logError({
      timestamp: new Date().toISOString(),
      requestId,
      method: 'POST',
      path: '/v1/responses',
      provider,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      context: { body: JSON.stringify(body) },
    });
    throw error;
  } finally {
    globalThrottler.release();
  }
}

// ============================================================================
// Response Generators
// ============================================================================

function generateOpenAIResponse(
  model: string, 
  messages: Array<{ role: string; content: unknown }>, 
  maxTokens: number,
  includeLogprobs: boolean = false,
  seed?: number
): {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
    logprobs?: unknown;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  system_fingerprint?: string;
} {
  const responses = sampleResponses.openai;
  const responseText = responses[Math.floor(Math.random() * responses.length)];
  const truncatedResponse = responseText.split(' ').slice(0, maxTokens).join(' ');
  const inputTokens = countMessageTokens(messages);
  const outputTokens = countTokens(truncatedResponse);
  
  const choice: {
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
    logprobs?: unknown;
  } = {
    index: 0,
    message: { role: 'assistant', content: truncatedResponse },
    finish_reason: 'stop',
  };
  
  if (includeLogprobs) {
    choice.logprobs = {
      content: truncatedResponse.split(' ').map((token) => ({
        token,
        logprob: -0.5 - Math.random(),
        bytes: Array.from(new TextEncoder().encode(token)),
      })),
    };
  }
  
  const result: {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<typeof choice>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    system_fingerprint?: string;
  } = {
    id: generateId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
  
  if (seed !== undefined) {
    result.system_fingerprint = `mock_fp_${seed}`;
  }
  
  return result;
}

function generateAnthropicResponse(
  model: string,
  messages: Array<{ role: string; content: unknown }>,
  maxTokens: number,
  enableThinking?: boolean
): {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{ type: string; text?: string; thinking?: string; signature?: string }>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
} {
  const responses = sampleResponses.anthropic;
  const responseText = responses[Math.floor(Math.random() * responses.length)];
  const truncatedResponse = responseText.split(' ').slice(0, maxTokens).join(' ');
  const inputTokens = countMessageTokens(messages);
  const outputTokens = countTokens(truncatedResponse);
  
  const content: Array<{ type: string; text?: string; thinking?: string; signature?: string }> = [];
  
  if (enableThinking) {
    content.push({
      type: 'thinking',
      thinking: 'This is simulated thinking content for Anthropic models.',
      signature: 'mock_signature_' + generateId(),
    });
  }
  
  content.push({
    type: 'text',
    text: truncatedResponse,
  });
  
  return {
    id: generateId(),
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

function generateDeepSeekResponse(
  model: string,
  messages: Array<{ role: string; content: unknown }>,
  maxTokens: number,
  enableThinking?: boolean
): {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string; reasoning_content?: string };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
} {
  const responses = sampleResponses.deepseek;
  const responseText = responses[Math.floor(Math.random() * responses.length)];
  const truncatedResponse = responseText.split(' ').slice(0, maxTokens).join(' ');
  const inputTokens = countMessageTokens(messages);
  const outputTokens = countTokens(truncatedResponse);
  
  const message: { role: string; content: string; reasoning_content?: string } = {
    role: 'assistant',
    content: truncatedResponse,
  };
  
  if (enableThinking) {
    message.reasoning_content = 'This is simulated reasoning content from DeepSeek R1.';
  }
  
  return {
    id: generateId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message,
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

// ============================================================================
// Streaming Generators
// ============================================================================

async function* openAIStreamGenerator(
  model: string,
  messages: Array<{ role: string; content: unknown }>,
  maxTokens: number,
  includeLogprobs: boolean = false,
  includeReasoning: boolean = false
): AsyncGenerator<string> {
  const responses = sampleResponses.openai;
  const responseText = responses[Math.floor(Math.random() * responses.length)];
  const truncatedResponse = responseText.split(' ').slice(0, maxTokens).join(' ');
  const words = truncatedResponse.split(' ');
  const responseId = generateId();
  const timestamp = Math.floor(Date.now() / 1000);
  
  yield `data: ${JSON.stringify({
    id: responseId,
    object: 'chat.completion.chunk',
    created: timestamp,
    model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  })}\n\n`;
  
  if (includeReasoning) {
    yield `data: ${JSON.stringify({
      id: generateId(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { reasoning_content: 'Simulated reasoning...' }, finish_reason: null }],
    })}\n\n`;
    await sleep(100);
  }
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const prefix = i > 0 ? ' ' : '';
    const choice: {
      index: number;
      delta: { content: string };
      finish_reason: null;
      logprobs?: unknown;
    } = {
      index: 0,
      delta: { content: prefix + word },
      finish_reason: null,
    };
    
    if (includeLogprobs) {
      choice.logprobs = {
        content: [{
          token: word,
          logprob: -0.5 - Math.random(),
          bytes: Array.from(new TextEncoder().encode(word)),
        }],
      };
    }
    
    const chunk = {
      id: generateId(),
      object: 'chat.completion.chunk' as const,
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [choice],
    };
    
    yield `data: ${JSON.stringify(chunk)}\n\n`;
    await sleep(localCalculateChunkDelay());
  }
  
  yield `data: ${JSON.stringify({
    id: generateId(),
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })}\n\n`;
  
  yield 'data: [DONE]\n\n';
}

async function* anthropicStreamGenerator(
  model: string,
  messages: Array<{ role: string; content: unknown }>,
  maxTokens: number,
  enableThinking?: boolean
): AsyncGenerator<string> {
  const responses = sampleResponses.anthropic;
  const responseText = responses[Math.floor(Math.random() * responses.length)];
  const truncatedResponse = responseText.split(' ').slice(0, maxTokens).join(' ');
  const words = truncatedResponse.split(' ');
  const responseId = generateId();
  
  yield `data: ${JSON.stringify({
    type: 'message_start',
    message: {
      id: responseId,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
    },
  })}\n\n`;
  
  if (enableThinking) {
    yield `data: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
    })}\n\n`;
    
    yield `data: ${JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Simulated thinking...' },
    })}\n\n`;
    
    yield `data: ${JSON.stringify({
      type: 'content_block_stop',
      index: 0,
    })}\n\n`;
  }
  
  yield `data: ${JSON.stringify({
    type: 'content_block_start',
    index: enableThinking ? 1 : 0,
    content_block: { type: 'text', text: '' },
  })}\n\n`;
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const prefix = i > 0 ? ' ' : '';
    
    yield `data: ${JSON.stringify({
      type: 'content_block_delta',
      index: enableThinking ? 1 : 0,
      delta: { type: 'text_delta', text: prefix + word },
    })}\n\n`;
    
    await sleep(localCalculateChunkDelay());
  }
  
  yield `data: ${JSON.stringify({
    type: 'content_block_stop',
    index: enableThinking ? 1 : 0,
  })}\n\n`;
  
  yield `data: ${JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: countTokens(truncatedResponse) },
  })}\n\n`;
  
  yield `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
}

// ============================================================================
// Route Handlers
// ============================================================================

async function handleOpenAIRequest(
  body: Record<string, unknown>,
  request: Request,
  startTime: number
): Promise<Response> {
  const requestId = generateRequestId();
  const provider = 'openai';
  
  // Apply request throttling for concurrency limiting
  await globalThrottler.acquire();
  
  try {
    if (config.strictValidation) {
      const validation = validateOpenAIRequest(body);
      if (!validation.isValid()) {
        requestLogger.logError({
          timestamp: new Date().toISOString(),
          requestId,
          method: 'POST',
          path: '/v1/chat/completions',
          provider,
          error: 'Validation failed',
          context: { errors: validation.errors },
        });
        
        requestLogger.logRequest({
          timestamp: new Date().toISOString(),
          method: 'POST',
          path: '/v1/chat/completions',
          provider,
          requestId,
          durationMs: performance.now() - startTime,
          statusCode: 400,
          error: 'Validation failed',
        });
        
        return new Response(JSON.stringify(validation.toResponse()), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
        });
      }
    }
    
    if (shouldError()) {
      const error = 'Simulated LLM error';
      requestLogger.logError({
        timestamp: new Date().toISOString(),
        requestId,
        method: 'POST',
        path: '/v1/chat/completions',
        provider,
        error,
        context: { model: body.model, simulated: true },
      });
      
      requestLogger.logRequest({
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/chat/completions',
        provider,
        requestId,
        durationMs: performance.now() - startTime,
        statusCode: 500,
        error,
      });
      
      return new Response(JSON.stringify({ error, requestId }), {
        status: 500,
        headers: { 'X-Request-Id': requestId },
      });
    }
    
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const maxTokens = Number(body.max_tokens) || 50;
    const stream = body.stream === true;
    const logprobs = body.logprobs === true;
    const seed = body.seed !== undefined ? Number(body.seed) : undefined;
    
    const inputTokens = countMessageTokens(messages);
    // For streaming, only apply input latency; output is distributed across chunks
    const latency = stream && config.streamingEnabled
      ? localCalculateStreamingLatency(inputTokens)
      : localCalculateLatency(inputTokens, maxTokens);
    await sleep(latency);
    
    if (stream && config.streamingEnabled) {
      const generator = openAIStreamGenerator(
        body.model as string,
        messages,
        maxTokens,
        logprobs,
        body.reasoning_content !== undefined
      );
      
      requestLogger.logRequest({
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/chat/completions',
        provider,
        requestId,
        durationMs: performance.now() - startTime,
        statusCode: 200,
        inputTokens,
      });
      
      const stream = new ReadableStream({
        async pull(controller) {
          const result = await generator.next();
          if (result.done) {
            controller.close();
          } else {
            controller.enqueue(new TextEncoder().encode(result.value));
          }
        },
      });
      
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Request-Id': requestId,
        },
      });
    }
    
    const response = generateOpenAIResponse(
      body.model as string,
      messages,
      maxTokens,
      logprobs,
      seed
    );
    
    requestLogger.logRequest({
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/v1/chat/completions',
      provider,
      requestId,
      durationMs: performance.now() - startTime,
      statusCode: 200,
      inputTokens,
      outputTokens: response.usage.completion_tokens,
    });
    
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Mock Server Error] POST /v1/chat/completions: ${errorMessage}`, { body: JSON.stringify(body), stack: error instanceof Error ? error.stack : undefined });
    requestLogger.logError({
      timestamp: new Date().toISOString(),
      requestId,
      method: 'POST',
      path: '/v1/chat/completions',
      provider,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      context: { body: JSON.stringify(body) },
    });
    throw error;
  } finally {
    globalThrottler.release();
  }
}

// Legacy OpenAI Completions API handler (for /v1/completions)
async function handleLegacyCompletionsRequest(
  body: Record<string, unknown>,
  request: Request,
  startTime: number
): Promise<Response> {
  const requestId = generateRequestId();
  const provider = 'openai-legacy';
  console.error(`[DEBUG] /v1/completions received: ${JSON.stringify(body)}`);
  
  // Apply request throttling for concurrency limiting
  await globalThrottler.acquire();
  
  try {
    if (shouldError()) {
      const error = 'Simulated LLM error';
      requestLogger.logError({
        timestamp: new Date().toISOString(),
        requestId,
        method: 'POST',
        path: '/v1/completions',
        provider,
        error,
        context: { model: body.model, simulated: true },
      });
      
      requestLogger.logRequest({
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/completions',
        provider,
        requestId,
        durationMs: performance.now() - startTime,
        statusCode: 500,
        error,
      });
      
      return new Response(JSON.stringify({ error, requestId }), {
        status: 500,
        headers: { 'X-Request-Id': requestId },
      });
    }
    
    const prompt = body.prompt as string | string[];
    const maxTokens = Number(body.max_tokens) || 50;
    const stream = body.stream === true;
    
    // Calculate input tokens from prompt
    const inputTokens = Array.isArray(prompt) 
      ? prompt.reduce((sum, p) => sum + countTokens(p), 0)
      : countTokens(prompt);
    // For streaming, only apply input latency; output is distributed across chunks
    const latency = stream && config.streamingEnabled
      ? calculateStreamingLatency(inputTokens, throttleConfig)
      : calculateLatency(inputTokens, maxTokens, throttleConfig);
    await sleep(latency);
    
    if (stream && config.streamingEnabled) {
      const generator = legacyCompletionsStreamGenerator(
        body.model as string,
        prompt,
        maxTokens
      );
      
      requestLogger.logRequest({
        timestamp: new Date().toISOString(),
        method: 'POST',
        path: '/v1/completions',
        provider,
        requestId,
        durationMs: performance.now() - startTime,
        statusCode: 200,
        inputTokens,
      });
      
      const stream = new ReadableStream({
        async pull(controller) {
          const result = await generator.next();
          if (result.done) {
            controller.close();
          } else {
            controller.enqueue(new TextEncoder().encode(result.value));
          }
        },
      });
      
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Request-Id': requestId,
        },
      });
    }
    
    const response = generateLegacyCompletionsResponse(
      body.model as string,
      prompt,
      maxTokens
    );
    
    requestLogger.logRequest({
      timestamp: new Date().toISOString(),
      method: 'POST',
      path: '/v1/completions',
      provider,
      requestId,
      durationMs: performance.now() - startTime,
      statusCode: 200,
      inputTokens,
      outputTokens: response.usage.completion_tokens,
    });
    
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Mock Server Error] POST /v1/completions: ${errorMessage}`, { body: JSON.stringify(body), stack: error instanceof Error ? error.stack : undefined });
    requestLogger.logError({
      timestamp: new Date().toISOString(),
      requestId,
      method: 'POST',
      path: '/v1/completions',
      provider,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      context: { body: JSON.stringify(body) },
    });
    throw error;
  } finally {
    globalThrottler.release();
  }
}

// Legacy completions response generator
function generateLegacyCompletionsResponse(
  model: string,
  prompt: string | string[],
  maxTokens: number
): {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    text: string;
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
} {
  const responses = sampleResponses.openai;
  const responseText = responses[Math.floor(Math.random() * responses.length)];
  const truncatedResponse = responseText.split(' ').slice(0, maxTokens).join(' ');
  const inputTokens = Array.isArray(prompt)
    ? prompt.reduce((sum, p) => sum + countTokens(p), 0)
    : countTokens(prompt);
  const outputTokens = countTokens(truncatedResponse);
  
  return {
    id: `cmpl-${generateRequestId()}`,
    object: 'text_completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        text: truncatedResponse,
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

// Legacy completions stream generator
async function* legacyCompletionsStreamGenerator(
  model: string,
  prompt: string | string[],
  maxTokens: number
): AsyncGenerator<string> {
  const responses = sampleResponses.openai;
  const responseText = responses[Math.floor(Math.random() * responses.length)];
  const words = responseText.split(' ').slice(0, maxTokens);
  const id = `cmpl-${generateRequestId()}`;
  const created = Math.floor(Date.now() / 1000);
  
  for (let i = 0; i < words.length; i++) {
    const chunk = {
      id,
      object: 'text_completion',
      created,
      model,
      choices: [
        {
          index: 0,
          text: (i === 0 ? '' : ' ') + words[i],
          finish_reason: null,
        },
      ],
    };
    yield `data: ${JSON.stringify(chunk)}\n\n`;
    await sleep(localCalculateChunkDelay());
  }
  
  yield `data: ${JSON.stringify({ id, object: 'text_completion', created, model, choices: [{ index: 0, text: '', finish_reason: 'stop' }] })}\n\n`;
  yield 'data: [DONE]\n\n';
}

async function handleAnthropicRequest(
  body: Record<string, unknown>,
  request: Request,
  startTime: number
): Promise<Response> {
  const requestId = generateRequestId();
  const provider = 'anthropic';
  
  // Apply request throttling for concurrency limiting
  await globalThrottler.acquire();
  
  try {
    if (config.strictValidation) {
      const validation = validateAnthropicRequest(body);
      if (!validation.isValid()) {
        return new Response(JSON.stringify(validation.toResponse()), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
        });
      }
    }
    
    if (shouldError()) {
      return new Response(JSON.stringify({ 
        error: 'Simulated Anthropic error',
        type: 'api_error',
        requestId 
      }), {
        status: 500,
        headers: { 'X-Request-Id': requestId },
      });
    }
    
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const maxTokens = Number(body.max_tokens) || 1024;
    const stream = body.stream === true;
    const thinking = body.thinking as { type?: string } | undefined;
    const enableThinking = thinking?.type === 'enabled';
    
    const inputTokens = countMessageTokens(messages);
    // For streaming, only apply input latency; output is distributed across chunks
    const latency = stream && config.streamingEnabled
      ? localCalculateStreamingLatency(inputTokens)
      : localCalculateLatency(inputTokens, maxTokens);
    await sleep(latency);
    
    if (stream && config.streamingEnabled) {
      const generator = anthropicStreamGenerator(
        body.model as string,
        messages,
        maxTokens,
        enableThinking
      );
      
      const stream = new ReadableStream({
        async pull(controller) {
          const result = await generator.next();
          if (result.done) {
            controller.close();
          } else {
            controller.enqueue(new TextEncoder().encode(result.value));
          }
        },
      });
      
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Request-Id': requestId,
        },
      });
    }
    
    const response = generateAnthropicResponse(
      body.model as string,
      messages,
      maxTokens,
      enableThinking
    );
    
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Mock Server Error] POST /v1/messages: ${errorMessage}`, { body: JSON.stringify(body), stack: error instanceof Error ? error.stack : undefined });
    requestLogger.logError({
      timestamp: new Date().toISOString(),
      requestId,
      method: 'POST',
      path: '/v1/messages',
      provider,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      context: { body: JSON.stringify(body) },
    });
    throw error;
  } finally {
    globalThrottler.release();
  }
}

async function handleDeepSeekRequest(
  body: Record<string, unknown>,
  request: Request,
  startTime: number
): Promise<Response> {
  const requestId = generateRequestId();
  const provider = 'deepseek';
  
  // Apply request throttling for concurrency limiting
  await globalThrottler.acquire();
  
  try {
    if (config.strictValidation) {
      const validation = validateDeepSeekRequest(body);
      if (!validation.isValid()) {
        return new Response(JSON.stringify(validation.toResponse()), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
        });
      }
    }
    
    if (shouldError()) {
      return new Response(JSON.stringify({ 
        error: 'Simulated DeepSeek error',
        requestId 
      }), { status: 500 });
    }
    
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const maxTokens = Number(body.max_tokens) || 50;
    const stream = body.stream === true;
    const chatTemplateKwargs = body.chat_template_kwargs as Record<string, unknown> | undefined;
    const enableThinking = chatTemplateKwargs?.enable_thinking === true || 
                          (body.thinking as Record<string, unknown>)?.type === 'enabled';
    
    const inputTokens = countMessageTokens(messages);
    // For streaming, only apply input latency; output is distributed across chunks
    const latency = stream && config.streamingEnabled
      ? localCalculateStreamingLatency(inputTokens)
      : localCalculateLatency(inputTokens, maxTokens);
    await sleep(latency);
    
    if (stream && config.streamingEnabled) {
      const generator = openAIStreamGenerator(
        body.model as string,
        messages,
        maxTokens,
        false,
        enableThinking
      );
      
      const stream = new ReadableStream({
        async pull(controller) {
          const result = await generator.next();
          if (result.done) controller.close();
          else controller.enqueue(new TextEncoder().encode(result.value));
        },
      });
      
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'X-Request-Id': requestId,
        },
      });
    }
    
    const response = generateDeepSeekResponse(
      body.model as string,
      messages,
      maxTokens,
      enableThinking
    );
    
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
    
  } catch (error) {
    requestLogger.logError({
      timestamp: new Date().toISOString(),
      requestId,
      method: 'POST',
      path: '/v1/chat/completions',
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    globalThrottler.release();
  }
}

// ============================================================================
// Elysia App
// ============================================================================

const app = new Elysia()
  .onError(({ code, error, set, request }) => {
    const requestId = generateRequestId();
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    console.error(`[Error ${code}] ${request.method} ${new URL(request.url).pathname}: ${errorMessage}`, error instanceof Error ? error.stack : '');
    
    requestLogger.logError({
      timestamp: new Date().toISOString(),
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      provider: 'unknown',
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    set.status = 500;
    return { 
      error: 'Internal server error',
      requestId,
    };
  })

  .onBeforeHandle(({ request }) => {
    (request as Request & { _startTime?: number })._startTime = performance.now();
  })

  // Health check
  .get('/health', () => ({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    strictValidation: config.strictValidation,
  }))

  // Server info
  .get('/info', () => ({
    name: 'Multi-Provider Mock LLM Server',
    version: '2.0.0',
    config: {
      latencyMeanMs: config.latencyMeanMs,
      latencyStdMs: config.latencyStdMs,
      tokensPerSecond: config.tokensPerSecond,
      errorRate: config.errorRate,
      maxContextLength: config.maxContextLength,
      streamingEnabled: config.streamingEnabled,
      strictValidation: config.strictValidation,
    },
    endpoints: {
      openai: '/v1/chat/completions',
      'openai-legacy': '/v1/completions',
      'openai-responses': '/v1/responses',
      anthropic: '/v1/messages',
      deepseek: '/deepseek/v1/chat/completions',
      generic: '/generic/v1/chat/completions',
    },
    stats: requestLogger.getStats(),
    throttling: {
      latencyMeanMs: config.latencyMeanMs,
      latencyStdMs: config.latencyStdMs,
      tokensPerSecond: config.tokensPerSecond,
      streamingEnabled: config.streamingEnabled,
      maxConcurrent: globalThrottler.getStats().max,
      currentLoad: globalThrottler.getStats(),
    },
  }))

  // List models (OpenAI format)
  .get('/v1/models', ({ request }) => {
    const startTime = (request as Request & { _startTime?: number })._startTime || performance.now();
    const requestId = generateRequestId();
    
    requestLogger.logRequest({
      timestamp: new Date().toISOString(),
      method: 'GET',
      path: '/v1/models',
      provider: 'openai',
      requestId,
      durationMs: performance.now() - startTime,
      statusCode: 200,
    });
    
    return {
      object: 'list',
      data: [
        { id: 'gpt-4o-mini', object: 'model', created: 1677610602, owned_by: 'openai' },
        { id: 'gpt-4o', object: 'model', created: 1677610602, owned_by: 'openai' },
        { id: 'claude-3-haiku', object: 'model', created: 1677610602, owned_by: 'anthropic' },
        { id: 'claude-3-opus', object: 'model', created: 1677610602, owned_by: 'anthropic' },
        { id: 'deepseek-chat', object: 'model', created: 1677610602, owned_by: 'deepseek' },
        { id: 'deepseek-reasoner', object: 'model', created: 1677610602, owned_by: 'deepseek' },
      ],
    };
  })
  
  // LM Studio compatible /models endpoint (alias for /v1/models)
  .get('/models', ({ request }) => {
    const startTime = (request as Request & { _startTime?: number })._startTime || performance.now();
    const requestId = generateRequestId();
    
    requestLogger.logRequest({
      timestamp: new Date().toISOString(),
      method: 'GET',
      path: '/models',
      provider: 'openai',
      requestId,
      durationMs: performance.now() - startTime,
      statusCode: 200,
    });
    
    return {
      object: 'list',
      data: [
        { id: 'gpt-4o-mini', object: 'model', created: 1677610602, owned_by: 'openai' },
        { id: 'gpt-4o', object: 'model', created: 1677610602, owned_by: 'openai' },
        { id: 'claude-3-haiku', object: 'model', created: 1677610602, owned_by: 'anthropic' },
        { id: 'claude-3-opus', object: 'model', created: 1677610602, owned_by: 'anthropic' },
        { id: 'deepseek-chat', object: 'model', created: 1677610602, owned_by: 'deepseek' },
        { id: 'deepseek-reasoner', object: 'model', created: 1677610602, owned_by: 'deepseek' },
      ],
    };
  })

  // OpenAI-compatible endpoint
  .post('/v1/chat/completions', async ({ body, request }) => {
    const startTime = (request as Request & { _startTime?: number })._startTime || performance.now();
    return handleOpenAIRequest(body as Record<string, unknown>, request, startTime);
  }, {
    body: t.Object({
      model: t.String(),
      messages: t.Array(t.Record(t.String(), t.Unknown())),
      stream: t.Optional(t.Boolean()),
      max_tokens: t.Optional(t.Number()),
      temperature: t.Optional(t.Number()),
      top_p: t.Optional(t.Number()),
      frequency_penalty: t.Optional(t.Number()),
      presence_penalty: t.Optional(t.Number()),
      seed: t.Optional(t.Number()),
      n: t.Optional(t.Number()),
      logprobs: t.Optional(t.Boolean()),
      top_logprobs: t.Optional(t.Number()),
      logit_bias: t.Optional(t.Record(t.String(), t.Number())),
      user: t.Optional(t.String()),
      extra_body: t.Optional(t.Record(t.String(), t.Unknown())),
      extra_headers: t.Optional(t.Record(t.String(), t.String())),
      extra_query: t.Optional(t.Record(t.String(), t.String())),
      chat_template_kwargs: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
  })

  // Legacy OpenAI Completions API endpoint (/v1/completions)
  .post('/v1/completions', async ({ body, request }) => {
    const startTime = (request as Request & { _startTime?: number })._startTime || performance.now();
    return handleLegacyCompletionsRequest(body as Record<string, unknown>, request, startTime);
  }, {
    body: t.Object({
      model: t.String(),
      prompt: t.Union([t.String(), t.Array(t.String())]),
      stream: t.Optional(t.Boolean()),
      max_tokens: t.Optional(t.Number()),
      temperature: t.Optional(t.Number()),
      top_p: t.Optional(t.Number()),
      n: t.Optional(t.Number()),
      logprobs: t.Optional(t.Number()),
      echo: t.Optional(t.Boolean()),
      stop: t.Optional(t.Union([t.String(), t.Array(t.String())])),
      presence_penalty: t.Optional(t.Number()),
      frequency_penalty: t.Optional(t.Number()),
      best_of: t.Optional(t.Number()),
      user: t.Optional(t.String()),
    }),
  })

  // OpenAI Responses API endpoint
  .post('/v1/responses', async ({ body, request }) => {
    const startTime = (request as Request & { _startTime?: number })._startTime || performance.now();
    return handleOpenAIResponsesRequest(body as Record<string, unknown>, request, startTime);
  }, {
    body: t.Object({
      model: t.String(),
      input: t.Union([t.String(), t.Array(t.Record(t.String(), t.Unknown()))]),
      instructions: t.Optional(t.String()),
      stream: t.Optional(t.Boolean()),
      max_tokens: t.Optional(t.Number()),
      temperature: t.Optional(t.Number()),
      top_p: t.Optional(t.Number()),
      stop: t.Optional(t.Union([t.String(), t.Array(t.String())])),
      tools: t.Optional(t.Array(t.Record(t.String(), t.Unknown()))),
      tool_choice: t.Optional(t.Union([t.String(), t.Record(t.String(), t.Unknown())])),
      parallel_tool_calls: t.Optional(t.Boolean()),
      previous_response_id: t.Optional(t.String()),
      reasoning: t.Optional(t.Record(t.String(), t.Unknown())),
      response_format: t.Optional(t.Record(t.String(), t.Unknown())),
      user: t.Optional(t.String()),
      metadata: t.Optional(t.Record(t.String(), t.String())),
      store: t.Optional(t.Boolean()),
    }),
  })

  // Anthropic endpoint
  .post('/v1/messages', async ({ body, request }) => {
    const startTime = (request as Request & { _startTime?: number })._startTime || performance.now();
    return handleAnthropicRequest(body as Record<string, unknown>, request, startTime);
  }, {
    body: t.Object({
      model: t.String(),
      messages: t.Array(t.Record(t.String(), t.Unknown())),
      max_tokens: t.Number(),
      stream: t.Optional(t.Boolean()),
      temperature: t.Optional(t.Number()),
      top_p: t.Optional(t.Number()),
      top_k: t.Optional(t.Number()),
      stop_sequences: t.Optional(t.Array(t.String())),
      system: t.Optional(t.Union([t.String(), t.Array(t.Record(t.String(), t.Unknown()))])),
      thinking: t.Optional(t.Record(t.String(), t.Unknown())),
      metadata: t.Optional(t.Record(t.String(), t.String())),
    }),
  })

  // DeepSeek endpoint
  .post('/deepseek/v1/chat/completions', async ({ body, request }) => {
    const startTime = (request as Request & { _startTime?: number })._startTime || performance.now();
    return handleDeepSeekRequest(body as Record<string, unknown>, request, startTime);
  })

  // Generic OpenAI-compatible (lenient validation)
  .post('/generic/v1/chat/completions', async ({ body, request }) => {
    const startTime = (request as Request & { _startTime?: number })._startTime || performance.now();
    return handleOpenAIRequest(body as Record<string, unknown>, request, startTime);
  })

  // Root
  .get('/', () => ({
    name: 'Multi-Provider Mock LLM Server',
    version: '2.0.0',
    endpoints: {
      health: '/health',
      info: '/info',
      models: '/v1/models',
      openai: '/v1/chat/completions',
      'openai-legacy': '/v1/completions',
      'openai-responses': '/v1/responses',
      anthropic: '/v1/messages',
      deepseek: '/deepseek/v1/chat/completions',
      generic: '/generic/v1/chat/completions',
    },
    configuration: {
      strictValidation: config.strictValidation,
    },
  }))

  // Fallback: log any unmatched requests for debugging
  .all('/*', async ({ request, body }) => {
    const requestId = generateRequestId();
    const url = new URL(request.url);
    let bodyText: string | undefined;
    try {
      bodyText = body ? JSON.stringify(body) : undefined;
    } catch {
      bodyText = '[unserializable body]';
    }
    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId,
      method: request.method,
      path: url.pathname,
      query: url.search,
      headers: Object.fromEntries(request.headers.entries()),
      body: bodyText,
    };
    console.error(`[Mock Server Fallback] Unmatched route: ${request.method} ${url.pathname}`, logEntry);
    requestLogger.logError({
      timestamp: logEntry.timestamp,
      requestId,
      method: request.method,
      path: url.pathname,
      provider: 'unknown',
      error: `Unmatched route: ${request.method} ${url.pathname}`,
      context: logEntry,
    });
    return new Response(JSON.stringify({ error: 'Not found', requestId, path: url.pathname }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
  });

// ============================================================================
// Start Server
// ============================================================================

console.log(`
╔════════════════════════════════════════════════════════════════╗
║           Multi-Provider Mock LLM Server                      ║
╚════════════════════════════════════════════════════════════════╝
`);

console.log('Configuration:');
console.log(`  Port: ${config.port}`);
console.log(`  Host: ${config.host}`);
console.log(`  Strict Validation: ${config.strictValidation ? 'enabled' : 'disabled'}`);
console.log(`  Latency: ${config.latencyMeanMs}ms ± ${config.latencyStdMs}ms`);
console.log(`  Tokens/sec: ${config.tokensPerSecond}`);
console.log(`  Error rate: ${(config.errorRate * 100).toFixed(1)}%`);
console.log(`  Max context: ${config.maxContextLength} tokens`);
console.log(`  Streaming: ${config.streamingEnabled ? 'enabled' : 'disabled'}`);
console.log(`  Request logging: ${config.logRequests ? 'enabled' : 'disabled'}`);
console.log(`  Error logging: ${config.logErrors ? 'enabled' : 'disabled'}`);
console.log(`  Log directory: ${config.logDir}`);
console.log('');

app.listen({
  port: config.port,
  hostname: config.host,
});

console.log(`🚀 Server running at http://${config.host}:${config.port}`);
console.log(`   Health: http://${config.host}:${config.port}/health`);
console.log(`   Info: http://${config.host}:${config.port}/info`);
console.log('');
console.log('All Endpoints Active:');
console.log(`   OpenAI:           POST http://${config.host}:${config.port}/v1/chat/completions`);
console.log(`   OpenAI Legacy:    POST http://${config.host}:${config.port}/v1/completions`);
console.log(`   OpenAI Responses: POST http://${config.host}:${config.port}/v1/responses`);
console.log(`   Anthropic:        POST http://${config.host}:${config.port}/v1/messages`);
console.log(`   DeepSeek:         POST http://${config.host}:${config.port}/deepseek/v1/chat/completions`);
console.log(`   Generic:          POST http://${config.host}:${config.port}/generic/v1/chat/completions`);
console.log('');
console.log('Environment Variables:');
console.log(`  MOCK_STRICT_VALIDATION=true|false (current: ${config.strictValidation})`);
console.log('');
console.log('Press Ctrl+C to stop and save logs');
