#!/usr/bin/env bun
// ============================================================================
// Universal Model Router - Main Server
// ============================================================================

import type { Server, ServerWebSocket } from "bun";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
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
import { providerRegistry, BUILTIN_PROVIDERS } from "./providers/registry.ts";
import { LoggingManager } from "./logging/index.ts";
import { Router } from "./router/index.ts";
import * as transformers from "./transformers/index.ts";

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
  content?: string;
  error?: string;
  chunks: number;
  startTime: number;
  endTime?: number;
}

let state: ServerState;
let server: Server;

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
${line("  --log-dir <path>       Override log directory from config")}
${line("  --timeout <seconds>    Override timeout from config")}
${line("  --gui-port <number>    Port for management GUI (default: 3001)")}
${line("  --hostname <name>      Hostname for URLs (default: actual hostname)")}
${line("  --no-gui               Disable management GUI")}
${line("  --help                 Show this help message")}
${line("")}
${line("Examples:")}
${line("  # Use default config")}
${line("  bun run src/server.ts")}
${line("")}
${line("  # Custom config and ports")}
${line("  bun run src/server.ts --config ./my-config.yaml --port 8080 --gui-port 8081")}
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
    } else {
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
    body = await req.json();
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
    sourceFormat: scheme.format,
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
  trackRequest({
    requestId,
    timestamp: new Date().toISOString(),
    model,
    targetModel: route.model,
    provider: route.provider,
    sourceScheme: scheme.format,
    stream: streamMode,
    status: 'pending',
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

  console.log(`[${new Date().toISOString()}] ${requestId} ${scheme.format}:${model} → ${route.provider}:${route.model} (stream=${body.stream ?? false})`);

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
        scheme.format,
        targetFormat,
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
    const clientResp = transformers.toProviderResponse(scheme.format, internalResp);

    logEntry.responseBody = clientResp;
    logEntry.durationMs = Date.now() - startTime;
    await state.logging.log(logEntry);

    // Update tracking with response
    const responseContent = typeof clientResp === 'object' && clientResp !== null
      ? (clientResp as Record<string, unknown>).choices?.[0]?.message?.content ||
        (clientResp as Record<string, unknown>).content?.[0]?.text || ''
      : '';
    updateRequest(requestId, { 
      status: 'completed', 
      content: String(responseContent),
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

  console.log(`[${new Date().toISOString()}] ${requestId} anthropic → [ANTHROPIC PASSTHROUGH] (stream=${body.stream ?? false})`);

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
    await state.logging.log(logEntry);

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": body.stream ? "text/event-stream" : "application/json",
        ...getCORSHeaders(req.headers.get("origin"), config),
      },
    });

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
  sourceFormat: string,
  targetFormat: string,
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
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await reader.read();
        } catch (readError) {
          // Reader was cancelled (usually client disconnected)
          const msg = readError instanceof Error ? readError.message : String(readError);
          if (msg.includes("cancelled") || msg.includes("aborted") || msg.includes("released")) {
            console.log(`[stream] reader cancelled after ${chunkIndex} chunks`);
          } else {
            console.error(`[stream] read error: ${msg}`);
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
        const mappedReason = transformers.mapStopReason("openai", "anthropic", finalStopReason);
        await writer.write(encoder.encode(
          transformers.createStreamStop("anthropic", mappedReason, outputTokens)
        ));
      } else {
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      }

      logEntry.responseBody = { type: "streaming", chunkCount: chunkIndex };
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
        errorMessage = "Unknown stream error";
      } else {
        errorMessage = String(error);
      }
      
      // Check if this is a client disconnect (not a real error)
      const isClientDisconnect = errorMessage.includes("cancelled") || 
                                  errorMessage.includes("aborted") ||
                                  errorMessage.includes("The operation was aborted") ||
                                  errorMessage.includes("Broken pipe") ||
                                  errorMessage.includes("Connection reset");
      
      if (isClientDisconnect) {
        console.log(`[stream] client disconnected after ${chunkIndex} chunks`);
      } else {
        console.error(`[stream] error: ${errorMessage}`);
        if (error instanceof Error && error.stack) {
          console.error(`[stream] stack: ${error.stack}`);
        }
      }
      
      // Update log entry with info
      logEntry.error = isClientDisconnect ? undefined : errorMessage;
      logEntry.responseBody = { type: "streaming", chunkCount: chunkIndex, aborted: true };
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
  const path = url.pathname.replace("/api/admin", "");
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

  // Default provider endpoint
  if (path === "/default-provider") {
    if (req.method === "GET") return handleGetDefaultProvider(corsHeaders);
    if (req.method === "PUT") return handleUpdateDefaultProvider(req, corsHeaders);
  }

  // Server info endpoint (for GUI to know API URL)
  if (path === "/server-info" && req.method === "GET") {
    return handleGetServerInfo(corsHeaders);
  }

  // Active requests endpoint (for live monitor)
  if (path === "/active-requests" && req.method === "GET") {
    return handleGetActiveRequests(corsHeaders);
  }

  // Models endpoint - returns available models from all sources
  if (path === "/models" && req.method === "GET") {
    return handleGetModels(corsHeaders);
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
  const providers = providerRegistry.getRegisteredProviderInfos();
  const builtin = Object.entries(BUILTIN_PROVIDERS).map(([id, info]) => ({
    id,
    ...info,
  }));
  
  return new Response(JSON.stringify({ 
    registered: providers,
    builtin,
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
    state.router.setDefaultProvider(config.defaultProvider);
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
    state.router.setDefaultProvider(config.defaultProvider);
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

function handleGetDefaultProvider(headers: Record<string, string>): Response {
  const config = state.config.getConfig();
  return new Response(JSON.stringify({ defaultProvider: config.defaultProvider }), { 
    headers: { "Content-Type": "application/json", ...headers } 
  });
}

async function handleUpdateDefaultProvider(req: Request, headers: Record<string, string>): Promise<Response> {
  try {
    const body = await req.json() as { defaultProvider?: string };
    await state.config.updateDefaultProvider(body.defaultProvider);
    state.router.setDefaultProvider(body.defaultProvider);
    
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

function handleGetServerInfo(headers: Record<string, string>): Response {
  const config = state.config.getConfig();
  const port = config.server?.port || 3000;
  const host = config.server?.host || "localhost";
  const protocol = "http";
  
  return new Response(JSON.stringify({
    apiUrl: `${protocol}://${host === "0.0.0.0" ? "localhost" : host}:${port}`,
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

async function handleGetModels(headers: Record<string, string>): Promise<Response> {
  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  
  // 1. Add models from route patterns (strip wildcards)
  const routes = state.router.getRoutes();
  for (const route of routes) {
    // Generate example models from patterns by stripping wildcards
    const pattern = route.pattern;
    const examples: string[] = [];
    
    if (pattern.includes('*')) {
      // For wildcard patterns, add the base pattern without wildcards
      const basePattern = pattern.replace(/\*/g, '');
      if (basePattern && !seen.has(basePattern)) {
        examples.push(basePattern);
      }
      // Also add some common variations
      if (pattern.includes('gpt-4*')) {
        examples.push('gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo');
      } else if (pattern.includes('claude*')) {
        examples.push('claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307');
      } else if (pattern.includes('local/*')) {
        examples.push('local/llama2', 'local/mistral', 'local/codellama');
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
  
  // 2. Fetch models from providers
  const config = state.config.getConfig();
  for (const [providerId, providerConfig] of Object.entries(config.providers)) {
    try {
      const provider = providerRegistry.get(providerId);
      if (!provider) continue;
      
      const info = provider.getInfo();
      const baseUrl = providerConfig.baseUrl || info.defaultBaseUrl;
      
      // Try to fetch models from the provider's /models endpoint
      const modelsUrl = `${baseUrl.replace(/\/$/, '')}/models`;
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          ...(providerConfig.apiKey ? { 'Authorization': `Bearer ${providerConfig.apiKey}` } : {}),
        },
      });
      
      if (response.ok) {
        const data = await response.json() as { data?: Array<{ id: string; description?: string }> };
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
      }
    } catch (error) {
      // Provider doesn't support /models endpoint or is unreachable - that's ok
      console.log(`[models] Could not fetch from ${providerId}: ${error}`);
    }
  }
  
  return new Response(JSON.stringify({ models }), {
    headers: { "Content-Type": "application/json", ...headers }
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

  // Initialize state
  const configManager = new ConfigManager(configPath);
  
  try {
    await configManager.load();
  } catch (error) {
    console.error(`Failed to load config: ${error}`);
    console.error("\nCreating default config...");
    
    // Create default config
    const defaultConfig: RouterConfig = {
      server: {
        port: parseInt(args.port || "3000", 10),
        host: "0.0.0.0",
        cors: { origin: "*", credentials: false },
        timeout: parseInt(args.timeout || "120", 10),
      },
      logging: {
        dir: args["log-dir"] || "./logs",
        level: "info",
        maskKeys: true,
      },
      preload: {
        enabled: false,
      },
      schemes: [
        { id: "openai", format: "openai-chat" },
        { id: "anthropic", format: "anthropic-messages" },
      ],
      providers: {},
      routes: [],
    };

    await configManager.save(defaultConfig, false);
    console.log(`Default config created at: ${configManager.getConfigPath()}`);
  }

  const config = configManager.getConfig();

  // Initialize logging
  const loggingManager = new LoggingManager(
    args["log-dir"] || config.logging?.dir,
    config.logging?.maskKeys !== false
  );
  await loggingManager.initialize();

  // Initialize router
  const router = new Router({
    routes: config.routes,
    defaultProvider: config.defaultProvider,
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
    console.log(`  → Log: ${filename}`);
  });

  // Override port from CLI
  const apiPort = args.port ? parseInt(args.port, 10) : (config.server?.port || 3000);
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
        const left = `  - ${id.padEnd(13)} → ${p.baseUrl.slice(0, 45)}`;
        return boxLine(left);
      })
    : [boxLine("  (none)")];
  
  const routeLines = config.routes.length > 0
    ? config.routes.map(r => {
        const modelInfo = r.model || "(as-is)";
        const left = `  ${r.pattern} → ${r.provider}:${modelInfo} (pri:${r.priority || 0})`;
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
${boxLine("  Routes (pattern → provider → target model):")}
${routeLines.join("\n")}
${config.defaultProvider ? boxLine("  Default: ", config.defaultProvider) : boxLine("  Default: (none)")}
${boxBottom()}
`);

  // Print supported endpoints
  console.log("Supported endpoints:");
  config.schemes?.forEach(s => {
    console.log(`  POST http://${displayHost}:${apiPort}${getSchemePath(s)} (${s.format})`);
  });
  console.log(`\nHealth check: http://${displayHost}:${apiPort}/health`);

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

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // WebSocket upgrade for live monitor
      if (url.pathname === "/api/admin/ws") {
        const upgraded = server.upgrade(req);
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
      if (url.pathname === "/api/admin" || url.pathname === "/api/admin/") {
        return new Response(null, {
          status: 302,
          headers: {
            "Location": `http://${displayHost}:${guiPort}/`,
          },
        });
      }

      // Management API
      if (url.pathname.startsWith("/api/admin/")) {
        return handleManagementAPI(req, url);
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

  console.log(`API server running at http://${displayHost}:${apiPort}/`);
  console.log(`Management API at http://${displayHost}:${apiPort}/api/admin/`);

  // Start GUI server if enabled
  if (guiPort > 0) {
    const guiDir = join(dirname(import.meta.dir), "gui", "build");
    if (existsSync(guiDir)) {
      const guiServer = Bun.serve({
        port: guiPort,
        hostname: host,
        idleTimeout: 30,

        async fetch(req) {
          const url = new URL(req.url);

          // Proxy /api/admin requests to the API server
          if (url.pathname.startsWith("/api/admin")) {
            const apiUrl = `http://127.0.0.1:${apiPort}${url.pathname}${url.search}`;
            try {
              const proxyResp = await fetch(apiUrl, {
                method: req.method,
                headers: req.headers,
                body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
              });
              return new Response(proxyResp.body, {
                status: proxyResp.status,
                headers: proxyResp.headers,
              });
            } catch (error) {
              return new Response(JSON.stringify({ error: "API server unavailable" }), {
                status: 502,
                headers: { "Content-Type": "application/json" },
              });
            }
          }

          // Serve static files from gui/build
          let filePath = join(guiDir, url.pathname);
          let file = Bun.file(filePath);

          // Try as-is first, then with index.html
          if (!(await file.exists())) {
            filePath = join(guiDir, url.pathname, "index.html");
            file = Bun.file(filePath);
          }

          // SPA fallback to index.html
          if (!(await file.exists())) {
            file = Bun.file(join(guiDir, "index.html"));
          }

          return new Response(file);
        },
      });

      console.log(`\nGUI server running at http://${displayHost}:${guiPort}/`);

      // Graceful shutdown (with GUI)
      const shutdown = () => {
        console.log("\nShutting down...");
        guiServer.stop();
        server.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } else {
      console.log(`\nGUI build not found at ${guiDir}. Run 'cd gui && bun run build' to build the GUI.`);
      // Graceful shutdown (no GUI)
      const shutdown = () => {
        console.log("\nShutting down...");
        server.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    }
  } else {
    // Graceful shutdown (GUI disabled)
    const shutdown = () => {
      console.log("\nShutting down...");
      server.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
