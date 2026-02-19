#!/usr/bin/env bun

import type { Server } from "bun";
import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

// CLI Argument parsing
function parseArgs() {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        args[key] = value;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  
  return args;
}

// Help text
function showHelp() {
  console.log(`
Anthropic to OpenAI Router

Usage: bun run index.ts [options]

Options:
  --port <number>      Port to listen on (default: 3000)
  --endpoint <url>     OpenAI compatible endpoint URL (required)
  --haiku <model>      Model mapping for claude-haiku-* (optional if --default set)
  --sonnet <model>     Model mapping for claude-sonnet-* (optional if --default set)
  --opus <model>       Model mapping for claude-opus-* (optional if --default set)
  --default <model>    Default model mapping for unrecognized claude models (optional)
  --preload            Send warmup requests to all configured models on startup
  --log-dir <path>     Directory to log conversations (optional)
  --cors-origin <url>  CORS origin (default: *, set to 'none' to disable)
  --timeout <seconds>  Request timeout in seconds (default: 120)
  --help               Show this help message

Example:
  bun run index.ts --port 3000 --endpoint https://api.openai.com/v1 \
    --haiku gpt-4o-mini --sonnet gpt-4o --opus gpt-4-turbo \
    --log-dir ./logs --timeout 60

  bun run index.ts --endpoint https://api.openai.com/v1 \
    --default gpt-4o --preload  # Preload gpt-4o on startup
`);
  process.exit(0);
}

// Parse and validate args
const args = parseArgs();

if (args.help) {
  showHelp();
}

const PORT = parseInt(args.port || "3000", 10);
const ENDPOINT = args.endpoint;
const MODEL_MAPPINGS = {
  haiku: args.haiku,
  sonnet: args.sonnet,
  opus: args.opus,
  default: args.default,
};
const LOG_DIR = args["log-dir"];
const CORS_ORIGIN = args["cors-origin"] || "*";
const TIMEOUT_MS = (parseInt(args.timeout || "120", 10)) * 1000;
const PRELOAD = args.preload === "true" || args.preload === "";

// Validation
if (!ENDPOINT) {
  console.error("Error: --endpoint is required");
  showHelp();
}

// Either all three model mappings, or at least a default must be provided
const hasAllModels = MODEL_MAPPINGS.haiku && MODEL_MAPPINGS.sonnet && MODEL_MAPPINGS.opus;
const hasDefault = !!MODEL_MAPPINGS.default;

if (!hasAllModels && !hasDefault) {
  console.error("Error: Either provide --haiku, --sonnet, and --opus, or provide --default");
  showHelp();
}

// Initialize log directory if specified
if (LOG_DIR && !existsSync(LOG_DIR)) {
  await mkdir(LOG_DIR, { recursive: true });
}

const modelLines = [
  MODEL_MAPPINGS.haiku ? `│  Haiku →    ${MODEL_MAPPINGS.haiku.padEnd(28)}│` : "",
  MODEL_MAPPINGS.sonnet ? `│  Sonnet →   ${MODEL_MAPPINGS.sonnet.padEnd(28)}│` : "",
  MODEL_MAPPINGS.opus ? `│  Opus →     ${MODEL_MAPPINGS.opus.padEnd(28)}│` : "",
  MODEL_MAPPINGS.default ? `│  Default →  ${MODEL_MAPPINGS.default.padEnd(28)}│` : "",
].filter(Boolean).join("\n");

const preloadLine = PRELOAD ? `│  Preload:   ${"enabled".padEnd(28)}│` : "";

console.log(`
┌─────────────────────────────────────────┐
│  Anthropic → OpenAI Router             │
├─────────────────────────────────────────┤
│  Port:      ${PORT.toString().padEnd(28)}│
│  Endpoint:  ${ENDPOINT.padEnd(28)}│
${modelLines}
${preloadLine}
│  CORS:      ${CORS_ORIGIN.padEnd(28)}│
│  Timeout:   ${(TIMEOUT_MS / 1000 + "s").padEnd(28)}│
${LOG_DIR ? `│  Log dir:   ${LOG_DIR.padEnd(28)}│` : "│  Logging:   disabled".padEnd(40) + "│"}
└─────────────────────────────────────────┘
`);

// ===== Types for Anthropic API =====

interface AnthropicCacheControl {
  type: "ephemeral";
  ttl?: string;
  scope?: string;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicImageBlock {
  type: "image";
  source: unknown;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<AnthropicTextBlock | AnthropicImageBlock>;
  is_error?: boolean;
  cache_control?: AnthropicCacheControl;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    $schema?: string;
  };
}

type AnthropicToolChoice = "auto" | "any" | "tool" | { type: "tool"; name: string };

interface AnthropicOutputConfig {
  format?: {
    type: "text" | "json_schema";
    schema?: Record<string, unknown>;
  };
  effort?: "low" | "medium" | "high";
}

interface AnthropicRequest {
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
}

// ===== Types for OpenAI API =====

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface OpenAITool {
  type: "function";
  function: OpenAIFunction;
}

type OpenAIResponseFormat = 
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };

interface OpenAIRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string[];
  tools?: OpenAITool[];
  tool_choice?: "auto" | "required" | "none" | { type: "function"; function: { name: string } };
  response_format?: OpenAIResponseFormat;
  // OpenAI doesn't have direct equivalents for:
  // - metadata (we could use user? but let's skip)
  // - output_config.effort (reasoning_effort is separate)
}

// ===== Model Mapping =====

function mapModel(anthropicModel: string): string {
  const lowerModel = anthropicModel.toLowerCase();
  
  if (lowerModel.includes("haiku") && MODEL_MAPPINGS.haiku) {
    return MODEL_MAPPINGS.haiku;
  } else if (lowerModel.includes("sonnet") && MODEL_MAPPINGS.sonnet) {
    return MODEL_MAPPINGS.sonnet;
  } else if (lowerModel.includes("opus") && MODEL_MAPPINGS.opus) {
    return MODEL_MAPPINGS.opus;
  }
  
  // Fall back to default if no specific match
  if (MODEL_MAPPINGS.default) {
    return MODEL_MAPPINGS.default;
  }
  
  return anthropicModel;
}

// ===== Tool Conversion =====

function convertAnthropicTools(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map((tool) => {
    // Strip $schema from parameters as OpenAI doesn't like it
    const { $schema, ...parameters } = tool.input_schema;
    
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters,
      },
    };
  });
}

function convertToolChoice(choice: AnthropicToolChoice): OpenAIRequest["tool_choice"] {
  if (choice === "auto") return "auto";
  if (choice === "any") return "required";
  if (typeof choice === "object" && choice.type === "tool") {
    return { type: "function", function: { name: choice.name } };
  }
  return "auto";
}

// ===== System Message Conversion =====

function convertSystem(system: string | AnthropicTextBlock[] | undefined): string | undefined {
  if (!system) return undefined;
  
  if (typeof system === "string") {
    return system;
  }
  
  // Array of text blocks - join them (strip cache_control)
  return system
    .filter((block): block is AnthropicTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// ===== Output Config Conversion =====

function convertOutputConfig(config: AnthropicOutputConfig | undefined): OpenAIResponseFormat | undefined {
  if (!config?.format) return undefined;
  
  if (config.format.type === "json_schema" && config.format.schema) {
    return {
      type: "json_schema",
      json_schema: {
        name: "response",
        schema: config.format.schema,
        strict: true,
      },
    };
  }
  
  if (config.format.type === "text") {
    return { type: "text" };
  }
  
  return undefined;
}

// ===== Message Conversion =====

function extractTextContent(content: string | AnthropicContentBlock[]): string {
  if (typeof content === "string") return content;
  
  return content
    .filter((c): c is AnthropicTextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function convertToolResultContent(content: string | Array<AnthropicTextBlock | AnthropicImageBlock>): string {
  if (typeof content === "string") return content;
  
  return content
    .filter((c): c is AnthropicTextBlock => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function convertAnthropicMessages(messages: AnthropicMessage[]): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];
  
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({
        role: msg.role,
        content: msg.content,
      });
    } else {
      // Handle content blocks
      const toolUseBlocks = msg.content.filter((c): c is AnthropicToolUseBlock => c.type === "tool_use");
      const toolResultBlocks = msg.content.filter((c): c is AnthropicToolResultBlock => c.type === "tool_result");
      const textBlocks = msg.content.filter((c): c is AnthropicTextBlock => c.type === "text");
      
      // Handle tool use (assistant calling a tool)
      if (msg.role === "assistant" && toolUseBlocks.length > 0) {
        const text = textBlocks.map((t) => t.text).join("");
        result.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolUseBlocks.map((tool) => ({
            id: tool.id,
            type: "function",
            function: {
              name: tool.name,
              arguments: JSON.stringify(tool.input),
            },
          })),
        });
      }
      // Handle tool results (user providing tool results)
      else if (msg.role === "user" && toolResultBlocks.length > 0) {
        for (const toolResult of toolResultBlocks) {
          const content = convertToolResultContent(toolResult.content);
          // Prefix with error indicator if is_error is true
          const finalContent = toolResult.is_error ? `[ERROR] ${content}` : content;
          
          result.push({
            role: "tool",
            content: finalContent,
            tool_call_id: toolResult.tool_use_id,
          });
        }
        // Also add any regular text content as a separate user message
        const regularText = textBlocks.map((t) => t.text).join("");
        if (regularText) {
          result.push({
            role: "user",
            content: regularText,
          });
        }
      }
      // Regular message with text blocks
      else {
        const text = textBlocks.map((t) => t.text).join("");
        result.push({
          role: msg.role,
          content: text,
        });
      }
    }
  }
  
  return result;
}

// Transform Anthropic request to OpenAI format
function transformRequest(anthropicReq: AnthropicRequest): OpenAIRequest {
  const openAIReq: OpenAIRequest = {
    model: mapModel(anthropicReq.model),
    messages: [],
    max_tokens: anthropicReq.max_tokens,
    temperature: anthropicReq.temperature,
    top_p: anthropicReq.top_p,
    stream: anthropicReq.stream,
    stop: anthropicReq.stop_sequences,
  };
  
  // Convert system message and prepend to messages if present
  const systemContent = convertSystem(anthropicReq.system);
  const chatMessages = convertAnthropicMessages(anthropicReq.messages);
  
  if (systemContent) {
    openAIReq.messages = [
      { role: "system", content: systemContent },
      ...chatMessages,
    ];
  } else {
    openAIReq.messages = chatMessages;
  }
  
  // Add tools if present
  if (anthropicReq.tools && anthropicReq.tools.length > 0) {
    openAIReq.tools = convertAnthropicTools(anthropicReq.tools);
  }
  
  if (anthropicReq.tool_choice) {
    openAIReq.tool_choice = convertToolChoice(anthropicReq.tool_choice);
  }
  
  // Convert output_config to response_format
  if (anthropicReq.output_config) {
    const responseFormat = convertOutputConfig(anthropicReq.output_config);
    if (responseFormat) {
      openAIReq.response_format = responseFormat;
    }
  }
  
  return openAIReq;
}

// ===== Response Conversion =====

interface OpenAIResponse {
  id: string;
  choices: Array<{
    message?: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    delta?: {
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
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

function mapStopReason(finishReason: string | null): string | null {
  if (finishReason === "stop") return "end_turn";
  if (finishReason === "tool_calls") return "tool_use";
  if (finishReason === "length") return "max_tokens";
  if (finishReason === "content_filter") return "content_filter";
  return null;
}

function convertOpenAIMessageToAnthropic(data: OpenAIResponse): {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
} {
  const message = data.choices?.[0]?.message;
  const finishReason = data.choices?.[0]?.finish_reason;
  
  const content: AnthropicContentBlock[] = [];
  
  // Add text content if present
  if (message?.content) {
    content.push({
      type: "text",
      text: message.content,
    });
  }
  
  // Add tool calls
  if (message?.tool_calls && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      if (toolCall.type === "function") {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(toolCall.function.arguments);
        } catch {
          input = {};
        }
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input,
        });
      }
    }
  }
  
  return { content, stop_reason: mapStopReason(finishReason) };
}

// ===== CORS Headers =====

function getCORSHeaders(requestOrigin: string | null): Record<string, string> {
  if (CORS_ORIGIN === "none") {
    return {};
  }
  
  const allowOrigin = CORS_ORIGIN === "*" ? (requestOrigin || "*") : CORS_ORIGIN;
  
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key, Authorization, Anthropic-Version",
    "Access-Control-Max-Age": "86400",
  };
}

// ===== Logging =====

interface ConversationLog {
  timestamp: string;
  requestId: string;
  anthropicRequest: AnthropicRequest;
  openAIRequest: OpenAIRequest;
  response?: unknown;
  error?: string;
  durationMs: number;
}

let logIndex = 0;

function sanitizeForFilename(str: string): string {
  // Remove or replace characters that are problematic in filenames
  return str
    .replace(/[^a-zA-Z0-9._-]/g, "_")  // Replace special chars with underscore
    .replace(/_{2,}/g, "_")              // Collapse multiple underscores
    .replace(/^_+|_+$/g, "")             // Trim leading/trailing underscores
    .slice(0, 50);                        // Limit length
}

function extractSourceModel(anthropicModel: string): string {
  const lower = anthropicModel.toLowerCase();
  if (lower.includes("haiku")) return "haiku";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("opus")) return "opus";
  return "unknown";
}

async function logConversation(log: ConversationLog): Promise<void> {
  if (!LOG_DIR) return;
  
  const index = String(logIndex++).padStart(6, "0");
  const sourceModel = extractSourceModel(log.anthropicRequest.model || "");
  const targetModel = sanitizeForFilename(log.openAIRequest.model || "unknown");
  const requestId = log.requestId;
  
  const filename = `${index}_${sourceModel}_${targetModel}_${requestId}.json`;
  const filepath = join(LOG_DIR, filename);
  
  try {
    await writeFile(filepath, JSON.stringify(log, null, 2));
  } catch (err) {
    console.error(`Failed to write log: ${err}`);
  }
}

function generateRequestId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

// ===== SSE Generation =====

function createAnthropicChunk(content: string, index: number): string {
  const chunk = {
    type: "content_block_delta",
    index,
    delta: {
      type: "text_delta",
      text: content,
    },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function createAnthropicToolUseStart(index: number, id: string, name: string): string {
  const chunk = {
    type: "content_block_start",
    index,
    content_block: {
      type: "tool_use",
      id,
      name,
      input: {},
    },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function createAnthropicToolUseDelta(index: number, partialInput: string): string {
  const chunk = {
    type: "content_block_delta",
    index,
    delta: {
      type: "input_json_delta",
      partial_json: partialInput,
    },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function createAnthropicStart(index: number): string {
  const chunk = {
    type: "content_block_start",
    index,
    content_block: {
      type: "text",
      text: "",
    },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function createAnthropicStop(index: number): string {
  const chunk = {
    type: "content_block_stop",
    index,
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function createAnthropicMessageStart(usage?: { input_tokens?: number; output_tokens?: number }): string {
  const chunk: Record<string, unknown> = {
    type: "message_start",
    message: {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: "claude-3",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: usage || { input_tokens: 0, output_tokens: 0 },
    },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function createAnthropicMessageStop(stopReason: string | null, outputTokens = 0): string {
  const chunk = {
    type: "message_delta",
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: {
      output_tokens: outputTokens,
    },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function createAnthropicDone(): string {
  return "data: [DONE]\n\n";
}

// ===== Streaming with Timeout and Stop Reason Tracking =====

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

interface StreamingResult {
  chunks: string[];
  finishReason: string | null;
  outputTokens: number;
}

async function streamOpenAIToAnthropic(response: Response): Promise<StreamingResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { chunks: [], finishReason: null, outputTokens: 0 };
  }
  
  const decoder = new TextDecoder();
  let buffer = "";
  let contentIndex = 0;
  let finished = false;
  let hasSentContent = false;
  let hasSentToolUse = false;
  let currentBlockIndex = 0;
  let toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();
  let finalFinishReason: string | null = null;
  let outputTokens = 0;
  
  const chunks: string[] = [];
  
  // Send message_start
  chunks.push(createAnthropicMessageStart());
  chunks.push(createAnthropicStart(contentIndex));
  
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        
        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          finished = true;
          break;
        }
        
        try {
          const parsed: OpenAIResponse = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          const finishReason = parsed.choices?.[0]?.finish_reason;
          
          // Track finish reason
          if (finishReason) {
            finalFinishReason = finishReason;
            finished = true;
          }
          
          // Track usage if available
          if (parsed.usage?.completion_tokens) {
            outputTokens = parsed.usage.completion_tokens;
          }
          
          // Handle text content
          if (delta?.content) {
            // If we were in a tool use block, close it first
            if (hasSentToolUse && !hasSentContent) {
              chunks.push(createAnthropicStop(currentBlockIndex));
              currentBlockIndex++;
              hasSentToolUse = false;
              chunks.push(createAnthropicStart(currentBlockIndex));
            }
            hasSentContent = true;
            chunks.push(createAnthropicChunk(delta.content, currentBlockIndex));
          }
          
          // Handle tool calls in streaming
          if (delta?.tool_calls && delta.tool_calls.length > 0) {
            for (const toolDelta of delta.tool_calls) {
              const toolIndex = toolDelta.index ?? 0;
              
              // New tool call starting
              if (toolDelta.id) {
                // Close previous content block if we had text
                if (hasSentContent) {
                  chunks.push(createAnthropicStop(currentBlockIndex));
                  currentBlockIndex++;
                  hasSentContent = false;
                }
                // Close previous tool block if we had one
                if (hasSentToolUse) {
                  chunks.push(createAnthropicStop(currentBlockIndex));
                  currentBlockIndex++;
                }
                
                const toolName = toolDelta.function?.name || "";
                toolCallBuffers.set(toolIndex, {
                  id: toolDelta.id,
                  name: toolName,
                  arguments: "",
                });
                
                chunks.push(createAnthropicToolUseStart(currentBlockIndex, toolDelta.id, toolName));
                hasSentToolUse = true;
              }
              
              // Accumulate arguments
              if (toolDelta.function?.arguments) {
                const existing = toolCallBuffers.get(toolIndex);
                if (existing) {
                  existing.arguments += toolDelta.function.arguments;
                  chunks.push(createAnthropicToolUseDelta(currentBlockIndex, toolDelta.function.arguments));
                }
              }
            }
          }
        } catch {
          // Ignore malformed JSON
        }
      }
    }
    
    // Close any open content block
    chunks.push(createAnthropicStop(currentBlockIndex));
    
    // Map stop reason
    const mappedStopReason = mapStopReason(finalFinishReason);
    chunks.push(createAnthropicMessageStop(mappedStopReason, outputTokens));
    chunks.push(createAnthropicDone());
    
    return { chunks, finishReason: finalFinishReason, outputTokens };
  } finally {
    reader.releaseLock();
  }
}

// ===== Non-streaming Response =====

async function transformNonStreamingResponse(openAIResponse: Response): Promise<{
  response: Response;
  data: unknown;
}> {
  const data: OpenAIResponse = await openAIResponse.json();
  
  const { content, stop_reason } = convertOpenAIMessageToAnthropic(data);
  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;
  
  const anthropicResponse = {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: "claude-3",
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
  
  return {
    response: new Response(JSON.stringify(anthropicResponse), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }),
    data: anthropicResponse,
  };
}

// ===== Server =====

const server: Server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const requestOrigin = req.headers.get("origin");
    const corsHeaders = getCORSHeaders(requestOrigin);
    const requestId = generateRequestId();
    const startTime = Date.now();
    
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }
    
    // Health check
    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response(JSON.stringify({ status: "ok", requestId }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    
    // Only handle /v1/messages
    if (url.pathname !== "/v1/messages" || req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    
    let anthropicReq: AnthropicRequest | undefined;
    let openAIReq: OpenAIRequest | undefined;
    let logData: ConversationLog = {
      timestamp: new Date().toISOString(),
      requestId,
      anthropicRequest: {} as AnthropicRequest,
      openAIRequest: {} as OpenAIRequest,
      durationMs: 0,
    };
    
    try {
      // Get API key from headers
      const authHeader = req.headers.get("x-api-key") || req.headers.get("authorization");
      if (!authHeader) {
        const error = { error: "Missing API key" };
        logData.error = "Missing API key";
        logData.durationMs = Date.now() - startTime;
        await logConversation(logData);
        
        return new Response(JSON.stringify(error), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      
      // Parse Anthropic request
      anthropicReq = await req.json();
      logData.anthropicRequest = anthropicReq;
      
      // Transform to OpenAI format
      openAIReq = transformRequest(anthropicReq);
      logData.openAIRequest = openAIReq;
      
      console.log(`[${new Date().toISOString()}] ${requestId} ${anthropicReq.model} → ${openAIReq.model} (stream=${anthropicReq.stream ?? false}, tools=${openAIReq.tools?.length ?? 0})`);
      
      // Forward to OpenAI endpoint with timeout
      const openAIHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": authHeader.startsWith("Bearer ") ? authHeader : `Bearer ${authHeader}`,
      };
      
      const openAIResponse = await fetchWithTimeout(
        `${ENDPOINT}/chat/completions`,
        {
          method: "POST",
          headers: openAIHeaders,
          body: JSON.stringify(openAIReq),
        },
        TIMEOUT_MS
      );
      
      if (!openAIResponse.ok) {
        const errorText = await openAIResponse.text();
        console.error(`[${requestId}] OpenAI error: ${openAIResponse.status} ${errorText}`);
        
        logData.error = `HTTP ${openAIResponse.status}: ${errorText}`;
        logData.durationMs = Date.now() - startTime;
        await logConversation(logData);
        
        return new Response(JSON.stringify({ error: "Upstream error", details: errorText }), {
          status: openAIResponse.status,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      
      // Handle streaming
      if (anthropicReq.stream) {
        const { chunks, finishReason } = await streamOpenAIToAnthropic(openAIResponse);
        
        logData.response = { type: "streaming", finishReason, chunkCount: chunks.length };
        logData.durationMs = Date.now() - startTime;
        await logConversation(logData);
        
        const stream = new ReadableStream({
          start(controller) {
            for (const chunk of chunks) {
              if (controller.desiredSize === null) {
                break;
              }
              controller.enqueue(new TextEncoder().encode(chunk));
            }
            controller.close();
          },
        });
        
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            ...corsHeaders,
          },
        });
      }
      
      // Non-streaming
      const { response, data } = await transformNonStreamingResponse(openAIResponse);
      
      logData.response = data;
      logData.durationMs = Date.now() - startTime;
      await logConversation(logData);
      
      // Add CORS headers to response
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });
      
      return new Response(response.body, {
        status: response.status,
        headers,
      });
      
    } catch (error) {
      console.error(`[${requestId}] Error:`, error);
      
      logData.error = String(error);
      logData.durationMs = Date.now() - startTime;
      await logConversation(logData);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const statusCode = errorMessage.includes("timeout") ? 504 : 500;
      
      return new Response(
        JSON.stringify({ error: "Internal server error", message: errorMessage, requestId }),
        { status: statusCode, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  },
});

// ===== Preload Function =====

async function preloadModels() {
  console.log("\n[Preload] Warming up models...");
  
  // Get unique list of configured models
  const models = new Set<string>();
  if (MODEL_MAPPINGS.haiku) models.add(MODEL_MAPPINGS.haiku);
  if (MODEL_MAPPINGS.sonnet) models.add(MODEL_MAPPINGS.sonnet);
  if (MODEL_MAPPINGS.opus) models.add(MODEL_MAPPINGS.opus);
  if (MODEL_MAPPINGS.default) models.add(MODEL_MAPPINGS.default);
  
  const authHeader = process.env.OPENAI_API_KEY || "preload-test-key";
  
  for (const model of models) {
    try {
      console.log(`[Preload] Pinging ${model}...`);
      
      const response = await fetchWithTimeout(
        `${ENDPOINT}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${authHeader}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "Hi" }],
            max_tokens: 1,
            stream: false,
          }),
        },
        TIMEOUT_MS
      );
      
      if (response.ok) {
        console.log(`[Preload] ✓ ${model} ready`);
      } else {
        const error = await response.text();
        console.log(`[Preload] ✗ ${model} failed: ${response.status} ${error.slice(0, 100)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[Preload] ✗ ${model} error: ${message.slice(0, 100)}`);
    }
  }
  
  console.log("[Preload] Done\n");
}

console.log(`Server running at http://localhost:${PORT}/v1/messages`);

// Preload models if requested
if (PRELOAD) {
  preloadModels();
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.stop();
  process.exit(0);
});
