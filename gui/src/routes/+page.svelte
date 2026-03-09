<script lang="ts">
  import { onMount } from 'svelte';
  import { AlertTriangle, CheckCircle, Activity, Clock, Server, Route, Zap, Plus, X, Eye } from '@lucide/svelte';

  // Simple local state
  let status = $state<any>(null);
  let unrouted: any[] = $state([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function loadData() {
    try {
      const res = await fetch('/api/admin/status');
      if (!res.ok) throw new Error('Failed to load status');
      status = await res.json();
      
      const unroutedRes = await fetch('/api/admin/unrouted');
      if (unroutedRes.ok) {
        const data = await unroutedRes.json();
        unrouted = data.unrouted;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  });
</script>

<div class="space-y-6">
  <div>
    <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
    <p class="text-gray-600 mt-1">Overview of your model router</p>
  </div>

  {#if loading}
    <div class="text-center py-12 text-gray-500">Loading...</div>
  {:else if error}
    <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
      Error: {error}
    </div>
  {:else if status}
    <!-- Stats Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-white rounded-xl border border-gray-200 p-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-600">Total Requests</p>
            <p class="text-2xl font-bold text-gray-900 mt-1">{status.totalRequests.toLocaleString()}</p>
          </div>
          <div class="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center">
            <Activity class="text-blue-600" size={24} />
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-gray-200 p-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-600">Routed</p>
            <p class="text-2xl font-bold text-green-600 mt-1">{status.routedRequests.toLocaleString()}</p>
          </div>
          <div class="w-12 h-12 bg-green-50 rounded-lg flex items-center justify-center">
            <CheckCircle class="text-green-600" size={24} />
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-gray-200 p-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-600">Unrouted</p>
            <p class="text-2xl font-bold {status.unroutedRequests > 0 ? 'text-red-600' : 'text-gray-900'} mt-1">
              {status.unroutedRequests.toLocaleString()}
            </p>
          </div>
          <div class="w-12 h-12 rounded-lg flex items-center justify-center {status.unroutedRequests > 0 ? 'bg-red-50' : 'bg-gray-50'}">
            <AlertTriangle class={status.unroutedRequests > 0 ? 'text-red-600' : 'text-gray-400'} size={24} />
          </div>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-gray-200 p-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-600">Avg Latency</p>
            <p class="text-2xl font-bold text-gray-900 mt-1">{status.averageLatency}ms</p>
          </div>
          <div class="w-12 h-12 bg-purple-50 rounded-lg flex items-center justify-center">
            <Clock class="text-purple-600" size={24} />
          </div>
        </div>
      </div>
    </div>

    <!-- Unrouted Requests -->
    {#if unrouted.length > 0}
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <AlertTriangle class="text-red-500" size={24} />
            <div>
              <h2 class="text-lg font-semibold text-gray-900">Unrouted Requests</h2>
              <p class="text-sm text-gray-600">These requests couldn't be routed</p>
            </div>
          </div>
        </div>

        <div class="divide-y divide-gray-200">
          {#each unrouted.slice(0, 5) as request}
            <div class="p-4">
              <div class="flex items-center justify-between">
                <div>
                  <span class="font-mono text-sm font-medium text-gray-900">{request.model}</span>
                  <div class="text-sm text-gray-500 mt-1">
                    {request.endpoint} · {new Date(request.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
