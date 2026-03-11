// ============================================================================
// Core Type Definitions
// ============================================================================

// Provider Configuration
export interface ProviderConfig {
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
  /** Default transformer format for this provider (e.g., "openai-chat", "anthropic-messages") */
  format?: string;
}

// Route Configuration
export interface RouteConfig {
  /** Pattern to match model names (supports wildcards: * and ?) */
  pattern: string;
  /** Provider to route to */
  provider: string;
  /** Model name to use upstream (defaults to original model name) */
  model?: string;
}

// API Scheme Configuration
export interface ApiSchemeConfig {
  /** API scheme identifier (e.g., "openai-chat", "anthropic-messages") */
  id: string;
  /** Transformer format (e.g., "openai-chat", "openai-responses", "anthropic-messages") */
  format: string;
  /** Provider to use for this scheme (defaults to scheme id) */
  defaultProvider?: string;
}

// Router Configuration
export interface RouterConfig {
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
  /** Routing rules (matched top-down, put catch-all "*" last) */
  routes: RouteConfig[];
}

// ============================================================================
// Request/Response Types - Anthropic
// ============================================================================

export interface AnthropicCacheControl {
  type: "ephemeral";
  ttl?: string;
  scope?: string;
}

export interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
}

export interface AnthropicImageBlock {
  type: "image";
  source: unknown;
  cache_control?: AnthropicCacheControl;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: AnthropicCacheControl;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<AnthropicTextBlock | AnthropicImageBlock>;
  is_error?: boolean;
  cache_control?: AnthropicCacheControl;
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    $schema?: string;
  };
}

export type AnthropicToolChoice = "auto" | "any" | "tool" | { type: "tool"; name: string };

export interface AnthropicOutputConfig {
  format?: {
    type: "text" | "json_schema";
    schema?: Record<string, unknown>;
  };
  effort?: "low" | "medium" | "high";
}

export interface AnthropicRequest {
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

export interface AnthropicResponse {
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
// Request/Response Types - OpenAI
// ============================================================================

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface OpenAITool {
  type: "function";
  function: OpenAIFunction;
}

export type OpenAIResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };

export interface OpenAIRequest {
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

export interface OpenAIStreamChoice {
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

export interface OpenAIResponse {
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
// Log Types
// ============================================================================

export interface LogEntry {
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
  /** Raw response from upstream provider (before transformation to client format) */
  rawUpstreamResponse?: unknown;
  /** Transformed response sent back to client (when different from responseBody) */
  transformedResponse?: unknown;
  error?: string;
  durationMs: number;
  /** Whether this request was successfully routed */
  routed: boolean;
  /** The matched route pattern (if any) */
  matchedPattern?: string;
}

// ============================================================================
// Route Match Types
// ============================================================================

export interface MatchResult {
  matched: boolean;
  captures: string[];
}

export interface RouteMatch {
  provider: string;
  model: string;
  pattern?: string;
}

// ============================================================================
// GUI Types
// ============================================================================

export interface UnroutedRequest {
  id: string;
  timestamp: string;
  model: string;
  apiKey: string;
  streaming: boolean;
  endpoint: string;
  fullRequest: unknown;
  headers: Record<string, string>;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  defaultBaseUrl: string;
  defaultApiKeyEnv?: string;
  authHeader: string;
  authPrefix: string;
  supportsStreaming: boolean;
  requiresApiKey: boolean;
  category: "cloud" | "local" | "custom";
}

export interface ConfigBackup {
  filename: string;
  createdAt: string;
  size: number;
}

export interface SystemStatus {
  status: "ok" | "error" | "warning";
  version: string;
  uptime: number;
  activeProviders: string[];
  totalRequests: number;
  unroutedRequests: number;
}
