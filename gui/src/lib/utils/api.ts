// API client for the management API
const API_BASE = '/api/admin';

export interface SystemStatus {
  status: string;
  version: string;
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
  priority?: number;
}

export interface ApiSchemeConfig {
  id: string;
  path: string;
  format: string;
}

export interface RouterConfig {
  server?: {
    port?: number;
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
  defaultProvider?: string;
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
  error?: string;
  durationMs: number;
  routed: boolean;
  matchedPattern?: string;
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
  getDefaultProvider: () => fetchApi<{ defaultProvider?: string }>('/default-provider'),
  updateDefaultProvider: (defaultProvider?: string) =>
    fetchApi<{ success: boolean }>('/default-provider', {
      method: 'PUT',
      body: JSON.stringify({ defaultProvider }),
    }),
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

// Model Testing API
export const testModelApi = {
  test: (params: {
    model: string;
    message: string;
    systemMessage?: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    apiFormat?: 'openai' | 'anthropic';
  }) =>
    fetch('/api/admin/test-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),
};
