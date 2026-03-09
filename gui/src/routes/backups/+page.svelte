<script lang="ts">
  import { onMount } from 'svelte';
  import { 
    Database, 
    Plus, 
    RotateCcw, 
    Trash2, 
    AlertCircle, 
    CheckCircle,
    Clock,
    FileText
  } from '@lucide/svelte';
  import { backups, isLoadingBackups } from '$lib/stores';
  import { backupApi } from '$lib/utils/api';

  let error: string | null = $state(null);
  let success = $state(false);
  let restoring = $state(false);
  let deleting = $state(false);

  async function loadBackups() {
    isLoadingBackups.set(true);
    try {
      const data = await backupApi.list();
      backups.set(data.backups);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load backups';
    } finally {
      isLoadingBackups.set(false);
    }
  }

  async function createBackup() {
    error = null;
    try {
      await backupApi.create();
      success = true;
      setTimeout(() => success = false, 3000);
      await loadBackups();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create backup';
    }
  }

  async function restoreBackup(filename: string) {
    if (!confirm(`Are you sure you want to restore from "${filename}"? This will replace your current configuration.`)) {
      return;
    }
    
    restoring = true;
    error = null;
    try {
      await backupApi.restore(filename);
      success = true;
      setTimeout(() => success = false, 3000);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to restore backup';
    } finally {
      restoring = false;
    }
  }

  async function deleteBackup(filename: string) {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
      return;
    }
    
    deleting = true;
    error = null;
    try {
      await backupApi.delete(filename);
      await loadBackups();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to delete backup';
    } finally {
      deleting = false;
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString();
  }

  onMount(() => {
    loadBackups();
  });
</script>

<svelte:head>
  <title>Backups - API Map</title>
</svelte:head>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Configuration Backups</h1>
      <p class="text-gray-600 mt-1">Manage and restore previous configurations</p>
    </div>
    <button
      type="button"
      onclick={createBackup}
      class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
    >
      <Plus size={18} />
      Create Backup
    </button>
  </div>

  {#if error}
    <div class="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 text-red-700">
      <AlertCircle size={20} />
      {error}
    </div>
  {/if}

  {#if success}
    <div class="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3 text-green-700">
      <CheckCircle size={20} />
      Operation completed successfully!
    </div>
  {/if}

  {#if $isLoadingBackups}
    <div class="text-center py-12 text-gray-500">Loading backups...</div>
  {:else if $backups.length === 0}
    <div class="bg-white rounded-xl border border-gray-200 p-12 text-center">
      <Database class="mx-auto text-gray-300 mb-4" size={64} />
      <h3 class="text-lg font-medium text-gray-900 mb-2">No backups yet</h3>
      <p class="text-gray-600 mb-4">Create your first backup to protect your configuration</p>
      <button
        type="button"
        onclick={createBackup}
        class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        <Plus size={18} />
        Create Backup
      </button>
    </div>
  {:else}
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h2 class="text-lg font-semibold text-gray-900">Available Backups</h2>
        <p class="text-sm text-gray-600 mt-1">{$backups.length} backup{$backups.length !== 1 ? 's' : ''} available</p>
      </div>

      <div class="divide-y divide-gray-200">
        {#each $backups as backup}
          <div class="p-6 flex items-center justify-between hover:bg-gray-50 transition-colors">
            <div class="flex items-center gap-4">
              <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <FileText class="text-blue-600" size={24} />
              </div>
              <div>
                <h3 class="font-medium text-gray-900">{backup.filename}</h3>
                <div class="flex items-center gap-4 mt-1 text-sm text-gray-500">
                  <span class="flex items-center gap-1">
                    <Clock size={14} />
                    {formatDate(backup.createdAt)}
                  </span>
                  <span>{formatSize(backup.size)}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                onclick={() => restoreBackup(backup.filename)}
                disabled={restoring}
                class="flex items-center gap-2 px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-lg font-medium transition-colors"
              >
                <RotateCcw size={16} />
                Restore
              </button>
              <button
                type="button"
                onclick={() => deleteBackup(backup.filename)}
                disabled={deleting}
                class="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                aria-label="Delete backup"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Info Section -->
    <div class="bg-blue-50 rounded-xl border border-blue-200 p-6">
      <h3 class="font-semibold text-blue-900 mb-2 flex items-center gap-2">
        <AlertCircle size={20} />
        About Backups
      </h3>
      <ul class="text-sm text-blue-800 space-y-1 list-disc list-inside">
        <li>Backups are created automatically before each configuration change</li>
        <li>Restoring a backup will immediately apply that configuration</li>
        <li>The current configuration is backed up before restoring an old one</li>
        <li>Backups are stored locally on this machine</li>
      </ul>
    </div>
  {/if}
</div>
