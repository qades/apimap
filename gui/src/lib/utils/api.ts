// API client for the management API
// API configuration is injected by the server into index.html as window.API_CONFIG

export interface ApiConfig {
  /** Internal port the API server listens on */
  port: number;
  /** External port (for container/port mapping scenarios) */
  externalPort: number;
  /** Hostname for API connections */
  host: string;
  /** Full base URL for API connections */
  url: string;
}

/**
 * Get the API configuration injected by the server.
 * Falls back to environment variables in dev mode or defaults.
 */
export function getApiConfig(): ApiConfig {
  if (typeof window !== 'undefined') {
    // Production: use injected config
    if (window.API_CONFIG) {
      return window.API_CONFIG;
    }
    
    // Legacy support: old API_PORT injection
    if (window.API_PORT) {
      const host = window.location?.hostname || 'localhost';
      const protocol = window.location?.protocol || 'http:';
      return {
        port: window.API_PORT,
        externalPort: window.API_PORT,
        host,
        url: `${protocol}//${host}:${window.API_PORT}`
      };
    }
  }
  
  // Dev mode: use environment variables
  const port = parseInt(import.meta.env.VITE_API_PORT || '3000', 10);
  const externalPort = parseInt(import.meta.env.VITE_API_EXTERNAL_PORT || String(port), 10);
  const host = import.meta.env.VITE_API_HOST || 'localhost';
  
  // In browser, use current location's protocol
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
  const urlHost = typeof window !== 'undefined' ? window.location.hostname : host;
  
  return {
    port,
    externalPort,
    host: urlHost,
    url: `${protocol}//${urlHost}:${externalPort}`
  };
}

/**
 * Get the base API URL for making requests.
 * Uses external port when different from internal port (for container/proxy scenarios).
 */
export function getApiUrl(): string {
  const config = getApiConfig();
  return config.url;
}

/**
 * Get the WebSocket URL for real-time connections.
 * Converts HTTP(S) to WS(S) protocol automatically.
 */
export function getWsUrl(): string {
  const apiUrl = getApiUrl();
  return apiUrl
    .replace('http://', 'ws://')
    .replace('https://', 'wss://');
}

// Backwards compatibility alias
export const resolveApiUrl = getApiUrl;

const API_URL = getApiUrl();
const API_BASE = `${API_URL}/admin`;

export interface SystemStatus {
  status: string;
  version: string;
  commitHash: string;
  uptime: number;
  configPath: string;
  providers: string[];
  routes: number;
  totalRequests: number;
  routedRequests: number;
  unroutedRequests: number;
  errors: number;
  averageLatency: number;
}

export interface DashboardStats {
  total: number;
  streaming: number;
  routed: number;
  unrouted: number;
  running: number;
  runningStreaming: number;
  completed: number;
  errors: number;
  avgLatency: number;
  avgTokensPerSecond: number;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  defaultBaseUrl: string;
  defaultApiKeyEnv?: string;
  authHeader: string;
  authPrefix: string;
  supportsStreaming: boolean;
  requiresApiKey: boolean;
  category: 'cloud' | 'local' | 'custom';
  configured?: boolean;
  enabled?: boolean;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  authHeader?: string;
  authPrefix?: string;
  headers?: Record<string, string>;
  timeout?: number;
  supportsStreaming?: boolean;
}

export interface RouteConfig {
  pattern: string;
  provider: string;
  model?: string;
}

export interface ApiSchemeConfig {
  id: string;
  path: string;
  format: string;
}

export interface RouterConfig {
  server?: {
    port?: number;
    externalPort?: number;  // External port for container/proxy scenarios
    externalHost?: string;  // External hostname for container/proxy scenarios
    host?: string;
    cors?: {
      origin?: string | string[];
      credentials?: boolean;
    };
    timeout?: number;
  };
  logging?: {
    dir?: string;
    level?: string;
    maskKeys?: boolean;
  };
  preload?: {
    enabled?: boolean;
    models?: string[];
  };
  schemes?: ApiSchemeConfig[];
  providers: Record<string, ProviderConfig>;
  routes: RouteConfig[];
  // Routes are matched top-down, first match wins
}

export interface UnroutedRequest {
  id: string;
  timestamp: string;
  model: string;
  apiKey: string;
  streaming: boolean;
  endpoint: string;
  fullRequest: unknown;
  headers: Record<string, string>;
}

export interface ConfigBackup {
  filename: string;
  path: string;
  createdAt: string;
  size: number;
}

export interface LogEntry {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  sourceScheme: string;
  targetScheme: string;
  provider: string;
  model: string;
  targetModel: string;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  transformedBody?: unknown;
  responseStatus: number;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  rawUpstreamResponse?: unknown;
  transformedResponse?: unknown;
  error?: string;
  durationMs: number;
  routed: boolean;
  matchedPattern?: string;
  /** Provider base URL used for the request */
  providerUrl?: string;
  /** Authentication scheme details */
  authScheme?: {
    header: string;
    prefix: string;
    maskedKey: string;
  };
  /** Whether the request used streaming */
  stream?: boolean;
  /** Tokens per second for the response */
  tokensPerSecond?: number;
  /** Time to first byte (latency) in milliseconds - only for streaming */
  latencyMs?: number;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Status API
export const statusApi = {
  get: () => fetchApi<SystemStatus>('/status'),
};

// Providers API
export const providersApi = {
  getAll: () => fetchApi<{ registered: (ProviderInfo & { configured: boolean })[]; builtin: ProviderInfo[] }>('/providers'),
  update: (providers: Record<string, ProviderConfig>) => 
    fetchApi<{ success: boolean }>('/providers', {
      method: 'PUT',
      body: JSON.stringify({ providers }),
    }),
};

// Routes API
export const routesApi = {
  getAll: () => fetchApi<{ routes: RouteConfig[] }>('/routes'),
  update: (routes: RouteConfig[]) =>
    fetchApi<{ success: boolean }>('/routes', {
      method: 'PUT',
      body: JSON.stringify({ routes }),
    }),
  add: (route: RouteConfig) =>
    fetchApi<{ success: boolean }>('/routes', {
      method: 'POST',
      body: JSON.stringify(route),
    }),
};

// Schemes API
export const schemesApi = {
  getAll: () => fetchApi<{ schemes: ApiSchemeConfig[] }>('/schemes'),
  update: (schemes: ApiSchemeConfig[]) =>
    fetchApi<{ success: boolean }>('/schemes', {
      method: 'PUT',
      body: JSON.stringify({ schemes }),
    }),
};

// Config API
export const configApi = {
  get: () => fetchApi<RouterConfig>('/config'),
  save: (config: RouterConfig) =>
    fetchApi<{ success: boolean }>('/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  // Routes are matched top-down with catch-all "*" at the end
};

// Backup API
export const backupApi = {
  list: () => fetchApi<{ backups: ConfigBackup[] }>('/backups'),
  create: () =>
    fetchApi<{ backup: ConfigBackup }>('/backups', { method: 'POST' }),
  restore: (filename: string) =>
    fetchApi<{ success: boolean }>(`/backups/${encodeURIComponent(filename)}`, { method: 'POST' }),
  delete: (filename: string) =>
    fetchApi<{ success: boolean }>(`/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
};

// Unrouted requests API
export const unroutedApi = {
  getAll: () => fetchApi<{ unrouted: UnroutedRequest[] }>('/unrouted'),
  clear: () =>
    fetchApi<{ success: boolean }>('/unrouted', { method: 'DELETE' }),
};

// Logs API
export const logsApi = {
  getRecent: (limit = 50) =>
    fetchApi<{ logs: LogEntry[] }>(`/logs?limit=${limit}`),
};

// Models API
export interface ModelInfo {
  id: string;
  name: string;
  source: 'route' | 'provider';
  provider?: string;
  description?: string;
}

export const modelsApi = {
  getAll: (options?: { source?: 'route' | 'provider'; provider?: string }) => {
    let url = '/models';
    const params = new URLSearchParams();
    if (options?.source) params.append('source', options.source);
    if (options?.provider) params.append('provider', options.provider);
    if (params.toString()) url += `?${params.toString()}`;
    return fetchApi<{ models: ModelInfo[] }>(url);
  },
};

// Server Info API
export interface ServerInfo {
  apiUrl: string;
  version: string;
  commitHash: string;
  uptime: number;
}

// API URL is derived from window.location (GUI server hostname + API port)
export const serverInfoApi = {
  get: () => fetchApi<ServerInfo>('/server-info'),
  
  // Get the API base URL for direct API calls (e.g., /v1/chat/completions)
  // Uses window.location to determine the API URL
  getApiUrl: (): string => {
    return API_URL;
  },
};

// Model Testing API - calls the API endpoints directly
export const testModelApi = {
  test: async (params: {
    model: string;
    message: string;
    systemMessage?: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    apiFormat?: 'openai' | 'anthropic' | 'openai-responses' | 'openai-completions';
    chatTemplateKwargs?: Record<string, unknown>;
  }) => {
    const apiUrl = serverInfoApi.getApiUrl();
    const format = params.apiFormat ?? 'openai';
    
    // Map API format to endpoint
    const ENDPOINT_MAP: Record<string, string> = {
      'openai': '/v1/chat/completions',
      'anthropic': '/v1/messages',
      'openai-responses': '/v1/responses',
      'openai-completions': '/v1/completions',
    };
    const endpoint = ENDPOINT_MAP[format] ?? '/v1/chat/completions';
    
    const requestBody: Record<string, unknown> = {
      model: params.model.trim(),
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.7,
      stream: params.stream ?? false,
    };
    
    // Format-specific request body construction
    if (format === 'anthropic') {
      // Anthropic Messages API format
      const messages = [];
      messages.push({ role: 'user', content: params.message.trim() });
      requestBody.messages = messages;
      // System message goes in separate field for Anthropic
      if (params.systemMessage?.trim()) {
        requestBody.system = params.systemMessage.trim();
      }
    } else if (format === 'openai-completions') {
      // Legacy completions format uses 'prompt' instead of 'messages'
      let prompt = '';
      if (params.systemMessage?.trim()) {
        prompt += params.systemMessage.trim() + '\n\n';
      }
      prompt += params.message.trim();
      requestBody.prompt = prompt;
      // Remove messages field for completions
      delete requestBody.messages;
    } else if (format === 'openai-responses') {
      // OpenAI Responses API format
      const input = [];
      if (params.systemMessage?.trim()) {
        input.push({ role: 'system', content: params.systemMessage.trim() });
      }
      input.push({ role: 'user', content: params.message.trim() });
      requestBody.input = input;
      // Remove messages field for responses API
      delete requestBody.messages;
    } else {
      // Standard OpenAI Chat Completions format
      const messages = [];
      if (params.systemMessage?.trim()) {
        messages.push({ role: 'system', content: params.systemMessage.trim() });
      }
      messages.push({ role: 'user', content: params.message.trim() });
      requestBody.messages = messages;
    }
    
    // Add chat_template_kwargs if provided
    if (params.chatTemplateKwargs && Object.keys(params.chatTemplateKwargs).length > 0) {
      requestBody.chat_template_kwargs = params.chatTemplateKwargs;
    }
    
    // Call API server directly
    return fetch(`${apiUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  },
};
