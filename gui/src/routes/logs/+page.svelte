<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    Activity,
    AlertCircle,
    CheckCircle,
    Clock,
    Server,
    ChevronDown,
    ChevronUp,
    Wifi,
    WifiOff,
    Loader2,
    ArrowRight,
    Wrench,
    AlertTriangle
  } from '@lucide/svelte';
  import type { LogEntry } from '$lib/utils/api';
  import { getWsUrl } from '$lib/utils/api';

  let logs = $state<LogEntry[]>([]);
  let error: string | null = $state(null);
  let expandedLog: string | null = $state(null);
  let filter = $state('');
  let statusFilter: 'all' | 'success' | 'error' = $state('all');
  let activeTab: Record<string, string> = $state({});

  // WebSocket state
  let ws: WebSocket | null = $state(null);
  let connected = $state(false);
  let connecting = $state(false);
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect() {
    if (ws?.readyState === WebSocket.OPEN) return;
    if (connecting) return;

    connecting = true;

    try {
      // Get WebSocket URL from injected config (handles externalPort automatically)
      const wsUrl = getWsUrl() + '/ws';
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        connected = true;
        connecting = false;
        console.log('[Logs] WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (err) {
          console.error('[Logs] Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        connected = false;
        connecting = false;
        console.log('[Logs] WebSocket disconnected');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('[Logs] WebSocket error:', err);
        connecting = false;
      };
    } catch (err) {
      console.error('[Logs] Failed to connect:', err);
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

  function handleWebSocketMessage(data: any) {
    if (data.type === 'log_entry' && data.entry) {
      // Add new log entry to the beginning, deduplicate by requestId
      logs = [data.entry, ...logs.filter(l => l.requestId !== data.entry.requestId)].slice(0, 200);
    } else if (data.type === 'initial_logs' && data.logs) {
      // Merge initial logs, keeping any we already have
      const existingIds = new Set(logs.map(l => l.requestId));
      const newLogs = data.logs.filter((l: any) => !existingIds.has(l.requestId));
      logs = [...logs, ...newLogs].slice(0, 200);
    }
  }

  function toggleLog(requestId: string) {
    expandedLog = expandedLog === requestId ? null : requestId;
    if (expandedLog && !activeTab[requestId]) {
      activeTab[requestId] = 'request';
    }
  }

  function setTab(requestId: string, tab: string) {
    activeTab = { ...activeTab, [requestId]: tab };
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  function hasSchemaConversion(log: any): boolean {
    return log.sourceScheme !== log.targetScheme && log.targetScheme !== 'none';
  }

  function hasToolCalls(body: any): boolean {
    if (!body) return false;
    // OpenAI format
    if (body.tools?.length) return true;
    if (body.messages?.some((m: any) => m.tool_calls?.length)) return true;
    if (body.choices?.[0]?.message?.tool_calls?.length) return true;
    // Anthropic format
    if (body.content?.some?.((c: any) => c.type === 'tool_use' || c.type === 'tool_result')) return true;
    if (body.messages?.some((m: any) =>
      Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_use' || c.type === 'tool_result')
    )) return true;
    return false;
  }

  function getToolNames(body: any): string[] {
    const names: string[] = [];
    if (!body) return names;
    // From tools definitions
    if (body.tools) {
      for (const t of body.tools) {
        if (t.function?.name) names.push(t.function.name);
        else if (t.name) names.push(t.name);
      }
    }
    return [...new Set(names)];
  }

  function detectSchemaDiffs(log: any): string[] {
    const diffs: string[] = [];
    if (!log.requestBody || !log.transformedBody) return diffs;

    const src = log.requestBody;
    const tgt = log.transformedBody;

    // Tool format differences
    if (src.tools && tgt.tools) {
      // Check if tool schema format changed (input_schema vs function.parameters)
      const srcHasInputSchema = src.tools.some((t: any) => t.input_schema);
      const tgtHasInputSchema = tgt.tools.some((t: any) => t.input_schema);
      const srcHasFunction = src.tools.some((t: any) => t.function);
      const tgtHasFunction = tgt.tools.some((t: any) => t.function);

      if (srcHasInputSchema !== tgtHasInputSchema || srcHasFunction !== tgtHasFunction) {
        diffs.push('Tool schema format converted');
      }
    }

    // Message format differences
    if (src.messages && tgt.messages) {
      // System message handling
      const srcHasSystem = src.system !== undefined;
      const tgtHasSystemMsg = tgt.messages?.some((m: any) => m.role === 'system');
      if (srcHasSystem || tgtHasSystemMsg) {
        if (srcHasSystem !== tgtHasSystemMsg) {
          diffs.push('System message format converted');
        }
      }

      // Tool call content block format
      const srcHasToolUse = src.messages?.some((m: any) =>
        Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_use')
      );
      const tgtHasToolCalls = tgt.messages?.some((m: any) => m.tool_calls);
      const tgtHasToolUse = tgt.messages?.some((m: any) =>
        Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_use')
      );
      const srcHasToolCalls = src.messages?.some((m: any) => m.tool_calls);
      if (srcHasToolUse && tgtHasToolCalls) {
        diffs.push('Tool call format: tool_use blocks → tool_calls array');
      } else if (tgtHasToolUse && srcHasToolCalls) {
        diffs.push('Tool call format: tool_calls array → tool_use blocks');
      }
    }

    // Max tokens field
    if (src.max_tokens !== undefined && tgt.max_completion_tokens !== undefined) {
      diffs.push('max_tokens → max_completion_tokens');
    }

    // Stop sequences
    if (src.stop_sequences && tgt.stop) {
      diffs.push('stop_sequences → stop');
    } else if (src.stop && tgt.stop_sequences) {
      diffs.push('stop → stop_sequences');
    }

    return diffs;
  }

  let filteredLogs = $derived([...logs].filter(log => {
    const matchesFilter = !filter ||
      log.model?.toLowerCase().includes(filter.toLowerCase()) ||
      log.provider?.toLowerCase().includes(filter.toLowerCase()) ||
      log.requestId?.toLowerCase().includes(filter.toLowerCase());

    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'success' && log.responseStatus < 400 && !log.error) ||
      (statusFilter === 'error' && (log.responseStatus >= 400 || log.error));

    return matchesFilter && matchesStatus;
  }));

  onMount(() => {
    connect();
  });

  onDestroy(() => {
    disconnect();
  });
</script>

<svelte:head>
  <title>Logs - API Map</title>
</svelte:head>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Request Logs</h1>
      <p class="text-gray-600 mt-1">Full request/response traffic with transformation details</p>
    </div>

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
        <span class="text-xs opacity-60">({logs.length})</span>
      {:else if connecting}
        <Loader2 size={16} class="animate-spin" />
        <span class="text-sm font-medium">Connecting...</span>
      {:else}
        <WifiOff size={16} />
        <span class="text-sm font-medium">Offline</span>
      {/if}
    </div>
  </div>

  <!-- Filters -->
  <div class="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-4">
    <div class="flex-1">
      <input
        type="text"
        bind:value={filter}
        placeholder="Filter by model, provider, or request ID..."
        class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        aria-label="Filter logs"
      />
    </div>
    <div class="flex gap-2">
      <button
        type="button"
        onclick={() => statusFilter = 'all'}
        class="px-4 py-2 rounded-lg font-medium transition-colors"
        class:bg-blue-600={statusFilter === 'all'}
        class:text-white={statusFilter === 'all'}
        class:bg-gray-100={statusFilter !== 'all'}
        class:text-gray-700={statusFilter !== 'all'}
      >
        All
      </button>
      <button
        type="button"
        onclick={() => statusFilter = 'success'}
        class="px-4 py-2 rounded-lg font-medium transition-colors"
        class:bg-green-600={statusFilter === 'success'}
        class:text-white={statusFilter === 'success'}
        class:bg-gray-100={statusFilter !== 'success'}
        class:text-gray-700={statusFilter !== 'success'}
      >
        Success
      </button>
      <button
        type="button"
        onclick={() => statusFilter = 'error'}
        class="px-4 py-2 rounded-lg font-medium transition-colors"
        class:bg-red-600={statusFilter === 'error'}
        class:text-white={statusFilter === 'error'}
        class:bg-gray-100={statusFilter !== 'error'}
        class:text-gray-700={statusFilter !== 'error'}
      >
        Errors
      </button>
    </div>
  </div>

  {#if error}
    <div class="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 text-red-700">
      <AlertCircle size={20} />
      {error}
    </div>
  {/if}

  {#if filteredLogs.length === 0}
    <div class="bg-white rounded-xl border border-gray-200 p-12 text-center">
      <Activity class="mx-auto text-gray-300 mb-4" size={64} />
      <h3 class="text-lg font-medium text-gray-900 mb-2">No logs found</h3>
      <p class="text-gray-600">
        {#if filter || statusFilter !== 'all'}
          Try adjusting your filters
        {:else if !connected}
          Waiting for WebSocket connection...
        {:else}
          Logs will appear here when requests are made
        {/if}
      </p>
    </div>
  {:else}
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="divide-y divide-gray-200">
        {#each filteredLogs as log}
          {@const schemaDiffs = detectSchemaDiffs(log)}
          {@const toolNames = getToolNames(log.requestBody)}
          <div class="hover:bg-gray-50 transition-colors">
            <button
              type="button"
              onclick={() => toggleLog(log.requestId)}
              class="w-full px-6 py-4 text-left"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-4">
                  {#if log.error || log.responseStatus >= 400}
                    <AlertCircle class="text-red-500 shrink-0" size={20} />
                  {:else}
                    <CheckCircle class="text-green-500 shrink-0" size={20} />
                  {/if}
                  <div>
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-mono text-sm font-medium text-gray-900">{log.model}</span>
                      <ArrowRight size={14} class="text-gray-400" />
                      <span class="font-mono text-sm text-gray-600">{log.targetModel}</span>
                      {#if !log.routed}
                        <span class="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                          Unrouted
                        </span>
                      {/if}
                      {#if hasSchemaConversion(log)}
                        <span class="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full flex items-center gap-1">
                          <ArrowRight size={10} />
                          {log.sourceScheme} → {log.targetScheme}
                        </span>
                      {/if}
                      {#if toolNames.length > 0}
                        <span class="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded-full flex items-center gap-1">
                          <Wrench size={10} />
                          {toolNames.length} tool{toolNames.length > 1 ? 's' : ''}
                        </span>
                      {/if}
                      {#if schemaDiffs.length > 0}
                        <span class="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full flex items-center gap-1" title={schemaDiffs.join(', ')}>
                          <AlertTriangle size={10} />
                          {schemaDiffs.length} conversion{schemaDiffs.length > 1 ? 's' : ''}
                        </span>
                      {/if}
                    </div>
                    <div class="flex items-center gap-4 mt-1 text-sm text-gray-500">
                      <span class="flex items-center gap-1">
                        <Server size={14} />
                        {log.provider}
                      </span>
                      <span class="flex items-center gap-1">
                        <Clock size={14} />
                        {formatTime(log.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-4">
                  <span class="text-sm font-medium text-gray-600">
                    {formatDuration(log.durationMs)}
                  </span>
                  <span class="px-2 py-1 rounded text-sm font-mono" class:bg-green-100={log.responseStatus < 400} class:text-green-700={log.responseStatus < 400} class:bg-red-100={log.responseStatus >= 400} class:text-red-700={log.responseStatus >= 400}>
                    {log.responseStatus}
                  </span>
                  {#if expandedLog === log.requestId}
                    <ChevronUp size={20} class="text-gray-400" />
                  {:else}
                    <ChevronDown size={20} class="text-gray-400" />
                  {/if}
                </div>
              </div>
            </button>

            {#if expandedLog === log.requestId}
              <div class="px-6 pb-4 border-t border-gray-100">
                <!-- Schema Conversion Warnings -->
                {#if schemaDiffs.length > 0}
                  <div class="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div class="flex items-center gap-2 text-blue-700 text-sm font-medium mb-1">
                      <AlertTriangle size={14} />
                      Schema Conversions Applied
                    </div>
                    <ul class="text-sm text-blue-600 ml-5 list-disc">
                      {#each schemaDiffs as diff}
                        <li>{diff}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}

                <!-- Tabs -->
                <div class="flex gap-1 mt-4 border-b border-gray-200">
                  {#each [
                    { id: 'request', label: 'Request' },
                    ...(log.transformedBody ? [{ id: 'transformed', label: 'Transformed Request' }] : []),
                    ...(log.rawUpstreamResponse ? [{ id: 'raw_response', label: 'Upstream Response' }] : []),
                    { id: 'response', label: log.rawUpstreamResponse ? 'Client Response' : 'Response' },
                    ...(log.error ? [{ id: 'error', label: 'Error' }] : []),
                    { id: 'meta', label: 'Metadata' }
                  ] as tab}
                    <button
                      type="button"
                      onclick={() => setTab(log.requestId, tab.id)}
                      class="px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
                      class:border-blue-500={(activeTab[log.requestId] || 'request') === tab.id}
                      class:text-blue-600={(activeTab[log.requestId] || 'request') === tab.id}
                      class:border-transparent={(activeTab[log.requestId] || 'request') !== tab.id}
                      class:text-gray-500={(activeTab[log.requestId] || 'request') !== tab.id}
                      class:hover:text-gray-700={(activeTab[log.requestId] || 'request') !== tab.id}
                    >
                      {tab.label}
                      {#if tab.id === 'error'}
                        <span class="ml-1 w-2 h-2 bg-red-500 rounded-full inline-block"></span>
                      {/if}
                    </button>
                  {/each}
                </div>

                <div class="pt-4">
                  <!-- Request Tab -->
                  {#if (activeTab[log.requestId] || 'request') === 'request'}
                    <div class="space-y-3">
                      <div class="flex items-center gap-2 text-sm text-gray-500">
                        <span class="font-medium">Format:</span>
                        <span class="px-2 py-0.5 bg-gray-100 rounded font-mono text-xs">{log.sourceScheme}</span>
                        <span class="font-medium ml-2">Endpoint:</span>
                        <span class="font-mono text-xs">{log.method} {log.path}</span>
                      </div>
                      {#if toolNames.length > 0}
                        <div class="flex items-center gap-2 text-sm text-gray-500">
                          <Wrench size={14} />
                          <span class="font-medium">Tools:</span>
                          {#each toolNames as name}
                            <span class="px-2 py-0.5 bg-purple-50 text-purple-700 rounded font-mono text-xs">{name}</span>
                          {/each}
                        </div>
                      {/if}
                      <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto max-h-96 overflow-y-auto">
                        <pre class="text-sm text-gray-100 font-mono whitespace-pre-wrap">{JSON.stringify(log.requestBody, null, 2)}</pre>
                      </div>
                    </div>
                  {/if}

                  <!-- Transformed Request Tab -->
                  {#if (activeTab[log.requestId] || 'request') === 'transformed' && log.transformedBody}
                    <div class="space-y-3">
                      <div class="flex items-center gap-2 text-sm text-gray-500">
                        <span class="font-medium">Target format:</span>
                        <span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded font-mono text-xs">{log.targetScheme}</span>
                        <ArrowRight size={12} />
                        <span class="font-medium">Provider:</span>
                        <span class="font-mono text-xs">{log.provider}</span>
                      </div>
                      {#if getToolNames(log.transformedBody).length > 0}
                        <div class="flex items-center gap-2 text-sm text-gray-500">
                          <Wrench size={14} />
                          <span class="font-medium">Tools (transformed):</span>
                          {#each getToolNames(log.transformedBody) as name}
                            <span class="px-2 py-0.5 bg-purple-50 text-purple-700 rounded font-mono text-xs">{name}</span>
                          {/each}
                        </div>
                      {/if}
                      <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto max-h-96 overflow-y-auto">
                        <pre class="text-sm text-gray-100 font-mono whitespace-pre-wrap">{JSON.stringify(log.transformedBody, null, 2)}</pre>
                      </div>
                    </div>
                  {/if}

                  <!-- Raw Upstream Response Tab -->
                  {#if (activeTab[log.requestId] || 'request') === 'raw_response' && log.rawUpstreamResponse}
                    <div class="space-y-3">
                      <div class="flex items-center gap-2 text-sm text-gray-500">
                        <span class="font-medium">Raw response from:</span>
                        <span class="px-2 py-0.5 bg-gray-100 rounded font-mono text-xs">{log.provider}</span>
                        <span class="font-medium ml-2">Format:</span>
                        <span class="px-2 py-0.5 bg-gray-100 rounded font-mono text-xs">{log.targetScheme}</span>
                      </div>
                      {#if hasToolCalls(log.rawUpstreamResponse)}
                        <div class="flex items-center gap-2 text-sm text-amber-600">
                          <Wrench size={14} />
                          <span class="font-medium">Contains tool calls in upstream format</span>
                        </div>
                      {/if}
                      <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto max-h-96 overflow-y-auto">
                        <pre class="text-sm text-gray-100 font-mono whitespace-pre-wrap">{JSON.stringify(log.rawUpstreamResponse, null, 2)}</pre>
                      </div>
                    </div>
                  {/if}

                  <!-- Response Tab -->
                  {#if (activeTab[log.requestId] || 'request') === 'response'}
                    <div class="space-y-3">
                      <div class="flex items-center gap-2 text-sm text-gray-500">
                        <span class="font-medium">Status:</span>
                        <span class="px-2 py-0.5 rounded font-mono text-xs"
                          class:bg-green-100={log.responseStatus < 400}
                          class:text-green-700={log.responseStatus < 400}
                          class:bg-red-100={log.responseStatus >= 400}
                          class:text-red-700={log.responseStatus >= 400}
                        >{log.responseStatus}</span>
                        <span class="font-medium ml-2">Format:</span>
                        <span class="px-2 py-0.5 bg-gray-100 rounded font-mono text-xs">{log.sourceScheme}</span>
                      </div>
                      {#if log.responseBody}
                        {#if hasToolCalls(log.responseBody)}
                          <div class="flex items-center gap-2 text-sm text-purple-600">
                            <Wrench size={14} />
                            <span class="font-medium">Contains tool calls in client format</span>
                          </div>
                        {/if}
                        <div class="bg-gray-900 rounded-lg p-4 overflow-x-auto max-h-96 overflow-y-auto">
                          <pre class="text-sm text-gray-100 font-mono whitespace-pre-wrap">{#if typeof log.responseBody === 'string'}{log.responseBody}{:else}{JSON.stringify(log.responseBody, null, 2)}{/if}</pre>
                        </div>
                      {:else}
                        <div class="text-sm text-gray-500 italic">No response body captured (streaming or passthrough)</div>
                      {/if}
                    </div>
                  {/if}

                  <!-- Error Tab -->
                  {#if (activeTab[log.requestId] || 'request') === 'error' && log.error}
                    <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                      <p class="text-sm text-red-800 font-mono whitespace-pre-wrap">{log.error}</p>
                    </div>
                  {/if}

                  <!-- Metadata Tab -->
                  {#if (activeTab[log.requestId] || 'request') === 'meta'}
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span class="text-gray-500 block">Request ID</span>
                        <p class="font-mono text-gray-900 text-xs break-all">{log.requestId}</p>
                      </div>
                      <div>
                        <span class="text-gray-500 block">Method</span>
                        <p class="text-gray-900">{log.method}</p>
                      </div>
                      <div>
                        <span class="text-gray-500 block">Path</span>
                        <p class="text-gray-900 font-mono text-xs">{log.path}</p>
                      </div>
                      <div>
                        <span class="text-gray-500 block">Source Format</span>
                        <p class="text-gray-900 font-mono text-xs">{log.sourceScheme}</p>
                      </div>
                      <div>
                        <span class="text-gray-500 block">Target Format</span>
                        <p class="text-gray-900 font-mono text-xs">{log.targetScheme}</p>
                      </div>
                      <div>
                        <span class="text-gray-500 block">Provider</span>
                        <p class="text-gray-900">{log.provider}</p>
                      </div>
                      <div>
                        <span class="text-gray-500 block">Duration</span>
                        <p class="text-gray-900">{formatDuration(log.durationMs)}</p>
                      </div>
                      <div>
                        <span class="text-gray-500 block">Matched Pattern</span>
                        <p class="text-gray-900 font-mono text-xs">{log.matchedPattern || 'N/A'}</p>
                      </div>
                      <div>
                        <span class="text-gray-500 block">Timestamp</span>
                        <p class="text-gray-900 text-xs">{log.timestamp}</p>
                      </div>
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
