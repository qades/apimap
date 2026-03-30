<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { 
    Activity, 
    Wifi, 
    WifiOff, 
    Loader2,
    RefreshCw
  } from '@lucide/svelte';
  import type { LogEntry, ProviderInfo, DashboardStats } from '$lib/utils/api';
  import { getWsUrl, providersApi } from '$lib/utils/api';
  import StatsBar from '$lib/components/StatsBar.svelte';
  import MessageFilters from '$lib/components/MessageFilters.svelte';
  import Pagination from '$lib/components/Pagination.svelte';
  import MessageTile from '$lib/components/MessageTile.svelte';

  // State
  let logs = $state<LogEntry[]>([]);
  let expandedLogId = $state<string | null>(null);
  let activeTabs = $state<Record<string, string>>({});
  let providers = $state<ProviderInfo[]>([]);
  
  // WebSocket state
  let ws = $state<WebSocket | null>(null);
  let connected = $state(false);
  let connecting = $state(false);
  let reconnectTimer = $state<ReturnType<typeof setTimeout> | null>(null);
  
  // Filters
  let searchFilter = $state('');
  let statusFilter = $state<'all' | 'streaming' | 'pending' | 'completed' | 'error' | 'unrouted'>('all');
  let providerFilter = $state<string>('all');
  let timeRangeFilter = $state<'1h' | '24h' | '7d' | 'all'>('all');
  
  // Pagination
  let currentPage = $state(1);
  let itemsPerPage = $state(10);

  // Derived: calculate stats
  let stats = $derived((): DashboardStats => {
    const total = logs.length;
    const streaming = logs.filter(l => l.stream).length;
    const routed = logs.filter(l => l.routed).length;
    const unrouted = logs.filter(l => !l.routed).length;
    const completed = logs.filter(l => l.routed && l.responseStatus < 400 && !l.error).length;
    const errors = logs.filter(l => l.error || l.responseStatus >= 400).length;
    
    // For running/pending, we'd need active request tracking via WebSocket
    // For now, estimate based on recent logs without end time
    const running = 0; // Will be updated from active requests
    const runningStreaming = 0;
    
    // Only calculate avg latency for streaming requests (time to first byte)
    const streamingLogs = logs.filter(l => l.stream && l.latencyMs);
    const avgLatency = streamingLogs.length > 0 
      ? Math.round(streamingLogs.reduce((sum, l) => sum + (l.latencyMs || 0), 0) / streamingLogs.length)
      : 0;
    
    const logsWithTps = logs.filter(l => l.tokensPerSecond);
    const avgTokensPerSecond = logsWithTps.length > 0
      ? Math.round(logsWithTps.reduce((sum, l) => sum + (l.tokensPerSecond || 0), 0) / logsWithTps.length)
      : 0;
    
    return {
      total,
      streaming,
      routed,
      unrouted,
      running,
      runningStreaming,
      completed,
      errors,
      avgLatency,
      avgTokensPerSecond
    };
  });

  // Derived: filter logs
  let filteredLogs = $derived(() => {
    let result = [...logs];
    
    // Search filter
    if (searchFilter) {
      const search = searchFilter.toLowerCase();
      result = result.filter(l => 
        l.model?.toLowerCase().includes(search) ||
        l.targetModel?.toLowerCase().includes(search) ||
        l.provider?.toLowerCase().includes(search) ||
        l.requestId?.toLowerCase().includes(search)
      );
    }
    
    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(l => {
        if (statusFilter === 'unrouted') return !l.routed;
        if (statusFilter === 'error') return l.error || l.responseStatus >= 400;
        if (statusFilter === 'completed') return l.routed && l.responseStatus < 400 && !l.error;
        if (statusFilter === 'streaming') return l.stream;
        return true;
      });
    }
    
    // Provider filter
    if (providerFilter !== 'all') {
      result = result.filter(l => l.provider === providerFilter);
    }
    
    // Time range filter
    if (timeRangeFilter !== 'all') {
      const now = Date.now();
      const ranges = {
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
      };
      const cutoff = now - ranges[timeRangeFilter];
      result = result.filter(l => new Date(l.timestamp).getTime() > cutoff);
    }
    
    // Sort by timestamp desc
    result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return result;
  });

  // Derived: paginate
  let paginatedLogs = $derived(() => {
    const filtered = filteredLogs();
    const start = (currentPage - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  });

  let totalPages = $derived(() => {
    return Math.max(1, Math.ceil(filteredLogs().length / itemsPerPage));
  });

  // Load providers
  async function loadProviders() {
    try {
      const data = await providersApi.getAll();
      providers = data.registered;
    } catch (err) {
      console.error('Failed to load providers:', err);
    }
  }

  // WebSocket connection
  async function connect() {
    if (ws?.readyState === WebSocket.OPEN) return;
    if (connecting) return;

    connecting = true;

    try {
      const wsUrl = getWsUrl() + '/ws';
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        connected = true;
        connecting = false;
        console.log('[Dashboard] WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (err) {
          console.error('[Dashboard] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        connected = false;
        connecting = false;
        ws = null;
        console.log('[Dashboard] WebSocket disconnected');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('[Dashboard] WebSocket error:', err);
        connecting = false;
      };
    } catch (err) {
      console.error('[Dashboard] Failed to connect:', err);
      connecting = false;
      reconnectTimer = setTimeout(connect, 5000);
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    connected = false;
  }

  function handleWebSocketMessage(data: unknown) {
    if (typeof data !== 'object' || data === null) return;
    const msg = data as Record<string, unknown>;

    if (msg.type === 'initial_logs' && Array.isArray(msg.logs)) {
      // Initial logs from server
      logs = msg.logs as LogEntry[];
    } else if (msg.type === 'log_entry' && msg.entry) {
      // New log entry - add to beginning, dedupe by requestId
      const entry = msg.entry as LogEntry;
      logs = [entry, ...logs.filter(l => l.requestId !== entry.requestId)];
    }
  }

  // Toggle expand/collapse
  function toggleLog(requestId: string) {
    if (expandedLogId === requestId) {
      expandedLogId = null;
    } else {
      expandedLogId = requestId;
      // Set default tab if not set
      if (!activeTabs[requestId]) {
        activeTabs = { ...activeTabs, [requestId]: 'message' };
      }
    }
  }

  // Change tab
  function setTab(requestId: string, tab: string) {
    activeTabs = { ...activeTabs, [requestId]: tab };
  }

  // Reset pagination when filters change
  $effect(() => {
    // Track filter changes
    const _ = searchFilter + statusFilter + providerFilter + timeRangeFilter;
    currentPage = 1;
  });

  onMount(() => {
    loadProviders();
    connect();
  });

  onDestroy(() => {
    disconnect();
  });
</script>

<svelte:head>
  <title>Dashboard - API Map</title>
</svelte:head>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 flex items-center gap-3">
        <Activity class="text-blue-600" size={28} />
        Dashboard
      </h1>
      <p class="text-gray-600 mt-1">Real-time view of requests flowing through the router</p>
    </div>

    <!-- Connection Status -->
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
        class:border-green-200={connected}
        class:bg-green-50={connected}
        class:text-green-700={connected}
        class:border-red-200={!connected}
        class:bg-red-50={!connected}
        class:text-red-700={!connected}
      >
        {#if connected}
          <Wifi size={16} />
          <span class="text-sm font-medium">Live</span>
        {:else if connecting}
          <Loader2 size={16} class="animate-spin" />
          <span class="text-sm font-medium">Connecting...</span>
        {:else}
          <WifiOff size={16} />
          <span class="text-sm font-medium">Offline</span>
        {/if}
      </div>

      {#if !connected}
        <button
          onclick={connect}
          disabled={connecting}
          class="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-1.5 hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw size={14} />
          Reconnect
        </button>
      {/if}
    </div>
  </div>

  <!-- Stats Bar -->
  <StatsBar stats={stats()} />

  <!-- Filters -->
  <MessageFilters
    search={searchFilter}
    status={statusFilter}
    provider={providerFilter}
    timeRange={timeRangeFilter}
    {providers}
    filteredCount={filteredLogs().length}
    totalCount={logs.length}
    onSearchChange={(v) => searchFilter = v}
    onStatusChange={(v) => statusFilter = v}
    onProviderChange={(v) => providerFilter = v}
    onTimeRangeChange={(v) => timeRangeFilter = v}
  />

  <!-- Pagination (top) -->
  {#if filteredLogs().length > 0}
    <Pagination
      {currentPage}
      totalPages={totalPages()}
      {itemsPerPage}
      onPageChange={(p) => currentPage = p}
      onItemsPerPageChange={(v) => { itemsPerPage = v; currentPage = 1; }}
    />
  {/if}

  <!-- Message List -->
  <div class="space-y-3">
    {#if paginatedLogs().length === 0}
      <div class="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <Activity size={48} class="text-gray-300 mx-auto mb-4" />
        <h3 class="text-lg font-medium text-gray-900 mb-1">No requests to display</h3>
        <p class="text-gray-500">
          {#if filteredLogs().length === 0 && logs.length > 0}
            Try adjusting your filters
          {:else if !connected}
            Waiting for WebSocket connection...
          {:else}
            Requests will appear here when they come in through the router.
          {/if}
        </p>
      </div>
    {:else}
      {#each paginatedLogs() as log (log.requestId)}
        <MessageTile
          {log}
          isExpanded={expandedLogId === log.requestId}
          activeTab={activeTabs[log.requestId] || 'message'}
          onToggle={() => toggleLog(log.requestId)}
          onTabChange={(tab) => setTab(log.requestId, tab)}
        />
      {/each}
    {/if}
  </div>

  <!-- Pagination (bottom) -->
  {#if filteredLogs().length > 0}
    <Pagination
      {currentPage}
      totalPages={totalPages()}
      {itemsPerPage}
      onPageChange={(p) => currentPage = p}
      onItemsPerPageChange={(v) => { itemsPerPage = v; currentPage = 1; }}
    />
  {/if}
</div>
