// ============================================================================
// OpenAI Format Transformer - Comprehensive implementation
// ============================================================================

import type {
  InternalRequest,
  InternalResponse,
  InternalMessage,
  InternalContentBlock,
  InternalTool,
  ToolChoice,
  ResponseFormat,
  TokenUsage,
  LogprobInfo,
} from "../types/internal.ts";
import type { OpenAIRequest, OpenAIResponse, OpenAIChatMessage, OpenAITool, OpenAIToolCall } from "../types/index.ts";

// ============================================================================
// Content Block Transformations
// ============================================================================

/**
 * Convert OpenAI content to internal content blocks
 */
function openAIContentToInternal(
  content: string | null | Array<{ 
    type: "text"; 
    text: string 
  } | { 
    type: "image_url"; 
    image_url: { url: string; detail?: string } 
  } | {
    type: "input_audio";
    input_audio: { data: string; format: string }
  } | {
    type: "file";
    file?: { file_data?: string; filename?: string; file_id?: string }
  }>
): string | InternalContentBlock[] {
  if (content === null) return "";
  if (typeof content === "string") return content;
  
  return content.map((item): InternalContentBlock => {
    switch (item.type) {
      case "text":
        return { type: "text", text: item.text };
      case "image_url":
        return {
          type: "image",
          image: {
            url: item.image_url.url,
          },
        };
      case "input_audio":
        return {
          type: "audio",
          audio: {
            base64: item.input_audio.data,
            mimeType: item.input_audio.format === "mp3" ? "audio/mpeg" : `audio/${item.input_audio.format}`,
          },
        };
      case "file":
        // Handle file data
        if (item.file?.file_data) {
          return {
            type: "text",
            text: `[File: ${item.file.filename || "unnamed"}]`,
          };
        }
        return { type: "text", text: "" };
      default:
        return { type: "text", text: "" };
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
  
  return content.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "text" as const, text: block.text || "" };
      case "image":
        return { type: "image_url" as const, image_url: { url: block.image?.url || "" } };
      case "thinking":
        // Thinking blocks are handled separately
        return { type: "text" as const, text: "" };
      default:
        return { type: "text" as const, text: "" };
    }
  });
}

// ============================================================================
// Tool Transformations
// ============================================================================

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
 * Convert OpenAI tool choice to internal tool choice
 */
function openAIToolChoiceToInternal(
  choice: "auto" | "required" | "none" | { type: "function"; function: { name: string } } | undefined
): ToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto" || choice === "required" || choice === "none") return choice;
  return { name: choice.function.name };
}

/**
 * Convert internal tool choice to OpenAI tool choice
 */
function internalToolChoiceToOpenAI(
  choice: ToolChoice | undefined
): "auto" | "required" | "none" | { type: "function"; function: { name: string } } | undefined {
  if (!choice) return undefined;
  if (choice === "auto" || choice === "required" || choice === "none") return choice;
  return { type: "function", function: { name: choice.name } };
}

// ============================================================================
// Response Format Transformations
// ============================================================================

/**
 * Convert OpenAI response format to internal response format
 */
function openAIResponseFormatToInternal(
  format: { type: "text" } | { type: "json_object" } | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } } | undefined
): ResponseFormat | undefined {
  if (!format) return undefined;
  if (format.type === "text") return { type: "text" };
  if (format.type === "json_object") return { type: "json" };
  return { type: "json", schema: format.json_schema.schema };
}

/**
 * Convert internal response format to OpenAI response format
 */
function internalResponseFormatToOpenAI(
  format: ResponseFormat | undefined
): { type: "text" } | { type: "json_object" } | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown> } } | undefined {
  if (!format) return undefined;
  if (format.type === "text") return { type: "text" };
  if (format.schema) {
    return {
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: format.schema,
      },
    };
  }
  return { type: "json_object" };
}

// ============================================================================
// Message Transformations
// ============================================================================

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
 * Convert internal message to OpenAI message
 */
function internalMessageToOpenAI(msg: InternalMessage): OpenAIChatMessage {
  const openAIMsg: OpenAIChatMessage = {
    role: msg.role,
    content: internalContentToOpenAI(msg.content),
    name: msg.name,
  };

  // Handle tool calls
  if (msg.toolCalls) {
    openAIMsg.tool_calls = msg.toolCalls
      .filter((tc) => tc.type === "tool_call")
      .map((tc, index): OpenAIToolCall => ({
        id: tc.toolCall?.id || `call_${index}`,
        type: "function",
        function: {
          name: tc.toolCall?.name || "",
          arguments: tc.toolCall?.argumentsJson || JSON.stringify(tc.toolCall?.arguments || {}),
        },
      }));
  }

  // Handle tool call ID
  if (msg.toolCallId) {
    openAIMsg.tool_call_id = msg.toolCallId;
  }

  return openAIMsg;
}

// ============================================================================
// Logprob Transformations
// ============================================================================

/**
 * Parse OpenAI logprobs to internal format
 */
function parseOpenAILogprobs(logprobs: {
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
} | null | undefined): LogprobInfo[] | undefined {
  if (!logprobs?.content) return undefined;
  
  return logprobs.content.map((item) => ({
    token: item.token,
    logprob: item.logprob,
    bytes: item.bytes,
    topLogprobs: item.top_logprobs?.map((top) => ({
      token: top.token,
      logprob: top.logprob,
      bytes: top.bytes,
    })),
  }));
}

/**
 * Convert internal logprobs to OpenAI format
 */
function internalLogprobsToOpenAI(logprobs: LogprobInfo[] | undefined): {
  content: Array<{
    token: string;
    logprob: number;
    bytes?: number[];
    top_logprobs?: Array<{
      token: string;
      logprob: number;
      bytes?: number[];
    }>;
  }>;
} | undefined {
  if (!logprobs) return undefined;
  
  return {
    content: logprobs.map((item) => ({
      token: item.token,
      logprob: item.logprob,
      bytes: item.bytes,
      top_logprobs: item.topLogprobs?.map((top) => ({
        token: top.token,
        logprob: top.logprob,
        bytes: top.bytes,
      })),
    })),
  };
}

// ============================================================================
// Request Transformations
// ============================================================================

/**
 * Parse OpenAI request to internal format
 */
export function parseOpenAIRequest(
  body: OpenAIRequest,
  metadata: InternalRequest["metadata"]
): InternalRequest {
  // Extract system message if present
  const systemMessages = body.messages.filter((m) => m.role === "system");
  const chatMessages = body.messages.filter((m) => m.role !== "system");

  const system = systemMessages.length > 0
    ? systemMessages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n")
    : undefined;

  // Build extensions from various passthrough parameters
  const extensions: Record<string, unknown> = {};
  if (body.chat_template_kwargs) {
    extensions.chat_template_kwargs = body.chat_template_kwargs;
    if (body.chat_template_kwargs.enable_thinking !== undefined) {
      extensions.enable_thinking = body.chat_template_kwargs.enable_thinking;
    }
  }
  if (body.extra_body) {
    extensions.extra_body = body.extra_body;
  }
  if (body.extra_headers) {
    extensions.extra_headers = body.extra_headers;
  }
  if (body.extra_query) {
    extensions.extra_query = body.extra_query;
  }
  if (body.metadata) {
    extensions.metadata = body.metadata;
  }

  return {
    model: body.model,
    messages: chatMessages.map(openAIMessageToInternal),
    system,
    
    // Core parameters
    maxTokens: body.max_tokens ?? body.max_completion_tokens ?? undefined,
    maxCompletionTokens: body.max_completion_tokens ?? undefined,
    temperature: body.temperature ?? undefined,
    topP: body.top_p ?? undefined,
    stream: body.stream ?? undefined,
    stopSequences: body.stop ? (Array.isArray(body.stop) ? body.stop : [body.stop]) : undefined,
    
    // Tool parameters
    tools: body.tools?.map(openAIToolToInternal),
    toolChoice: openAIToolChoiceToInternal(body.tool_choice),
    parallelToolCalls: body.parallel_tool_calls ?? undefined,
    
    // Response format
    responseFormat: openAIResponseFormatToInternal(body.response_format),
    modalities: body.modalities ?? undefined,
    
    // Sampling parameters
    frequencyPenalty: body.frequency_penalty ?? undefined,
    presencePenalty: body.presence_penalty ?? undefined,
    seed: body.seed ?? undefined,
    n: body.n ?? undefined,
    logitBias: body.logit_bias ?? undefined,
    logprobs: body.logprobs ?? undefined,
    topLogprobs: body.top_logprobs ?? undefined,
    
    // Reasoning parameters
    reasoningEffort: body.reasoning_effort ?? undefined,
    
    // Extensions
    chatTemplateKwargs: body.chat_template_kwargs ?? undefined,
    prediction: body.prediction ?? undefined,
    
    // Passthrough
    extraBody: body.extra_body ?? undefined,
    extraHeaders: body.extra_headers ?? undefined,
    extraQuery: body.extra_query ?? undefined,
    
    // Metadata
    user: body.user ?? undefined,
    extensions: Object.keys(extensions).length > 0 ? extensions : undefined,
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
      const systemText = request.system
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text?: string }).text || "")
        .join("\n");
      messages.push({ role: "system", content: systemText });
    }
  }

  // Add chat messages
  messages.push(...request.messages.map(internalMessageToOpenAI));

  const result: OpenAIRequest = {
    model: request.targetModel || request.model,
    messages,
  };

  // Core parameters
  if (request.maxTokens !== undefined) result.max_tokens = request.maxTokens;
  if (request.maxCompletionTokens !== undefined) result.max_completion_tokens = request.maxCompletionTokens;
  if (request.temperature !== undefined) result.temperature = request.temperature;
  if (request.topP !== undefined) result.top_p = request.topP;
  if (request.stream !== undefined) result.stream = request.stream;
  if (request.stopSequences !== undefined) result.stop = request.stopSequences;
  
  // Tool parameters
  if (request.tools !== undefined) result.tools = request.tools.map(internalToolToOpenAI);
  if (request.toolChoice !== undefined) result.tool_choice = internalToolChoiceToOpenAI(request.toolChoice);
  if (request.parallelToolCalls !== undefined) result.parallel_tool_calls = request.parallelToolCalls;
  
  // Response format
  if (request.responseFormat !== undefined) result.response_format = internalResponseFormatToOpenAI(request.responseFormat);
  if (request.modalities !== undefined) result.modalities = request.modalities;
  
  // Sampling parameters
  if (request.frequencyPenalty !== undefined) result.frequency_penalty = request.frequencyPenalty;
  if (request.presencePenalty !== undefined) result.presence_penalty = request.presencePenalty;
  if (request.seed !== undefined) result.seed = request.seed;
  if (request.n !== undefined) result.n = request.n;
  if (request.logitBias !== undefined) result.logit_bias = request.logitBias;
  if (request.logprobs !== undefined) result.logprobs = request.logprobs;
  if (request.topLogprobs !== undefined) result.top_logprobs = request.topLogprobs;
  
  // Reasoning parameters
  if (request.reasoningEffort !== undefined && typeof request.reasoningEffort === "string") {
    result.reasoning_effort = request.reasoningEffort;
  }
  
  // Extensions
  if (request.chatTemplateKwargs !== undefined) result.chat_template_kwargs = request.chatTemplateKwargs;
  if (request.prediction !== undefined) result.prediction = request.prediction;
  
  // Passthrough from extensions
  if (request.extensions?.extra_body) {
    result.extra_body = request.extensions.extra_body as Record<string, unknown>;
  }
  if (request.extensions?.extra_headers) {
    result.extra_headers = request.extensions.extra_headers as Record<string, string>;
  }
  if (request.extensions?.extra_query) {
    result.extra_query = request.extensions.extra_query as Record<string, string>;
  }
  
  // Metadata
  if (request.user !== undefined) result.user = request.user;

  return result;
}

// ============================================================================
// Response Transformations
// ============================================================================

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
      content.push(
        ...message.content.map((c): InternalContentBlock =>
          c.type === "text" ? { type: "text", text: c.text } : { type: "image", image: { url: c.image_url?.url || "" } }
        )
      );
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

  // Build extensions
  const extensions: Record<string, unknown> = {};
  if (message?.reasoning_content) {
    extensions.reasoning_content = message.reasoning_content;
  }
  if (choice?.logprobs) {
    extensions.logprobs = choice.logprobs;
  }
  if (data.system_fingerprint) {
    extensions.system_fingerprint = data.system_fingerprint;
  }

  return {
    id: data.id,
    model: data.model,
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    stopReason,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
          reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens,
        }
      : undefined,
    logprobs: parseOpenAILogprobs(choice?.logprobs),
    systemFingerprint: data.system_fingerprint,
    reasoningContent: message?.reasoning_content,
    extensions: Object.keys(extensions).length > 0 ? extensions : undefined,
  };
}

/**
 * Convert internal response to OpenAI format
 */
export function toOpenAIResponse(response: InternalResponse): OpenAIResponse {
  // Convert content blocks to text
  const textContent = response.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");

  // Convert tool calls
  const toolCalls = response.toolCalls
    ?.filter((tc) => tc.type === "tool_call")
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

  // Build message with reasoning_content if present
  const message: OpenAIChatMessage = {
    role: "assistant",
    content: textContent || null,
    tool_calls: toolCalls,
  };

  // Include reasoning_content from extensions or direct field
  if (response.reasoningContent) {
    message.reasoning_content = response.reasoningContent;
  } else if (response.extensions?.reasoning_content) {
    message.reasoning_content = response.extensions.reasoning_content as string;
  }

  // Build choices
  const choices: OpenAIResponse["choices"] = [{
    index: 0,
    message,
    finish_reason: finishReason,
  }];

  // Add logprobs if present
  const logprobs = response.logprobs ? internalLogprobsToOpenAI(response.logprobs) : undefined;
  if (logprobs) {
    choices[0].logprobs = logprobs;
  }

  return {
    id: response.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices,
    usage: response.usage
      ? {
          prompt_tokens: response.usage.promptTokens,
          completion_tokens: response.usage.completionTokens,
          total_tokens: response.usage.totalTokens,
          completion_tokens_details: response.usage.reasoningTokens
            ? { reasoning_tokens: response.usage.reasoningTokens }
            : undefined,
        }
      : undefined,
    system_fingerprint: response.systemFingerprint,
  };
}

// ============================================================================
// Streaming Transformations
// ============================================================================

import type { InternalStreamChunk } from "../types/internal.ts";

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

  // Handle reasoning_content in streaming (e.g., from DeepSeek)
  const reasoningContent = delta.reasoning_content as string | undefined;
  if (reasoningContent) {
    deltaContent.push({ type: "thinking", text: reasoningContent });
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

  // Parse logprobs if present
  const chunkLogprobs = choice.logprobs as {
    content?: Array<{
      token: string;
      logprob: number;
      bytes?: number[];
      top_logprobs?: Array<{ token: string; logprob: number; bytes?: number[] }>;
    }>;
  } | null | undefined;

  return {
    index,
    delta: deltaContent[0] || { type: "text", text: "" },
    finishReason,
    isComplete,
    logprobs: parseOpenAILogprobs(chunkLogprobs),
    reasoningContent,
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
    choices: [
      {
        index: chunk.index,
        delta: {},
        finish_reason: chunk.finishReason,
      },
    ],
  };

  const choices = data.choices as Array<{
    index?: number;
    delta: Record<string, unknown>;
    finish_reason?: string | null;
    logprobs?: unknown;
  }>;
  const delta = choices[0]!.delta;

  if (chunk.delta.type === "text" && chunk.delta.text) {
    delta.content = chunk.delta.text;
  }

  if (chunk.delta.type === "tool_call" && chunk.delta.toolCall) {
    delta.tool_calls = [
      {
        index: 0,
        id: chunk.delta.toolCall.id,
        type: "function",
        function: {
          name: chunk.delta.toolCall.name,
          arguments: chunk.delta.toolCall.argumentsJson || JSON.stringify(chunk.delta.toolCall.arguments),
        },
      },
    ];
  }

  // Include reasoning_content if present
  if (chunk.reasoningContent) {
    delta.reasoning_content = chunk.reasoningContent;
  }

  // Include logprobs if present
  if (chunk.logprobs) {
    choices[0].logprobs = internalLogprobsToOpenAI(chunk.logprobs);
  }

  return `data: ${JSON.stringify(data)}\n\n`;
}
