import { writable, derived } from 'svelte/store';
import type { SystemStatus, ProviderInfo, RouteConfig, UnroutedRequest, ConfigBackup, LogEntry } from '../utils/api';

// Status store
export const status = writable<SystemStatus | null>(null);
export const statusError = writable<string | null>(null);
export const isLoadingStatus = writable(false);

// Providers store
export const providers = writable<(ProviderInfo & { configured: boolean })[]>([]);
export const builtinProviders = writable<ProviderInfo[]>([]);
export const isLoadingProviders = writable(false);

// Routes store
export const routes = writable<RouteConfig[]>([]);
export const isLoadingRoutes = writable(false);

// Unrouted requests store
export const unroutedRequests = writable<UnroutedRequest[]>([]);
export const isLoadingUnrouted = writable(false);
export const selectedUnroutedRequest = writable<UnroutedRequest | null>(null);

// Backups store
export const backups = writable<ConfigBackup[]>([]);
export const isLoadingBackups = writable(false);

// Logs store
export const logs = writable<LogEntry[]>([]);
export const isLoadingLogs = writable(false);

// Config store
export const config = writable<Record<string, unknown> | null>(null);
export const isLoadingConfig = writable(false);

// Derived stores
export const providerCategories = derived(builtinProviders, $providers => {
  const categories = new Map<string, ProviderInfo[]>();
  
  for (const provider of $providers) {
    const list = categories.get(provider.category) || [];
    list.push(provider);
    categories.set(provider.category, list);
  }
  
  return categories;
});

export const unroutedCount = derived(unroutedRequests, $requests => $requests.length);

export const hasUnroutedRequests = derived(unroutedRequests, $requests => $requests.length > 0);

export const routeStats = derived(routes, $routes => {
  const providers = new Set($routes.map(r => r.provider));
  return {
    total: $routes.length,
    providers: providers.size,
  };
});

// Auto-refresh functionality
let refreshInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoRefresh(intervalMs = 5000) {
  stopAutoRefresh();
  refreshInterval = setInterval(() => {
    // Trigger refresh by updating a timestamp store
    lastRefresh.set(Date.now());
  }, intervalMs);
}

export function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

export const lastRefresh = writable(Date.now());
