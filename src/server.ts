#!/usr/bin/env bun
// ============================================================================
// Universal Model Router - Main Server
// ============================================================================

import type { Server, ServerWebSocket } from "bun";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { join, dirname } from "path";

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

let state: ServerState;
let server: Server;

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
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           Universal Model Router v2.0                          ║
╠════════════════════════════════════════════════════════════════╣
Usage: bun run src/server.ts [options]

Options:
  --config <path>        Path to YAML config (default: config/config.yaml)
  --port <number>        Override port from config
  --log-dir <path>       Override log directory from config
  --timeout <seconds>    Override timeout from config
  --gui-port <number>    Port for management GUI (default: 3001)
  --no-gui               Disable management GUI
  --help                 Show this help message

Examples:
  # Use default config
  bun run src/server.ts

  # Custom config and ports
  bun run src/server.ts --config ./my-config.yaml --port 8080 --gui-port 8081

  # Disable GUI
  bun run src/server.ts --no-gui
╚════════════════════════════════════════════════════════════════╝
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
        startTime
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

    return jsonResponse(clientResp, 200, config, req.headers.get("origin"));

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
  startTime: number
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
  let sentStart = false;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

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
        const { done, value } = await reader.read();
        if (done) break;

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
            const outputLine = transformers.toProviderStreamChunk(sourceFormat, chunk, model);
            await writer.write(encoder.encode(outputLine));
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
    } catch (error) {
      console.error(`[stream] error:`, error);
    } finally {
      reader.cancel().catch(() => {});
      await writer.close().catch(() => {});
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

  // Override port from CLI
  const apiPort = args.port ? parseInt(args.port, 10) : (config.server?.port || 3000);
  const host = config.server?.host || "0.0.0.0";

  // Print startup banner
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           Universal Model Router v${state.version}                     ║
╠════════════════════════════════════════════════════════════════╣
║  API Server:  http://${host}:${apiPort.toString().padEnd(27)}║
${guiPort > 0 ? `║  GUI Server:  http://${host}:${guiPort.toString().padEnd(27)}║` : "║  GUI:        Disabled".padEnd(65) + "║"}
║  Config:     ${configManager.getConfigPath().padEnd(52)}║
╠════════════════════════════════════════════════════════════════╣
║  Active Providers:                                             ║
${Object.entries(config.providers)
  .filter(([id]) => router.getStats().providers.includes(id))
  .map(([id, p]) => `║    - ${id.padEnd(15)} → ${p.baseUrl.slice(0, 32).padEnd(32)}║`)
  .join("\n")}
╠════════════════════════════════════════════════════════════════╣
║  Routes (pattern → provider → target model):                  ║
${config.routes
  .map(r => {
    const modelInfo = r.model || "(as-is)";
    const line = `║    ${r.pattern} → ${r.provider}:${modelInfo} (pri:${r.priority || 0})`;
    return line.slice(0, 64).padEnd(64) + "║";
  })
  .join("\n")}
${config.defaultProvider ? `║  Default: ${config.defaultProvider.padEnd(54)}║` : "║  Default: (none)".padEnd(65) + "║"}
╚════════════════════════════════════════════════════════════════╝
`);

  // Print supported endpoints
  console.log("Supported endpoints:");
  config.schemes?.forEach(s => {
    console.log(`  POST http://${host}:${apiPort}${getSchemePath(s)} (${s.format})`);
  });
  console.log(`\nHealth check: http://${host}:${apiPort}/health`);

  // Start API server
  server = Bun.serve({
    port: apiPort,
    hostname: host,
    idleTimeout: Math.min(config.server?.timeout || 120, 255),
    
    async fetch(req) {
      const url = new URL(req.url);
      const requestOrigin = req.headers.get("origin");
      const corsHeaders = getCORSHeaders(requestOrigin, config);
      const requestId = generateRequestId();
      const startTime = Date.now();

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
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

      // Management API
      if (url.pathname.startsWith("/api/admin")) {
        return handleManagementAPI(req, url);
      }

      // Handle API requests
      return handleRequest(req, requestId, startTime);
    },
  });

  console.log(`API server running at http://${host}:${apiPort}/`);
  console.log(`Management API at http://${host}:${apiPort}/api/admin/`);

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
            const apiUrl = `http://${host}:${apiPort}${url.pathname}${url.search}`;
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

      console.log(`\nGUI server running at http://${host}:${guiPort}/`);

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
