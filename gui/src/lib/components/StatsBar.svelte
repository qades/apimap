<script lang="ts">
  import { Activity, CheckCircle, Loader2, Clock, AlertTriangle } from '@lucide/svelte';
  import type { DashboardStats } from '$lib/utils/api';

  interface Props {
    stats: DashboardStats;
  }

  let { stats }: Props = $props();

  function formatNumber(num: number): string {
    return num.toLocaleString();
  }
</script>

<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
  <!-- Total -->
  <div class="bg-white rounded-xl border border-gray-200 p-4">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-gray-600">Total</p>
        <p class="text-2xl font-bold text-gray-900">{formatNumber(stats.total)}</p>
        {#if stats.streaming > 0}
          <p class="text-base font-semibold text-blue-600">{stats.streaming} ● stream</p>
        {:else}
          <p class="text-base font-semibold text-gray-400">-</p>
        {/if}
      </div>
      <div class="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
        <Activity class="text-blue-600" size={20} />
      </div>
    </div>
  </div>

  <!-- Routed -->
  <div class="bg-white rounded-xl border border-gray-200 p-4">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-gray-600">Routed</p>
        <p class="text-2xl font-bold text-green-600">{formatNumber(stats.routed)}</p>
        {#if stats.unrouted > 0}
          <p class="text-base font-semibold text-orange-600">{stats.unrouted} ⚠️</p>
        {:else}
          <p class="text-base font-semibold text-gray-400">-</p>
        {/if}
      </div>
      <div class="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
        <CheckCircle class="text-green-600" size={20} />
      </div>
    </div>
  </div>

  <!-- Running -->
  <div class="bg-white rounded-xl border border-gray-200 p-4">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-gray-600">Running</p>
        <p class="text-2xl font-bold text-amber-600">{formatNumber(stats.running)}</p>
        {#if stats.runningStreaming > 0}
          <p class="text-base font-semibold text-blue-600">{stats.runningStreaming} streaming</p>
        {:else}
          <p class="text-base font-semibold text-gray-400">-</p>
        {/if}
      </div>
      <div class="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
        <Loader2 class="text-amber-600" size={20} />
      </div>
    </div>
  </div>

  <!-- Completed -->
  <div class="bg-white rounded-xl border border-gray-200 p-4">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-gray-600">Completed</p>
        <p class="text-2xl font-bold text-purple-600">{formatNumber(stats.completed)}</p>
        {#if stats.errors > 0}
          <p class="text-base font-semibold text-red-600">{stats.errors} ✗</p>
        {:else}
          <p class="text-base font-semibold text-gray-400">-</p>
        {/if}
      </div>
      <div class="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
        <CheckCircle class="text-purple-600" size={20} />
      </div>
    </div>
  </div>

  <!-- Avg Latency (streaming only) -->
  <div class="bg-white rounded-xl border border-gray-200 p-4">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-gray-600">Avg Latency</p>
        <p class="text-2xl font-bold text-gray-900">{stats.avgLatency} <span class="text-sm font-normal">ms</span></p>
        <p class="text-xs text-gray-400">streaming only</p>
      </div>
      <div class="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center">
        <Clock class="text-gray-600" size={20} />
      </div>
    </div>
  </div>
</div>
