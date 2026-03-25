#!/usr/bin/env bun
// ============================================================================
// Universal Model Router - Main Server
// ============================================================================

import type { Server, ServerWebSocket } from "bun";
import { existsSync } from "fs";
import { mkdir, stat as statAsync } from "fs/promises";
import { join, dirname } from "path";
import { hostname as getHostname } from "os";

import type { 
  RouterConfig, 
  LogEntry, 
  UnroutedRequest,
  ProviderConfig,
  RouteConfig,
  ApiSchemeConfig,
} from "./types/index.ts";
import type { InternalRequest, InternalResponse, InternalStreamChunk } from "./types/internal.ts";

import { ConfigManager } from "./config/manager.ts";
import { providerRegistry } from "./providers/registry.ts";
import { BUILTIN_PROVIDERS, type ProviderInfo } from "./providers/builtin.ts";
import { LoggingManager } from "./logging/index.ts";
import { Router } from "./router/index.ts";
import * as transformers from "./transformers/index.ts";
import { log, setLogLevel } from "./logger.ts";

// ============================================================================
// Server State
// ============================================================================

interface ServerState {
  config: ConfigManager;
  router: Router;
  logging: LoggingManager;
  version: string;
  startTime: Date;
}

interface ActiveRequest {
  requestId: string;
  timestamp: string;
  model: string;
  targetModel?: string;
  provider?: string;
  sourceScheme: string;
  stream: boolean;
  status: 'pending' | 'streaming' | 'completed' | 'error';
  prompt?: string;
  content?: string;
  error?: string;
  chunks: number;
  startTime: number;
  endTime?: number;
}

let state: ServerState;
let server: Server<unknown>;
let apiPort: number = 3000; // Default API port

// Active requests tracking for live monitor
const activeRequests = new Map<string, ActiveRequest>();
const wsClients = new Set<ServerWebSocket<unknown>>();

// Broadcast update to all connected WebSocket clients
function broadcastRequestUpdate(request: ActiveRequest) {
  const message = JSON.stringify({ type: 'request_update', request });
  for (const ws of wsClients) {
    ws.send(message);
  }
}

// Broadcast log entry to all connected WebSocket clients
function broadcastLogEntry(entry: LogEntry) {
  const message = JSON.stringify({ type: 'log_entry', entry });
  for (const ws of wsClients) {
    ws.send(message);
  }
}

// Add or update active request
function trackRequest(request: ActiveRequest) {
  activeRequests.set(request.requestId, request);
  broadcastRequestUpdate(request);
}

// Update request status
function updateRequest(requestId: string, updates: Partial<ActiveRequest>) {
  const req = activeRequests.get(requestId);
  if (req) {
    Object.assign(req, updates);
    broadcastRequestUpdate(req);
  }
}

// Remove old completed requests (keep last 100)
function cleanupOldRequests() {
  const entries = Array.from(activeRequests.entries());
  if (entries.length > 100) {
    const toRemove = entries
      .filter(([_, r]) => r.status === 'completed' || r.status === 'error')
      .sort((a, b) => (a[1].endTime || 0) - (b[1].endTime || 0))
      .slice(0, entries.length - 100);
    for (const [id] of toRemove) {
      activeRequests.delete(id);
    }
  }
}

// ============================================================================
// CLI Arguments
// ============================================================================

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
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

function showHelp(): void {
  const HELP_WIDTH = 79;
  const BL = "║", BR = "║";
  const TL = "╔", TR = "╗";
  const BLM = "╚", BRM = "╝";
  const H = "═";
  const T = "╠", TRG = "╣";
  const INNER = HELP_WIDTH - 2;
  
  const line = (l: string, r = ""): string => {
    const g = r ? " " : ""; 
    const c = l + g + r;
    const p = Math.max(0, INNER - c.length - 1);
    return BL + l + " ".repeat(p) + g + r + " " + BR;
  };
  const center = (t: string): string => {
    const p = Math.max(0, INNER - t.length);
    const lp = Math.floor(p / 2);
    return BL + " ".repeat(lp) + t + " ".repeat(p - lp) + BR;
  };
  const top = (): string => TL + H.repeat(INNER) + TR;
  const sep = (): string => T + H.repeat(INNER) + TRG;
  const bot = (): string => BLM + H.repeat(INNER) + BRM;
  
  console.log(`
${top()}
${center("Universal Model Router v2.0")}
${sep()}
${line("Usage: bun run src/server.ts [options]")}
${line("")}
${line("Options:")}
${line("  --config <path>        Path to YAML config (default: config/config.yaml)")}
${line("  --port <number>        Override port from config")}
${line("  --external-port <num>  Override external port (for container mappings)")}
${line("  --log-dir <path>       Override log directory from config")}
${line("  --timeout <seconds>    Override timeout from config")}
${line("  --gui-port <number>    Port for management GUI (default: 3001)")}
${line("  --hostname <name>      Hostname for URLs (default: actual hostname)")}
${line("  --log-level <level>    Log level: debug, info, warn, error")}
${line("  --no-gui               Disable management GUI")}
${line("  --help                 Show this help message")}
${line("")}
${line("Examples:")}
${line("  # Use default config")}
${line("  bun run src/server.ts")}
${line("")}
${line("  # Custom config and ports")}
${line("  bun run src/server.ts --config ./my-config.yaml --port 8080 --gui-port 8081")}
${line("  # With container port mapping (external port 8080, internal port 3000)")}
${line("  bun run src/server.ts --port 3000 --external-port 8080 --gui-port 8081")}
${line("")}
${line("  # Disable GUI")}
${line("  bun run src/server.ts --no-gui")}
${bot()}
`);
  process.exit(0);
}

// ============================================================================
// Default Scheme Paths
// ============================================================================

const SCHEME_PATH_MAP: Record<string, string> = {
  "openai": "/v1/chat/completions",
  "openai-chat": "/v1/chat/completions",
  "anthropic": "/v1/messages",
  "anthropic-messages": "/v1/messages",
  "openai-responses": "/v1/responses",
  "openai-completions": "/v1/completions",
};

function getSchemePath(scheme: { id: string; path?: string; format: string }): string {
  return scheme.path || SCHEME_PATH_MAP[scheme.id] || SCHEME_PATH_MAP[scheme.format] || `/${scheme.id}`;
}

// ============================================================================
// Utility Functions
// ============================================================================

async function filePathStat(filePath: string): Promise<{ isDirectory: () => boolean } | null> {
  try {
    const s = await statAsync(filePath);
    return s;
  } catch {
    return null;
  }
}

function generateRequestId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

function getDisplayHostname(cliHostname?: string, configHostname?: string): string {
  // Priority: CLI override > config > actual hostname > localhost
  if (cliHostname) return cliHostname;
  if (configHostname && configHostname !== "0.0.0.0") return configHostname;
  const actualHostname = getHostname();
  if (actualHostname && actualHostname !== "localhost") return actualHostname;
  return "localhost";
}

function getCORSHeaders(requestOrigin: string | null, config: RouterConfig): Record<string, string> {
  const cors = config.server?.cors;
  if (!cors || cors.origin === "none") {
    return {};
  }

  let allowOrigin = "*";
  if (cors.origin !== "*") {
    if (Array.isArray(cors.origin)) {
      if (requestOrigin && cors.origin.includes(requestOrigin)) {
        allowOrigin = requestOrigin;
      } else {
        allowOrigin = cors.origin[0] || "*";
      }
    } else if (cors.origin) {
      allowOrigin = cors.origin;
    }
  } else if (requestOrigin) {
    allowOrigin = requestOrigin;
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key, Authorization, Anthropic-Version, X-Goog-Api-Key",
    "Access-Control-Max-Age": "86400",
    ...(cors.credentials ? { "Access-Control-Allow-Credentials": "true" } : {}),
  };
}

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

// ============================================================================
// Request Handling
// ============================================================================

async function handleRequest(
  req: Request,
  requestId: string,
  startTime: number
): Promise<Response> {
  const url = new URL(req.url);
  const config = state.config.getConfig();
  
  // Find matching scheme by path (explicit or derived from format)
  const scheme = config.schemes?.find(s => url.pathname === getSchemePath(s));
  
  if (!scheme || req.method !== "POST") {
    return jsonResponse({ error: "Not found" }, 404, config, req.headers.get("origin"));
  }

  // Parse body based on format
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, config, req.headers.get("origin"));
  }

  // Extract model
  const model = body.model as string;
  if (!model) {
    return jsonResponse({ error: "Missing model" }, 400, config, req.headers.get("origin"));
  }

  // Find route
  const route = state.router.findRoute(model);
  
  // Get API key from request
  const authHeader = req.headers.get("authorization") || req.headers.get("x-api-key") || "";
  const apiKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  const endpointPath = getSchemePath(scheme);
  
  // Create internal request
  const internalReq = transformers.parseRequest(scheme.format as transformers.ProviderFormat, body, {
    sourceFormat: scheme.format as "openai" | "anthropic" | "google" | "ollama" | "custom",
    endpoint: endpointPath,
    headers: Object.fromEntries(req.headers.entries()),
    apiKey,
    requestId,
    timestamp: new Date().toISOString(),
  });

  // Log unrouted request if no route found
  if (!route) {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      requestId,
      method: "POST",
      path: endpointPath,
      sourceScheme: scheme.format,
      targetScheme: "none",
      provider: "none",
      model,
      targetModel: model,
      requestHeaders: Object.fromEntries(req.headers.entries()),
      requestBody: body,
      responseStatus: 404,
      error: "No route found for model",
      durationMs: Date.now() - startTime,
      routed: false,
    };
    
    await state.logging.log(logEntry);
    
    return jsonResponse(
      { error: "No route found for model", model, requestId },
      404,
      config,
      req.headers.get("origin")
    );
  }

  // Update internal request with target info
  internalReq.targetModel = route.model;

  // Get provider
  const provider = providerRegistry.get(route.provider);
  if (!provider) {
    return jsonResponse(
      { error: "Provider not configured", provider: route.provider },
      500,
      config,
      req.headers.get("origin")
    );
  }

  // Track this request for live monitoring
  const streamMode = body.stream === true;
  
  // Extract prompt from messages
  let prompt = '';
  if (body.messages && Array.isArray(body.messages)) {
    // Get the last user message
    const userMessages = body.messages.filter((m: { role?: string; content?: unknown }) => m.role === 'user');
    if (userMessages.length > 0) {
      const lastMessage = userMessages[userMessages.length - 1];
      prompt = typeof lastMessage.content === 'string' 
        ? lastMessage.content 
        : JSON.stringify(lastMessage.content);
    }
  }
  
  trackRequest({
    requestId,
    timestamp: new Date().toISOString(),
    model,
    targetModel: route.model,
    provider: route.provider,
    sourceScheme: scheme.format,
    stream: streamMode,
    status: 'pending',
    prompt,
    chunks: 0,
    startTime,
  });

  // Handle Anthropic passthrough
  if (route.provider === "anthropic" && scheme.format.startsWith("anthropic")) {
    return handleAnthropicPassthrough(req, body as { stream?: boolean }, provider, requestId, startTime, config, internalReq);
  }

  // Transform request to target format
  const targetFormat = provider.getInfo().supportsStreaming ? "openai" : "openai-compatible";
  const transformedReq = transformers.toProviderRequest(targetFormat, internalReq);

  // Build provider request
  const providerReq = provider.buildRequest(transformedReq, req.headers);
  const timeoutMs = provider.getTimeoutMs(config.server?.timeout);

  log.info(`${requestId} ${scheme.format}:${model} → ${route.provider}:${route.model} (stream=${body.stream ?? false})`);

  // Log entry
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    method: "POST",
    path: endpointPath,
    sourceScheme: scheme.format,
    targetScheme: targetFormat,
    provider: route.provider,
    model,
    targetModel: route.model,
    requestHeaders: Object.fromEntries(req.headers.entries()),
    requestBody: body,
    transformedBody: transformedReq,
    responseStatus: 200,
    durationMs: 0,
    routed: true,
    matchedPattern: route.pattern,
  };

  try {
    const response = await fetchWithTimeout(providerReq.url, {
      method: "POST",
      headers: providerReq.headers,
      body: JSON.stringify(providerReq.body),
    }, timeoutMs);

    logEntry.responseStatus = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      logEntry.error = `HTTP ${response.status}: ${errorText}`;
      logEntry.durationMs = Date.now() - startTime;
      await state.logging.log(logEntry);

      // Update tracking with error
      updateRequest(requestId, { status: 'error', error: `HTTP ${response.status}`, endTime: Date.now() });
      cleanupOldRequests();

      return jsonResponse(
        { error: "Upstream error", details: errorText },
        response.status,
        config,
        req.headers.get("origin")
      );
    }

    // Handle streaming
    if (body.stream && provider.supportsStreaming()) {
      const stream = await createStreamingResponse(
        response,
        scheme.format as transformers.ProviderFormat,
        targetFormat as transformers.ProviderFormat,
        route.model,
        logEntry,
        startTime,
        requestId
      );

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          ...getCORSHeaders(req.headers.get("origin"), config),
        },
      });
    }

    // Non-streaming response
    const responseData = await response.json();
    const internalResp = transformers.parseResponse(targetFormat, responseData);
    const clientResp = transformers.toProviderResponse(scheme.format as transformers.ProviderFormat, internalResp);

    // Store both raw upstream and transformed response when format conversion happened
    if (scheme.format !== targetFormat) {
      logEntry.rawUpstreamResponse = responseData;
      logEntry.transformedResponse = clientResp;
    }
    logEntry.responseBody = clientResp;
    logEntry.durationMs = Date.now() - startTime;
    await state.logging.log(logEntry);

    // Update tracking with response
    let responseContent = '';
    if (typeof clientResp === 'object' && clientResp !== null) {
      const resp = clientResp as Record<string, unknown>;
      const choices = resp.choices as unknown[] | undefined;
      if (choices && choices.length > 0) {
        const firstChoice = choices[0] as Record<string, unknown>;
        const message = firstChoice.message as Record<string, unknown> | undefined;
        if (message?.content) {
          responseContent = String(message.content);
        }
      }
      const content = resp.content as unknown[] | undefined;
      if (content && content.length > 0) {
        const firstContent = content[0] as Record<string, unknown>;
        if (firstContent.text) {
          responseContent = String(firstContent.text);
        }
      }
    }
    updateRequest(requestId, { 
      status: 'completed', 
      content: responseContent,
      endTime: Date.now() 
    });
    cleanupOldRequests();

    return jsonResponse(clientResp, 200, config, req.headers.get("origin"));

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logEntry.error = errorMessage;
    logEntry.durationMs = Date.now() - startTime;
    await state.logging.log(logEntry);

    // Update tracking with error
    updateRequest(requestId, { status: 'error', error: errorMessage, endTime: Date.now() });
    cleanupOldRequests();

    return jsonResponse(
      { error: "Internal error", message: errorMessage, requestId },
      500,
      config,
      req.headers.get("origin")
    );
  }
}

async function handleAnthropicPassthrough(
  req: Request,
  body: { stream?: boolean },
  provider: import("./providers/base.ts").BaseProvider,
  requestId: string,
  startTime: number,
  config: RouterConfig,
  internalReq: InternalRequest
): Promise<Response> {
  const providerReq = provider.buildRequest(body, req.headers);
  const timeoutMs = provider.getTimeoutMs(config.server?.timeout);

  log.info(`${requestId} anthropic → [ANTHROPIC PASSTHROUGH] (stream=${body.stream ?? false})`);

  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    method: "POST",
    path: "/v1/messages",
    sourceScheme: "anthropic",
    targetScheme: "anthropic",
    provider: "anthropic",
    model: (body as { model?: string }).model || "unknown",
    targetModel: (body as { model?: string }).model || "unknown",
    requestHeaders: Object.fromEntries(req.headers.entries()),
    requestBody: body,
    responseStatus: 200,
    durationMs: 0,
    routed: true,
  };

  try {
    const response = await fetchWithTimeout(providerReq.url, {
      method: "POST",
      headers: providerReq.headers,
      body: JSON.stringify(providerReq.body),
    }, timeoutMs);

    logEntry.responseStatus = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      logEntry.error = `HTTP ${response.status}: ${errorText}`;
      logEntry.durationMs = Date.now() - startTime;
      await state.logging.log(logEntry);

      return jsonResponse(
        { error: "Anthropic API error", details: errorText },
        response.status,
        config,
        req.headers.get("origin")
      );
    }

    logEntry.durationMs = Date.now() - startTime;

    if (body.stream) {
      // For streaming passthrough, tee the body to capture content for logging
      const [logStream, clientStream] = response.body!.tee();

      // Capture streamed content in background for logging
      (async () => {
        try {
          const reader = logStream.getReader();
          const decoder = new TextDecoder();
          let fullContent = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            // Extract text content from SSE events
            for (const line of text.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === "content_block_delta" && event.delta?.text) {
                  fullContent += event.delta.text;
                }
              } catch {}
            }
          }
          logEntry.responseBody = fullContent || { type: "streaming_passthrough" };
          state.logging.log(logEntry).catch(console.error);
        } catch {
          logEntry.responseBody = { type: "streaming_passthrough" };
          state.logging.log(logEntry).catch(console.error);
        }
      })();

      // Update tracking
      updateRequest(requestId, { status: 'streaming' });

      return new Response(clientStream, {
        status: response.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          ...getCORSHeaders(req.headers.get("origin"), config),
        },
      });
    }

    // Non-streaming: read and log the response body
    const responseData = await response.json();
    logEntry.responseBody = responseData;
    await state.logging.log(logEntry);

    // Update tracking
    const respData = responseData as Record<string, unknown>;
    const content = respData.content as unknown[] | undefined;
    let responseContent = '';
    if (content && content.length > 0) {
      const firstContent = content[0] as Record<string, unknown>;
      if (firstContent.text) {
        responseContent = String(firstContent.text);
      }
    }
    updateRequest(requestId, {
      status: 'completed',
      content: responseContent,
      endTime: Date.now()
    });
    cleanupOldRequests();

    return jsonResponse(responseData, response.status, config, req.headers.get("origin"));

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logEntry.error = errorMessage;
    logEntry.durationMs = Date.now() - startTime;
    await state.logging.log(logEntry);

    return jsonResponse(
      { error: "Internal error", message: errorMessage, requestId },
      500,
      config,
      req.headers.get("origin")
    );
  }
}

async function createStreamingResponse(
  response: Response,
  sourceFormat: transformers.ProviderFormat,
  targetFormat: transformers.ProviderFormat,
  model: string,
  logEntry: LogEntry,
  startTime: number,
  requestId?: string
): Promise<ReadableStream<Uint8Array>> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const isAnthropicSource = sourceFormat === "anthropic" || sourceFormat === "anthropic-messages";

  let buffer = "";
  let chunkIndex = 0;
  let outputTokens = 0;
  let finalStopReason: string | null = null;
  let streamAborted = false;
  let fullContent = "";
  // Track Anthropic content block state for proper block lifecycle
  let currentContentBlockIndex = 0;
  let currentContentBlockType: "text" | "tool_use" | null = isAnthropicSource ? "text" : null;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  // Update status to streaming
  if (requestId) {
    updateRequest(requestId, { status: 'streaming' });
  }

  // Process the upstream stream asynchronously
  (async () => {
    try {
      // Send stream start for Anthropic format
      if (isAnthropicSource) {
        await writer.write(encoder.encode(
          transformers.createStreamStart("anthropic", `msg_${Date.now()}`)
        ));
      }

      while (true) {
        let readResult: ReturnType<typeof reader.read> extends Promise<infer T> ? T : never;
        try {
          readResult = await reader.read();
        } catch (readError) {
          // Reader was cancelled (usually client disconnected)
          const msg = readError instanceof Error ? readError.message : String(readError);
          if (msg.includes("cancelled") || msg.includes("aborted") || msg.includes("released")) {
            log.debug(`[stream] reader cancelled after ${chunkIndex} chunks`);
          } else {
            log.error(`[stream] read error: ${msg}`);
          }
          break;
        }
        
        if (readResult.done) break;
        const value = readResult.value;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let streamComplete = false;
        for (const line of lines) {
          const chunk = transformers.parseStreamChunk(targetFormat, line);
          if (!chunk) continue;

          if (chunk.isComplete) {
            if (chunk.finishReason) finalStopReason = chunk.finishReason;
            if (chunk.usage) outputTokens = chunk.usage.completionTokens;
            streamComplete = true;
          } else {
            chunkIndex++;
            if (chunk.usage) outputTokens = chunk.usage.completionTokens;
            // Extract content for monitoring
            if (chunk.delta?.text) {
              fullContent += chunk.delta.text;
            }

            // For Anthropic source: handle content block transitions (text → tool_use)
            if (isAnthropicSource && chunk.delta.type === "tool_call" && currentContentBlockType !== "tool_use") {
              // Close the current text block before starting tool_use
              if (currentContentBlockType === "text") {
                await writer.write(encoder.encode(
                  transformers.createAnthropicStreamEvent("content_block_stop", { index: currentContentBlockIndex })
                ));
              }
              currentContentBlockIndex++;
              currentContentBlockType = "tool_use";
              // Emit content_block_start for the tool_use with correct index
              chunk.index = currentContentBlockIndex;
            } else if (isAnthropicSource) {
              // Keep the index consistent
              if (chunk.delta.type === "tool_call") {
                chunk.index = currentContentBlockIndex;
              } else {
                chunk.index = currentContentBlockIndex;
              }
            }

            const outputLine = transformers.toProviderStreamChunk(sourceFormat, chunk, model);
            await writer.write(encoder.encode(outputLine));
            // Update monitoring
            if (requestId) {
              updateRequest(requestId, { content: fullContent, chunks: chunkIndex });
            }
          }
        }

        if (streamComplete) break;
      }

      // Send stream end
      if (isAnthropicSource) {
        // Close the current content block
        await writer.write(encoder.encode(
          transformers.createAnthropicStreamEvent("content_block_stop", { index: currentContentBlockIndex })
        ));
        // Send message_delta with stop reason and message_stop
        const mappedReason = transformers.mapStopReason("openai", "anthropic", finalStopReason);
        await writer.write(encoder.encode(
          transformers.createAnthropicStreamEvent("message_delta", {
            delta: { stop_reason: mappedReason },
            usage: { output_tokens: outputTokens },
          })
        ));
        await writer.write(encoder.encode(
          transformers.createAnthropicStreamEvent("message_stop", {})
        ));
      } else {
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      }

      // Store the full concatenated response instead of just streaming metadata
      logEntry.responseBody = fullContent || { type: "streaming", chunkCount: chunkIndex };
      logEntry.durationMs = Date.now() - startTime;
      state.logging.log(logEntry).catch(console.error);
      
      // Mark as completed
      if (requestId) {
        updateRequest(requestId, { status: 'completed', endTime: Date.now() });
        cleanupOldRequests();
      }
    } catch (error) {
      streamAborted = true;
      
      // Determine the actual error message
      let errorMessage: string;
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error === undefined || error === null) {
        // writer.write() throws undefined/null when client disconnects in Bun
        errorMessage = "Client disconnected (stream write failed)";
      } else {
        errorMessage = String(error);
      }

      // Check if this is a client disconnect (not a real error)
      const isClientDisconnect = errorMessage.includes("cancelled") ||
                                  errorMessage.includes("aborted") ||
                                  errorMessage.includes("The operation was aborted") ||
                                  errorMessage.includes("Broken pipe") ||
                                  errorMessage.includes("Connection reset") ||
                                  errorMessage.includes("Client disconnected");
      
      if (isClientDisconnect) {
        log.debug(`[stream] client disconnected after ${chunkIndex} chunks`);
      } else {
        log.error(`[stream] error: ${errorMessage}`);
        if (error instanceof Error && error.stack) {
          log.error(`[stream] stack: ${error.stack}`);
        }
      }
      
      // Update log entry with info - include full content if available
      logEntry.error = isClientDisconnect ? undefined : errorMessage;
      logEntry.responseBody = fullContent || { type: "streaming", chunkCount: chunkIndex, aborted: true };
      logEntry.durationMs = Date.now() - startTime;
      state.logging.log(logEntry).catch(console.error);
      
      // Update request tracking
      if (requestId) {
        if (isClientDisconnect) {
          updateRequest(requestId, { status: 'completed', content: fullContent, endTime: Date.now() });
        } else {
          updateRequest(requestId, { status: 'error', error: errorMessage, endTime: Date.now() });
        }
        cleanupOldRequests();
      }
    } finally {
      reader.cancel().catch(() => {});
      // Only close writer gracefully if stream wasn't aborted
      if (!streamAborted) {
        await writer.close().catch(() => {});
      }
    }
  })();

  return readable;
}

function jsonResponse(data: unknown, status: number, config: RouterConfig, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCORSHeaders(origin, config),
    },
  });
}

// ============================================================================
// Management API (for GUI)
// ============================================================================

function handleManagementAPI(req: Request, url: URL): Promise<Response> | Response {
  const path = url.pathname.replace("/admin", "");
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Status endpoint
  if (path === "/status" && req.method === "GET") {
    return handleStatusRequest(corsHeaders);
  }

  // Providers endpoints
  if (path === "/providers") {
    if (req.method === "GET") return handleGetProviders(corsHeaders);
    if (req.method === "PUT") return handleUpdateProviders(req, corsHeaders);
  }

  // Routes endpoints
  if (path === "/routes") {
    if (req.method === "GET") return handleGetRoutes(corsHeaders);
    if (req.method === "PUT") return handleUpdateRoutes(req, corsHeaders);
    if (req.method === "POST") return handleAddRoute(req, corsHeaders);
  }

  // Schemes endpoints
  if (path === "/schemes") {
    if (req.method === "GET") return handleGetSchemes(corsHeaders);
    if (req.method === "PUT") return handleUpdateSchemes(req, corsHeaders);
  }

  // Config endpoints
  if (path === "/config") {
    if (req.method === "GET") return handleGetConfig(corsHeaders);
    if (req.method === "POST") return handleSaveConfig(req, corsHeaders);
  }

  // Backup endpoints
  if (path === "/backups") {
    if (req.method === "GET") return handleListBackups(corsHeaders);
    if (req.method === "POST") return handleCreateBackup(corsHeaders);
  }

  if (path.startsWith("/backups/")) {
    const filename = path.replace("/backups/", "");
    if (req.method === "POST") return handleRestoreBackup(filename, corsHeaders);
    if (req.method === "DELETE") return handleDeleteBackup(filename, corsHeaders);
  }

  // Unrouted requests endpoint
  if (path === "/unrouted" && req.method === "GET") {
    return handleGetUnrouted(corsHeaders);
  }

  if (path === "/unrouted" && req.method === "DELETE") {
    return handleClearUnrouted(corsHeaders);
  }

  // Logs endpoint
  if (path === "/logs" && req.method === "GET") {
    return handleGetLogs(url, corsHeaders);
  }

  // Server info endpoint (for GUI to know API URL)
  if (path === "/server-info" && req.method === "GET") {
    return handleGetServerInfo(corsHeaders, apiPort);
  }

  // Active requests endpoint (for live monitor)
  if (path === "/active-requests" && req.method === "GET") {
    return handleGetActiveRequests(corsHeaders);
  }

  // Models endpoint - returns available models from all sources
  if (path === "/models" && req.method === "GET") {
    return handleGetModels(url, corsHeaders);
  }

  return new Response(JSON.stringify({ error: "Not found" }), { 
    status: 404, 
    headers: { "Content-Type": "application/json", ...corsHeaders } 
  });
}

async function handleStatusRequest(headers: Record<string, string>): Promise<Response> {
  const stats = await state.logging.getStats();
  const config = state.config.getConfig();
  
  return new Response(JSON.stringify({
    status: "ok",
    version: state.version,
    uptime: Math.floor((Date.now() - state.startTime.getTime()) / 1000),
    configPath: state.config.getConfigPath(),
    providers: Object.keys(config.providers),
    routes: config.routes.length,
    ...stats,
  }), { headers: { "Content-Type": "application/json", ...headers } });
}

function handleGetProviders(headers: Record<string, string>): Response {
  const config = state.config.getConfig();
  
  // Build list of all builtin providers with enabled flag
  // Provider is "enabled" if:
  // 1. It's in config.providers (explicitly configured), OR
  // 2. It has an API key set via environment variable (for cloud providers)
  const allProviders: Array<ProviderInfo & { configured: boolean; enabled: boolean }> = [];
  
  for (const [id, builtin] of Object.entries(BUILTIN_PROVIDERS)) {
    const provider = providerRegistry.get(id);
    const providerConfig = config.providers[id];
    
    // Check if API key is available (either directly or via env)
    const hasApiKey = provider?.hasApiKey() || 
      (!!builtin.defaultApiKeyEnv && !!process.env[builtin.defaultApiKeyEnv]);
    
    // Provider is enabled if explicitly in config OR has API key
    const isEnabled = !!providerConfig || hasApiKey;
    
    // Provider is fully configured if it has API key or doesn't require one
    const isConfigured = hasApiKey || !builtin.requiresApiKey;
    
    allProviders.push({
      ...builtin,
      configured: isConfigured,
      enabled: isEnabled,
    });
  }
  
  // Add custom providers from config
  for (const [id, providerConfig] of Object.entries(config.providers)) {
    if (BUILTIN_PROVIDERS[id]) continue; // Skip builtins, already added
    
    const provider = providerRegistry.get(id);
    const hasApiKey = !!providerConfig.apiKey || 
      (!!providerConfig.apiKeyEnv && !!process.env[providerConfig.apiKeyEnv]);
    
    allProviders.push({
      id,
      name: id,
      description: "Custom provider",
      defaultBaseUrl: providerConfig.baseUrl || "",
      defaultApiKeyEnv: providerConfig.apiKeyEnv,
      authHeader: providerConfig.authHeader || "Authorization",
      authPrefix: providerConfig.authPrefix || "Bearer ",
      supportsStreaming: providerConfig.supportsStreaming ?? true,
      requiresApiKey: !!providerConfig.apiKeyEnv || !!providerConfig.apiKey,
      category: "custom" as const,
      configured: hasApiKey,
      enabled: true, // Custom providers are always enabled if in config
    });
  }
  
  return new Response(JSON.stringify({ 
    registered: allProviders,
    builtin: allProviders, // Same list for convenience
  }), { headers: { "Content-Type": "application/json", ...headers } });
}

async function handleUpdateProviders(req: Request, headers: Record<string, string>): Promise<Response> {
  try {
    const body = await req.json() as { providers: Record<string, ProviderConfig> };
    await state.config.updateProviders(body.providers);
    providerRegistry.initializeFromConfig(body.providers);
    
    return new Response(JSON.stringify({ success: true }), { 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { 
      status: 400, 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  }
}

function handleGetRoutes(headers: Record<string, string>): Response {
  const routes = state.router.getRoutes();
  return new Response(JSON.stringify({ routes }), { 
    headers: { "Content-Type": "application/json", ...headers } 
  });
}

async function handleUpdateRoutes(req: Request, headers: Record<string, string>): Promise<Response> {
  try {
    const body = await req.json() as { routes: RouteConfig[] };
    await state.config.updateRoutes(body.routes);
    state.router.setRoutes(body.routes);
    
    return new Response(JSON.stringify({ success: true }), { 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { 
      status: 400, 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  }
}

async function handleAddRoute(req: Request, headers: Record<string, string>): Promise<Response> {
  try {
    const route = await req.json() as RouteConfig;
    await state.config.addRoute(route);
    state.router.addRoute(route);
    
    return new Response(JSON.stringify({ success: true }), { 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { 
      status: 400, 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  }
}

function handleGetSchemes(headers: Record<string, string>): Response {
  const config = state.config.getConfig();
  return new Response(JSON.stringify({ schemes: config.schemes }), { 
    headers: { "Content-Type": "application/json", ...headers } 
  });
}

async function handleUpdateSchemes(req: Request, headers: Record<string, string>): Promise<Response> {
  try {
    const body = await req.json() as { schemes: ApiSchemeConfig[] };
    await state.config.updateSchemes(body.schemes);
    
    return new Response(JSON.stringify({ success: true }), { 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { 
      status: 400, 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  }
}

async function handleGetConfig(headers: Record<string, string>): Promise<Response> {
  const config = state.config.getConfig();
  return new Response(JSON.stringify(config), { 
    headers: { "Content-Type": "application/json", ...headers } 
  });
}

async function handleSaveConfig(req: Request, headers: Record<string, string>): Promise<Response> {
  try {
    const body = await req.json() as RouterConfig;
    await state.config.save(body, true);
    
    // Reload everything
    const config = state.config.getConfig();
    state.router.setRoutes(config.routes);
    providerRegistry.initializeFromConfig(config.providers);
    state.logging.setLogDir(config.logging?.dir || null);
    state.logging.setMaskKeys(config.logging?.maskKeys !== false);
    
    return new Response(JSON.stringify({ success: true }), { 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { 
      status: 400, 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  }
}

async function handleListBackups(headers: Record<string, string>): Promise<Response> {
  try {
    const backups = await state.config.listBackups();
    return new Response(JSON.stringify({ backups }), { 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { 
      status: 500, 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  }
}

async function handleCreateBackup(headers: Record<string, string>): Promise<Response> {
  try {
    const backup = await state.config.createBackup();
    return new Response(JSON.stringify({ backup }), { 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { 
      status: 500, 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  }
}

async function handleRestoreBackup(filename: string, headers: Record<string, string>): Promise<Response> {
  try {
    await state.config.restoreBackup(filename);
    
    // Reload everything
    const config = state.config.getConfig();
    state.router.setRoutes(config.routes);
    providerRegistry.initializeFromConfig(config.providers);
    state.logging.setLogDir(config.logging?.dir || null);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json", ...headers }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...headers }
    });
  }
}

async function handleDeleteBackup(filename: string, headers: Record<string, string>): Promise<Response> {
  try {
    await state.config.deleteBackup(filename);
    return new Response(JSON.stringify({ success: true }), { 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { 
      status: 500, 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  }
}

function handleGetUnrouted(headers: Record<string, string>): Response {
  const unrouted = state.logging.getUnroutedRequests();
  return new Response(JSON.stringify({ unrouted }), { 
    headers: { "Content-Type": "application/json", ...headers } 
  });
}

function handleClearUnrouted(headers: Record<string, string>): Response {
  state.logging.clearUnroutedRequests();
  return new Response(JSON.stringify({ success: true }), { 
    headers: { "Content-Type": "application/json", ...headers } 
  });
}

async function handleGetLogs(url: URL, headers: Record<string, string>): Promise<Response> {
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  
  try {
    const logs = await state.logging.getRecentLogs(limit);
    return new Response(JSON.stringify({ logs }), { 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { 
      status: 500, 
      headers: { "Content-Type": "application/json", ...headers } 
    });
  }
}

function handleGetServerInfo(headers: Record<string, string>, actualPort: number): Response {
  // Use the same logic as display hostname - prefer actual hostname over localhost
  const config = state.config.getConfig();
  const host = getDisplayHostname(undefined, config.server?.host);
  const protocol = "http";
  // Use external port if configured (for container port mappings), otherwise use actual port
  const port = config.server?.externalPort ?? actualPort;
  
  return new Response(JSON.stringify({
    apiUrl: `${protocol}://${host}:${port}`,
    version: state.version,
    uptime: Math.floor((Date.now() - state.startTime.getTime()) / 1000),
  }), { headers: { "Content-Type": "application/json", ...headers } });
}

function handleGetActiveRequests(headers: Record<string, string>): Response {
  const requests = Array.from(activeRequests.values());
  return new Response(JSON.stringify({ requests }), {
    headers: { "Content-Type": "application/json", ...headers }
  });
}

interface ModelInfo {
  id: string;
  name: string;
  source: 'route' | 'provider';
  provider?: string;
  description?: string;
}

async function handleGetModels(url: URL, headers: Record<string, string>): Promise<Response> {
  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  const providerFilter = url.searchParams.get('provider');
  const sourceFilter = url.searchParams.get('source'); // 'route', 'provider', or null for all
  
  // 1. Add models from route patterns (only if not filtering to provider-only)
  if (sourceFilter !== 'provider') {
    const routes = state.router.getRoutes();
    for (const route of routes) {
      // Skip if filtering by provider and doesn't match
      if (providerFilter && route.provider !== providerFilter) continue;
      
      // Generate example models from patterns by stripping wildcards
      const pattern = route.pattern;
      const examples: string[] = [];
      
      if (pattern.includes('*')) {
        // For wildcard patterns, add the base pattern without wildcards
        const basePattern = pattern.replace(/\*/g, '');
        if (basePattern && !seen.has(basePattern)) {
          examples.push(basePattern);
        }
      } else {
        examples.push(pattern);
      }
      
      for (const model of examples) {
        if (!seen.has(model)) {
          seen.add(model);
          models.push({
            id: model,
            name: model,
            source: 'route',
            provider: route.provider,
          });
        }
      }
    }
  }
  
  // 2. Fetch models from providers (only if not filtering to route-only)
  if (sourceFilter !== 'route') {
    const config = state.config.getConfig();
    
    // Build list of enabled providers (same logic as handleGetProviders)
    const enabledProviders: string[] = [];
    for (const [id, builtin] of Object.entries(BUILTIN_PROVIDERS)) {
      const provider = providerRegistry.get(id);
      const providerConfig = config.providers[id];
      const hasApiKey = provider?.hasApiKey() || 
        (!!builtin.defaultApiKeyEnv && !!process.env[builtin.defaultApiKeyEnv]);
      if (!!providerConfig || hasApiKey) {
        enabledProviders.push(id);
      }
    }
    // Add custom providers
    for (const id of Object.keys(config.providers)) {
      if (!BUILTIN_PROVIDERS[id] && !enabledProviders.includes(id)) {
        enabledProviders.push(id);
      }
    }
    
    log.debug(`[models] Enabled providers: ${enabledProviders.join(', ')}`);
    log.debug(`[models] Provider filter: ${providerFilter || 'none'}`);
    
    for (const providerId of enabledProviders) {
      // Skip if filtering by provider and doesn't match
      if (providerFilter && providerId !== providerFilter) {
        log.debug(`[models] Skipping ${providerId} - doesn't match filter ${providerFilter}`);
        continue;
      }
      
      const savedConfig = config.providers[providerId];
      
      try {
        const provider = providerRegistry.get(providerId);
        if (!provider) {
          log.debug(`[models] Provider ${providerId} not found in registry`);
          continue;
        }
        
        // Use the provider's getModelsUrl method to get the correct URL
        const modelsUrl = provider.getModelsUrl();
        if (!modelsUrl) {
          log.debug(`[models] Provider ${providerId} has no models URL`);
          continue;
        }
        
        // Only send auth headers if provider has an API key configured
        // Some local servers (LM Studio, Ollama, etc.) reject requests with empty Authorization headers
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        
        // Add auth headers only if API key is configured
        // Check saved config first, then fall back to provider's method
        const apiKey = savedConfig?.apiKey || 
          (savedConfig?.apiKeyEnv ? process.env[savedConfig.apiKeyEnv] : undefined) ||
          provider.getApiKey();
        const authHeader = savedConfig?.authHeader || BUILTIN_PROVIDERS[providerId]?.authHeader;
        const authPrefix = savedConfig?.authPrefix || BUILTIN_PROVIDERS[providerId]?.authPrefix || '';
        
        if (apiKey && authHeader) {
          headers[authHeader] = `${authPrefix}${apiKey}`;
        }
        
        // Add any custom headers from config
        if (savedConfig?.headers) {
          Object.assign(headers, savedConfig.headers);
        }
        
        log.debug(`[models] Fetching from ${providerId}: ${modelsUrl}`);
        
        // Add a 5-second timeout to prevent hanging on unreachable providers
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        let response: Response;
        try {
          response = await fetch(modelsUrl, {
            method: 'GET',
            headers,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        
        log.debug(`[models] ${providerId} response: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'no body');
          log.debug(`[models] ${providerId} error response: ${errorText.slice(0, 200)}`);
        }
        
        if (response.ok) {
          const data = await response.json() as { 
            data?: Array<{ id: string; description?: string }>;
            models?: Array<{ id?: string; name?: string; description?: string; model?: string }>;
          };
          
          // Handle OpenAI-style response format (data array)
          if (data.data && Array.isArray(data.data)) {
            for (const model of data.data) {
              if (!seen.has(model.id)) {
                seen.add(model.id);
                models.push({
                  id: model.id,
                  name: model.id,
                  source: 'provider',
                  provider: providerId,
                  description: model.description,
                });
              }
            }
          }
          // Handle Ollama-style response format (models array)
          else if (data.models && Array.isArray(data.models)) {
            for (const model of data.models) {
              const modelId = model.id || model.name || model.model || '';
              if (modelId && !seen.has(modelId)) {
                seen.add(modelId);
                models.push({
                  id: modelId,
                  name: modelId,
                  source: 'provider',
                  provider: providerId,
                  description: model.description,
                });
              }
            }
          }
        }
      } catch (error) {
        // Provider doesn't support /models endpoint or is unreachable - that's ok
        log.debug(`[models] Could not fetch from ${providerId}: ${error}`);
      }
    }
  }
  
  return new Response(JSON.stringify({ models }), {
    headers: { "Content-Type": "application/json", ...headers }
  });
}

// Fetch with timeout helper for models endpoint
async function fetchWithTimeoutModels(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    return null;
  }
}

// OpenAI-compatible /v1/models endpoint
async function handleGetModelsOpenAI(corsHeaders: Record<string, string>): Promise<Response> {
  const models: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }> = [];
  const seen = new Set<string>();
  const now = Math.floor(Date.now() / 1000);
  
  const routes = state.router.getRoutes();
  const config = state.config.getConfig();
  
  // Fetch models from all configured providers in parallel with timeout
  const providerFetches = Object.entries(config.providers).map(async ([providerId, providerConfig]) => {
    try {
      const provider = providerRegistry.get(providerId);
      if (!provider) return [];
      
      const modelsUrl = provider.getModelsUrl();
      if (!modelsUrl) return [];
      
      // Only send auth headers if provider has an API key configured
      // Some local servers (LM Studio, Ollama, etc.) reject requests with empty Authorization headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // Add auth headers only if API key is configured
      const apiKey = providerConfig?.apiKey || 
        (providerConfig?.apiKeyEnv ? process.env[providerConfig.apiKeyEnv] : undefined);
      if (apiKey && providerConfig?.authHeader) {
        headers[providerConfig.authHeader] = `${providerConfig.authPrefix || ''}${apiKey}`;
      }
      
      // Add any custom headers from config
      if (providerConfig?.headers) {
        Object.assign(headers, providerConfig.headers);
      }
      
      // 3 second timeout for provider model fetching
      const response = await fetchWithTimeoutModels(modelsUrl, headers, 3000);
      if (!response || !response.ok) return [];
      
      const data = await response.json() as { 
        data?: Array<{ id: string; created?: number; owned_by?: string }>;
        models?: Array<{ id?: string; name?: string; model?: string; created?: number; owned_by?: string }>;
      };
      
      const providerModels: Array<{ id: string; created: number; owned_by: string }> = [];
      
      // Handle OpenAI-style response format (data array)
      if (data.data && Array.isArray(data.data)) {
        for (const model of data.data) {
          if (model.id && !seen.has(model.id)) {
            seen.add(model.id);
            providerModels.push({
              id: model.id,
              created: model.created || now,
              owned_by: model.owned_by || providerId,
            });
          }
        }
      }
      // Handle Ollama-style response format (models array with 'name' field)
      else if (data.models && Array.isArray(data.models)) {
        for (const model of data.models) {
          const modelId = model.id || model.name || model.model || '';
          if (modelId && !seen.has(modelId)) {
            seen.add(modelId);
            providerModels.push({
              id: modelId,
              created: model.created || now,
              owned_by: model.owned_by || providerId,
            });
          }
        }
      }
      
      return providerModels;
    } catch (error) {
      // Provider doesn't support /models endpoint or is unreachable - that's ok
      log.debug(`[models] Could not fetch from ${providerId}: ${error}`);
      return [];
    }
  });
  
  // Wait for all provider fetches to complete
  const providerResults = await Promise.allSettled(providerFetches);
  for (const result of providerResults) {
    if (result.status === 'fulfilled' && result.value.length > 0) {
      for (const model of result.value) {
        models.push({
          ...model,
          object: "model",
        });
      }
    }
  }
  
  // Add models from route patterns (strip wildcards for cleaner display)
  for (const route of routes) {
    // Strip wildcards from pattern to get base model name
    const basePattern = route.pattern.replace(/[\*\?]/g, '');
    if (!basePattern) continue;
    
    // Use the stripped pattern as the model id
    if (!seen.has(basePattern)) {
      seen.add(basePattern);
      models.push({
        id: basePattern,
        object: "model",
        created: now,
        owned_by: route.provider,
      });
    }
  }
  
  return new Response(JSON.stringify({ 
    object: "list",
    data: models 
  }), {
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

// Anthropic-compatible /v1/models endpoint
async function handleGetModelsAnthropic(corsHeaders: Record<string, string>): Promise<Response> {
  const models: Array<{
    type: string;
    id: string;
    display_name: string;
    created_at: string;
  }> = [];
  const seen = new Set<string>();
  
  const routes = state.router.getRoutes();
  const config = state.config.getConfig();
  const now = new Date().toISOString();
  
  // Fetch models from all configured providers in parallel with timeout
  const providerFetches = Object.entries(config.providers).map(async ([providerId, providerConfig]) => {
    try {
      const provider = providerRegistry.get(providerId);
      if (!provider) return [];
      
      const modelsUrl = provider.getModelsUrl();
      if (!modelsUrl) return [];
      
      // Only send auth headers if provider has an API key configured
      // Some local servers (LM Studio, Ollama, etc.) reject requests with empty Authorization headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // Add auth headers only if API key is configured
      const apiKey = providerConfig?.apiKey || 
        (providerConfig?.apiKeyEnv ? process.env[providerConfig.apiKeyEnv] : undefined);
      if (apiKey && providerConfig?.authHeader) {
        headers[providerConfig.authHeader] = `${providerConfig.authPrefix || ''}${apiKey}`;
      }
      
      // Add any custom headers from config
      if (providerConfig?.headers) {
        Object.assign(headers, providerConfig.headers);
      }
      
      // 3 second timeout for provider model fetching
      const response = await fetchWithTimeoutModels(modelsUrl, headers, 3000);
      if (!response || !response.ok) return [];
      
      const data = await response.json() as { 
        data?: Array<{ 
          type?: string;
          id: string; 
          display_name?: string;
          created_at?: string;
        }>;
        models?: Array<{ id?: string; name?: string; model?: string; created?: number }>;
      };
      
      const providerModels: Array<{ type: string; id: string; display_name: string; created_at: string }> = [];
      
      // Handle Anthropic/OpenAI-style response format (data array)
      if (data.data && Array.isArray(data.data)) {
        for (const model of data.data) {
          if (model.id && !seen.has(model.id)) {
            seen.add(model.id);
            providerModels.push({
              type: model.type || "model",
              id: model.id,
              display_name: model.display_name || model.id,
              created_at: model.created_at || now,
            });
          }
        }
      }
      // Handle Ollama-style response format
      else if (data.models && Array.isArray(data.models)) {
        for (const model of data.models) {
          const modelId = model.id || model.name || model.model || '';
          if (modelId && !seen.has(modelId)) {
            seen.add(modelId);
            providerModels.push({
              type: "model",
              id: modelId,
              display_name: modelId,
              created_at: now,
            });
          }
        }
      }
      
      return providerModels;
    } catch (error) {
      log.debug(`[models] Could not fetch from ${providerId}: ${error}`);
      return [];
    }
  });
  
  // Wait for all provider fetches to complete
  const providerResults = await Promise.allSettled(providerFetches);
  for (const result of providerResults) {
    if (result.status === 'fulfilled' && result.value.length > 0) {
      models.push(...result.value);
    }
  }
  
  // Add models from route patterns (strip wildcards for cleaner display)
  for (const route of routes) {
    // Strip wildcards from pattern to get base model name
    const basePattern = route.pattern.replace(/[\*\?]/g, '');
    if (!basePattern) continue;
    
    // Use the stripped pattern as the model id
    if (!seen.has(basePattern)) {
      seen.add(basePattern);
      models.push({
        type: "model",
        id: basePattern,
        display_name: basePattern,
        created_at: now,
      });
    }
  }
  
  const firstModel = models[0];
  const lastModel = models[models.length - 1];
  return new Response(JSON.stringify({
    data: models,
    has_more: false,
    first_id: firstModel ? firstModel.id : null,
    last_id: lastModel ? lastModel.id : null,
  }), {
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

// ============================================================================
// Main Server
// ============================================================================

async function main() {
  const args = parseArgs();
  
  if (args.help) {
    showHelp();
  }

  const configPath = args.config || "config/config.yaml";
  const guiPort = args["no-gui"] ? 0 : (args["gui-port"] ? parseInt(args["gui-port"], 10) : 3001);
  const isDev = process.argv.includes("--hot") || !!process.env.BUN_HOT;
  
  // CLI overrides for server config (will be applied after config load)
  const cliPort = args.port ? parseInt(args.port, 10) : undefined;
  const cliExternalPort = args["external-port"] ? parseInt(args["external-port"], 10) : undefined;

  // Set log level from CLI arg early
  if (args["log-level"]) {
    setLogLevel(args["log-level"]);
  }

  // Initialize state
  const configManager = new ConfigManager(configPath);

  try {
    await configManager.load();
  } catch (error) {
    log.warn(`Config not found: ${configManager.getConfigPath()}`);

    // First-time: auto-detect reachable providers
    const defaultConfig = await ConfigManager.createInitialConfig(configPath);

    // Apply CLI overrides
    if (args.port) defaultConfig.server!.port = parseInt(args.port, 10);
    if (args["external-port"]) defaultConfig.server!.externalPort = parseInt(args["external-port"], 10);
    if (args.timeout) defaultConfig.server!.timeout = parseInt(args.timeout, 10);
    if (args["log-dir"]) defaultConfig.logging!.dir = args["log-dir"];

    await configManager.save(defaultConfig, false);
    log.info(`Config created at: ${configManager.getConfigPath()}`);
  }

const config = configManager.getConfig();

  // Apply CLI overrides
  if (cliPort !== undefined) {
    config.server!.port = cliPort;
  }
  if (cliExternalPort !== undefined) {
    config.server!.externalPort = cliExternalPort;
  }
  
  // Set log level from config (CLI takes precedence, already set above)
  if (!args["log-level"] && config.logging?.level) {
    setLogLevel(config.logging.level);
  }

  // Initialize logging
  const loggingManager = new LoggingManager(
    args["log-dir"] || config.logging?.dir,
    config.logging?.maskKeys !== false
  );
  await loggingManager.initialize();

  // Initialize router (top-down matching, no priority sorting)
  const router = new Router({
    routes: config.routes,
  });

  // Initialize providers
  providerRegistry.initializeFromConfig(config.providers);

  // Set up state
  state = {
    config: configManager,
    router,
    logging: loggingManager,
    version: "2.0.0",
    startTime: new Date(),
  };

  // Listen for log events to print filename to stdout
  loggingManager.on("logged", ({ filename }: { filename: string }) => {
    log.debug(`Log written: ${filename}`);
  });
  
  // Listen for log events to broadcast to WebSocket clients
  loggingManager.on("logged", ({ entry }: { entry: LogEntry }) => {
    broadcastLogEntry(entry);
  });

  // Override port from CLI
  apiPort = cliPort ?? (config.server?.port || 3000);
  const host = config.server?.host || "0.0.0.0";
  const displayHost = getDisplayHostname(args.hostname, config.server?.host);

  // Print startup banner
  const BOX_WIDTH = 79;
  const BORDER_LEFT = "║";
  const BORDER_RIGHT = "║";
  const CORNER_TL = "╔";
  const CORNER_TR = "╗";
  const CORNER_BL = "╚";
  const CORNER_BR = "╝";
  const HORIZONTAL = "═";
  const T_LEFT = "╠";
  const T_RIGHT = "╣";
  
  // Inner content width (excluding borders)
  const INNER_WIDTH = BOX_WIDTH - BORDER_LEFT.length - BORDER_RIGHT.length;
  
  function boxTop(): string {
    return CORNER_TL + HORIZONTAL.repeat(INNER_WIDTH) + CORNER_TR;
  }
  
  function boxSeparator(): string {
    return T_LEFT + HORIZONTAL.repeat(INNER_WIDTH) + T_RIGHT;
  }
  
  function boxBottom(): string {
    return CORNER_BL + HORIZONTAL.repeat(INNER_WIDTH) + CORNER_BR;
  }
  
  function boxLine(left: string, right: string = ""): string {
    const gap = right ? " " : "";
    const content = left + gap + right;
    const paddingNeeded = INNER_WIDTH - content.length - 1; // -1 for trailing space
    const padding = Math.max(0, paddingNeeded);
    return BORDER_LEFT + left + " ".repeat(padding) + gap + right + " " + BORDER_RIGHT;
  }
  
  function boxCenter(text: string): string {
    const padding = Math.max(0, INNER_WIDTH - text.length);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return BORDER_LEFT + " ".repeat(leftPad) + text + " ".repeat(rightPad) + BORDER_RIGHT;
  }
  
  const apiServerLine = `http://${displayHost}:${apiPort}`;
  const guiServerLine = guiPort > 0 ? `http://${displayHost}:${guiPort}` : "Disabled";
  const displayConfigPath = configManager.getConfigPath();
  
  const activeProviders = Object.entries(config.providers)
    .filter(([id]) => router.getStats().providers.includes(id));
  
  const providerLines = activeProviders.length > 0
    ? activeProviders.map(([id, p]) => {
        const baseUrl = p.baseUrl || "(default)";
        const left = `  - ${id.padEnd(13)} → ${baseUrl.slice(0, 45)}`;
        return boxLine(left);
      })
    : [boxLine("  (none)")];
  
  const routeLines = config.routes.length > 0
    ? config.routes.map((r, i) => {
        const modelInfo = r.model || "(as-is)";
        const left = `  ${i + 1}. ${r.pattern} → ${r.provider}:${modelInfo}`;
        return boxLine(left.slice(0, INNER_WIDTH));
      })
    : [boxLine("  (none)")];
  
  console.log(`
${boxTop()}
${boxCenter(`Universal Model Router v${state.version}`)}
${boxSeparator()}
${boxLine("  API Server: ", apiServerLine)}
${guiPort > 0 ? boxLine("  GUI Server: ", guiServerLine) : boxLine("  GUI:        ", "Disabled")}
${boxLine("  Config:     ", displayConfigPath)}
${boxSeparator()}
${boxLine("  Active Providers:")}
${providerLines.join("\n")}
${boxSeparator()}
${boxLine("  Routes (top-down, first match wins):")}
${routeLines.join("\n")}
${boxBottom()}
`);

  // Print supported endpoints
  log.info("Supported endpoints:");
  config.schemes?.forEach(s => {
    log.info(`  POST http://${displayHost}:${apiPort}${getSchemePath(s)} (${s.format})`);
  });
  log.info(`Health check: http://${displayHost}:${apiPort}/health`);

  // Start API server
  server = Bun.serve({
    port: apiPort,
    hostname: host,
    idleTimeout: Math.min(config.server?.timeout || 120, 255),
    
    async fetch(req, server) {
      const url = new URL(req.url);
      const requestOrigin = req.headers.get("origin");
      const corsHeaders = getCORSHeaders(requestOrigin, config);
      const requestId = generateRequestId();
      const startTime = Date.now();

      // CORS preflight — admin endpoints always allow all origins
      if (req.method === "OPTIONS") {
        if (url.pathname.startsWith("/admin/")) {
          return new Response(null, { status: 204, headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          }});
        }
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // WebSocket upgrade for live monitor
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req, {
          data: { requestId }
        });
        if (upgraded) {
          return undefined;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Health check
      if (url.pathname === "/health" || url.pathname === "/") {
        return jsonResponse({
          status: "ok",
          version: state.version,
          requestId,
          providers: Object.keys(config.providers),
          schemes: config.schemes?.map(s => s.id),
        }, 200, config, requestOrigin);
      }

      // Admin UI redirect (root path only)
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        return new Response(null, {
          status: 302,
          headers: {
            "Location": `http://${displayHost}:${guiPort}/`,
          },
        });
      }

      // Management API
      if (url.pathname.startsWith("/admin/")) {
        return handleManagementAPI(req, url);
      }

      // OpenAI-compatible /v1/models endpoint
      if (url.pathname === "/v1/models" && req.method === "GET") {
        // Check if it's an Anthropic request based on headers
        if (req.headers.get("anthropic-version") || req.headers.get("x-api-key")) {
          return handleGetModelsAnthropic(corsHeaders);
        }
        return handleGetModelsOpenAI(corsHeaders);
      }

      // Handle API requests
      return handleRequest(req, requestId, startTime);
    },
    
    websocket: {
      async open(ws) {
        wsClients.add(ws);
        // Send current active requests to new client
        const requests = Array.from(activeRequests.values());
        ws.send(JSON.stringify({ type: 'initial', requests }));
        // Send recent logs so the logs page isn't empty on connect
        try {
          const recentLogs = await state.logging.getRecentLogs(50);
          ws.send(JSON.stringify({ type: 'initial_logs', logs: recentLogs }));
        } catch (err) {
          log.error(`Failed to send initial logs: ${err}`);
        }
      },
      async close(ws) {
        wsClients.delete(ws);
      },
      async message(ws, message) {
        // Handle client messages if needed
        try {
          const data = JSON.parse(message as string);
          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // Ignore invalid messages
        }
      },
    },
  });

  log.info(`API server running at http://${displayHost}:${apiPort}/`);
  log.info(`Management API at http://${displayHost}:${apiPort}/admin/`);

  // Start GUI server if enabled
  let guiProcess: import("bun").Subprocess | null = null;

  if (guiPort > 0) {
    if (isDev) {
      // Dev mode: launch SvelteKit dev server for hot reload
      const guiDir = join(dirname(import.meta.dir), "gui");
      if (existsSync(join(guiDir, "package.json"))) {
        log.info(`Starting GUI dev server (hot reload) on port ${guiPort}...`);
        guiProcess = Bun.spawn(
          ["bun", "run", "dev", "--port", String(guiPort), "--host"],
          {
            cwd: guiDir,
            stdio: ["ignore", "inherit", "inherit"],
            env: {
              ...process.env,
              API_PORT: String(apiPort),
            },
          }
        );
        log.info(`GUI dev server at http://${displayHost}:${guiPort}/`);
      } else {
        log.warn(`GUI source not found at ${guiDir}`);
      }
    } else {
      // Production: serve built GUI files
      const guiDir = join(dirname(import.meta.dir), "gui", "build");
      if (existsSync(guiDir)) {
        const guiServer = Bun.serve({
          port: guiPort,
          hostname: host,
          idleTimeout: 30,

          async fetch(req) {
            const url = new URL(req.url);

            // Determine file path
            let filePath = join(guiDir, url.pathname);
            
            // Check if it's a directory or doesn't exist - serve index.html
            let stat;
            try {
              stat = await filePathStat(filePath);
            } catch {
              stat = null;
            }
            
            const isIndexHtml = !stat || stat.isDirectory() || url.pathname === "/" || url.pathname === "/index.html";
            
            if (isIndexHtml) {
              filePath = join(guiDir, "index.html");
              const content = await Bun.file(filePath).text();
              const injected = content.replace('"{{API_PORT}}"', String(apiPort));
              return new Response(injected, {
                headers: { "Content-Type": "text/html" },
              });
            }

            return new Response(Bun.file(filePath));
          },
        });

        log.info(`GUI server running at http://${displayHost}:${guiPort}/`);
      } else {
        log.warn(`GUI build not found at ${guiDir}. Run 'cd gui && bun run build' to build the GUI.`);
      }
    }
  }

  // Graceful shutdown
  const shutdown = () => {
    log.info("Shutting down...");
    if (guiProcess) guiProcess.kill();
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(error => {
  log.error(`Fatal error: ${error}`);
  process.exit(1);
});
