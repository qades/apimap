<script lang="ts">
  import { onMount } from 'svelte';
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
    Key
  } from '@lucide/svelte';
  import { providers, builtinProviders, isLoadingProviders } from '$lib/stores';
  import { providersApi } from '$lib/utils/api';
  import type { ProviderConfig } from '$lib/utils/api';
  
  // API URL is injected by GUI server
  const API_URL = typeof window !== 'undefined' && (window as any).API_URL 
    ? (window as any).API_URL 
    : 'http://localhost:3000';

  let editingProviders: Record<string, ProviderConfig> = $state({});
  let showApiKeys: Record<string, boolean> = $state({});
  let hasChanges = $state(false);
  let saveError: string | null = $state(null);
  let saveSuccess = $state(false);
  let savingProvider: string | null = $state(null);
  
  // Global settings
  let globalTimeout = $state(120);
  let showTimeoutOverrides = $state<Record<string, boolean>>({});
  
  // Collapse/expand state - groups expanded if they have enabled providers
  let expandedGroups = $state<Record<string, boolean>>({});
  let expandedProviders = $state<Record<string, boolean>>({});

  // Auth preset options
  const authPresets = [
    { label: 'Bearer Token (OpenAI-style)', header: 'Authorization', prefix: 'Bearer ' },
    { label: 'API Key (Anthropic-style)', header: 'x-api-key', prefix: '' },
    { label: 'Google API Key', header: 'x-goog-api-key', prefix: '' },
    { label: 'Custom', header: '', prefix: '' },
  ];

  const categories = [
    { id: 'cloud', label: 'Cloud Providers', icon: Cloud, color: 'blue' },
    { id: 'local', label: 'Local Providers', icon: Home, color: 'green' },
    { id: 'custom', label: 'Custom Providers', icon: Server, color: 'purple' },
  ];

  async function loadProviders() {
    isLoadingProviders.set(true);
    try {
      const [data, configData] = await Promise.all([
        providersApi.getAll(),
        fetch(`${API_URL}/admin/config`).then(r => r.json())
      ]);
      builtinProviders.set(data.builtin);
      providers.set(data.registered);
      
      // Load global timeout from config
      globalTimeout = configData.server?.timeout || 120;
      
      // Initialize editing state for ALL builtin providers (not just enabled ones)
      editingProviders = {};
      showTimeoutOverrides = {};
      expandedGroups = {};
      expandedProviders = {};
      
      // Process all builtin providers
      for (const provider of data.builtin) {
        const savedConfig = configData.providers?.[provider.id] || {};
        const hasApiKey = !!savedConfig.apiKey || !!savedConfig.apiKeyEnv || 
          (!!provider.defaultApiKeyEnv && !!(window as any).ENV?.[provider.defaultApiKeyEnv]);
        const isEnabled = !!savedConfig || hasApiKey;
        
        editingProviders[provider.id] = {
          baseUrl: savedConfig.baseUrl || provider.defaultBaseUrl,
          apiKeyEnv: savedConfig.apiKeyEnv || provider.defaultApiKeyEnv,
          authHeader: savedConfig.authHeader || provider.authHeader,
          authPrefix: savedConfig.authPrefix || provider.authPrefix,
          supportsStreaming: savedConfig.supportsStreaming ?? provider.supportsStreaming,
          timeout: savedConfig.timeout,
          apiKey: savedConfig.apiKey || '',
        };
        // Show timeout field if provider has custom timeout
        showTimeoutOverrides[provider.id] = !!savedConfig.timeout;
        
        // Expand enabled providers and their groups
        if (isEnabled) {
          expandedProviders[provider.id] = true;
          expandedGroups[provider.category] = true;
        }
      }
    } catch (err) {
      console.error('Failed to load providers:', err);
    } finally {
      isLoadingProviders.set(false);
    }
  }

  function updateProvider(id: string, updates: Partial<ProviderConfig>) {
    editingProviders[id] = { ...editingProviders[id], ...updates };
    hasChanges = true;
    saveSuccess = false;
  }

  function removeProvider(id: string) {
    delete editingProviders[id];
    hasChanges = true;
    saveSuccess = false;
  }

  function addCustomProvider() {
    const id = `custom-${Date.now()}`;
    editingProviders[id] = {
      baseUrl: 'https://api.example.com/v1',
      authHeader: 'Authorization',
      authPrefix: 'Bearer ',
      supportsStreaming: true,
    };
    hasChanges = true;
    saveSuccess = false;
  }

  function focusProvider(providerId: string) {
    const builtin = $builtinProviders.find(p => p.id === providerId);
    if (!builtin) return;
    
    // Auto-expand when focusing
    expandedProviders[providerId] = true;
    expandedGroups[builtin.category] = true;
    
    // Scroll to provider
    setTimeout(() => {
      document.getElementById(`provider-${providerId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  async function saveSingleProvider(providerId: string) {
    savingProvider = providerId;
    saveError = null;
    try {
      const config = editingProviders[providerId];
      const builtin = $builtinProviders.find(p => p.id === providerId);
      
      // Determine if we should save this provider
      let providerToSave: Record<string, ProviderConfig> = {};
      
      if (!builtin) {
        // Custom provider - always save
        providerToSave[providerId] = { ...config };
        if (!providerToSave[providerId].apiKey) {
          delete providerToSave[providerId].apiKey;
        }
      } else {
        // Builtin - only save if has API key or differs from defaults
        const hasApiKey = config.apiKey || config.apiKeyEnv;
        const differsFromDefaults = 
          config.baseUrl !== builtin.defaultBaseUrl ||
          config.authHeader !== builtin.authHeader ||
          config.authPrefix !== builtin.authPrefix ||
          config.supportsStreaming !== builtin.supportsStreaming ||
          !!config.timeout;
        
        if (hasApiKey || differsFromDefaults) {
          providerToSave[providerId] = { ...config };
          if (!providerToSave[providerId].apiKey) {
            delete providerToSave[providerId].apiKey;
          }
        } else {
          // If no longer differs from defaults, remove from config
          providerToSave[providerId] = {} as ProviderConfig;
        }
      }
      
      // Get current config and merge
      const currentConfig = await fetch(`${API_URL}/admin/config`).then(r => r.json());
      const updatedProviders = { ...currentConfig.providers };
      
      if (Object.keys(providerToSave[providerId]).length === 0) {
        delete updatedProviders[providerId];
      } else {
        updatedProviders[providerId] = providerToSave[providerId];
      }
      
      await providersApi.update(updatedProviders);
      saveSuccess = true;
      setTimeout(() => saveSuccess = false, 2000);
      await loadProviders();
    } catch (err) {
      saveError = err instanceof Error ? err.message : `Failed to save ${providerId}`;
    } finally {
      savingProvider = null;
    }
  }

  async function saveProviders() {
    saveError = null;
    try {
      // Filter providers to only save those with meaningful config
      // Only include providers that differ from defaults or have an API key set
      const providersToSave: Record<string, ProviderConfig> = {};
      
      for (const [id, config] of Object.entries(editingProviders)) {
        const builtin = $builtinProviders.find(p => p.id === id);
        
        // Always save custom providers
        if (!builtin) {
          providersToSave[id] = { ...config };
          // Remove empty apiKey
          if (!providersToSave[id].apiKey) {
            delete providersToSave[id].apiKey;
          }
          continue;
        }
        
        // For builtin providers, only save if configured (has apiKey or differs from defaults)
        const hasApiKey = config.apiKey || config.apiKeyEnv;
        const differsFromDefaults = 
          config.baseUrl !== builtin.defaultBaseUrl ||
          config.authHeader !== builtin.authHeader ||
          config.authPrefix !== builtin.authPrefix ||
          config.supportsStreaming !== builtin.supportsStreaming ||
          !!config.timeout;
        
        if (hasApiKey || differsFromDefaults) {
          providersToSave[id] = { ...config };
          // Remove empty apiKey
          if (!providersToSave[id].apiKey) {
            delete providersToSave[id].apiKey;
          }
        }
      }
      
      // Save providers
      await providersApi.update(providersToSave);
      
      // Save global timeout
      const currentConfig = await fetch(`${API_URL}/admin/config`).then(r => r.json());
      await fetch(`${API_URL}/admin/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...currentConfig,
          server: {
            ...currentConfig.server,
            timeout: globalTimeout,
          },
        }),
      });
      
      hasChanges = false;
      saveSuccess = true;
      setTimeout(() => saveSuccess = false, 3000);
      await loadProviders();
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Failed to save providers';
    }
  }

  function getCustomProviders() {
    return Object.entries(editingProviders)
      .filter(([id]) => !$builtinProviders.find(b => b.id === id))
      .map(([id, config]) => ({ id, config }));
  }

  // Get the matching preset for current auth header/prefix
  function getAuthPresetId(header: string, prefix: string): string {
    const match = authPresets.find(p => 
      p.header.toLowerCase() === (header || '').toLowerCase() && 
      p.prefix === (prefix || '')
    );
    return match ? `${match.header}|${match.prefix}` : 'custom';
  }

  // Apply auth preset selection
  function applyAuthPreset(providerId: string, presetValue: string) {
    if (presetValue === 'custom') return;
    const [header, prefix] = presetValue.split('|');
    updateProvider(providerId, { 
      authHeader: header,
      authPrefix: prefix
    });
  }

  onMount(() => {
    loadProviders();
  });
</script>

<svelte:head>
  <title>Providers - API Map</title>
</svelte:head>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Providers</h1>
      <p class="text-gray-600 mt-1">Configure upstream AI model providers</p>
    </div>
    <button
      type="button"
      onclick={saveProviders}
      disabled={!hasChanges}
      class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <Save size={18} />
      Save Changes
    </button>
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
      Providers saved successfully!
    </div>
  {/if}

  {#if $isLoadingProviders}
    <div class="text-center py-12 text-gray-500">Loading providers...</div>
  {:else}
    <!-- Global Settings -->
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h2 class="text-lg font-semibold text-gray-900">Global Settings</h2>
      </div>
      <div class="p-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label for="global-timeout" class="block text-sm font-medium text-gray-700 mb-1">
              Default Timeout (seconds)
            </label>
            <input
              id="global-timeout"
              type="number"
              min="1"
              max="600"
              bind:value={globalTimeout}
              oninput={() => hasChanges = true}
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
            <p class="text-xs text-gray-500 mt-1">
              Default request timeout for all providers. Can be overridden per provider.
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Navigation & Custom Provider -->
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h2 class="text-lg font-semibold text-gray-900">Quick Navigation</h2>
      </div>
      <div class="p-6">
        <div class="flex gap-4 items-end">
          <div class="flex-1">
            <label for="nav-provider" class="block text-sm font-medium text-gray-700 mb-1">
              Jump to provider
            </label>
            <select
              id="nav-provider"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              onchange={(e) => {
                const value = e.currentTarget.value;
                if (value) {
                  const provider = $builtinProviders.find(p => p.id === value);
                  if (provider) {
                    expandedGroups[provider.category] = true;
                    expandedProviders[value] = true;
                    // Scroll to provider
                    setTimeout(() => {
                      document.getElementById(`provider-${value}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                  }
                  e.currentTarget.value = '';
                }
              }}
            >
              <option value="">Select a provider...</option>
              {#each $builtinProviders.sort((a, b) => a.name.localeCompare(b.name)) as provider}
                <option value={provider.id}>{provider.name} - {provider.description.slice(0, 60)}...</option>
              {/each}
            </select>
          </div>
          <button
            type="button"
            onclick={addCustomProvider}
            class="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Plus size={18} />
            Custom Provider
          </button>
        </div>
      </div>
    </div>

    <!-- Provider Categories - Show all providers, sorted, collapsible -->
    {#each categories as category}
      {@const categoryProviders = $builtinProviders
        .filter(p => p.category === category.id)
        .sort((a, b) => a.name.localeCompare(b.name))}
      {#if categoryProviders.length > 0}
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <!-- Collapsible Group Header -->
          <button
            type="button"
            class="w-full px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
            onclick={() => expandedGroups[category.id] = !expandedGroups[category.id]}
          >
            <div class="flex items-center gap-3">
              <category.icon class="text-{category.color}-600" size={24} />
              <h2 class="text-lg font-semibold text-gray-900">{category.label}</h2>
              <span class="text-sm text-gray-500">({categoryProviders.filter(p => p.enabled).length} enabled)</span>
            </div>
            <svg 
              class="w-5 h-5 text-gray-500 transition-transform {expandedGroups[category.id] ? 'rotate-180' : ''}" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {#if expandedGroups[category.id]}
            <div class="divide-y divide-gray-200">
              {#each categoryProviders as provider}
                {@const editing = editingProviders[provider.id] || {}}
                {@const hasApiKey = !!editing.apiKey || !!editing.apiKeyEnv}
                {@const isFullyConfigured = !provider.requiresApiKey || hasApiKey}
                {@const isEnabled = provider.enabled}
                {@const currentPreset = getAuthPresetId(editing.authHeader || provider.authHeader, editing.authPrefix || provider.authPrefix)}
                {@const isExpanded = expandedProviders[provider.id]}
                
                <div class="{isEnabled ? 'bg-blue-50/30' : ''}" id="provider-{provider.id}">
                  <!-- Provider Header (always visible) -->
                  <button
                    type="button"
                    class="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    onclick={() => expandedProviders[provider.id] = !isExpanded}
                  >
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-lg bg-{category.color}-100 flex items-center justify-center">
                        <Server class="text-{category.color}-600" size={20} />
                      </div>
                      <div class="text-left">
                        <h3 class="font-semibold text-gray-900 flex items-center gap-2">
                          {provider.name}
                          {#if isEnabled && isFullyConfigured}
                            <CheckCircle class="text-green-500" size={16} />
                          {:else if isEnabled}
                            <AlertCircle class="text-amber-500" size={16} />
                          {/if}
                        </h3>
                        <p class="text-sm text-gray-600">{provider.description}</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-3">
                      {#if isEnabled}
                        <span class="px-3 py-1 rounded-full text-xs font-medium {isFullyConfigured ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}">
                          {isFullyConfigured ? 'Ready' : 'API Key Required'}
                        </span>
                      {:else}
                        <span class="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          Not Configured
                        </span>
                      {/if}
                      <svg 
                        class="w-5 h-5 text-gray-400 transition-transform {isExpanded ? 'rotate-180' : ''}" 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  <!-- Provider Details (expandable) -->
                  {#if isExpanded}
                    <div class="px-6 pb-6">
                      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <!-- Base URL -->
                        <div>
                          <label for="{provider.id}-baseUrl" class="block text-sm font-medium text-gray-700 mb-1">
                            Base URL
                            <span class="text-red-500">*</span>
                          </label>
                          <input
                            id="{provider.id}-baseUrl"
                            type="text"
                            value={editing.baseUrl || provider.defaultBaseUrl}
                            oninput={(e) => updateProvider(provider.id, { baseUrl: e.currentTarget.value })}
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                          />
                        </div>

                        <!-- API Key -->
                        <div>
                          <label for="{provider.id}-apiKey" class="block text-sm font-medium text-gray-700 mb-1">
                            <span class="flex items-center gap-1">
                              <Key size={14} />
                              API Key
                            </span>
                          </label>
                          <div class="relative">
                            <input
                              id="{provider.id}-apiKey"
                              type={showApiKeys[provider.id] ? 'text' : 'password'}
                              value={editing.apiKey || ''}
                              placeholder={provider.requiresApiKey ? 'Required' : 'Optional'}
                              oninput={(e) => updateProvider(provider.id, { apiKey: e.currentTarget.value })}
                              class="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                            />
                            <button
                              type="button"
                              onclick={() => showApiKeys[provider.id] = !showApiKeys[provider.id]}
                              class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              aria-label={showApiKeys[provider.id] ? 'Hide API key' : 'Show API key'}
                            >
                              {#if showApiKeys[provider.id]}
                                <EyeOff size={16} />
                              {:else}
                                <Eye size={16} />
                              {/if}
                            </button>
                          </div>
                        </div>

                        <!-- Environment Variable -->
                        <div>
                          <label for="{provider.id}-apiKeyEnv" class="block text-sm font-medium text-gray-700 mb-1">
                            Environment Variable
                          </label>
                          <input
                            id="{provider.id}-apiKeyEnv"
                            type="text"
                            value={editing.apiKeyEnv || provider.defaultApiKeyEnv || ''}
                            placeholder={provider.defaultApiKeyEnv || 'e.g., MY_API_KEY'}
                            oninput={(e) => updateProvider(provider.id, { apiKeyEnv: e.currentTarget.value })}
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                          />
                        </div>

                        <!-- Auth Type -->
                        <div>
                          <label for="{provider.id}-authType" class="block text-sm font-medium text-gray-700 mb-1">
                            Authentication Type
                          </label>
                          <input
                            id="{provider.id}-authType"
                            type="text"
                            list="auth-presets"
                            value={currentPreset === 'custom' ? `${editing.authHeader || provider.authHeader}|${editing.authPrefix || provider.authPrefix}` : currentPreset}
                            oninput={(e) => applyAuthPreset(provider.id, e.currentTarget.value)}
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                          />
                          <datalist id="auth-presets">
                            {#each authPresets as preset}
                              {#if preset.label !== 'Custom'}
                                <option value="{preset.header}|{preset.prefix}">{preset.label}</option>
                              {/if}
                            {/each}
                          </datalist>
                          <p class="text-xs text-gray-500 mt-1">
                            Header: <code>{editing.authHeader || provider.authHeader}</code>
                          </p>
                        </div>

                        <!-- Timeout Override -->
                        <div>
                          <label class="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                            <input
                              type="checkbox"
                              checked={showTimeoutOverrides[provider.id]}
                              onchange={(e) => {
                                showTimeoutOverrides[provider.id] = e.currentTarget.checked;
                                if (!e.currentTarget.checked) {
                                  updateProvider(provider.id, { timeout: undefined });
                                }
                                hasChanges = true;
                              }}
                              class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            Custom Timeout
                          </label>
                          {#if showTimeoutOverrides[provider.id]}
                            <input
                              type="number"
                              min="1"
                              max="600"
                              value={editing.timeout || globalTimeout}
                              oninput={(e) => updateProvider(provider.id, { timeout: parseInt(e.currentTarget.value) })}
                              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                            />
                          {/if}
                        </div>
                      </div>

                      <!-- Streaming Support & Actions -->
                      <div class="mt-4 flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="{provider.id}-streaming"
                            checked={editing.supportsStreaming !== false}
                            onchange={(e) => updateProvider(provider.id, { supportsStreaming: e.currentTarget.checked })}
                            class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <label for="{provider.id}-streaming" class="text-sm text-gray-700">
                            Supports streaming
                          </label>
                        </div>
                        
                        <div class="flex items-center gap-2">
                          <button
                            type="button"
                            onclick={() => saveSingleProvider(provider.id)}
                            disabled={savingProvider === provider.id}
                            class="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            {#if savingProvider === provider.id}
                              <span class="animate-spin">⟳</span>
                            {:else}
                              <Save size={16} />
                            {/if}
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/each}

    <!-- Custom Providers -->
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Server class="text-purple-600" size={24} />
          <h2 class="text-lg font-semibold text-gray-900">Custom Providers</h2>
          <span class="text-sm text-gray-500">({getCustomProviders().length})</span>
        </div>
      </div>

      {#if getCustomProviders().length === 0}
        <div class="p-8 text-center text-gray-500">
          No custom providers configured
        </div>
      {:else}
        <div class="divide-y divide-gray-200">
          {#each getCustomProviders().sort((a, b) => a.id.localeCompare(b.id)) as { id, config: customConfig }}
            {@const currentPreset = getAuthPresetId(customConfig.authHeader, customConfig.authPrefix)}
            {@const isExpanded = expandedProviders[id]}
            <div>
              <!-- Provider Header -->
              <button
                type="button"
                class="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                onclick={() => expandedProviders[id] = !isExpanded}
              >
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                    <Server class="text-purple-600" size={20} />
                  </div>
                  <div class="text-left">
                    <h3 class="font-semibold text-gray-900">{id}</h3>
                    <p class="text-sm text-gray-600">Custom provider</p>
                  </div>
                </div>
                <div class="flex items-center gap-3">
                  <span class="px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                    Custom
                  </span>
                  <svg 
                    class="w-5 h-5 text-gray-400 transition-transform {isExpanded ? 'rotate-180' : ''}" 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {#if isExpanded}
                <div class="px-6 pb-6">
                  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label for="{id}-baseUrl" class="block text-sm font-medium text-gray-700 mb-1">
                        Base URL <span class="text-red-500">*</span>
                      </label>
                      <input
                        id="{id}-baseUrl"
                        type="text"
                        value={customConfig.baseUrl}
                        oninput={(e) => updateProvider(id, { baseUrl: e.currentTarget.value })}
                        class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                    </div>

                    <div>
                      <label for="{id}-apiKey" class="block text-sm font-medium text-gray-700 mb-1">
                        API Key (optional)
                      </label>
                      <input
                        id="{id}-apiKey"
                        type="password"
                        value={customConfig.apiKey || ''}
                        placeholder="Optional"
                        oninput={(e) => updateProvider(id, { apiKey: e.currentTarget.value })}
                        class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                    </div>

                    <!-- Auth Type -->
                    <div>
                      <label for="{id}-authType" class="block text-sm font-medium text-gray-700 mb-1">
                        Authentication Type
                      </label>
                      <input
                        id="{id}-authType"
                        type="text"
                        list="auth-presets-custom"
                        value={currentPreset === 'custom' ? `${customConfig.authHeader || 'Authorization'}|${customConfig.authPrefix || 'Bearer '}` : currentPreset}
                        oninput={(e) => applyAuthPreset(id, e.currentTarget.value)}
                        class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                      <datalist id="auth-presets-custom">
                        {#each authPresets as preset}
                          {#if preset.label !== 'Custom'}
                            <option value="{preset.header}|{preset.prefix}">{preset.label}</option>
                          {/if}
                        {/each}
                      </datalist>
                    </div>

                    <!-- Timeout Override -->
                    <div>
                      <label class="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                        <input
                          type="checkbox"
                          checked={showTimeoutOverrides[id]}
                          onchange={(e) => {
                            showTimeoutOverrides[id] = e.currentTarget.checked;
                            if (!e.currentTarget.checked) {
                              updateProvider(id, { timeout: undefined });
                            }
                            hasChanges = true;
                          }}
                          class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        Custom Timeout
                      </label>
                      {#if showTimeoutOverrides[id]}
                        <input
                          type="number"
                          min="1"
                          max="600"
                          value={customConfig.timeout || globalTimeout}
                          oninput={(e) => updateProvider(id, { timeout: parseInt(e.currentTarget.value) })}
                          class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        />
                      {/if}
                    </div>
                  </div>

                  <!-- Streaming Support & Actions -->
                  <div class="mt-4 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="{id}-streaming"
                        checked={customConfig.supportsStreaming !== false}
                        onchange={(e) => updateProvider(id, { supportsStreaming: e.currentTarget.checked })}
                        class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <label for="{id}-streaming" class="text-sm text-gray-700">
                        Supports streaming
                      </label>
                    </div>
                    
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        onclick={() => removeProvider(id)}
                        class="flex items-center gap-2 px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm"
                      >
                        <Trash2 size={16} />
                        Remove
                      </button>
                      <button
                        type="button"
                        onclick={() => saveSingleProvider(id)}
                        disabled={savingProvider === id}
                        class="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {#if savingProvider === id}
                          <span class="animate-spin">⟳</span>
                        {:else}
                          <Save size={16} />
                        {/if}
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Help Section -->
    <div class="bg-blue-50 rounded-xl border border-blue-200 p-6">
      <h3 class="font-semibold text-blue-900 mb-2 flex items-center gap-2">
        <AlertCircle size={20} />
        About Provider Configuration
      </h3>
      <div class="text-sm text-blue-800 space-y-2">
        <p>
          <strong>API Key Priority:</strong> If you enter an API key directly, it will be used. 
          Otherwise, the system will look for the environment variable specified.
        </p>
        <p>
          <strong>Security:</strong> API keys entered here are stored in the config file. 
          For better security, use environment variables (e.g., <code>OPENAI_API_KEY</code>).
        </p>
        <p>
          <strong>Local Providers:</strong> Ollama, LM Studio, and llama.cpp typically don't require API keys 
          as they run locally on your machine, but you can still configure one if needed.
        </p>
        <p>
          <strong>Authentication Types:</strong> Choose from presets like Bearer Token (OpenAI-style), 
          API Key (Anthropic-style), or enter a custom header/prefix combination.
        </p>
      </div>
    </div>
  {/if}
</div>
