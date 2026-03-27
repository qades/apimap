// ============================================================================
// Internal Message Format - Universal representation for all providers
// ============================================================================

/**
 * Content types that can appear in messages
 */
export type ContentType = "text" | "image" | "tool_call" | "tool_result" | "thinking" | "audio" | "video";

/**
 * A single piece of content in a message
 */
export interface InternalContentBlock {
  type: ContentType;
  /** Text content or tool name/thinking signature */
  text?: string;
  /** Image data (base64 or URL) */
  image?: {
    url?: string;
    base64?: string;
    mimeType?: string;
  };
  /** Audio data */
  audio?: {
    url?: string;
    base64?: string;
    mimeType?: string;
  };
  /** Video data */
  video?: {
    url?: string;
    base64?: string;
    mimeType?: string;
  };
  /** Tool call details */
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    argumentsJson?: string; // Raw JSON for streaming
  };
  /** Tool result details */
  toolResult?: {
    toolCallId: string;
    content: string;
    isError?: boolean;
  };
  /** Thinking/reasoning content */
  thinking?: {
    signature?: string;
    redacted?: boolean;
    budgetTokens?: number;
  };
  /** Cache control hint */
  cacheControl?: "ephemeral" | "persistent";
}

/**
 * Message role
 */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/**
 * Internal message representation
 */
export interface InternalMessage {
  role: MessageRole;
  content: string | InternalContentBlock[];
  /** Optional name for the message sender (used in tool results) */
  name?: string;
  /** Tool calls made by the assistant */
  toolCalls?: InternalContentBlock[];
  /** Tool call ID for tool results */
  toolCallId?: string;
  /** Cache control for this message (Anthropic-style) */
  cacheControl?: "ephemeral" | "persistent";
}

/**
 * Tool definition
 */
export interface InternalTool {
  name: string;
  description?: string;
  parameters: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  /** Cache control for tool definitions */
  cacheControl?: "ephemeral" | "persistent";
}

/**
 * Tool choice mode
 */
export type ToolChoice = "auto" | "required" | "none" | { name: string };

/**
 * Response format
 */
export type ResponseFormat = 
  | { type: "text" }
  | { type: "json"; schema?: Record<string, unknown> };

/**
 * Logprob information for a token
 */
export interface LogprobInfo {
  token: string;
  logprob: number;
  bytes?: number[];
  /** Top alternative tokens and their logprobs */
  topLogprobs?: Array<{
    token: string;
    logprob: number;
    bytes?: number[];
  }>;
}

/**
 * Internal request representation - normalized from all provider formats
 * 
 * This is a UNIFIED representation that captures ALL parameters from ALL providers.
 * Transformers should map provider-specific formats to/from this structure.
 */
export interface InternalRequest {
  /** Original model name requested */
  model: string;
  /** Target model (after routing) */
  targetModel?: string;
  /** Messages in the conversation */
  messages: InternalMessage[];
  
  // ============================================================================
  // Core Parameters (supported by almost all providers)
  // ============================================================================
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Alias for maxTokens (OpenAI o-series) */
  maxCompletionTokens?: number;
  /** Temperature (0-2) */
  temperature?: number;
  /** Top-p sampling (0-1) */
  topP?: number;
  /** Whether to stream the response */
  stream?: boolean;
  /** Stop sequences */
  stopSequences?: string[];
  
  // ============================================================================
  // Tool Parameters
  // ============================================================================
  /** Tools available */
  tools?: InternalTool[];
  /** Tool choice mode */
  toolChoice?: ToolChoice;
  /** Whether to allow parallel tool calls */
  parallelToolCalls?: boolean;
  
  // ============================================================================
  // Response Format
  // ============================================================================
  /** Response format */
  responseFormat?: ResponseFormat;
  /** Modalities to use (text, audio, etc.) */
  modalities?: string[];
  
  // ============================================================================
  // Sampling Parameters
  // ============================================================================
  /** Frequency penalty (0-2) - penalizes tokens based on frequency */
  frequencyPenalty?: number;
  /** Presence penalty (0-2) - penalizes tokens based on existence */
  presencePenalty?: number;
  /** Seed for deterministic/reproducible responses */
  seed?: number;
  /** Number of completions to generate (1-128) */
  n?: number;
  /** Logit bias for token manipulation */
  logitBias?: Record<string, number>;
  /** Whether to return log probabilities */
  logprobs?: boolean;
  /** Number of top logprobs to return (0-20, requires logprobs=true) */
  topLogprobs?: number;
  
  // ============================================================================
  // Reasoning/Thinking Parameters (provider-specific implementations)
  // ============================================================================
  /** 
   * Reasoning effort level (OpenAI o-series, Anthropic)
   * Can be string for standard levels or object for provider-specific config
   */
  reasoningEffort?: "low" | "medium" | "high" | { 
    budgetTokens: number;
    type?: "enabled";
  };
  /** 
   * Thinking configuration (Anthropic-style)
   * { type: "enabled", budget_tokens: number }
   */
  thinking?: {
    type: "enabled" | "disabled";
    budgetTokens?: number;
  };
  /** Chat template kwargs (DeepSeek, vLLM, etc.) */
  chatTemplateKwargs?: Record<string, unknown>;
  
  // ============================================================================
  // System/Context
  // ============================================================================
  /** System message (can be separate from messages array) */
  system?: string | InternalContentBlock[];
  /** System message as a list (Anthropic-style with cache_control) */
  systemBlocks?: Array<{ type: "text"; text: string; cacheControl?: string }>;
  
  // ============================================================================
  // Provider-specific Parameters (stored in extensions)
  // ============================================================================
  /** 
   * Top-k sampling (Gemini, vLLM, etc.)
   * Number of highest probability vocabulary tokens to keep for top-k-filtering
   */
  topK?: number;
  /** Repetition penalty (vLLM, HuggingFace, etc.) */
  repetitionPenalty?: number;
  /** Min-p sampling (vLLM, etc.) */
  minP?: number;
  /** Truncation length (vLLM, etc.) */
  truncate?: number;
  /** Web search options (Gemini, etc.) */
  webSearchOptions?: {
    searchContextSize?: "low" | "medium" | "high";
    userLocation?: {
      country?: string;
      region?: string;
      city?: string;
    };
  };
  /** Prediction/content to bias towards (OpenAI) */
  prediction?: {
    type: "content";
    content: string;
  };
  
  // ============================================================================
  // Passthrough Parameters (sent directly to provider)
  // ============================================================================
  /** Extra body parameters to pass to provider */
  extraBody?: Record<string, unknown>;
  /** Extra headers to include in the request */
  extraHeaders?: Record<string, string>;
  /** Extra query parameters for the URL */
  extraQuery?: Record<string, string>;
  
  // ============================================================================
  // Metadata
  // ============================================================================
  /** Unique identifier for the end-user (for tracking) */
  user?: string;
  /** Provider-specific extensions (any additional params) */
  extensions?: Record<string, unknown>;
  /** Original request metadata */
  metadata: {
    /** Source API format */
    sourceFormat: "openai" | "anthropic" | "google" | "ollama" | "custom";
    /** API endpoint path */
    endpoint: string;
    /** Request headers (sanitized) */
    headers: Record<string, string>;
    /** API key used (masked) */
    apiKey?: string;
    /** Unique request ID */
    requestId: string;
    /** Timestamp */
    timestamp: string;
  };
}

/**
 * Usage statistics
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Anthropic-specific cache stats */
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  /** Reasoning tokens (OpenAI o-series) */
  reasoningTokens?: number;
}

/**
 * Internal response representation - can be converted to any provider format
 */
export interface InternalResponse {
  /** Response ID */
  id: string;
  /** Model that generated the response */
  model: string;
  /** Response content */
  content: InternalContentBlock[];
  /** Stop reason */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "content_filter" | "stop_sequence" | null;
  /** Stop sequence if applicable */
  stopSequence?: string | null;
  /** Usage statistics */
  usage?: TokenUsage;
  /** Whether this is a streaming chunk */
  isStreamChunk?: boolean;
  /** For streaming: whether this is the final chunk */
  isComplete?: boolean;
  /** Tool calls in the response */
  toolCalls?: InternalContentBlock[];
  /** Logprobs if requested */
  logprobs?: LogprobInfo[];
  /** System fingerprint for deterministic responses (OpenAI) */
  systemFingerprint?: string;
  /** Reasoning content from models like DeepSeek */
  reasoningContent?: string;
  /** Provider-specific extensions */
  extensions?: Record<string, unknown>;
}

/**
 * Stream chunk for streaming responses
 */
export interface InternalStreamChunk {
  /** Chunk index */
  index: number;
  /** Delta content */
  delta: InternalContentBlock;
  /** Finish reason (if this is the final chunk) */
  finishReason?: string | null;
  /** Usage (often only in final chunk) */
  usage?: TokenUsage;
  /** Whether this is the final chunk */
  isComplete?: boolean;
  /** Logprobs for this chunk */
  logprobs?: LogprobInfo[];
  /** Reasoning content delta */
  reasoningContent?: string;
}

/**
 * Supported provider format variants for conversion
 * Format: "{provider}-{endpoint-type}" for variants, "{provider}" for defaults
 */
export type ProviderFormat = 
  // OpenAI variants
  | "openai-chat"
  | "openai-completions"
  | "openai-responses"
  // Anthropic variants
  | "anthropic-messages"
  // Gemini variants
  | "gemini-chat"
  | "gemini-generate"
  // Ollama variants
  | "ollama-chat"
  | "ollama-generate"
  // DeepSeek
  | "deepseek-chat"
  // vLLM
  | "vllm-chat"
  // Legacy/simple formats (backward compatible)
  | "openai"
  | "anthropic"
  | "google"
  | "ollama"
  | "openai-compatible";

/**
 * Format capability flags
 */
export interface FormatCapabilities {
  supportsSystemMessage: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsImages: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  supportsJsonMode: boolean;
  supportsReasoningEffort: boolean;
  supportsLogprobs: boolean;
  supportsN: boolean;
  supportsSeed: boolean;
  supportsTopK: boolean;
  supportsCacheControl: boolean;
  separateSystemField: boolean; // e.g., Anthropic has top-level "system"
  toolChoiceStyle: "openai" | "anthropic" | "google" | "simple";
  messageContentStyle: "string" | "array" | "both";
  reasoningStyle: "thinking" | "reasoning_effort" | "none";
}

/**
 * Get capabilities for a format
 */
export function getFormatCapabilities(format: ProviderFormat): FormatCapabilities {
  switch (format) {
    // Anthropic variants
    case "anthropic":
    case "anthropic-messages":
      return {
        supportsSystemMessage: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsImages: true,
        supportsAudio: false,
        supportsVideo: false,
        supportsJsonMode: true,
        supportsReasoningEffort: true,
        supportsLogprobs: false,
        supportsN: false,
        supportsSeed: false,
        supportsTopK: false,
        supportsCacheControl: true,
        separateSystemField: true,
        toolChoiceStyle: "anthropic",
        messageContentStyle: "array",
        reasoningStyle: "thinking",
      };
    // Gemini variants
    case "gemini":
    case "gemini-chat":
      return {
        supportsSystemMessage: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsImages: true,
        supportsAudio: true,
        supportsVideo: true,
        supportsJsonMode: true,
        supportsReasoningEffort: true,
        supportsLogprobs: true,
        supportsN: true,
        supportsSeed: false,
        supportsTopK: true,
        supportsCacheControl: false,
        separateSystemField: false,
        toolChoiceStyle: "google",
        messageContentStyle: "array",
        reasoningStyle: "thinking",
      };
    // OpenAI chat variants
    case "openai":
    case "openai-compatible":
    case "openai-chat":
      return {
        supportsSystemMessage: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsImages: true,
        supportsAudio: true,
        supportsVideo: false,
        supportsJsonMode: true,
        supportsReasoningEffort: true,
        supportsLogprobs: true,
        supportsN: true,
        supportsSeed: true,
        supportsTopK: false,
        supportsCacheControl: false,
        separateSystemField: false,
        toolChoiceStyle: "openai",
        messageContentStyle: "both",
        reasoningStyle: "reasoning_effort",
      };
    // OpenAI legacy completions (text-based, no message array)
    case "openai-completions":
      return {
        supportsSystemMessage: false,
        supportsTools: false,
        supportsStreaming: true,
        supportsImages: false,
        supportsAudio: false,
        supportsVideo: false,
        supportsJsonMode: true,
        supportsReasoningEffort: false,
        supportsLogprobs: true,
        supportsN: true,
        supportsSeed: true,
        supportsTopK: false,
        supportsCacheControl: false,
        separateSystemField: false,
        toolChoiceStyle: "simple",
        messageContentStyle: "string",
        reasoningStyle: "none",
      };
    // OpenAI responses API
    case "openai-responses":
      return {
        supportsSystemMessage: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsImages: true,
        supportsAudio: true,
        supportsVideo: false,
        supportsJsonMode: true,
        supportsReasoningEffort: true,
        supportsLogprobs: true,
        supportsN: true,
        supportsSeed: true,
        supportsTopK: false,
        supportsCacheControl: false,
        separateSystemField: false,
        toolChoiceStyle: "openai",
        messageContentStyle: "both",
        reasoningStyle: "reasoning_effort",
      };
    // DeepSeek
    case "deepseek":
    case "deepseek-chat":
      return {
        supportsSystemMessage: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsImages: false,
        supportsAudio: false,
        supportsVideo: false,
        supportsJsonMode: true,
        supportsReasoningEffort: true,
        supportsLogprobs: false,
        supportsN: false,
        supportsSeed: false,
        supportsTopK: false,
        supportsCacheControl: false,
        separateSystemField: false,
        toolChoiceStyle: "openai",
        messageContentStyle: "string",
        reasoningStyle: "thinking",
      };
    // Ollama variants
    case "ollama":
    case "ollama-generate":
      return {
        supportsSystemMessage: true,
        supportsTools: false,
        supportsStreaming: true,
        supportsImages: true,
        supportsAudio: false,
        supportsVideo: false,
        supportsJsonMode: false,
        supportsReasoningEffort: false,
        supportsLogprobs: false,
        supportsN: false,
        supportsSeed: false,
        supportsTopK: true,
        supportsCacheControl: false,
        separateSystemField: false,
        toolChoiceStyle: "simple",
        messageContentStyle: "string",
        reasoningStyle: "none",
      };
    case "ollama-chat":
      return {
        supportsSystemMessage: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsImages: true,
        supportsAudio: false,
        supportsVideo: false,
        supportsJsonMode: false,
        supportsReasoningEffort: false,
        supportsLogprobs: false,
        supportsN: false,
        supportsSeed: false,
        supportsTopK: true,
        supportsCacheControl: false,
        separateSystemField: false,
        toolChoiceStyle: "simple",
        messageContentStyle: "array",
        reasoningStyle: "none",
      };
    // vLLM
    case "vllm":
    case "vllm-chat":
      return {
        supportsSystemMessage: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsImages: true,
        supportsAudio: false,
        supportsVideo: false,
        supportsJsonMode: true,
        supportsReasoningEffort: false,
        supportsLogprobs: true,
        supportsN: true,
        supportsSeed: true,
        supportsTopK: true,
        supportsCacheControl: false,
        separateSystemField: false,
        toolChoiceStyle: "openai",
        messageContentStyle: "both",
        reasoningStyle: "none",
      };
    default:
      return {
        supportsSystemMessage: true,
        supportsTools: false,
        supportsStreaming: true,
        supportsImages: false,
        supportsAudio: false,
        supportsVideo: false,
        supportsJsonMode: false,
        supportsReasoningEffort: false,
        supportsLogprobs: false,
        supportsN: false,
        supportsSeed: false,
        supportsTopK: false,
        supportsCacheControl: false,
        separateSystemField: false,
        toolChoiceStyle: "simple",
        messageContentStyle: "string",
        reasoningStyle: "none",
      };
  }
}
