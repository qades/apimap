// ============================================================================
// OpenAI-Compatible Provider
// Works with Groq, Together, Fireworks, Mistral, DeepSeek, and many others
// ============================================================================

import { BaseProvider } from "../base.ts";
import type { ProviderRequest } from "../types.ts";
import type { InternalRequest, InternalResponse, InternalStreamChunk } from "../../types/internal.ts";

// ============================================================================
// OpenAI Types
// ============================================================================

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<{
    type: "text";
    text: string;
  } | {
    type: "image_url";
    image_url: { url: string; detail?: string };
  } | {
    type: "input_audio";
    input_audio: { data: string; format: string };
  } | {
    type: "file";
    file?: { file_data?: string; filename?: string; file_id?: string };
  }>;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  reasoning_content?: string;
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[] | null;
  tools?: OpenAITool[];
  tool_choice?: "auto" | "required" | "none" | { type: "function"; function: { name: string } };
  parallel_tool_calls?: boolean;
  response_format?: { type: "text" } | { type: "json_object" } | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };
  modalities?: ("text" | "audio")[];
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
  n?: number;
  logit_bias?: Record<string, number>;
  logprobs?: boolean;
  top_logprobs?: number;
  reasoning_effort?: "low" | "medium" | "high";
  chat_template_kwargs?: Record<string, unknown>;
  prediction?: { type: "content"; content: string };
  extra_body?: Record<string, unknown>;
  extra_headers?: Record<string, string>;
  extra_query?: Record<string, string>;
  user?: string;
  metadata?: Record<string, string>;
}

interface OpenAICompletionRequest {
  model: string;
  prompt: string | string[] | number[] | Array<number[]> | null;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[] | null;
  suffix?: string;
  n?: number;
  logprobs?: number;
  echo?: boolean;
  best_of?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
  seed?: number;
}

interface OpenAIResponse {
  id: string;
  object: "chat.completion" | "chat.completion.chunk" | "text_completion" | "text_completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message?: OpenAIChatMessage;
    delta?: OpenAIChatMessage;
    text?: string;
    finish_reason: string | null;
    logprobs?: {
      content?: Array<{
        token: string;
        logprob: number;
        bytes?: number[];
        top_logprobs?: Array<{ token: string; logprob: number; bytes?: number[] }>;
      }>;
      text?: Array<{
        token: string;
        logprob: number;
        bytes?: number[];
        top_logprobs?: Array<{ token: string; logprob: number; bytes?: number[] }>;
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  system_fingerprint?: string;
}

/**
 * OpenAI-compatible provider implementation
 * Used by most cloud providers that follow OpenAI's API format
 */
export class OpenAICompatibleProvider extends BaseProvider {
  static override readonly supportedFormats = ["openai-chat", "openai-completions", "openai-responses", "openai-compatible"];
  static override readonly endpoints = [
    { method: "POST", path: "/v1/chat/completions", format: "openai-chat", description: "OpenAI chat completions" },
    { method: "POST", path: "/v1/completions", format: "openai-completions", description: "OpenAI text completions" },
    { method: "POST", path: "/v1/responses", format: "openai-responses", description: "OpenAI responses API" },
  ];

  buildRequest(body: unknown, _originalHeaders: Headers, format?: string): ProviderRequest {
    return {
      url: this.getEndpointUrl(format || "openai-chat"),
      headers: this.getHeaders(),
      body,
    };
  }

  // ============================================================================
  // Format Support Check
  // ============================================================================

  private supportsFormat(format: string): boolean {
    return [
      "openai",
      "openai-chat",
      "openai-completions",
      "openai-responses",
      "openai-compatible",
    ].includes(format);
  }

  // ============================================================================
  // Request Parsing
  // ============================================================================

  override parseRequest(format: string, body: unknown, metadata: InternalRequest["metadata"]): InternalRequest | null {
    if (!this.supportsFormat(format)) return null;

    // Handle completions API (prompt-based)
    if (format === "openai-completions") {
      return this.parseCompletionRequest(body as OpenAICompletionRequest, metadata);
    }

    // Handle chat API (messages-based)
    return this.parseChatRequest(body as OpenAIChatRequest, metadata);
  }

  private parseCompletionRequest(
    body: OpenAICompletionRequest,
    metadata: InternalRequest["metadata"]
  ): InternalRequest {
    // Convert prompt to a single user message
    let promptText: string;
    if (typeof body.prompt === "string") {
      promptText = body.prompt;
    } else if (Array.isArray(body.prompt)) {
      if (body.prompt.length > 0 && typeof body.prompt[0] === "string") {
        promptText = (body.prompt as string[]).join("");
      } else {
        promptText = String(body.prompt);
      }
    } else {
      promptText = String(body.prompt ?? "");
    }

    const messages = [{ role: "user" as const, content: promptText }];

    return {
      model: body.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      maxTokens: body.max_tokens,
      temperature: body.temperature,
      topP: body.top_p,
      stream: body.stream,
      stopSequences: body.stop ? (Array.isArray(body.stop) ? body.stop : [body.stop]) : undefined,
      n: body.n,
      presencePenalty: body.presence_penalty,
      frequencyPenalty: body.frequency_penalty,
      seed: body.seed,
      user: body.user,
      metadata,
      extensions: {
        isCompletionApi: true,
        suffix: body.suffix,
        echo: body.echo,
        best_of: body.best_of,
        logprobs: body.logprobs,
      },
    };
  }

  private parseChatRequest(
    body: OpenAIChatRequest,
    metadata: InternalRequest["metadata"]
  ): InternalRequest {
    // Extract system message if present
    const systemMessages = body.messages?.filter((m) => m.role === "system") ?? [];
    const chatMessages = body.messages?.filter((m) => m.role !== "system") ?? [];

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
    if (body.extra_body) extensions.extra_body = body.extra_body;
    if (body.extra_headers) extensions.extra_headers = body.extra_headers;
    if (body.extra_query) extensions.extra_query = body.extra_query;
    if (body.metadata) extensions.metadata = body.metadata;

    return {
      model: body.model,
      messages: chatMessages.map((m) => this.convertChatMessageToInternal(m)),
      system,
      maxTokens: body.max_tokens ?? body.max_completion_tokens ?? undefined,
      maxCompletionTokens: body.max_completion_tokens ?? undefined,
      temperature: body.temperature ?? undefined,
      topP: body.top_p ?? undefined,
      stream: body.stream ?? undefined,
      stopSequences: body.stop ? (Array.isArray(body.stop) ? body.stop : [body.stop]) : undefined,
      tools: body.tools?.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: {
          type: "object" as const,
          properties: (t.function.parameters as { properties?: Record<string, unknown> }).properties || {},
          required: (t.function.parameters as { required?: string[] }).required || [],
        },
      })),
      toolChoice: body.tool_choice
        ? body.tool_choice === "auto" || body.tool_choice === "required" || body.tool_choice === "none"
          ? body.tool_choice
          : { name: body.tool_choice.function.name }
        : undefined,
      parallelToolCalls: body.parallel_tool_calls ?? undefined,
      responseFormat: body.response_format
        ? body.response_format.type === "text"
          ? { type: "text" }
          : body.response_format.type === "json_object"
          ? { type: "json" }
          : { type: "json", schema: body.response_format.json_schema.schema }
        : undefined,
      modalities: body.modalities ?? undefined,
      frequencyPenalty: body.frequency_penalty ?? undefined,
      presencePenalty: body.presence_penalty ?? undefined,
      seed: body.seed ?? undefined,
      n: body.n ?? undefined,
      logitBias: body.logit_bias ?? undefined,
      logprobs: body.logprobs ?? undefined,
      topLogprobs: body.top_logprobs ?? undefined,
      reasoningEffort: body.reasoning_effort ?? undefined,
      chatTemplateKwargs: body.chat_template_kwargs ?? undefined,
      prediction: body.prediction ?? undefined,
      extraBody: body.extra_body ?? undefined,
      extraHeaders: body.extra_headers ?? undefined,
      extraQuery: body.extra_query ?? undefined,
      user: body.user ?? undefined,
      extensions: Object.keys(extensions).length > 0 ? extensions : undefined,
      metadata,
    };
  }

  private convertChatMessageToInternal(msg: OpenAIChatMessage): import("../../types/internal.ts").InternalMessage {
    const content = this.convertContentToInternal(msg.content);

    const internalMsg: import("../../types/internal.ts").InternalMessage = {
      role: msg.role as import("../../types/internal.ts").MessageRole,
      content,
      name: msg.name,
    };

    // Handle tool calls
    if (msg.tool_calls) {
      internalMsg.toolCalls = msg.tool_calls.map((tc) => ({
        type: "tool_call" as const,
        toolCall: {
          id: tc.id,
          name: tc.function.name,
          arguments: this.safeParseJson(tc.function.arguments),
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

  private convertContentToInternal(
    content: string | null | Array<{
      type: "text";
      text: string;
    } | {
      type: "image_url";
      image_url: { url: string; detail?: string };
    } | {
      type: "input_audio";
      input_audio: { data: string; format: string };
    } | {
      type: "file";
      file?: { file_data?: string; filename?: string; file_id?: string };
    }>
  ) {
    if (content === null) return "";
    if (typeof content === "string") return content;

    return content.map((item) => {
      switch (item.type) {
        case "text":
          return { type: "text" as const, text: item.text };
        case "image_url":
          return { type: "image" as const, image: { url: item.image_url.url } };
        case "input_audio":
          return {
            type: "audio" as const,
            audio: {
              base64: item.input_audio.data,
              mimeType: item.input_audio.format === "mp3" ? "audio/mpeg" : `audio/${item.input_audio.format}`,
            },
          };
        case "file":
          if (item.file?.file_data) {
            return { type: "text" as const, text: `[File: ${item.file.filename || "unnamed"}]` };
          }
          return { type: "text" as const, text: "" };
        default:
          return { type: "text" as const, text: "" };
      }
    });
  }

  private safeParseJson(json: string): Record<string, unknown> {
    try {
      return JSON.parse(json);
    } catch {
      return {};
    }
  }

  // ============================================================================
  // Request Serialization (to provider format)
  // ============================================================================

  override toProviderRequest(format: string, request: InternalRequest): unknown | null {
    if (!this.supportsFormat(format)) return null;

    // Handle completions API
    if (format === "openai-completions") {
      return this.toCompletionRequest(request);
    }

    // Handle chat API
    return this.toChatRequest(request);
  }

  private toCompletionRequest(request: InternalRequest): Record<string, unknown> {
    // Get the last user message content as prompt
    const lastUserMessage = [...request.messages].reverse().find((m) => m.role === "user");
    const prompt = typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : "";

    const result: Record<string, unknown> = {
      model: request.targetModel || request.model,
      prompt,
    };

    if (request.maxTokens !== undefined) result.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) result.temperature = request.temperature;
    if (request.topP !== undefined) result.top_p = request.topP;
    if (request.stream !== undefined) result.stream = request.stream;
    if (request.stopSequences !== undefined) result.stop = request.stopSequences;
    if (request.n !== undefined) result.n = request.n;
    if (request.presencePenalty !== undefined) result.presence_penalty = request.presencePenalty;
    if (request.frequencyPenalty !== undefined) result.frequency_penalty = request.frequencyPenalty;
    if (request.seed !== undefined) result.seed = request.seed;
    if (request.user !== undefined) result.user = request.user;

    // Pass through extensions
    if (request.extensions?.suffix) result.suffix = request.extensions.suffix;
    if (request.extensions?.echo) result.echo = request.extensions.echo;
    if (request.extensions?.best_of) result.best_of = request.extensions.best_of;
    if (request.extensions?.logprobs !== undefined) result.logprobs = request.extensions.logprobs;

    return result;
  }

  private toChatRequest(request: InternalRequest): Record<string, unknown> {
    const messages: OpenAIChatMessage[] = [];

    // Add system message
    if (request.system) {
      if (typeof request.system === "string") {
        messages.push({ role: "system", content: request.system });
      } else {
        const systemText = request.system
          .filter((b): b is { type: "text"; text?: string } => b.type === "text")
          .map((b) => b.text || "")
          .join("\n");
        messages.push({ role: "system", content: systemText });
      }
    }

    // Add chat messages
    messages.push(...request.messages.map((m) => this.convertInternalToChatMessage(m)));

    const result: Record<string, unknown> = {
      model: request.targetModel || request.model,
      messages,
    };

    if (request.maxTokens !== undefined) result.max_tokens = request.maxTokens;
    if (request.maxCompletionTokens !== undefined) result.max_completion_tokens = request.maxCompletionTokens;
    if (request.temperature !== undefined) result.temperature = request.temperature;
    if (request.topP !== undefined) result.top_p = request.topP;
    if (request.stream !== undefined) result.stream = request.stream;
    if (request.stopSequences !== undefined) result.stop = request.stopSequences;
    if (request.tools !== undefined) {
      result.tools = request.tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    if (request.toolChoice !== undefined) {
      result.tool_choice = request.toolChoice === "auto" || request.toolChoice === "required" || request.toolChoice === "none"
        ? request.toolChoice
        : { type: "function", function: { name: request.toolChoice.name } };
    }
    if (request.parallelToolCalls !== undefined) result.parallel_tool_calls = request.parallelToolCalls;
    if (request.responseFormat !== undefined) {
      result.response_format = request.responseFormat.type === "text"
        ? { type: "text" }
        : request.responseFormat.schema
        ? { type: "json_schema", json_schema: { name: "response", schema: request.responseFormat.schema } }
        : { type: "json_object" };
    }
    if (request.modalities !== undefined) result.modalities = request.modalities;
    if (request.frequencyPenalty !== undefined) result.frequency_penalty = request.frequencyPenalty;
    if (request.presencePenalty !== undefined) result.presence_penalty = request.presencePenalty;
    if (request.seed !== undefined) result.seed = request.seed;
    if (request.n !== undefined) result.n = request.n;
    if (request.logitBias !== undefined) result.logit_bias = request.logitBias;
    if (request.logprobs !== undefined) result.logprobs = request.logprobs;
    if (request.topLogprobs !== undefined) result.top_logprobs = request.topLogprobs;
    if (request.reasoningEffort !== undefined && typeof request.reasoningEffort === "string") {
      result.reasoning_effort = request.reasoningEffort;
    }
    if (request.chatTemplateKwargs !== undefined) result.chat_template_kwargs = request.chatTemplateKwargs;
    if (request.prediction !== undefined) result.prediction = request.prediction;
    if (request.extensions?.extra_body) result.extra_body = request.extensions.extra_body;
    if (request.extensions?.extra_headers) result.extra_headers = request.extensions.extra_headers;
    if (request.extensions?.extra_query) result.extra_query = request.extensions.extra_query;
    if (request.user !== undefined) result.user = request.user;

    return result;
  }

  private convertInternalToChatMessage(msg: {
    role: string;
    content: string | Array<{ type: string }>;
    name?: string;
    toolCalls?: Array<{ type: string; toolCall?: { id?: string; name?: string; argumentsJson?: string; arguments?: Record<string, unknown> } }>;
    toolCallId?: string;
  }): OpenAIChatMessage {
    const openAIMsg: OpenAIChatMessage = {
      role: msg.role as "system" | "user" | "assistant" | "tool",
      content: typeof msg.content === "string"
        ? msg.content
        : msg.content.map((b) => {
            if (b.type === "text") return { type: "text" as const, text: (b as { text?: string }).text || "" };
            if (b.type === "image") return { type: "image_url" as const, image_url: { url: (b as { image?: { url?: string } }).image?.url || "" } };
            return { type: "text" as const, text: "" };
          }),
      name: msg.name,
    };

    // Handle tool calls
    if (msg.toolCalls) {
      openAIMsg.tool_calls = msg.toolCalls
        .filter((tc) => tc.type === "tool_call")
        .map((tc, index) => ({
          id: tc.toolCall?.id || `call_${index}`,
          type: "function" as const,
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
  // Response Parsing
  // ============================================================================

  override parseResponse(format: string, data: unknown): InternalResponse | null {
    if (!this.supportsFormat(format)) return null;

    const response = data as OpenAIResponse;
    const isCompletionApi = response.object?.startsWith("text_completion");

    const choice = response.choices?.[0];
    const message = choice?.message || choice?.delta;

    const content: InternalResponse["content"] = [];

    // Handle text content from completions API
    if (isCompletionApi && choice?.text !== undefined) {
      content.push({ type: "text", text: choice.text });
    }
    // Handle chat message content
    else if (message?.content) {
      if (typeof message.content === "string") {
        content.push({ type: "text", text: message.content });
      } else {
        content.push(
          ...message.content.map((c): { type: "text" | "image"; text?: string; image?: { url: string } } =>
            c.type === "text" ? { type: "text", text: c.text } : { type: "image", image: { url: (c as { image_url?: { url?: string } }).image_url?.url || "" } }
          )
        );
      }
    }

    // Handle tool calls
    const toolCalls: InternalResponse["content"] = [];
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        toolCalls.push({
          type: "tool_call",
          toolCall: {
            id: tc.id,
            name: tc.function.name,
            arguments: this.safeParseJson(tc.function.arguments),
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
    if (response.system_fingerprint) {
      extensions.system_fingerprint = response.system_fingerprint;
    }

    return {
      id: response.id,
      model: response.model,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
            reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens,
          }
        : undefined,
      logprobs: this.parseLogprobs(choice?.logprobs),
      systemFingerprint: response.system_fingerprint,
      reasoningContent: message?.reasoning_content,
      extensions: Object.keys(extensions).length > 0 ? extensions : undefined,
    };
  }

  private parseLogprobs(logprobs: {
    content?: Array<{
      token: string;
      logprob: number;
      bytes?: number[];
      top_logprobs?: Array<{ token: string; logprob: number; bytes?: number[] }>;
    }>;
  } | null | undefined) {
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

  // ============================================================================
  // Response Serialization (to client format)
  // ============================================================================

  override toClientResponse(format: string, response: InternalResponse): unknown | null {
    if (!this.supportsFormat(format)) return null;

    // Handle completions API
    if (format === "openai-completions") {
      return this.toCompletionResponse(response);
    }

    // Handle chat API
    return this.toChatResponse(response);
  }

  private toCompletionResponse(response: InternalResponse): Record<string, unknown> {
    // Convert content blocks to text
    const textContent = response.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    // Map stop reason back
    let finishReason: string | null = null;
    if (response.stopReason === "end_turn") finishReason = "stop";
    else if (response.stopReason === "tool_use") finishReason = "tool_calls";
    else if (response.stopReason === "max_tokens") finishReason = "length";
    else if (response.stopReason === "content_filter") finishReason = "content_filter";

    return {
      id: response.id,
      object: "text_completion",
      created: Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [{
        text: textContent,
        index: 0,
        logprobs: null,
        finish_reason: finishReason,
      }],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.promptTokens,
            completion_tokens: response.usage.completionTokens,
            total_tokens: response.usage.totalTokens,
          }
        : undefined,
    };
  }

  private toChatResponse(response: InternalResponse): Record<string, unknown> {
    // Convert content blocks to text
    const textContent = response.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    // Convert tool calls
    const toolCalls = response.toolCalls
      ?.filter((tc) => tc.type === "tool_call")
      .map((tc, index) => ({
        id: tc.toolCall?.id || `call_${index}`,
        type: "function" as const,
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
    const message: Record<string, unknown> = {
      role: "assistant",
      content: textContent || null,
    };

    if (toolCalls?.length) {
      message.tool_calls = toolCalls;
    }

    // Include reasoning_content from extensions or direct field
    if (response.reasoningContent) {
      message.reasoning_content = response.reasoningContent;
    } else if (response.extensions?.reasoning_content) {
      message.reasoning_content = response.extensions.reasoning_content;
    }

    // Build choices
    const choices: Array<{
      index: number;
      message: typeof message;
      finish_reason: string | null;
      logprobs?: unknown;
    }> = [{
      index: 0,
      message,
      finish_reason: finishReason,
    }];

    // Add logprobs if present
    if (response.logprobs && choices[0]) {
      choices[0].logprobs = {
        content: response.logprobs.map((item) => ({
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
  // Streaming
  // ============================================================================

  override parseStreamChunk(format: string, line: string): InternalStreamChunk | null {
    if (!this.supportsFormat(format)) return null;

    try {
      if (!line.startsWith("data: ")) return null;
      const json = line.slice(6).trim();
      if (json === "[DONE]") {
        return { index: 0, delta: { type: "text", text: "" }, isComplete: true };
      }

      const data = JSON.parse(json) as {
        choices?: Array<{
          index?: number;
          delta?: {
            role?: string;
            content?: string | null;
            reasoning_content?: string;
            tool_calls?: Array<{
              index: number;
              id?: string;
              type?: "function";
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string | null;
          text?: string;
          logprobs?: {
            content?: Array<{
              token: string;
              logprob: number;
              bytes?: number[];
              top_logprobs?: Array<{ token: string; logprob: number; bytes?: number[] }>;
            }>;
          };
        }>;
      };

      const choice = data.choices?.[0];
      if (!choice) return null;

      const delta = choice.delta || {};
      const index = choice.index ?? 0;

      // Handle completions API streaming (text field)
      if (choice.text !== undefined) {
        return {
          index,
          delta: { type: "text", text: choice.text },
          finishReason: choice.finish_reason ?? null,
          isComplete: choice.finish_reason !== null && choice.finish_reason !== undefined,
        };
      }

      const deltaContent: InternalStreamChunk["delta"] = { type: "text", text: "" };

      // Handle text content
      if (typeof delta.content === "string") {
        deltaContent.type = "text";
        deltaContent.text = delta.content;
      }

      // Handle reasoning_content
      const reasoningContent = delta.reasoning_content;

      // Handle tool calls
      if (delta.tool_calls?.length) {
        const tc = delta.tool_calls[0];
        if (tc?.function) {
          return {
            index,
            delta: {
              type: "tool_call",
              toolCall: {
                id: tc.id || "",
                name: tc.function.name || "",
                arguments: {},
                argumentsJson: tc.function.arguments || "",
              },
            },
            finishReason: choice.finish_reason ?? null,
            isComplete: choice.finish_reason !== null && choice.finish_reason !== undefined,
            reasoningContent,
          };
        }
      }

      const finishReason = choice.finish_reason ?? null;

      return {
        index,
        delta: deltaContent,
        finishReason,
        isComplete: finishReason !== null && finishReason !== undefined,
        logprobs: this.parseLogprobs(choice.logprobs),
        reasoningContent,
      };
    } catch {
      return null;
    }
  }

  override toClientStreamChunk(format: string, chunk: InternalStreamChunk, model: string): string {
    if (!this.supportsFormat(format)) return "";

    // Handle completions API
    if (format === "openai-completions") {
      const data: Record<string, unknown> = {
        id: `cmpl-${Date.now()}`,
        object: "text_completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          text: chunk.delta.type === "text" ? chunk.delta.text : "",
          index: chunk.index,
          finish_reason: chunk.finishReason ?? null,
        }],
      };
      return `data: ${JSON.stringify(data)}\n\n`;
    }

    // Handle chat API
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

    if (chunk.reasoningContent) {
      delta.reasoning_content = chunk.reasoningContent;
    }

    if (chunk.logprobs && choices[0]) {
      choices[0].logprobs = {
        content: chunk.logprobs.map((item) => ({
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

    return `data: ${JSON.stringify(data)}\n\n`;
  }

  override createStreamStart(_format: string, _messageId: string, _usage?: { input_tokens?: number }): string {
    // OpenAI formats don't use stream start events
    return "";
  }

  override createStreamStop(format: string, _stopReason: string | null, _outputTokens: number): string {
    if (!this.supportsFormat(format)) return "";
    return "data: [DONE]\n\n";
  }
}
