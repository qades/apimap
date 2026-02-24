#!/usr/bin/env bun

import type { Server } from "bun";
import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, dirname } from "path";

// ============================================================================
// Configuration Types
// ============================================================================

interface ProviderConfig {
  /** Base URL for the provider API */
  baseUrl: string;
  /** API key (optional, can use env var or request header) */
  apiKey?: string;
  /** Environment variable name for API key */
  apiKeyEnv?: string;
  /** Header name for API key (default: Authorization) */
  authHeader?: string;
  /** Auth header prefix (default: "Bearer ") */
  authPrefix?: string;
  /** Additional headers to send */
  headers?: Record<string, string>;
  /** Request timeout in seconds */
  timeout?: number;
  /** Whether this provider supports streaming */
  supportsStreaming?: boolean;
}

interface RouteConfig {
  /** Pattern to match model names (supports wildcards: * and ?) */
  pattern: string;
  /** Provider to route to */
  provider: string;
  /** Model name to use upstream (defaults to original model name) */
  model?: string;
  /** Priority for matching (higher = checked first) */
  priority?: number;
}

interface ApiSchemeConfig {
  /** API scheme identifier */
  id: string;
  /** Base path for this API (e.g., /v1/chat/completions) */
  path: string;
  /** Request/Response format */
  format: "openai" | "anthropic" | "google" | "ollama" | "lmstudio" | "openai-compatible";
  /** Provider to use for this scheme (defaults to scheme id) */
  defaultProvider?: string;
}

interface RouterConfig {
  /** Server configuration */
  server?: {
    port?: number;
    host?: string;
    cors?: {
      origin?: string | string[];
      credentials?: boolean;
    };
    timeout?: number;
  };
  /** Logging configuration */
  logging?: {
    dir?: string;
    level?: "debug" | "info" | "warn" | "error";
    maskKeys?: boolean;
  };
  /** Preload configuration */
  preload?: {
    enabled?: boolean;
    models?: string[];
  };
  /** API schemes supported */
  schemes?: ApiSchemeConfig[];
  /** Provider configurations */
  providers: Record<string, ProviderConfig>;
  /** Routing rules */
  routes: RouteConfig[];
  /** Default provider for unmatched models */
  defaultProvider?: string;
}

// ============================================================================
// Default Providers and Built-in Knowledge
// ============================================================================

const DEFAULT_PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    authHeader: "x-api-key",
    authPrefix: "",
    headers: { "anthropic-version": "2023-06-01" },
    supportsStreaming: true,
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnv: "GOOGLE_API_KEY",
    authHeader: "x-goog-api-key",
    authPrefix: "",
    supportsStreaming: true,
  },
  ollama: {
    baseUrl: "http://localhost:11434",
    supportsStreaming: true,
  },
  lmstudio: {
    baseUrl: "http://localhost:1234/v1",
    supportsStreaming: true,
  },
  llamacpp: {
    baseUrl: "http://localhost:8080/v1",
    supportsStreaming: true,
  },
  vllm: {
    baseUrl: "http://localhost:8000/v1",
    supportsStreaming: true,
  },
  fireworks: {
    baseUrl: "https://api.fireworks.ai/inference/v1",
    apiKeyEnv: "FIREWORKS_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
  },
  together: {
    baseUrl: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
  },
  perplexity: {
    baseUrl: "https://api.perplexity.ai",
    apiKeyEnv: "PERPLEXITY_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
  },
  anyscale: {
    baseUrl: "https://api.endpoints.anyscale.com/v1",
    apiKeyEnv: "ANYSCALE_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
  },
  cohere: {
    baseUrl: "https://api.cohere.ai/v1",
    apiKeyEnv: "COHERE_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
  },
};

// ============================================================================
// API Types - Anthropic
// ============================================================================

interface AnthropicCacheControl {
  type: "ephemeral";
  ttl?: string;
  scope?: string;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicImageBlock {
  type: "image";
  source: unknown;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<AnthropicTextBlock | AnthropicImageBlock>;
  is_error?: boolean;
  cache_control?: AnthropicCacheControl;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    $schema?: string;
  };
}

type AnthropicToolChoice = "auto" | "any" | "tool" | { type: "tool"; name: string };

interface AnthropicOutputConfig {
  format?: {
    type: "text" | "json_schema";
    schema?: Record<string, unknown>;
  };
  effort?: "low" | "medium" | "high";
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  system?: string | AnthropicTextBlock[];
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  metadata?: Record<string, unknown>;
  output_config?: AnthropicOutputConfig;
  thinking?: {
    type: "enabled";
    budget_tokens: number;
  };
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

// ============================================================================
// API Types - OpenAI
// ============================================================================

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface OpenAITool {
  type: "function";
  function: OpenAIFunction;
}

type OpenAIResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };

interface OpenAIRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string[];
  tools?: OpenAITool[];
  tool_choice?: "auto" | "required" | "none" | { type: "function"; function: { name: string } };
  response_format?: OpenAIResponseFormat;
  reasoning_effort?: "low" | "medium" | "high";
}

interface OpenAIStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: "function";
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  };
  finish_reason: string | null;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message?: OpenAIChatMessage;
    delta?: OpenAIChatMessage;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Configuration Loading
// ============================================================================

let CONFIG: RouterConfig;
let CONFIG_PATH: string | null = null;

function parseArgs() {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        args[key] = value;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }

  return args;
}

function showHelp() {
  console.log(`
Universal Model Router - The Ultimate AI Model Gateway

Usage: bun run index.ts [options]

Options:
  --config <path>        Path to YAML config file (default: config.yaml)
  --port <number>        Override port from config
  --log-dir <path>       Override log directory from config
  --timeout <seconds>    Override timeout from config
  --help                 Show this help message

Examples:
  # Use default config.yaml
  bun run index.ts

  # Use custom config
  bun run index.ts --config ./my-config.yaml

  # Override specific settings
  bun run index.ts --config ./config.yaml --port 8080 --log-dir ./logs
`);
  process.exit(0);
}

async function loadConfig(configPath: string): Promise<RouterConfig> {
  const fullPath = resolve(configPath);

  if (!existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}`);
  }

  // Use Bun's built-in file API and YAML parsing
  const file = Bun.file(fullPath);
  const content = await file.text();

  // Parse YAML - Bun doesn't have built-in YAML, so we use the yaml package
  // But let's try using Bun's native TOML-like or use the yaml package we installed
  let parsed: RouterConfig;
  try {
    // Try to import yaml dynamically
    const YAML = await import("yaml");
    parsed = YAML.parse(content) as RouterConfig;
  } catch {
    // Fallback: try JSON
    try {
      parsed = JSON.parse(content) as RouterConfig;
    } catch {
      throw new Error(`Failed to parse config file. Ensure it's valid YAML or JSON.`);
    }
  }

  // Merge with defaults
  const config: RouterConfig = {
    server: {
      port: 3000,
      host: "0.0.0.0",
      cors: { origin: "*", credentials: false },
      timeout: 120,
      ...parsed.server,
    },
    logging: {
      level: "info",
      maskKeys: true,
      ...parsed.logging,
    },
    preload: {
      enabled: false,
      ...parsed.preload,
    },
    schemes: parsed.schemes || [],
    providers: {},
    routes: parsed.routes || [],
    defaultProvider: parsed.defaultProvider,
  };

  // Merge providers with defaults
  for (const [id, defaultProvider] of Object.entries(DEFAULT_PROVIDERS)) {
    config.providers[id] = {
      ...defaultProvider,
      ...(parsed.providers?.[id] || {}),
    };
  }

  // Add custom providers
  for (const [id, provider] of Object.entries(parsed.providers || {})) {
    if (!config.providers[id]) {
      config.providers[id] = provider;
    }
  }

  // Add default schemes if none specified
  if (config.schemes.length === 0) {
    config.schemes = [
      { id: "openai", path: "/v1/chat/completions", format: "openai" },
      { id: "anthropic", path: "/v1/messages", format: "anthropic" },
    ];
  }

  // Sort routes by priority (higher first)
  config.routes.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  CONFIG_PATH = fullPath;
  return config;
}

// ============================================================================
// Pattern Matching
// ============================================================================

interface MatchResult {
  matched: boolean;
  captures: string[];
}

function matchPattern(model: string, pattern: string): MatchResult {
  // Convert glob pattern to regex with capture groups
  // Each wildcard * becomes a capture group (.*)
  let captureIndex = 1;
  const captureMap: number[] = [];
  
  let regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&"); // Escape special regex chars
  
  // Replace wildcards with capture groups, tracking which capture index corresponds to each wildcard
  regexPattern = regexPattern
    .replace(/\*/g, () => {
      captureMap.push(captureIndex++);
      return "(.*)";
    })
    .replace(/\?/g, () => {
      captureMap.push(captureIndex++);
      return "(.)";
    });

  const regex = new RegExp(`^${regexPattern}$`, "i");
  const match = model.match(regex);
  
  if (!match) {
    return { matched: false, captures: [] };
  }
  
  // Return captured groups
  return {
    matched: true,
    captures: match.slice(1),
  };
}

function applyModelTemplate(template: string | undefined, originalModel: string, captures: string[]): string {
  if (!template) return originalModel;
  
  // Replace ${n} with captured groups
  return template.replace(/\$\{(\d+)\}/g, (match, num) => {
    const index = parseInt(num, 10) - 1;
    return captures[index] ?? match;
  });
}

function findRoute(model: string): { provider: string; model: string } | null {
  for (const route of CONFIG.routes) {
    const matchResult = matchPattern(model, route.pattern);
    if (matchResult.matched) {
      return {
        provider: route.provider,
        model: applyModelTemplate(route.model, model, matchResult.captures),
      };
    }
  }

  if (CONFIG.defaultProvider) {
    return {
      provider: CONFIG.defaultProvider,
      model,
    };
  }

  return null;
}

// ============================================================================
// Request/Response Transformation - Anthropic to OpenAI
// ============================================================================

function convertAnthropicTools(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map((tool) => {
    const { $schema, ...parameters } = tool.input_schema;
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters,
      },
    };
  });
}

function convertToolChoice(choice: AnthropicToolChoice): OpenAIRequest["tool_choice"] {
  if (choice === "auto") return "auto";
  if (choice === "any") return "required";
  if (typeof choice === "object" && choice.type === "tool") {
    return { type: "function", function: { name: choice.name } };
  }
  return "auto";
}

function convertSystem(system: string | AnthropicTextBlock[] | undefined): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  return system
    .filter((block): block is AnthropicTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function convertOutputConfig(config: AnthropicOutputConfig | undefined): OpenAIResponseFormat | undefined {
  if (!config?.format) return undefined;

  if (config.format.type === "json_schema" && config.format.schema) {
    return {
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: config.format.schema,
        strict: true,
      },
    };
  }

  if (config.format.type === "text") {
    return { type: "text" };
  }

  return undefined;
}

function extractTextContent(content: string | AnthropicContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is AnthropicTextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function convertToolResultContent(content: string | Array<AnthropicTextBlock | AnthropicImageBlock>): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is AnthropicTextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function convertAnthropicMessages(messages: AnthropicMessage[]): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({
        role: msg.role,
        content: msg.content,
      });
    } else {
      const toolUseBlocks = msg.content.filter((c): c is AnthropicToolUseBlock => c.type === "tool_use");
      const toolResultBlocks = msg.content.filter((c): c is AnthropicToolResultBlock => c.type === "tool_result");
      const textBlocks = msg.content.filter((c): c is AnthropicTextBlock => c.type === "text");

      if (msg.role === "assistant" && toolUseBlocks.length > 0) {
        const text = textBlocks.map((t) => t.text).join("");
        result.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolUseBlocks.map((tool) => ({
            id: tool.id,
            type: "function",
            function: {
              name: tool.name,
              arguments: JSON.stringify(tool.input),
            },
          })),
        });
      } else if (msg.role === "user" && toolResultBlocks.length > 0) {
        for (const toolResult of toolResultBlocks) {
          const content = convertToolResultContent(toolResult.content);
          const finalContent = toolResult.is_error ? `[ERROR] ${content}` : content;
          result.push({
            role: "tool",
            content: finalContent,
            tool_call_id: toolResult.tool_use_id,
          });
        }
        const regularText = textBlocks.map((t) => t.text).join("");
        if (regularText) {
          result.push({
            role: "user",
            content: regularText,
          });
        }
      } else {
        const text = textBlocks.map((t) => t.text).join("");
        result.push({
          role: msg.role,
          content: text,
        });
      }
    }
  }

  return result;
}

function transformAnthropicToOpenAI(anthropicReq: AnthropicRequest, targetModel: string): OpenAIRequest {
  const openAIReq: OpenAIRequest = {
    model: targetModel,
    messages: [],
    max_tokens: anthropicReq.max_tokens,
    temperature: anthropicReq.temperature,
    top_p: anthropicReq.top_p,
    stream: anthropicReq.stream,
    stop: anthropicReq.stop_sequences,
  };

  const systemContent = convertSystem(anthropicReq.system);
  const chatMessages = convertAnthropicMessages(anthropicReq.messages);

  if (systemContent) {
    openAIReq.messages = [
      { role: "system", content: systemContent },
      ...chatMessages,
    ];
  } else {
    openAIReq.messages = chatMessages;
  }

  if (anthropicReq.tools?.length) {
    openAIReq.tools = convertAnthropicTools(anthropicReq.tools);
  }

  if (anthropicReq.tool_choice) {
    openAIReq.tool_choice = convertToolChoice(anthropicReq.tool_choice);
  }

  if (anthropicReq.output_config) {
    const responseFormat = convertOutputConfig(anthropicReq.output_config);
    if (responseFormat) {
      openAIReq.response_format = responseFormat;
    }
  }

  // Map thinking/reasoning effort if present
  if (anthropicReq.thinking?.type === "enabled") {
    // Convert to OpenAI reasoning_effort based on budget
    const budget = anthropicReq.thinking.budget_tokens;
    if (budget < 4000) {
      openAIReq.reasoning_effort = "low";
    } else if (budget < 16000) {
      openAIReq.reasoning_effort = "medium";
    } else {
      openAIReq.reasoning_effort = "high";
    }
  }

  return openAIReq;
}

// ============================================================================
// Response Transformation - OpenAI to Anthropic
// ============================================================================

function mapStopReason(finishReason: string | null): string | null {
  if (finishReason === "stop") return "end_turn";
  if (finishReason === "tool_calls") return "tool_use";
  if (finishReason === "length") return "max_tokens";
  if (finishReason === "content_filter") return "content_filter";
  return null;
}

function convertOpenAIMessageToAnthropic(data: OpenAIResponse): {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
} {
  const message = data.choices?.[0]?.message;
  const finishReason = data.choices?.[0]?.finish_reason;

  const content: AnthropicContentBlock[] = [];

  if (message?.content && typeof message.content === "string") {
    content.push({
      type: "text",
      text: message.content,
    });
  }

  if (message?.tool_calls?.length) {
    for (const toolCall of message.tool_calls) {
      if (toolCall.type === "function") {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(toolCall.function.arguments);
        } catch {
          input = {};
        }
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input,
        });
      }
    }
  }

  return { content, stop_reason: mapStopReason(finishReason) };
}

function createAnthropicChunk(content: string, index: number): string {
  return `data: ${JSON.stringify({
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text: content },
  })}

`;
}

function createAnthropicToolUseStart(index: number, id: string, name: string): string {
  return `data: ${JSON.stringify({
    type: "content_block_start",
    index,
    content_block: { type: "tool_use", id, name, input: {} },
  })}

`;
}

function createAnthropicToolUseDelta(index: number, partialInput: string): string {
  return `data: ${JSON.stringify({
    type: "content_block_delta",
    index,
    delta: { type: "input_json_delta", partial_json: partialInput },
  })}

`;
}

function createAnthropicStart(index: number): string {
  return `data: ${JSON.stringify({
    type: "content_block_start",
    index,
    content_block: { type: "text", text: "" },
  })}

`;
}

function createAnthropicStop(index: number): string {
  return `data: ${JSON.stringify({ type: "content_block_stop", index })}

`;
}

function createAnthropicMessageStart(usage?: { input_tokens?: number; output_tokens?: number }): string {
  return `data: ${JSON.stringify({
    type: "message_start",
    message: {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: "claude-3",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: usage || { input_tokens: 0, output_tokens: 0 },
    },
  })}

`;
}

function createAnthropicMessageStop(stopReason: string | null, outputTokens = 0): string {
  return `data: ${JSON.stringify({
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  })}

`;
}

function createAnthropicDone(): string {
  return "data: [DONE]\n\n";
}

// ============================================================================
// HTTP Utilities
// ============================================================================

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

function maskSensitive(value: string): string {
  if (value.length <= 10) return "[REDACTED]";
  return `${value.slice(0, 5)}...${value.slice(-5)}`;
}

function getCORSHeaders(requestOrigin: string | null): Record<string, string> {
  const cors = CONFIG.server?.cors;
  if (!cors || cors.origin === "none") {
    return {};
  }

  let allowOrigin = "*";
  if (cors.origin !== "*") {
    if (Array.isArray(cors.origin)) {
      if (requestOrigin && cors.origin.includes(requestOrigin)) {
        allowOrigin = requestOrigin;
      } else {
        allowOrigin = cors.origin[0] || "*";
      }
    } else {
      allowOrigin = cors.origin;
    }
  } else if (requestOrigin) {
    allowOrigin = requestOrigin;
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key, Authorization, Anthropic-Version, X-Goog-Api-Key",
    "Access-Control-Max-Age": "86400",
    ...(cors.credentials ? { "Access-Control-Allow-Credentials": "true" } : {}),
  };
}

// ============================================================================
// Logging
// ============================================================================

interface LogEntry {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  sourceScheme: string;
  targetScheme: string;
  provider: string;
  model: string;
  targetModel: string;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  transformedBody?: unknown;
  responseStatus: number;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  error?: string;
  durationMs: number;
}

let logIndex = 0;

async function logConversation(entry: LogEntry): Promise<void> {
  if (!CONFIG.logging?.dir) return;

  const index = String(logIndex++).padStart(6, "0");
  const filename = `${index}_${entry.provider}_${entry.model}_${entry.requestId}.json`;
  const filepath = join(CONFIG.logging.dir, filename);

  try {
    if (!existsSync(CONFIG.logging.dir)) {
      await mkdir(CONFIG.logging.dir, { recursive: true });
    }

    // Mask sensitive data if enabled
    if (CONFIG.logging.maskKeys !== false) {
      entry.requestHeaders = maskHeaders(entry.requestHeaders);
      if (entry.responseHeaders) {
        entry.responseHeaders = maskHeaders(entry.responseHeaders);
      }
    }

    await writeFile(filepath, JSON.stringify(entry, null, 2));
  } catch (err) {
    console.error(`Failed to write log: ${err}`);
  }
}

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "x-api-key" || lowerKey === "authorization" || lowerKey.includes("key")) {
      masked[key] = maskSensitive(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

function generateRequestId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

// ============================================================================
// Request Handlers
// ============================================================================

async function handleAnthropicRequest(
  req: Request,
  anthropicReq: AnthropicRequest,
  requestId: string,
  startTime: number
): Promise<Response> {
  const route = findRoute(anthropicReq.model);

  if (!route) {
    return new Response(
      JSON.stringify({ error: "No route found for model", model: anthropicReq.model }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const provider = CONFIG.providers[route.provider];
  if (!provider) {
    return new Response(
      JSON.stringify({ error: "Unknown provider", provider: route.provider }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Check if this is passthrough to Anthropic
  if (route.provider === "anthropic") {
    return handleAnthropicPassthrough(req, anthropicReq, provider, requestId, startTime);
  }

  // Transform to OpenAI format
  const openAIReq = transformAnthropicToOpenAI(anthropicReq, route.model);

  console.log(
    `[${new Date().toISOString()}] ${requestId} anthropic:${anthropicReq.model} → ${route.provider}:${route.model} (stream=${anthropicReq.stream ?? false})`
  );

  // Get API key
  const authHeader = req.headers.get("x-api-key") || req.headers.get("authorization") || "";
  const apiKey = provider.apiKey ||
    (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined) ||
    (authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(provider.authHeader && apiKey
      ? { [provider.authHeader]: `${provider.authPrefix || ""}${apiKey}` }
      : {}),
    ...provider.headers,
  };

  const timeoutMs = (provider.timeout || CONFIG.server?.timeout || 120) * 1000;

  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    method: "POST",
    path: "/v1/messages",
    sourceScheme: "anthropic",
    targetScheme: provider.format || "openai-compatible",
    provider: route.provider,
    model: anthropicReq.model,
    targetModel: route.model,
    requestHeaders: Object.fromEntries(req.headers.entries()),
    requestBody: anthropicReq,
    transformedBody: openAIReq,
    responseStatus: 200,
    durationMs: 0,
  };

  try {
    const upstreamUrl = `${provider.baseUrl}/chat/completions`;
    const response = await fetchWithTimeout(
      upstreamUrl,
      {
        method: "POST",
        headers,
        body: JSON.stringify(openAIReq),
      },
      timeoutMs
    );

    logEntry.responseStatus = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      logEntry.error = `HTTP ${response.status}: ${errorText}`;
      logEntry.durationMs = Date.now() - startTime;
      await logConversation(logEntry);

      return new Response(
        JSON.stringify({ error: "Upstream error", details: errorText }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    if (anthropicReq.stream) {
      const streamResult = await streamOpenAIToAnthropic(response);

      logEntry.responseBody = { type: "streaming", chunkCount: streamResult.chunks.length };
      logEntry.durationMs = Date.now() - startTime;
      await logConversation(logEntry);

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of streamResult.chunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Non-streaming
    const openAIData: OpenAIResponse = await response.json();
    const { content, stop_reason } = convertOpenAIMessageToAnthropic(openAIData);

    const anthropicResponse: AnthropicResponse = {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: anthropicReq.model,
      content,
      stop_reason,
      stop_sequence: null,
      usage: {
        input_tokens: openAIData.usage?.prompt_tokens || 0,
        output_tokens: openAIData.usage?.completion_tokens || 0,
      },
    };

    logEntry.responseBody = anthropicResponse;
    logEntry.durationMs = Date.now() - startTime;
    await logConversation(logEntry);

    return new Response(JSON.stringify(anthropicResponse), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logEntry.error = errorMessage;
    logEntry.durationMs = Date.now() - startTime;
    await logConversation(logEntry);

    return new Response(
      JSON.stringify({ error: "Internal error", message: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function streamOpenAIToAnthropic(response: Response): Promise<{ chunks: string[]; finishReason: string | null }> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { chunks: [], finishReason: null };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  let hasSentContent = false;
  let hasSentToolUse = false;
  let currentBlockIndex = 0;
  const toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();
  let finalFinishReason: string | null = null;

  const chunks: string[] = [];

  chunks.push(createAnthropicMessageStart());
  chunks.push(createAnthropicStart(currentBlockIndex));

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          finished = true;
          break;
        }

        try {
          const parsed: OpenAIResponse = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          const finishReason = parsed.choices?.[0]?.finish_reason;

          if (finishReason) {
            finalFinishReason = finishReason;
            finished = true;
          }

          if (delta?.content) {
            if (hasSentToolUse && !hasSentContent) {
              chunks.push(createAnthropicStop(currentBlockIndex));
              currentBlockIndex++;
              hasSentToolUse = false;
              chunks.push(createAnthropicStart(currentBlockIndex));
            }
            hasSentContent = true;
            chunks.push(createAnthropicChunk(delta.content, currentBlockIndex));
          }

          if (delta?.tool_calls?.length) {
            for (const toolDelta of delta.tool_calls) {
              const toolIndex = toolDelta.index ?? 0;

              if (toolDelta.id) {
                if (hasSentContent) {
                  chunks.push(createAnthropicStop(currentBlockIndex));
                  currentBlockIndex++;
                  hasSentContent = false;
                }
                if (hasSentToolUse) {
                  chunks.push(createAnthropicStop(currentBlockIndex));
                  currentBlockIndex++;
                }

                const toolName = toolDelta.function?.name || "";
                toolCallBuffers.set(toolIndex, {
                  id: toolDelta.id,
                  name: toolName,
                  arguments: "",
                });

                chunks.push(createAnthropicToolUseStart(currentBlockIndex, toolDelta.id, toolName));
                hasSentToolUse = true;
              }

              if (toolDelta.function?.arguments) {
                const existing = toolCallBuffers.get(toolIndex);
                if (existing) {
                  existing.arguments += toolDelta.function.arguments;
                  chunks.push(createAnthropicToolUseDelta(currentBlockIndex, toolDelta.function.arguments));
                }
              }
            }
          }
        } catch {
          // Ignore malformed JSON
        }
      }
    }

    chunks.push(createAnthropicStop(currentBlockIndex));
    chunks.push(createAnthropicMessageStop(mapStopReason(finalFinishReason)));
    chunks.push(createAnthropicDone());

    return { chunks, finishReason: finalFinishReason };
  } finally {
    reader.releaseLock();
  }
}

async function handleAnthropicPassthrough(
  req: Request,
  anthropicReq: AnthropicRequest,
  provider: ProviderConfig,
  requestId: string,
  startTime: number
): Promise<Response> {
  console.log(
    `[${new Date().toISOString()}] ${requestId} anthropic:${anthropicReq.model} → [ANTHROPIC PASSTHROUGH] (stream=${anthropicReq.stream ?? false})`
  );

  const authHeader = req.headers.get("x-api-key") || req.headers.get("authorization") || "";
  const requestKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  const apiKey = provider.apiKey ||
    (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined) ||
    requestKey;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing API key", message: "No Anthropic API key provided" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": apiKey,
    "Anthropic-Version": "2023-06-01",
    ...provider.headers,
  };

  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    method: "POST",
    path: "/v1/messages",
    sourceScheme: "anthropic",
    targetScheme: "anthropic",
    provider: "anthropic",
    model: anthropicReq.model,
    targetModel: anthropicReq.model,
    requestHeaders: Object.fromEntries(req.headers.entries()),
    requestBody: anthropicReq,
    responseStatus: 200,
    durationMs: 0,
  };

  const timeoutMs = (provider.timeout || CONFIG.server?.timeout || 120) * 1000;

  try {
    const response = await fetchWithTimeout(
      `${provider.baseUrl}/v1/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(anthropicReq),
      },
      timeoutMs
    );

    logEntry.responseStatus = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      logEntry.error = `HTTP ${response.status}: ${errorText}`;
      logEntry.durationMs = Date.now() - startTime;
      await logConversation(logEntry);

      return new Response(
        JSON.stringify({ error: "Anthropic API error", details: errorText }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    logEntry.durationMs = Date.now() - startTime;
    await logConversation(logEntry);

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": anthropicReq.stream ? "text/event-stream" : "application/json",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logEntry.error = errorMessage;
    logEntry.durationMs = Date.now() - startTime;
    await logConversation(logEntry);

    return new Response(
      JSON.stringify({ error: "Internal error", message: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function handleOpenAIRequest(
  req: Request,
  requestId: string,
  startTime: number
): Promise<Response> {
  const body = await req.json();
  const model = body.model;

  if (!model) {
    return new Response(
      JSON.stringify({ error: "Missing model in request" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const route = findRoute(model);

  if (!route) {
    return new Response(
      JSON.stringify({ error: "No route found for model", model }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const provider = CONFIG.providers[route.provider];
  if (!provider) {
    return new Response(
      JSON.stringify({ error: "Unknown provider", provider: route.provider }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Update model in body if remapped
  if (route.model !== model) {
    body.model = route.model;
  }

  console.log(
    `[${new Date().toISOString()}] ${requestId} openai:${model} → ${route.provider}:${route.model} (stream=${body.stream ?? false})`
  );

  const authHeader = req.headers.get("authorization") || "";
  const apiKey = provider.apiKey ||
    (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined) ||
    (authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(provider.authHeader && apiKey
      ? { [provider.authHeader]: `${provider.authPrefix || ""}${apiKey}` }
      : {}),
    ...provider.headers,
  };

  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    method: "POST",
    path: "/v1/chat/completions",
    sourceScheme: "openai",
    targetScheme: provider.format || "openai-compatible",
    provider: route.provider,
    model,
    targetModel: route.model,
    requestHeaders: Object.fromEntries(req.headers.entries()),
    requestBody: body,
    responseStatus: 200,
    durationMs: 0,
  };

  const timeoutMs = (provider.timeout || CONFIG.server?.timeout || 120) * 1000;

  try {
    const response = await fetchWithTimeout(
      `${provider.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      timeoutMs
    );

    logEntry.responseStatus = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      logEntry.error = `HTTP ${response.status}: ${errorText}`;
      logEntry.durationMs = Date.now() - startTime;
      await logConversation(logEntry);

      return new Response(
        JSON.stringify({ error: "Upstream error", details: errorText }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    logEntry.durationMs = Date.now() - startTime;
    await logConversation(logEntry);

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": body.stream ? "text/event-stream" : "application/json",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logEntry.error = errorMessage;
    logEntry.durationMs = Date.now() - startTime;
    await logConversation(logEntry);

    return new Response(
      JSON.stringify({ error: "Internal error", message: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ============================================================================
// Preload
// ============================================================================

async function preloadModels() {
  console.log("\n[Preload] Warming up models...");

  const modelsToPreload = CONFIG.preload?.models || [];

  for (const model of modelsToPreload) {
    const route = findRoute(model);
    if (!route) {
      console.log(`[Preload] ⚠ No route for ${model}`);
      continue;
    }

    const provider = CONFIG.providers[route.provider];
    if (!provider) {
      console.log(`[Preload] ⚠ Unknown provider for ${model}`);
      continue;
    }

    // Skip providers that don't support warmup
    if (route.provider === "anthropic") {
      console.log(`[Preload] ⏭ Skipping ${model} (Anthropic - always-on)`);
      continue;
    }

    const apiKey = provider.apiKey || (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(provider.authHeader && apiKey
        ? { [provider.authHeader]: `${provider.authPrefix || ""}${apiKey}` }
        : {}),
      ...provider.headers,
    };

    const timeoutMs = (provider.timeout || CONFIG.server?.timeout || 120) * 1000;

    try {
      console.log(`[Preload] Pinging ${route.provider}:${route.model}...`);

      const response = await fetchWithTimeout(
        `${provider.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: route.model,
            messages: [{ role: "user", content: "Hi" }],
            max_tokens: 1,
            stream: false,
          }),
        },
        timeoutMs
      );

      if (response.ok) {
        console.log(`[Preload] ✓ ${model} ready`);
      } else {
        const error = await response.text();
        console.log(`[Preload] ✗ ${model} failed: ${response.status} ${error.slice(0, 100)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[Preload] ✗ ${model} error: ${message.slice(0, 100)}`);
    }
  }

  console.log("[Preload] Done\n");
}

// ============================================================================
// Main Server
// ============================================================================

async function main() {
  const args = parseArgs();

  if (args.help) {
    showHelp();
  }

  const configPath = args.config || "config.yaml";

  try {
    CONFIG = await loadConfig(configPath);
  } catch (error) {
    console.error(`Failed to load config: ${error}`);
    console.error("\nPlease create a config.yaml file. See config.example.yaml for examples.");
    process.exit(1);
  }

  // Override with CLI args
  const port = args.port ? parseInt(args.port, 10) : CONFIG.server?.port || 3000;
  const host = CONFIG.server?.host || "0.0.0.0";
  const timeout = args.timeout ? parseInt(args.timeout, 10) : CONFIG.server?.timeout || 120;

  if (args["log-dir"]) {
    CONFIG.logging = { ...CONFIG.logging, dir: args["log-dir"] };
  }

  // Ensure log directory exists
  if (CONFIG.logging?.dir && !existsSync(CONFIG.logging.dir)) {
    await mkdir(CONFIG.logging.dir, { recursive: true });
  }

  // Print startup info
  console.log(`
╔══════════════════════════════════════════════════════════╗
║           Universal Model Router                         ║
╠══════════════════════════════════════════════════════════╣
║  Config: ${configPath.padEnd(48)}║
║  Port:   ${port.toString().padEnd(48)}║
║  Host:   ${host.padEnd(48)}║
║  Timeout: ${(timeout + "s").padEnd(47)}║
╠══════════════════════════════════════════════════════════╣
║  Providers:                                              ║
${Object.entries(CONFIG.providers)
  .filter(([id]) => {
    // Only show providers that are referenced in routes or are built-in defaults
    return CONFIG.routes.some((r) => r.provider === id) || CONFIG.defaultProvider === id;
  })
  .map(([id, p]) => `║    - ${id.padEnd(15)} → ${p.baseUrl.slice(0, 35).padEnd(35)}║`)
  .join("\n")}
╠══════════════════════════════════════════════════════════╣
║  Routes:                                                 ║
${CONFIG.routes
  .map((r) => `║    ${r.pattern.padEnd(20)} → ${r.provider.padEnd(15)} (${r.model || "auto"})${"".padEnd(5)}║`)
  .join("\n")}
${CONFIG.defaultProvider ? `║    (default)           → ${CONFIG.defaultProvider.padEnd(32)}║` : "║    (no default provider)                                 ║"}
╚══════════════════════════════════════════════════════════╝
`);

  const server: Server = Bun.serve({
    port,
    hostname: host,
    idleTimeout: timeout,
    async fetch(req) {
      const url = new URL(req.url);
      const requestOrigin = req.headers.get("origin");
      const corsHeaders = getCORSHeaders(requestOrigin);
      const requestId = generateRequestId();
      const startTime = Date.now();

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      // Health check
      if (url.pathname === "/health" || url.pathname === "/") {
        return new Response(
          JSON.stringify({
            status: "ok",
            requestId,
            version: "2.0.0",
            schemes: CONFIG.schemes?.map((s) => s.id),
            providers: Object.keys(CONFIG.providers),
          }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Handle configured API paths
      const scheme = CONFIG.schemes?.find((s) => url.pathname === s.path);

      if (!scheme || req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      try {
        let response: Response;

        if (scheme.format === "anthropic") {
          const body = await req.json();
          response = await handleAnthropicRequest(req, body as AnthropicRequest, requestId, startTime);
        } else if (scheme.format === "openai" || scheme.format === "openai-compatible") {
          response = await handleOpenAIRequest(req, requestId, startTime);
        } else {
          response = new Response(
            JSON.stringify({ error: "Unsupported scheme format", format: scheme.format }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        // Add CORS headers to response
        const headers = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([key, value]) => {
          headers.set(key, value);
        });

        return new Response(response.body, {
          status: response.status,
          headers,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[${requestId}] Error:`, error);

        return new Response(
          JSON.stringify({ error: "Internal server error", message: errorMessage, requestId }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    },
  });

  console.log(`Server running at http://${host}:${port}/`);
  console.log(`\nSupported endpoints:`);
  CONFIG.schemes?.forEach((s) => {
    console.log(`  POST http://${host}:${port}${s.path} (${s.format})`);
  });
  console.log(`\nHealth check: http://${host}:${port}/health`);

  // Preload if enabled
  if (CONFIG.preload?.enabled) {
    await preloadModels();
  }

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    server.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
