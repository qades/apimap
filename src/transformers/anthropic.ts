// ============================================================================
// Anthropic Format Transformer
// ============================================================================

import type {
  InternalRequest,
  InternalResponse,
  InternalMessage,
  InternalContentBlock,
  InternalStreamChunk,
  InternalTool,
  ToolChoice,
} from "../types/internal.ts";
import type { 
  AnthropicRequest, 
  AnthropicResponse, 
  AnthropicMessage, 
  AnthropicContentBlock,
  AnthropicTool,
  AnthropicToolChoice,
} from "../types/index.ts";

/**
 * Convert Anthropic tool to internal tool
 */
function anthropicToolToInternal(tool: AnthropicTool): InternalTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema as InternalTool["parameters"],
  };
}

/**
 * Convert internal tool to Anthropic tool
 */
function internalToolToAnthropic(tool: InternalTool): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  };
}

/**
 * Convert Anthropic content block to internal
 */
function anthropicContentToInternal(block: AnthropicContentBlock): InternalContentBlock {
  switch (block.type) {
    case "text":
      return {
        type: "text",
        text: block.text,
        cacheControl: block.cache_control?.type === "ephemeral" ? "ephemeral" : undefined,
      };
    case "thinking":
      return {
        type: "thinking",
        text: block.thinking,
      };
    case "redacted_thinking":
      return {
        type: "thinking",
        text: "[redacted thinking]",
      };
    case "image":
      return {
        type: "image",
        image: { url: (block.source as { url?: string })?.url || "" },
      };
    case "tool_use":
      return {
        type: "tool_call",
        toolCall: {
          id: block.id,
          name: block.name,
          arguments: block.input,
        },
      };
    case "tool_result":
      return {
        type: "tool_result",
        toolResult: {
          toolCallId: block.tool_use_id,
          content: typeof block.content === "string" 
            ? block.content 
            : block.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map(c => c.text).join(""),
          isError: block.is_error,
        },
      };
    default:
      return { type: "text", text: "" };
  }
}

/**
 * Convert internal content block to Anthropic
 */
function internalContentToAnthropic(block: InternalContentBlock): AnthropicContentBlock {
  switch (block.type) {
    case "text":
      return {
        type: "text",
        text: block.text || "",
        ...(block.cacheControl ? { cache_control: { type: "ephemeral" } } : {}),
      };
    case "image":
      // Anthropic only supports base64 images, not URLs
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: (block.image?.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp") || "image/jpeg",
          data: block.image?.base64 || "",
        },
      };
    case "tool_call":
      return {
        type: "tool_use",
        id: block.toolCall?.id || "",
        name: block.toolCall?.name || "",
        input: block.toolCall?.arguments || {},
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolResult?.toolCallId || "",
        content: block.toolResult?.content || "",
        is_error: block.toolResult?.isError,
      };
    case "thinking":
      return {
        type: "thinking",
        thinking: block.text || "",
        signature: "",
      };
    default:
      return { type: "text", text: "" };
  }
}

/**
 * Convert Anthropic message to internal
 */
function anthropicMessageToInternal(msg: AnthropicMessage): InternalMessage {
  const content = typeof msg.content === "string" 
    ? msg.content 
    : msg.content.map(anthropicContentToInternal);

  const internalMsg: InternalMessage = {
    role: msg.role,
    content,
  };

  // Extract tool calls from content
  if (Array.isArray(content)) {
    const toolCalls = content.filter(c => c.type === "tool_call");
    if (toolCalls.length > 0) {
      internalMsg.toolCalls = toolCalls;
    }

    // Extract tool results
    const toolResults = content.filter(c => c.type === "tool_result");
    const firstToolResult = toolResults[0];
    if (firstToolResult && firstToolResult.toolResult) {
      internalMsg.toolCallId = firstToolResult.toolResult.toolCallId;
    }
  }

  return internalMsg;
}

/**
 * Convert internal message to Anthropic
 */
function internalMessageToAnthropic(msg: InternalMessage): AnthropicMessage {
  let content: string | AnthropicContentBlock[];

  if (typeof msg.content === "string") {
    content = msg.content;
  } else {
    content = msg.content.map(internalContentToAnthropic);
  }

  return {
    role: msg.role as "user" | "assistant",
    content,
  };
}

/**
 * Convert Anthropic tool choice to internal
 */
function anthropicToolChoiceToInternal(choice: AnthropicToolChoice | undefined): ToolChoice | undefined {
  if (!choice) return undefined;
  if (choice.type === "auto") return "auto";
  if (choice.type === "any") return "required";
  if (choice.type === "tool") return { name: choice.name };
  return "auto";
}

/**
 * Convert internal tool choice to Anthropic
 */
function internalToolChoiceToAnthropic(choice: ToolChoice | undefined): AnthropicToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "required") return { type: "any" };
  if (choice === "none") return undefined; // Anthropic doesn't support "none"
  return { type: "tool", name: choice.name };
}

/**
 * Parse Anthropic request to internal format
 */
export function parseAnthropicRequest(
  body: AnthropicRequest,
  metadata: InternalRequest["metadata"]
): InternalRequest {
  // Convert reasoning effort
  let reasoningEffort: InternalRequest["reasoningEffort"];
  if (body.thinking?.type === "enabled") {
    const budget = body.thinking.budget_tokens;
    if (budget !== undefined) {
      if (budget < 4000) reasoningEffort = "low";
      else if (budget < 16000) reasoningEffort = "medium";
      else reasoningEffort = "high";
    }
  }

  // Convert system
  let system: InternalRequest["system"];
  if (body.system) {
    if (typeof body.system === "string") {
      system = body.system;
    } else {
      system = body.system.map(s => ({
        type: "text",
        text: s.text,
        cacheControl: s.cache_control?.type === "ephemeral" ? "ephemeral" : undefined,
      }));
    }
  }

  return {
    model: body.model,
    messages: body.messages.map(anthropicMessageToInternal),
    system,
    maxTokens: body.max_tokens,
    temperature: body.temperature,
    topP: body.top_p,
    stream: body.stream,
    stopSequences: body.stop_sequences,
    tools: body.tools?.map(anthropicToolToInternal),
    toolChoice: anthropicToolChoiceToInternal(body.tool_choice),
    reasoningEffort,
    chatTemplateKwargs: (body as unknown as Record<string, unknown>)?.chat_template_kwargs as Record<string, unknown> | undefined,
    extensions: {
      anthropic_metadata: body.metadata,
      ...((body as unknown as Record<string, unknown>)?.chat_template_kwargs ? { 
        chat_template_kwargs: (body as unknown as Record<string, unknown>).chat_template_kwargs 
      } : {}),
    },
    metadata,
  };
}

/**
 * Convert internal request to Anthropic format
 */
export function toAnthropicRequest(request: InternalRequest): AnthropicRequest {
  const result: AnthropicRequest = {
    model: request.targetModel || request.model,
    messages: request.messages.map(internalMessageToAnthropic),
    max_tokens: request.maxTokens || 4096,
  };

  // Add system if present
  if (request.system) {
    if (typeof request.system === "string") {
      result.system = request.system;
    } else {
      result.system = request.system
        .filter((s) => s.type === "text")
        .map((s) => {
          const block = s as { type: "text"; text?: string; cacheControl?: string };
          return {
            type: "text" as const,
            text: block.text || "",
            ...(block.cacheControl ? { cache_control: { type: "ephemeral" } } : {}),
          };
        });
    }
  }

  if (request.temperature !== undefined) result.temperature = request.temperature;
  if (request.topP !== undefined) result.top_p = request.topP;
  if (request.stream) result.stream = request.stream;
  if (request.stopSequences) result.stop_sequences = request.stopSequences;
  if (request.tools) result.tools = request.tools.map(internalToolToAnthropic);
  if (request.toolChoice) result.tool_choice = internalToolChoiceToAnthropic(request.toolChoice);

  // Convert reasoning effort back to thinking config
  if (request.reasoningEffort) {
    if (typeof request.reasoningEffort === "string") {
      const budgetMap = { low: 4000, medium: 16000, high: 32000 };
      result.thinking = {
        type: "enabled",
        budget_tokens: budgetMap[request.reasoningEffort],
      };
    } else {
      result.thinking = {
        type: "enabled",
        budget_tokens: request.reasoningEffort.budgetTokens,
      };
    }
  }

  return result;
}

/**
 * Parse Anthropic response to internal format
 */
export function parseAnthropicResponse(data: AnthropicResponse): InternalResponse {
  const content = Array.isArray(data.content) 
    ? data.content.map(anthropicContentToInternal)
    : [{ type: "text" as const, text: data.content }];

  // Map stop reason
  let stopReason: InternalResponse["stopReason"] = null;
  if (data.stop_reason === "end_turn") stopReason = "end_turn";
  else if (data.stop_reason === "tool_use") stopReason = "tool_use";
  else if (data.stop_reason === "max_tokens") stopReason = "max_tokens";
  // Note: Anthropic doesn't have "content_filter" stop reason

  // Extract tool calls
  const toolCalls = content.filter(c => c.type === "tool_call");

  return {
    id: data.id,
    model: data.model,
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    stopReason,
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      cacheCreationInputTokens: data.usage.cache_creation_input_tokens,
      cacheReadInputTokens: data.usage.cache_read_input_tokens,
    } : undefined,
  };
}

/**
 * Convert internal response to Anthropic format
 */
export function toAnthropicResponse(response: InternalResponse): AnthropicResponse {
  const content = response.content.map(internalContentToAnthropic);

  // Append tool calls to content (Anthropic format requires tool_use blocks in the content array)
  if (response.toolCalls) {
    for (const tc of response.toolCalls) {
      // Only add if not already in content (avoid duplicates)
      const alreadyInContent = content.some(
        (c) => c.type === "tool_use" && c.id === tc.toolCall?.id
      );
      if (!alreadyInContent) {
        content.push(internalContentToAnthropic(tc));
      }
    }
  }

  // Map stop reason back
  let stopReason: AnthropicResponse["stop_reason"] = "end_turn";
  if (response.stopReason === "end_turn") stopReason = "end_turn";
  else if (response.stopReason === "tool_use") stopReason = "tool_use";
  else if (response.stopReason === "max_tokens") stopReason = "max_tokens";
  // Note: No content_filter in Anthropic

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason: stopReason,
    stop_sequence: response.stopSequence ?? undefined,
    usage: response.usage ? {
      input_tokens: response.usage.promptTokens,
      output_tokens: response.usage.completionTokens,
      cache_creation_input_tokens: response.usage.cacheCreationInputTokens,
      cache_read_input_tokens: response.usage.cacheReadInputTokens,
    } : { input_tokens: 0, output_tokens: 0 },
  };
}

/**
 * Create Anthropic streaming chunks
 */
export function createAnthropicStreamEvent(
  type: string,
  data: Record<string, unknown>
): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

/**
 * Parse Anthropic streaming event
 */
export function parseAnthropicStreamEvent(line: string): InternalStreamChunk | null {
  if (!line.startsWith("data: ")) return null;
  
  const json = line.slice(6).trim();
  if (json === "[DONE]") {
    return { index: 0, delta: { type: "text", text: "" }, isComplete: true };
  }

  try {
    const event = JSON.parse(json);
    
    switch (event.type) {
      case "content_block_delta":
        if (event.delta?.type === "text_delta") {
          return {
            index: event.index || 0,
            delta: { type: "text", text: event.delta.text },
          };
        } else if (event.delta?.type === "thinking_delta") {
          return {
            index: event.index || 0,
            delta: { type: "thinking", text: event.delta.thinking },
          };
        } else if (event.delta?.type === "signature_delta") {
          // Signature deltas don't contain thinking text, ignore for now
          return null;
        } else if (event.delta?.type === "input_json_delta") {
          return {
            index: event.index || 0,
            delta: { 
              type: "tool_call", 
              toolCall: { 
                id: "", 
                name: "", 
                arguments: {}, 
                argumentsJson: event.delta.partial_json 
              } 
            },
          };
        }
        break;
      
      case "message_delta":
        return {
          index: 0,
          delta: { type: "text", text: "" },
          finishReason: event.delta?.stop_reason,
          usage: event.usage ? {
            promptTokens: 0,
            completionTokens: event.usage.output_tokens,
            totalTokens: event.usage.output_tokens,
          } : undefined,
          isComplete: true,
        };
      
      case "message_stop":
        return {
          index: 0,
          delta: { type: "text", text: "" },
          isComplete: true,
        };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Convert internal stream chunk to Anthropic SSE format
 */
export function toAnthropicStreamChunk(chunk: InternalStreamChunk): string {
  if (chunk.isComplete) {
    if (chunk.finishReason) {
      return createAnthropicStreamEvent("message_delta", {
        delta: { stop_reason: chunk.finishReason },
        usage: chunk.usage ? { output_tokens: chunk.usage.completionTokens } : undefined,
      });
    }
    return createAnthropicStreamEvent("message_stop", {});
  }

  const index = chunk.index;

  if (chunk.delta.type === "text") {
    return createAnthropicStreamEvent("content_block_delta", {
      index,
      delta: { type: "text_delta", text: chunk.delta.text || "" },
    });
  }

  if (chunk.delta.type === "thinking") {
    return createAnthropicStreamEvent("content_block_delta", {
      index,
      delta: { type: "thinking_delta", thinking: chunk.delta.text || "" },
    });
  }

  if (chunk.delta.type === "tool_call" && chunk.delta.toolCall) {
    if (chunk.delta.toolCall.argumentsJson) {
      return createAnthropicStreamEvent("content_block_delta", {
        index,
        delta: { type: "input_json_delta", partial_json: chunk.delta.toolCall.argumentsJson },
      });
    }
    return createAnthropicStreamEvent("content_block_start", {
      index,
      content_block: {
        type: "tool_use",
        id: chunk.delta.toolCall.id,
        name: chunk.delta.toolCall.name,
        input: {},
      },
    });
  }

  return "";
}

/**
 * Create initial Anthropic stream events
 */
export function createAnthropicStreamStart(
  messageId: string,
  usage?: { input_tokens?: number }
): string {
  const lines: string[] = [];
  
  lines.push(createAnthropicStreamEvent("message_start", {
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      model: "claude-3",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: usage?.input_tokens || 0, output_tokens: 0 },
    },
  }));
  
  lines.push(createAnthropicStreamEvent("content_block_start", {
    index: 0,
    content_block: { type: "text", text: "" },
  }));

  return lines.join("");
}

/**
 * Create final Anthropic stream events
 */
export function createAnthropicStreamStop(
  stopReason: string | null,
  outputTokens: number
): string {
  const lines: string[] = [];
  
  lines.push(createAnthropicStreamEvent("content_block_stop", { index: 0 }));
  
  lines.push(createAnthropicStreamEvent("message_delta", {
    delta: { stop_reason: stopReason },
    usage: { output_tokens: outputTokens },
  }));
  
  lines.push(createAnthropicStreamEvent("message_stop", {}));

  return lines.join("");
}
