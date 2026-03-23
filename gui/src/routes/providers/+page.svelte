<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import {
    Server,
    CheckCircle,
    XCircle,
    Cloud,
    Home,
    Plus,
    Trash2,
    Save,
    AlertCircle,
    Eye,
    EyeOff,
    Key,
    ChevronDown,
    ChevronUp,
    GripVertical,
  } from '@lucide/svelte';
  import { providers, builtinProviders, isLoadingProviders } from '$lib/stores';
  import { providersApi } from '$lib/utils/api';
  import type { ProviderConfig, ProviderInfo } from '$lib/utils/api';

  import { resolveApiUrl } from '$lib/utils/api';
  const API_URL = resolveApiUrl();

  // State
  let enabledProviders: Array<{ id: string; config: ProviderConfig; builtin?: ProviderInfo }> = $state([]);
  let showApiKeys: Record<string, boolean> = $state({});
  let hasUnsavedChanges = $state(false);
  let saveError: string | null = $state(null);
  let saveSuccess = $state(false);
  let savingProvider: string | null = $state(null);
  let expandedProvider: string | null = $state(null);

  // Add provider state
  let addProviderSelect = $state('');

  // Available providers not yet added
  let availableToAdd = $derived.by(() => {
    const enabledIds = new Set(enabledProviders.map(p => p.id));
    return $builtinProviders
      .filter(p => !enabledIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  async function loadProviders() {
    isLoadingProviders.set(true);
    try {
      const [data, configData] = await Promise.all([
        providersApi.getAll(),
        fetch(`${API_URL}/admin/config`).then(r => r.json())
      ]);
      builtinProviders.set(data.builtin);
      providers.set(data.registered);

      // Build enabled providers list from config
      enabledProviders = [];
      for (const [id, rawConfig] of Object.entries(configData.providers || {})) {
        const builtin = data.builtin.find((b: ProviderInfo) => b.id === id);
        const config = (rawConfig || {}) as ProviderConfig;
        // Ensure baseUrl is always set
        if (!config.baseUrl && builtin?.defaultBaseUrl) {
          config.baseUrl = builtin.defaultBaseUrl;
        }
        enabledProviders.push({
          id,
          config,
          builtin,
        });
      }
    } catch (err) {
      console.error('Failed to load providers:', err);
    } finally {
      isLoadingProviders.set(false);
    }
  }

  function generateInstanceId(baseId: string): string {
    const existing = enabledProviders.filter(p => p.id === baseId || p.id.startsWith(`${baseId}-`));
    if (existing.length === 0) return baseId;
    // Find the next available number
    let n = 2;
    while (enabledProviders.some(p => p.id === `${baseId}-${n}`)) n++;
    return `${baseId}-${n}`;
  }

  function addProvider() {
    if (!addProviderSelect) return;

    const builtin = $builtinProviders.find(b => b.id === addProviderSelect);
    const id = generateInstanceId(addProviderSelect);

    const config: ProviderConfig = {
      baseUrl: builtin?.defaultBaseUrl || 'https://api.example.com/v1',
      authHeader: builtin?.authHeader || 'Authorization',
      authPrefix: builtin?.authPrefix || 'Bearer ',
      supportsStreaming: builtin?.supportsStreaming ?? true,
    };

    enabledProviders = [...enabledProviders, { id, config, builtin: builtin || undefined }];
    hasUnsavedChanges = true;
    expandedProvider = id;
    addProviderSelect = '';
  }

  function removeProvider(id: string) {
    enabledProviders = enabledProviders.filter(p => p.id !== id);
    if (expandedProvider === id) expandedProvider = null;
    hasUnsavedChanges = true;
  }

  function updateProviderConfig(id: string, updates: Partial<ProviderConfig>) {
    enabledProviders = enabledProviders.map(p =>
      p.id === id ? { ...p, config: { ...p.config, ...updates } } : p
    );
    hasUnsavedChanges = true;
  }

  async function saveSingleProvider(id: string) {
    savingProvider = id;
    saveError = null;
    try {
      await saveAllProviders();
      hasUnsavedChanges = false;
      saveSuccess = true;
      setTimeout(() => saveSuccess = false, 2000);
    } catch (err) {
      saveError = err instanceof Error ? err.message : `Failed to save`;
    } finally {
      savingProvider = null;
    }
  }

  async function saveAllProviders() {
    const providersToSave: Record<string, ProviderConfig> = {};
    for (const { id, config } of enabledProviders) {
      const cleaned = { ...config };
      if (!cleaned.apiKey) delete cleaned.apiKey;
      providersToSave[id] = cleaned;
    }
    await providersApi.update(providersToSave);
  }

  function getProviderIcon(provider: { builtin?: ProviderInfo }) {
    if (!provider.builtin) return Server;
    return provider.builtin.category === 'local' ? Home : Cloud;
  }

  function getStatusColor(provider: { config: ProviderConfig; builtin?: ProviderInfo }): string {
    if (!provider.builtin?.requiresApiKey) return 'green'; // Local providers
    if (provider.config.apiKey) return 'green'; // Direct key set
    if (provider.builtin?.defaultApiKeyEnv) return 'yellow'; // Might have env var
    return 'red';
  }

  function getStatusText(provider: { config: ProviderConfig; builtin?: ProviderInfo }): string {
    if (!provider.builtin?.requiresApiKey) return 'No key needed';
    if (provider.config.apiKey) return 'API key set';
    if (provider.builtin?.defaultApiKeyEnv) return `Uses ${provider.builtin.defaultApiKeyEnv}`;
    return 'No API key';
  }

  // Warn on unsaved changes
  beforeNavigate(({ cancel }) => {
    if (hasUnsavedChanges && !confirm('You have unsaved provider changes. Leave without saving?')) {
      cancel();
    }
  });

  function handleBeforeUnload(e: BeforeUnloadEvent) {
    if (hasUnsavedChanges) {
      e.preventDefault();
    }
  }

  onMount(() => {
    loadProviders();
  });
</script>

<svelte:window onbeforeunload={handleBeforeUnload} />

<svelte:head>
  <title>Providers - API Map</title>
</svelte:head>

<div class="space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-2xl font-bold text-gray-900">Providers</h1>
    <p class="text-gray-600 mt-1">Manage upstream AI model providers</p>
  </div>

  {#if saveError}
    <div class="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 text-red-700">
      <AlertCircle size={20} />
      {saveError}
    </div>
  {/if}

  {#if saveSuccess}
    <div class="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3 text-green-700">
      <CheckCircle size={20} />
      Saved!
    </div>
  {/if}

  {#if $isLoadingProviders}
    <div class="text-center py-12 text-gray-500">Loading providers...</div>
  {:else}
    <!-- Add Provider -->
    <div class="bg-white rounded-xl border border-gray-200 p-4">
      <div class="flex gap-3 items-end">
        <div class="flex-1">
          <label for="add-provider" class="block text-sm font-medium text-gray-700 mb-1">
            Add Provider
          </label>
          <select
            id="add-provider"
            bind:value={addProviderSelect}
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
          >
            <option value="">Select a provider to add...</option>
            <optgroup label="Cloud Providers">
              {#each availableToAdd.filter(p => p.category === 'cloud') as provider}
                <option value={provider.id}>{provider.name} - {provider.description}</option>
              {/each}
            </optgroup>
            <optgroup label="Local Providers">
              {#each availableToAdd.filter(p => p.category === 'local') as provider}
                <option value={provider.id}>{provider.name} - {provider.description}</option>
              {/each}
            </optgroup>
            <optgroup label="Enterprise">
              {#each availableToAdd.filter(p => p.category === 'enterprise' || p.category === 'regional') as provider}
                <option value={provider.id}>{provider.name} - {provider.description}</option>
              {/each}
            </optgroup>
          </select>
        </div>
        <button
          type="button"
          onclick={addProvider}
          disabled={!addProviderSelect}
          class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Plus size={18} />
          Add
        </button>
      </div>
      <p class="text-xs text-gray-500 mt-2">
        You can add the same provider multiple times with different API keys or endpoints.
      </p>
    </div>

    <!-- Enabled Providers List -->
    {#if enabledProviders.length === 0}
      <div class="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
        <Server class="mx-auto mb-4 text-gray-300" size={48} />
        <p class="text-lg font-medium text-gray-700">No providers configured</p>
        <p class="mt-1">Add a provider above to get started.</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each enabledProviders as provider (provider.id)}
          {@const isExpanded = expandedProvider === provider.id}
          {@const IconComponent = getProviderIcon(provider)}
          {@const statusColor = getStatusColor(provider)}
          {@const statusText = getStatusText(provider)}

          <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <!-- Provider Row -->
            <button
              type="button"
              class="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
              onclick={() => expandedProvider = isExpanded ? null : provider.id}
            >
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-lg {statusColor === 'green' ? 'bg-green-100' : statusColor === 'yellow' ? 'bg-yellow-100' : 'bg-gray-100'} flex items-center justify-center">
                  <IconComponent class={statusColor === 'green' ? 'text-green-600' : statusColor === 'yellow' ? 'text-yellow-600' : 'text-gray-400'} size={18} />
                </div>
                <div class="text-left">
                  <h3 class="font-semibold text-gray-900 text-sm">{provider.id}</h3>
                  <p class="text-xs text-gray-500">
                    {provider.builtin?.description || 'Custom provider'} &middot;
                    <span class="{statusColor === 'green' ? 'text-green-600' : statusColor === 'yellow' ? 'text-yellow-600' : 'text-red-500'}">{statusText}</span>
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-2">
                {#if isExpanded}
                  <ChevronUp size={18} class="text-gray-400" />
                {:else}
                  <ChevronDown size={18} class="text-gray-400" />
                {/if}
              </div>
            </button>

            <!-- Expanded Configuration -->
            {#if isExpanded}
              <div class="px-5 pb-5 border-t border-gray-100 pt-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <!-- Base URL -->
                  <div>
                    <label for="{provider.id}-baseUrl" class="block text-xs font-medium text-gray-600 mb-1">
                      Base URL
                    </label>
                    <input
                      id="{provider.id}-baseUrl"
                      type="text"
                      value={provider.config.baseUrl}
                      oninput={(e) => updateProviderConfig(provider.id, { baseUrl: e.currentTarget.value })}
                      class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                  </div>

                  <!-- API Key -->
                  <div>
                    <label for="{provider.id}-apiKey" class="block text-xs font-medium text-gray-600 mb-1">
                      API Key
                      {#if provider.builtin?.defaultApiKeyEnv}
                        <span class="text-gray-400 font-normal">({provider.builtin.defaultApiKeyEnv})</span>
                      {/if}
                    </label>
                    <div class="relative">
                      <input
                        id="{provider.id}-apiKey"
                        type={showApiKeys[provider.id] ? 'text' : 'password'}
                        value={provider.config.apiKey || ''}
                        placeholder={provider.builtin?.requiresApiKey ? 'Required' : 'Optional'}
                        oninput={(e) => updateProviderConfig(provider.id, { apiKey: e.currentTarget.value })}
                        class="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                      <button
                        type="button"
                        onclick={() => showApiKeys[provider.id] = !showApiKeys[provider.id]}
                        class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {#if showApiKeys[provider.id]}
                          <EyeOff size={16} />
                        {:else}
                          <Eye size={16} />
                        {/if}
                      </button>
                    </div>
                  </div>

                  <!-- Timeout -->
                  <div>
                    <label for="{provider.id}-timeout" class="block text-xs font-medium text-gray-600 mb-1">
                      Timeout (seconds)
                    </label>
                    <input
                      id="{provider.id}-timeout"
                      type="number"
                      min="1"
                      max="600"
                      value={provider.config.timeout || ''}
                      placeholder="Default (120)"
                      oninput={(e) => updateProviderConfig(provider.id, { timeout: e.currentTarget.value ? parseInt(e.currentTarget.value) : undefined })}
                      class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                  </div>

                  <!-- Streaming -->
                  <div class="flex items-center pt-5">
                    <label class="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={provider.config.supportsStreaming !== false}
                        onchange={(e) => updateProviderConfig(provider.id, { supportsStreaming: e.currentTarget.checked })}
                        class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      Supports streaming
                    </label>
                  </div>
                </div>

                <!-- Actions -->
                <div class="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onclick={() => removeProvider(provider.id)}
                    class="flex items-center gap-2 px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm"
                  >
                    <Trash2 size={16} />
                    Remove
                  </button>
                  <button
                    type="button"
                    onclick={() => saveSingleProvider(provider.id)}
                    disabled={savingProvider === provider.id}
                    class="flex items-center gap-2 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {#if savingProvider === provider.id}
                      <span class="animate-spin">&#x27F3;</span>
                    {:else}
                      <Save size={16} />
                    {/if}
                    Save
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Help -->
    <div class="bg-blue-50 rounded-xl border border-blue-200 p-5">
      <h3 class="font-semibold text-blue-900 mb-2 flex items-center gap-2">
        <AlertCircle size={18} />
        Tips
      </h3>
      <div class="text-sm text-blue-800 space-y-1">
        <p><strong>Multiple instances:</strong> Add the same provider type multiple times with different API keys or endpoints (e.g., two OpenAI accounts).</p>
        <p><strong>Local providers:</strong> Ollama, LM Studio, etc. are auto-detected on first start and don't need API keys.</p>
        <p><strong>Environment variables:</strong> If an API key env var (e.g., OPENAI_API_KEY) is set, the provider will use it automatically.</p>
      </div>
    </div>
  {/if}
</div>
