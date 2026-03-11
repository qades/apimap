// ============================================================================
// Transformer Registry - Central hub for format conversions
// ============================================================================

import type { InternalRequest, InternalResponse, InternalStreamChunk, ProviderFormat } from "../types/internal.ts";
import type { OpenAIRequest, OpenAIResponse, AnthropicRequest, AnthropicResponse } from "../types/index.ts";
import * as openaiTransformer from "./openai.ts";
import * as anthropicTransformer from "./anthropic.ts";

export type { InternalRequest, InternalResponse, InternalStreamChunk, ProviderFormat };

// Re-export Anthropic stream helpers needed by server for content block lifecycle
export const createAnthropicStreamEvent = anthropicTransformer.createAnthropicStreamEvent;

/**
 * Parse a request from a provider format to internal format
 */
export function parseRequest(
  format: ProviderFormat,
  body: unknown,
  metadata: InternalRequest["metadata"]
): InternalRequest {
  switch (format) {
    // OpenAI chat variants (share the same parser)
    case "openai":
    case "openai-compatible":
    case "openai-chat":
    case "openai-responses":  // Responses API uses similar structure
      return openaiTransformer.parseOpenAIRequest(body as OpenAIRequest, metadata);
    // Anthropic variants
    case "anthropic":
    case "anthropic-messages":
      return anthropicTransformer.parseAnthropicRequest(body as AnthropicRequest, metadata);
    default:
      throw new Error(`Unsupported format for parsing: ${format}`);
  }
}

/**
 * Convert internal request to a provider format
 */
export function toProviderRequest(format: ProviderFormat, request: InternalRequest): unknown {
  switch (format) {
    // OpenAI chat variants (share the same serializer)
    case "openai":
    case "openai-compatible":
    case "openai-chat":
      return openaiTransformer.toOpenAIRequest(request);
    // OpenAI responses API (may have differences)
    case "openai-responses":
      return openaiTransformer.toOpenAIRequest(request); // TODO: Handle responses API differences
    // Anthropic variants
    case "anthropic":
    case "anthropic-messages":
      return anthropicTransformer.toAnthropicRequest(request);
    default:
      throw new Error(`Unsupported format for request conversion: ${format}`);
  }
}

/**
 * Parse a response from a provider format to internal format
 */
export function parseResponse(format: ProviderFormat, data: unknown): InternalResponse {
  switch (format) {
    // OpenAI chat variants
    case "openai":
    case "openai-compatible":
    case "openai-chat":
      return openaiTransformer.parseOpenAIResponse(data as OpenAIResponse);
    // OpenAI responses API
    case "openai-responses":
      return openaiTransformer.parseOpenAIResponse(data as OpenAIResponse); // TODO: Handle responses API differences
    // Anthropic variants
    case "anthropic":
    case "anthropic-messages":
      return anthropicTransformer.parseAnthropicResponse(data as AnthropicResponse);
    default:
      throw new Error(`Unsupported format for response parsing: ${format}`);
  }
}

/**
 * Convert internal response to a provider format
 */
export function toProviderResponse(format: ProviderFormat, response: InternalResponse): unknown {
  switch (format) {
    // OpenAI chat variants
    case "openai":
    case "openai-compatible":
    case "openai-chat":
      return openaiTransformer.toOpenAIResponse(response);
    // OpenAI responses API
    case "openai-responses":
      return openaiTransformer.toOpenAIResponse(response); // TODO: Handle responses API differences
    // Anthropic variants
    case "anthropic":
    case "anthropic-messages":
      return anthropicTransformer.toAnthropicResponse(response);
    default:
      throw new Error(`Unsupported format for response conversion: ${format}`);
  }
}

/**
 * Parse a streaming chunk from a provider format
 */
export function parseStreamChunk(
  format: ProviderFormat,
  line: string
): InternalStreamChunk | null {
  switch (format) {
    // OpenAI chat variants
    case "openai":
    case "openai-compatible":
    case "openai-chat":
      try {
        if (!line.startsWith("data: ")) return null;
        const json = line.slice(6).trim();
        if (json === "[DONE]") {
          return { index: 0, delta: { type: "text", text: "" }, isComplete: true };
        }
        return openaiTransformer.parseOpenAIStreamChunk(JSON.parse(json));
      } catch {
        return null;
      }
    // OpenAI responses API
    case "openai-responses":
      try {
        if (!line.startsWith("data: ")) return null;
        const json = line.slice(6).trim();
        if (json === "[DONE]") {
          return { index: 0, delta: { type: "text", text: "" }, isComplete: true };
        }
        return openaiTransformer.parseOpenAIStreamChunk(JSON.parse(json)); // TODO: Handle responses API differences
      } catch {
        return null;
      }
    // Anthropic variants
    case "anthropic":
    case "anthropic-messages":
      return anthropicTransformer.parseAnthropicStreamEvent(line);
    default:
      return null;
  }
}

/**
 * Convert internal stream chunk to provider SSE format
 */
export function toProviderStreamChunk(
  format: ProviderFormat,
  chunk: InternalStreamChunk,
  model: string
): string {
  switch (format) {
    // OpenAI chat variants
    case "openai":
    case "openai-compatible":
    case "openai-chat":
      return openaiTransformer.toOpenAIStreamChunk(chunk, model);
    // OpenAI responses API
    case "openai-responses":
      return openaiTransformer.toOpenAIStreamChunk(chunk, model); // TODO: Handle responses API differences
    // Anthropic variants
    case "anthropic":
    case "anthropic-messages":
      return anthropicTransformer.toAnthropicStreamChunk(chunk);
    default:
      return "";
  }
}

/**
 * Create stream start events for a provider
 */
export function createStreamStart(
  format: ProviderFormat,
  messageId: string,
  usage?: { input_tokens?: number }
): string {
  switch (format) {
    // Anthropic variants
    case "anthropic":
    case "anthropic-messages":
      return anthropicTransformer.createAnthropicStreamStart(messageId, usage);
    // OpenAI variants (no start events needed)
    case "openai":
    case "openai-compatible":
    case "openai-chat":
    case "openai-responses":
    default:
      return "";
  }
}

/**
 * Create stream stop events for a provider
 */
export function createStreamStop(
  format: ProviderFormat,
  stopReason: string | null,
  outputTokens: number
): string {
  switch (format) {
    // Anthropic variants
    case "anthropic":
    case "anthropic-messages":
      return anthropicTransformer.createAnthropicStreamStop(stopReason, outputTokens);
    // OpenAI variants
    case "openai":
    case "openai-compatible":
    case "openai-chat":
    case "openai-responses":
    default:
      return "data: [DONE]\n\n";
  }
}

/**
 * Map stop reason between formats
 */
export function mapStopReason(
  fromFormat: ProviderFormat,
  toFormat: ProviderFormat,
  reason: string | null
): string | null {
  // First normalize to internal
  let internal: InternalResponse["stopReason"] = null;
  
  // Check if fromFormat is OpenAI variant
  const isFromOpenAI = fromFormat.startsWith("openai");
  // Check if fromFormat is Anthropic variant
  const isFromAnthropic = fromFormat.startsWith("anthropic");
  // Check if toFormat is OpenAI variant
  const isToOpenAI = toFormat.startsWith("openai");
  // Check if toFormat is Anthropic variant
  const isToAnthropic = toFormat.startsWith("anthropic");
  
  if (isFromOpenAI) {
    if (reason === "stop") internal = "end_turn";
    else if (reason === "tool_calls") internal = "tool_use";
    else if (reason === "length") internal = "max_tokens";
    else if (reason === "content_filter") internal = "content_filter";
  } else if (isFromAnthropic) {
    if (reason === "end_turn") internal = "end_turn";
    else if (reason === "tool_use") internal = "tool_use";
    else if (reason === "max_tokens") internal = "max_tokens";
    else if (reason === "content_filter") internal = "content_filter";
  }

  // Then convert to target format
  if (isToOpenAI) {
    if (internal === "end_turn") return "stop";
    if (internal === "tool_use") return "tool_calls";
    if (internal === "max_tokens") return "length";
    if (internal === "content_filter") return "content_filter";
  } else if (isToAnthropic) {
    if (internal === "end_turn") return "end_turn";
    if (internal === "tool_use") return "tool_use";
    if (internal === "max_tokens") return "max_tokens";
    if (internal === "content_filter") return "content_filter";
  }

  return null;
}

/**
 * Detect provider format from request body
 */
export function detectFormat(body: Record<string, unknown>): ProviderFormat | null {
  // Anthropic uses "max_tokens" (required) and has distinct structure
  if (body.max_tokens !== undefined && 
      body.messages !== undefined &&
      (body.system !== undefined || 
       (Array.isArray(body.messages) && body.messages.length > 0 && 
        typeof body.messages[0] === "object" && body.messages[0] !== null &&
        ("content" in body.messages[0] && 
         (Array.isArray((body.messages[0] as Record<string, unknown>).content) ||
          typeof (body.messages[0] as Record<string, unknown>).content === "string"))))) {
    // Check for Anthropic-specific fields
    if (body.stop_sequences !== undefined || 
        (body.tools !== undefined && Array.isArray(body.tools) && body.tools.length > 0 &&
         typeof body.tools[0] === "object" && body.tools[0] !== null &&
         "input_schema" in body.tools[0])) {
      return "anthropic";
    }
  }

  // OpenAI uses "max_tokens" or "max_completion_tokens"
  if (body.model !== undefined && 
      body.messages !== undefined &&
      (body.max_tokens !== undefined || body.max_completion_tokens !== undefined ||
       body.temperature !== undefined || body.top_p !== undefined)) {
    return "openai";
  }

  return null;
}
