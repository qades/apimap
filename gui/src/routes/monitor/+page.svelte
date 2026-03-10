<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { 
    Activity, 
    Clock,
    AlertCircle,
    CheckCircle,
    Loader2,
    Zap,
    Terminal,
    RefreshCw,
    Wifi,
    WifiOff,
    Trash2,
    Pause,
    Maximize2,
    Minimize2,
    X,
    MessageSquare,
    ChevronDown,
    ChevronUp
  } from '@lucide/svelte';
  import { serverInfoApi } from '$lib/utils/api';

  interface LiveRequest {
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

  // State
  let requests = $state<LiveRequest[]>([]);
  let selectedRequest = $state<LiveRequest | null>(null);
  let connected = $state(false);
  let connecting = $state(false);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let apiUrl = $state('');
  let autoScroll = $state(true);
  let showOnlyRunning = $state(false);
  let expandedRequest = $state<string | null>(null);
  let expandedPrompts = $state<Set<string>>(new Set());

  // Filtered requests - sorted by timestamp descending (latest first)
  let filteredRequests = $derived(
    (showOnlyRunning 
      ? requests.filter(r => r.status === 'pending' || r.status === 'streaming')
      : requests
    ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  );

  // Stats
  let stats = $derived({
    total: requests.length,
    running: requests.filter(r => r.status === 'pending' || r.status === 'streaming').length,
    completed: requests.filter(r => r.status === 'completed').length,
    errors: requests.filter(r => r.status === 'error').length,
  });

  async function connect() {
    if (ws?.readyState === WebSocket.OPEN) return;
    if (connecting) return;
    
    connecting = true;
    
    try {
      if (!apiUrl) {
        apiUrl = await serverInfoApi.getApiUrl();
      }
      
      const wsUrl = apiUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      ws = new WebSocket(`${wsUrl}/api/admin/ws`);
      
      ws.onopen = () => {
        connected = true;
        connecting = false;
        console.log('[Monitor] WebSocket connected');
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (err) {
          console.error('[Monitor] Failed to parse message:', err);
        }
      };
      
      ws.onclose = () => {
        connected = false;
        connecting = false;
        ws = null;
        console.log('[Monitor] WebSocket disconnected');
        // Auto reconnect after 3 seconds
        reconnectTimer = setTimeout(connect, 3000);
      };
      
      ws.onerror = (err) => {
        console.error('[Monitor] WebSocket error:', err);
        connecting = false;
      };
    } catch (err) {
      console.error('[Monitor] Failed to connect:', err);
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
    
    if (msg.type === 'initial' && Array.isArray(msg.requests)) {
      requests = msg.requests as LiveRequest[];
    } else if (msg.type === 'request_update' && msg.request) {
      const req = msg.request as LiveRequest;
      const index = requests.findIndex(r => r.requestId === req.requestId);
      if (index >= 0) {
        requests[index] = req;
        // Trigger reactivity
        requests = [...requests];
      } else {
        requests = [req, ...requests];
      }
    }
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'streaming': return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'pending': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'completed': return 'text-green-600 bg-green-50 border-green-200';
      case 'error': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'streaming': return Loader2;
      case 'pending': return Clock;
      case 'completed': return CheckCircle;
      case 'error': return AlertCircle;
      default: return Activity;
    }
  }

  function clearCompleted() {
    requests = requests.filter(r => r.status === 'pending' || r.status === 'streaming');
  }

  function toggleExpand(requestId: string) {
    expandedRequest = expandedRequest === requestId ? null : requestId;
  }

  function togglePromptExpand(requestId: string) {
    const newSet = new Set(expandedPrompts);
    if (newSet.has(requestId)) {
      newSet.delete(requestId);
    } else {
      newSet.add(requestId);
    }
    expandedPrompts = newSet;
  }

  function isPromptExpanded(requestId: string): boolean {
    return expandedPrompts.has(requestId);
  }

  onMount(() => {
    connect();
  });

  onDestroy(() => {
    disconnect();
  });
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 flex items-center gap-3">
        <Activity class="text-blue-600" size={28} />
        Live Monitor
      </h1>
      <p class="text-gray-600 mt-1">Real-time view of requests flowing through the router</p>
    </div>
    
    <div class="flex items-center gap-2">
      <!-- Connection Status -->
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
      
      <button
        onclick={clearCompleted}
        class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium flex items-center gap-1.5 hover:bg-gray-200"
      >
        <Trash2 size={14} />
        Clear Completed
      </button>
    </div>
  </div>

  <!-- Stats Bar -->
  <div class="grid grid-cols-4 gap-4">
    <div class="bg-white rounded-lg border border-gray-200 p-4">
      <div class="text-2xl font-bold text-gray-900">{stats.total}</div>
      <div class="text-sm text-gray-500">Total Requests</div>
    </div>
    <div class="bg-white rounded-lg border border-gray-200 p-4">
      <div class="text-2xl font-bold text-blue-600">{stats.running}</div>
      <div class="text-sm text-gray-500">Running</div>
    </div>
    <div class="bg-white rounded-lg border border-gray-200 p-4">
      <div class="text-2xl font-bold text-green-600">{stats.completed}</div>
      <div class="text-sm text-gray-500">Completed</div>
    </div>
    <div class="bg-white rounded-lg border border-gray-200 p-4">
      <div class="text-2xl font-bold text-red-600">{stats.errors}</div>
      <div class="text-sm text-gray-500">Errors</div>
    </div>
  </div>

  <!-- Filters -->
  <div class="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-3">
    <div class="flex items-center gap-4">
      <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          bind:checked={showOnlyRunning}
          class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        Show only running
      </label>
      <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          bind:checked={autoScroll}
          class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        Auto-scroll
      </label>
    </div>
    <div class="text-sm text-gray-500">
      Showing {filteredRequests.length} of {requests.length}
    </div>
  </div>

  <!-- Requests List -->
  <div class="space-y-3">
    {#if filteredRequests.length === 0}
      <div class="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <Activity size={48} class="text-gray-300 mx-auto mb-4" />
        <h3 class="text-lg font-medium text-gray-900 mb-1">No requests to display</h3>
        <p class="text-gray-500">
          {#if showOnlyRunning}
            No running requests. Toggle "Show only running" to see completed requests.
          {:else}
            Requests will appear here when they come in through the router.
          {/if}
        </p>
      </div>
    {:else}
      {#each filteredRequests as request (request.requestId)}
        <div class="bg-white rounded-lg border overflow-hidden"
          class:border-gray-200={request.status !== 'streaming'}
          class:border-blue-300={request.status === 'streaming'}
          class:shadow-sm={request.status === 'streaming'}
        >
          <!-- Request Header -->
          <div class="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50"
            onclick={() => toggleExpand(request.requestId)}
          >
            <div class="flex items-center gap-4">
              <!-- Status Badge -->
              <span class="px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1.5 {getStatusColor(request.status)}">
                {#if request.status === 'streaming'}
                  <Loader2 size={12} class="animate-spin" />
                {:else}
                  <svelte:component this={getStatusIcon(request.status)} size={12} />
                {/if}
                {request.status}
              </span>
              
              <!-- Model Info -->
              <div class="flex items-center gap-2">
                <span class="font-mono text-sm text-gray-900">{request.model}</span>
                {#if request.targetModel && request.targetModel !== request.model}
                  <span class="text-gray-400">→</span>
                  <span class="font-mono text-sm text-gray-600">{request.targetModel}</span>
                {/if}
              </div>
              
              <!-- Provider -->
              {#if request.provider}
                <span class="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                  {request.provider}
                </span>
              {/if}
              
              <!-- Stream indicator -->
              {#if request.stream}
                <span class="text-xs text-blue-600 flex items-center gap-0.5">
                  <Zap size={10} />
                  stream
                </span>
              {/if}
            </div>
            
            <div class="flex items-center gap-4 text-sm text-gray-500">
              <!-- Time -->
              <span class="flex items-center gap-1">
                <Clock size={14} />
                {formatTime(request.timestamp)}
              </span>
              
              <!-- Duration -->
              {#if request.endTime}
                <span>{formatDuration(request.endTime - request.startTime)}</span>
              {:else}
                <span>{formatDuration(Date.now() - request.startTime)}</span>
              {/if}
              
              <!-- Chunks -->
              {#if request.chunks > 0}
                <span class="text-xs text-gray-400">{request.chunks} chunks</span>
              {/if}
              
              <!-- Expand/Collapse -->
              {#if expandedRequest === request.requestId}
                <Minimize2 size={16} class="text-gray-400" />
              {:else}
                <Maximize2 size={16} class="text-gray-400" />
              {/if}
            </div>
          </div>
          
          <!-- Expanded Content -->
          {#if expandedRequest === request.requestId}
            <div class="border-t border-gray-200">
              <!-- Request Prompt -->
              {#if request.prompt}
                <div class="p-4 bg-blue-50/50 border-b border-gray-200">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-medium text-blue-700 flex items-center gap-1">
                      <MessageSquare size={12} />
                      Prompt
                    </span>
                    <button
                      type="button"
                      onclick={() => togglePromptExpand(request.requestId)}
                      class="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      {#if isPromptExpanded(request.requestId)}
                        <ChevronUp size={14} />
                        Show less
                      {:else}
                        <ChevronDown size={14} />
                        Show more
                      {/if}
                    </button>
                  </div>
                  <div class={isPromptExpanded(request.requestId) ? 'max-h-96 overflow-auto' : 'max-h-12 overflow-hidden'}>
                    <pre class="text-sm text-blue-900 whitespace-pre-wrap">{request.prompt}</pre>
                  </div>
                </div>
              {/if}
              
              {#if request.status === 'error'}
                <div class="p-4 bg-red-50">
                  <div class="flex items-start gap-2">
                    <AlertCircle class="text-red-500 flex-shrink-0" size={16} />
                    <p class="text-sm text-red-700">{request.error}</p>
                  </div>
                </div>
              {:else if request.content}
                <div class="p-4">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-medium text-gray-500 flex items-center gap-1">
                      <Terminal size={12} />
                      Response Content
                    </span>
                  </div>
                  <div class="bg-gray-50 rounded-lg p-3 max-h-96 overflow-auto">
                    <pre class="text-sm text-gray-800 whitespace-pre-wrap">{request.content}</pre>
                    {#if request.status === 'streaming'}
                      <span class="inline-block w-2 h-4 bg-blue-500 ml-1 animate-pulse"></span>
                    {/if}
                  </div>
                </div>
              {:else if request.status === 'streaming' || request.status === 'pending'}
                <div class="p-8 flex items-center justify-center text-gray-400">
                  <Loader2 size={24} class="animate-spin mr-2" />
                  <span>Waiting for response...</span>
                </div>
              {/if}
              
              <!-- Request Details -->
              <div class="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
                <div class="grid grid-cols-4 gap-4">
                  <div>
                    <span class="text-gray-400">Request ID:</span>
                    <span class="font-mono ml-1">{request.requestId}</span>
                  </div>
                  <div>
                    <span class="text-gray-400">Scheme:</span>
                    <span class="ml-1">{request.sourceScheme}</span>
                  </div>
                  <div>
                    <span class="text-gray-400">Provider:</span>
                    <span class="ml-1">{request.provider || 'none'}</span>
                  </div>
                  <div>
                    <span class="text-gray-400">Chunks:</span>
                    <span class="ml-1">{request.chunks}</span>
                  </div>
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
