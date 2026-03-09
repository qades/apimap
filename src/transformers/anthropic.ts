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
  const { $schema, ...parameters } = tool.input_schema;
  return {
    name: tool.name,
    description: tool.description,
    parameters: parameters as InternalTool["parameters"],
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
      return {
        type: "image",
        source: block.image?.url 
          ? { type: "url", url: block.image.url }
          : { type: "base64", media_type: block.image?.mimeType || "image/jpeg", data: block.image?.base64 || "" },
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
      // Anthropic doesn't have explicit thinking blocks in API yet
      return { type: "text", text: "" };
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
    if (toolResults.length > 0 && toolResults[0].toolResult) {
      internalMsg.toolCallId = toolResults[0].toolResult.toolCallId;
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
    role: msg.role,
    content,
  };
}

/**
 * Convert Anthropic tool choice to internal
 */
function anthropicToolChoiceToInternal(choice: AnthropicToolChoice | undefined): ToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto" || choice === "any") {
    return choice === "any" ? "required" : "auto";
  }
  if (typeof choice === "object" && choice.type === "tool") {
    return { name: choice.name };
  }
  return "auto";
}

/**
 * Convert internal tool choice to Anthropic
 */
function internalToolChoiceToAnthropic(choice: ToolChoice | undefined): AnthropicToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto") return "auto";
  if (choice === "required") return "any";
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
    if (budget < 4000) reasoningEffort = "low";
    else if (budget < 16000) reasoningEffort = "medium";
    else reasoningEffort = "high";
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
    extensions: {
      anthropic_metadata: body.metadata,
      anthropic_output_config: body.output_config,
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
        .filter((s): s is Extract<typeof s, { type: "text" }> => s.type === "text")
        .map(s => ({
          type: "text",
          text: s.text || "",
          ...(s.cacheControl ? { cache_control: { type: "ephemeral" } } : {}),
        }));
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
  else if (data.stop_reason === "content_filter") stopReason = "content_filter";

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

  // Map stop reason back
  let stopReason: string | null = null;
  if (response.stopReason === "end_turn") stopReason = "end_turn";
  else if (response.stopReason === "tool_use") stopReason = "tool_use";
  else if (response.stopReason === "max_tokens") stopReason = "max_tokens";
  else if (response.stopReason === "content_filter") stopReason = "content_filter";

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason: stopReason,
    stop_sequence: response.stopSequence ?? null,
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
