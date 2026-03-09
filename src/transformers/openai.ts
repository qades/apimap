// ============================================================================
// OpenAI Format Transformer
// ============================================================================

import type {
  InternalRequest,
  InternalResponse,
  InternalMessage,
  InternalContentBlock,
  InternalStreamChunk,
  InternalTool,
  ToolChoice,
  ResponseFormat,
  TokenUsage,
} from "../types/internal.ts";
import type { OpenAIRequest, OpenAIResponse, OpenAIChatMessage, OpenAITool, OpenAIToolCall } from "../types/index.ts";

/**
 * Convert OpenAI tool to internal tool
 */
function openAIToolToInternal(tool: OpenAITool): InternalTool {
  return {
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters as InternalTool["parameters"],
  };
}

/**
 * Convert internal tool to OpenAI tool
 */
function internalToolToOpenAI(tool: InternalTool): OpenAITool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * Convert OpenAI message content to internal content blocks
 */
function openAIContentToInternal(
  content: string | null | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>
): string | InternalContentBlock[] {
  if (content === null) return "";
  if (typeof content === "string") return content;
  
  return content.map((item): InternalContentBlock => {
    if (item.type === "text") {
      return { type: "text", text: item.text };
    } else {
      return {
        type: "image",
        image: {
          url: item.image_url.url,
        },
      };
    }
  });
}

/**
 * Convert internal content blocks to OpenAI format
 */
function internalContentToOpenAI(
  content: string | InternalContentBlock[]
): string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  if (typeof content === "string") return content;
  
  return content.map((block): { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } => {
    if (block.type === "text") {
      return { type: "text", text: block.text || "" };
    } else if (block.type === "image") {
      return { type: "image_url", image_url: { url: block.image?.url || "" } };
    }
    // Other types become empty text in OpenAI
    return { type: "text", text: "" };
  });
}

/**
 * Convert OpenAI message to internal message
 */
function openAIMessageToInternal(msg: OpenAIChatMessage): InternalMessage {
  const internalMsg: InternalMessage = {
    role: msg.role,
    content: openAIContentToInternal(msg.content),
    name: msg.name,
  };

  // Handle tool calls
  if (msg.tool_calls) {
    internalMsg.toolCalls = msg.tool_calls.map((tc): InternalContentBlock => ({
      type: "tool_call",
      toolCall: {
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}"),
        argumentsJson: tc.function.arguments,
      },
    }));
  }

  // Handle tool call ID
  if (msg.tool_call_id) {
    internalMsg.toolCallId = msg.tool_call_id;
  }

  return internalMsg;
}

/**
 * Convert internal message to OpenAI format
 */
function internalMessageToOpenAI(msg: InternalMessage): OpenAIChatMessage {
  const openAIMsg: OpenAIChatMessage = {
    role: msg.role,
    content: internalContentToOpenAI(msg.content),
  };

  if (msg.name) {
    openAIMsg.name = msg.name;
  }

  // Handle tool calls
  if (msg.toolCalls) {
    openAIMsg.tool_calls = msg.toolCalls
      .filter(tc => tc.type === "tool_call")
      .map((tc): OpenAIToolCall => ({
        id: tc.toolCall?.id || "",
        type: "function",
        function: {
          name: tc.toolCall?.name || "",
          arguments: tc.toolCall?.argumentsJson || JSON.stringify(tc.toolCall?.arguments || {}),
        },
      }));
  }

  if (msg.toolCallId) {
    openAIMsg.tool_call_id = msg.toolCallId;
  }

  return openAIMsg;
}

/**
 * Convert OpenAI tool choice to internal
 */
function openAIToolChoiceToInternal(
  choice: "auto" | "required" | "none" | { type: "function"; function: { name: string } } | undefined
): ToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto" || choice === "required" || choice === "none") return choice;
  if (typeof choice === "object" && choice.type === "function") {
    return { name: choice.function.name };
  }
  return "auto";
}

/**
 * Convert internal tool choice to OpenAI
 */
function internalToolChoiceToOpenAI(choice: ToolChoice | undefined): OpenAIRequest["tool_choice"] {
  if (!choice) return undefined;
  if (choice === "auto" || choice === "required" || choice === "none") return choice;
  return { type: "function", function: { name: choice.name } };
}

/**
 * Convert OpenAI response format to internal
 */
function openAIResponseFormatToInternal(
  format: { type: "text" } | { type: "json_object" } | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } } | undefined
): ResponseFormat | undefined {
  if (!format) return undefined;
  if (format.type === "text") return { type: "text" };
  if (format.type === "json_schema") {
    return { type: "json", schema: format.json_schema.schema };
  }
  // json_object becomes generic json
  return { type: "json" };
}

/**
 * Convert internal response format to OpenAI
 */
function internalResponseFormatToOpenAI(format: ResponseFormat | undefined): OpenAIRequest["response_format"] {
  if (!format) return undefined;
  if (format.type === "text") return { type: "text" };
  return {
    type: "json_schema",
    json_schema: {
      name: "response",
      schema: format.schema || { type: "object" },
      strict: true,
    },
  };
}

/**
 * Parse OpenAI request to internal format
 */
export function parseOpenAIRequest(
  body: OpenAIRequest,
  metadata: InternalRequest["metadata"]
): InternalRequest {
  // Extract system message if present
  const systemMessages = body.messages.filter(m => m.role === "system");
  const chatMessages = body.messages.filter(m => m.role !== "system");
  
  const system = systemMessages.length > 0 
    ? systemMessages.map(m => typeof m.content === "string" ? m.content : "").join("\n")
    : undefined;

  return {
    model: body.model,
    messages: chatMessages.map(openAIMessageToInternal),
    system,
    maxTokens: body.max_tokens ?? body.max_completion_tokens,
    temperature: body.temperature,
    topP: body.top_p,
    stream: body.stream,
    stopSequences: body.stop,
    tools: body.tools?.map(openAIToolToInternal),
    toolChoice: openAIToolChoiceToInternal(body.tool_choice),
    responseFormat: openAIResponseFormatToInternal(body.response_format),
    reasoningEffort: body.reasoning_effort,
    metadata,
  };
}

/**
 * Convert internal request to OpenAI format
 */
export function toOpenAIRequest(request: InternalRequest): OpenAIRequest {
  const messages: OpenAIChatMessage[] = [];

  // Add system message
  if (request.system) {
    if (typeof request.system === "string") {
      messages.push({ role: "system", content: request.system });
    } else {
      // Convert content blocks to text
      const systemText = request.system
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map(b => b.text)
        .join("\n");
      messages.push({ role: "system", content: systemText });
    }
  }

  // Add chat messages
  messages.push(...request.messages.map(internalMessageToOpenAI));

  const result: OpenAIRequest = {
    model: request.targetModel || request.model,
    messages,
    stream: request.stream,
  };

  if (request.maxTokens) result.max_tokens = request.maxTokens;
  if (request.temperature !== undefined) result.temperature = request.temperature;
  if (request.topP !== undefined) result.top_p = request.topP;
  if (request.stopSequences) result.stop = request.stopSequences;
  if (request.tools) result.tools = request.tools.map(internalToolToOpenAI);
  if (request.toolChoice) result.tool_choice = internalToolChoiceToOpenAI(request.toolChoice);
  if (request.responseFormat) result.response_format = internalResponseFormatToOpenAI(request.responseFormat);
  if (request.reasoningEffort && typeof request.reasoningEffort === "string") {
    result.reasoning_effort = request.reasoningEffort;
  }

  return result;
}

/**
 * Parse OpenAI response to internal format
 */
export function parseOpenAIResponse(data: OpenAIResponse): InternalResponse {
  const choice = data.choices?.[0];
  const message = choice?.message || choice?.delta;

  const content: InternalContentBlock[] = [];

  // Handle text content
  if (message?.content) {
    if (typeof message.content === "string") {
      content.push({ type: "text", text: message.content });
    } else {
      content.push(...message.content.map((c): InternalContentBlock => 
        c.type === "text" 
          ? { type: "text", text: c.text }
          : { type: "image", image: { url: c.image_url.url } }
      ));
    }
  }

  // Handle tool calls
  const toolCalls: InternalContentBlock[] = [];
  if (message?.tool_calls) {
    for (const tc of message.tool_calls) {
      toolCalls.push({
        type: "tool_call",
        toolCall: {
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || "{}"),
          argumentsJson: tc.function.arguments,
        },
      });
    }
  }

  // Map stop reason
  let stopReason: InternalResponse["stopReason"] = null;
  const finishReason = choice?.finish_reason;
  if (finishReason === "stop") stopReason = "end_turn";
  else if (finishReason === "tool_calls") stopReason = "tool_use";
  else if (finishReason === "length") stopReason = "max_tokens";
  else if (finishReason === "content_filter") stopReason = "content_filter";

  return {
    id: data.id,
    model: data.model,
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    stopReason,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

/**
 * Convert internal response to OpenAI format
 */
export function toOpenAIResponse(response: InternalResponse): OpenAIResponse {
  // Convert content blocks to text
  const textContent = response.content
    .filter(c => c.type === "text")
    .map(c => c.text)
    .join("");

  // Convert tool calls
  const toolCalls = response.toolCalls
    ?.filter(tc => tc.type === "tool_call")
    .map((tc, index): OpenAIToolCall => ({
      id: tc.toolCall?.id || `call_${index}`,
      type: "function",
      function: {
        name: tc.toolCall?.name || "",
        arguments: tc.toolCall?.argumentsJson || JSON.stringify(tc.toolCall?.arguments || {}),
      },
    }));

  // Map stop reason back
  let finishReason: string | null = null;
  if (response.stopReason === "end_turn") finishReason = "stop";
  else if (response.stopReason === "tool_use") finishReason = "tool_calls";
  else if (response.stopReason === "max_tokens") finishReason = "length";
  else if (response.stopReason === "content_filter") finishReason = "content_filter";

  return {
    id: response.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: textContent || null,
        tool_calls: toolCalls,
      },
      finish_reason: finishReason,
    }],
    usage: response.usage ? {
      prompt_tokens: response.usage.promptTokens,
      completion_tokens: response.usage.completionTokens,
      total_tokens: response.usage.totalTokens,
    } : undefined,
  };
}

/**
 * Parse OpenAI streaming chunk to internal format
 */
export function parseOpenAIStreamChunk(data: Record<string, unknown>): InternalStreamChunk | null {
  const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
  if (!choice) return null;

  const delta = choice.delta as Record<string, unknown>;
  if (!delta) return null;

  const index = (choice.index as number) || 0;
  const deltaContent: InternalContentBlock[] = [];

  // Handle text content
  if (typeof delta.content === "string") {
    deltaContent.push({ type: "text", text: delta.content });
  }

  // Handle tool calls
  const toolCalls = delta.tool_calls as Array<Record<string, unknown>>;
  if (toolCalls?.length) {
    for (const tc of toolCalls) {
      const func = tc.function as Record<string, string>;
      if (func) {
        deltaContent.push({
          type: "tool_call",
          toolCall: {
            id: (tc.id as string) || "",
            name: func.name || "",
            arguments: {},
            argumentsJson: func.arguments || "",
          },
        });
      }
    }
  }

  // Get finish reason
  const finishReason = choice.finish_reason as string | null;
  const isComplete = finishReason !== null && finishReason !== undefined;

  return {
    index,
    delta: deltaContent[0] || { type: "text", text: "" },
    finishReason,
    isComplete,
  };
}

/**
 * Convert internal stream chunk to OpenAI format
 */
export function toOpenAIStreamChunk(chunk: InternalStreamChunk, model: string): string {
  const data: Record<string, unknown> = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: chunk.index,
      delta: {},
      finish_reason: chunk.finishReason,
    }],
  };

  const delta = data.choices[0].delta as Record<string, unknown>;

  if (chunk.delta.type === "text" && chunk.delta.text) {
    delta.content = chunk.delta.text;
  } else if (chunk.delta.type === "tool_call" && chunk.delta.toolCall) {
    delta.tool_calls = [{
      index: chunk.index,
      id: chunk.delta.toolCall.id,
      type: "function",
      function: {
        name: chunk.delta.toolCall.name,
        arguments: chunk.delta.toolCall.argumentsJson,
      },
    }];
  }

  return `data: ${JSON.stringify(data)}\n\n`;
}
