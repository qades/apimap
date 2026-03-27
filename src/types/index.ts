// ============================================================================
// API Types - External request/response formats
// ============================================================================

/**
 * OpenAI-style tool definition
 */
export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * OpenAI-style tool call
 */
export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * OpenAI chat message content block
 */
export interface OpenAIContentBlock {
  type: "text" | "image_url" | "input_audio" | "file";
  text?: string;
  image_url?: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
  input_audio?: {
    data: string;
    format: "mp3" | "wav" | "ogg";
  };
  file?: {
    file_data?: string;
    filename?: string;
    file_id?: string;
  };
}

/**
 * OpenAI chat message
 */
export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | OpenAIContentBlock[];
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  /** Reasoning content from models like DeepSeek R1 */
  reasoning_content?: string;
  /** Logprobs for this message */
  logprobs?: {
    content?: Array<{
      token: string;
      logprob: number;
      bytes?: number[];
      top_logprobs?: Array<{
        token: string;
        logprob: number;
        bytes?: number[];
      }>;
    }>;
  };
}

/**
 * OpenAI response format
 */
export type OpenAIResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };

/**
 * OpenAI chat completion request
 * 
 * Full implementation of the OpenAI Chat Completions API parameters.
 * Reference: https://platform.openai.com/docs/api-reference/chat/create
 */
export interface OpenAIRequest {
  // Required
  model: string;
  messages: OpenAIChatMessage[];
  
  // Core parameters
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[] | null;
  
  // Tool parameters
  tools?: OpenAITool[];
  tool_choice?: "auto" | "required" | "none" | { type: "function"; function: { name: string } };
  parallel_tool_calls?: boolean;
  
  // Response format
  response_format?: OpenAIResponseFormat;
  modalities?: ("text" | "audio")[];
  
  // Sampling parameters
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  seed?: number | null;
  n?: number | null;
  logit_bias?: Record<string, number> | null;
  logprobs?: boolean | null;
  top_logprobs?: number | null;
  
  // Reasoning parameters
  reasoning_effort?: "low" | "medium" | "high";
  
  // Extensions
  /** Chat template kwargs for providers like DeepSeek (e.g., enable_thinking) */
  chat_template_kwargs?: Record<string, unknown>;
  /** Prediction/content to bias towards */
  prediction?: {
    type: "content";
    content: string;
  };
  
  // Passthrough parameters
  /** Extra body parameters to pass to provider */
  extra_body?: Record<string, unknown>;
  /** Extra headers to include in the request */
  extra_headers?: Record<string, string>;
  /** Extra query parameters for the URL */
  extra_query?: Record<string, string>;
  
  // Metadata
  /** Unique identifier for the end-user */
  user?: string;
  /** Metadata to include with the request */
  metadata?: Record<string, string>;
  /** Store the output for later retrieval */
  store?: boolean;
}

/**
 * OpenAI streaming choice delta
 */
export interface OpenAIStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string | null;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: "function";
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
    /** Reasoning content delta (DeepSeek, etc.) */
    reasoning_content?: string;
  };
  finish_reason: string | null;
  /** Logprobs if requested */
  logprobs?: {
    content?: Array<{
      token: string;
      logprob: number;
      bytes?: number[];
      top_logprobs?: Array<{
        token: string;
        logprob: number;
        bytes?: number[];
      }>;
    }>;
  };
}

/**
 * OpenAI chat completion response
 * 
 * Full implementation of the OpenAI Chat Completions API response.
 */
export interface OpenAIResponse {
  id: string;
  object: "chat.completion" | "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message?: OpenAIChatMessage;
    delta?: OpenAIChatMessage;
    finish_reason: string | null;
    /** Logprobs if requested */
    logprobs?: {
      content?: Array<{
        token: string;
        logprob: number;
        bytes?: number[];
        top_logprobs?: Array<{
          token: string;
          logprob: number;
          bytes?: number[];
        }>;
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** OpenAI o-series reasoning tokens */
    completion_tokens_details?: {
      reasoning_tokens?: number;
      accepted_prediction_tokens?: number;
      rejected_prediction_tokens?: number;
    };
  };
  /** System fingerprint for deterministic responses */
  system_fingerprint?: string;
  /** Service tier used (OpenAI) */
  service_tier?: "scale" | "default" | null;
}

// ============================================================================
// Anthropic Types
// ============================================================================

/**
 * Anthropic thinking configuration
 */
export interface AnthropicThinking {
  type: "enabled" | "disabled";
  budget_tokens?: number;
}

/**
 * Anthropic cache control
 */
export interface AnthropicCacheControl {
  type: "ephemeral";
}

/**
 * Anthropic text content block
 */
export interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
}

/**
 * Anthropic thinking content block
 */
export interface AnthropicThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
  cache_control?: AnthropicCacheControl;
}

/**
 * Anthropic redacted thinking block
 */
export interface AnthropicRedactedThinkingBlock {
  type: "redacted_thinking";
  data: string;
}

/**
 * Anthropic image source
 */
export interface AnthropicImageSource {
  type: "base64";
  media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
}

/**
 * Anthropic image content block
 */
export interface AnthropicImageBlock {
  type: "image";
  source: AnthropicImageSource;
  cache_control?: AnthropicCacheControl;
}

/**
 * Anthropic tool use block
 */
export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: AnthropicCacheControl;
}

/**
 * Anthropic tool result block
 */
export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | AnthropicContentBlock[];
  is_error?: boolean;
  cache_control?: AnthropicCacheControl;
}

/**
 * Anthropic content block (union type)
 */
export type AnthropicContentBlock = 
  | AnthropicTextBlock 
  | AnthropicThinkingBlock
  | AnthropicRedactedThinkingBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

/**
 * Anthropic message
 */
export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

/**
 * Anthropic tool definition
 */
export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  cache_control?: AnthropicCacheControl;
}

/**
 * Anthropic tool choice
 */
export type AnthropicToolChoice = 
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string };

/**
 * Anthropic metadata
 */
export interface AnthropicMetadata {
  user_id?: string;
}

/**
 * Anthropic request
 * 
 * Reference: https://docs.anthropic.com/en/api/messages
 */
export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string | AnthropicTextBlock[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  thinking?: AnthropicThinking;
  metadata?: AnthropicMetadata;
}

/**
 * Anthropic usage
 */
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Anthropic response
 */
export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  stop_sequence?: string;
  usage: AnthropicUsage;
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
  routed: boolean;
  matchedPattern?: string;
}

// ============================================================================
// Provider Registry Types
// ============================================================================

export interface ProviderDefinition {
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

// ============================================================================
// Router Configuration Types
// ============================================================================

export interface RouteConfig {
  pattern: string;
  provider: string;
  model?: string;
  priority?: number;
  /** Provider-specific options */
  options?: Record<string, unknown>;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  authHeader?: string;
  authPrefix?: string;
  headers?: Record<string, string>;
  timeout?: number;
  supportsStreaming?: boolean;
  /** Default options for this provider */
  defaultOptions?: Record<string, unknown>;
}

export interface ApiSchemeConfig {
  id: string;
  path: string;
  format: string;
  /** Optional: transform rules for this scheme */
  transformRules?: {
    stripFields?: string[];
    addFields?: Record<string, unknown>;
    mapFields?: Record<string, string>;
  };
}

export interface RouterConfig {
  server?: {
    port?: number;
    externalPort?: number;
    externalHost?: string;
    host?: string;
    cors?: {
      origin?: string | string[];
      credentials?: boolean;
    };
    timeout?: number;
  };
  logging?: {
    dir?: string;
    level?: string;
    maskKeys?: boolean;
  };
  preload?: {
    enabled?: boolean;
    models?: string[];
  };
  schemes?: ApiSchemeConfig[];
  providers: Record<string, ProviderConfig>;
  routes: RouteConfig[];
  /** Default provider when no route matches */
  defaultProvider?: string;
  /** Global transform rules applied to all requests */
  globalTransformRules?: {
    stripFields?: string[];
    addFields?: Record<string, unknown>;
    mapFields?: Record<string, string>;
  };
}
