// ============================================================================
// Internal Message Format - Universal representation for all providers
// ============================================================================

/**
 * Content types that can appear in messages
 */
export type ContentType = "text" | "image" | "tool_call" | "tool_result" | "thinking";

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
 * Internal request representation - normalized from all provider formats
 */
export interface InternalRequest {
  /** Original model name requested */
  model: string;
  /** Target model (after routing) */
  targetModel?: string;
  /** Messages in the conversation */
  messages: InternalMessage[];
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature (0-2) */
  temperature?: number;
  /** Top-p sampling */
  topP?: number;
  /** Whether to stream the response */
  stream?: boolean;
  /** Stop sequences */
  stopSequences?: string[];
  /** Tools available */
  tools?: InternalTool[];
  /** Tool choice mode */
  toolChoice?: ToolChoice;
  /** Response format */
  responseFormat?: ResponseFormat;
  /** System message (can be separate from messages array) */
  system?: string | InternalContentBlock[];
  /** Reasoning effort/thinking budget */
  reasoningEffort?: "low" | "medium" | "high" | { budgetTokens: number };
  /** Provider-specific extensions (passthrough) */
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
  // Ollama variants
  | "ollama-chat"
  | "ollama-generate"
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
  supportsJsonMode: boolean;
  supportsReasoningEffort: boolean;
  separateSystemField: boolean; // e.g., Anthropic has top-level "system"
  toolChoiceStyle: "openai" | "anthropic" | "google" | "simple";
  messageContentStyle: "string" | "array" | "both";
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
        supportsJsonMode: true,
        supportsReasoningEffort: true,
        separateSystemField: true,
        toolChoiceStyle: "anthropic",
        messageContentStyle: "array",
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
        supportsJsonMode: true,
        supportsReasoningEffort: true,
        separateSystemField: false,
        toolChoiceStyle: "openai",
        messageContentStyle: "both",
      };
    // OpenAI legacy completions (text-based, no message array)
    case "openai-completions":
      return {
        supportsSystemMessage: false,
        supportsTools: false,
        supportsStreaming: true,
        supportsImages: false,
        supportsJsonMode: true,
        supportsReasoningEffort: false,
        separateSystemField: false,
        toolChoiceStyle: "simple",
        messageContentStyle: "string",
      };
    // OpenAI responses API
    case "openai-responses":
      return {
        supportsSystemMessage: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsImages: true,
        supportsJsonMode: true,
        supportsReasoningEffort: true,
        separateSystemField: false,
        toolChoiceStyle: "openai",
        messageContentStyle: "both",
      };
    case "google":
      return {
        supportsSystemMessage: true,
        supportsTools: true,
        supportsStreaming: true,
        supportsImages: true,
        supportsJsonMode: true,
        supportsReasoningEffort: false,
        separateSystemField: false,
        toolChoiceStyle: "google",
        messageContentStyle: "array",
      };
    // Ollama variants
    case "ollama":
    case "ollama-generate":
      return {
        supportsSystemMessage: true,
        supportsTools: false,
        supportsStreaming: true,
        supportsImages: true,
        supportsJsonMode: false,
        supportsReasoningEffort: false,
        separateSystemField: false,
        toolChoiceStyle: "simple",
        messageContentStyle: "string",
      };
    case "ollama-chat":
      return {
        supportsSystemMessage: true,
        supportsTools: false,
        supportsStreaming: true,
        supportsImages: true,
        supportsJsonMode: false,
        supportsReasoningEffort: false,
        separateSystemField: false,
        toolChoiceStyle: "simple",
        messageContentStyle: "array",
      };
    default:
      return {
        supportsSystemMessage: true,
        supportsTools: false,
        supportsStreaming: true,
        supportsImages: false,
        supportsJsonMode: false,
        supportsReasoningEffort: false,
        separateSystemField: false,
        toolChoiceStyle: "simple",
        messageContentStyle: "string",
      };
  }
}
