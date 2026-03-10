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

  let editingProviders: Record<string, ProviderConfig> = $state({});
  let showApiKeys: Record<string, boolean> = $state({});
  let hasChanges = $state(false);
  let saveError: string | null = $state(null);
  let saveSuccess = $state(false);

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
      const data = await providersApi.getAll();
      builtinProviders.set(data.builtin);
      providers.set(data.registered);
      
      // Initialize editing state
      editingProviders = {};
      for (const provider of data.registered) {
        editingProviders[provider.id] = {
          baseUrl: provider.defaultBaseUrl,
          apiKeyEnv: provider.defaultApiKeyEnv,
          authHeader: provider.authHeader,
          authPrefix: provider.authPrefix,
          supportsStreaming: provider.supportsStreaming,
        };
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

  async function saveProviders() {
    saveError = null;
    try {
      await providersApi.update(editingProviders);
      hasChanges = false;
      saveSuccess = true;
      setTimeout(() => saveSuccess = false, 3000);
      await loadProviders();
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Failed to save providers';
    }
  }

  function getCategoryProviders(categoryId: string) {
    return $builtinProviders.filter(p => p.category === categoryId);
  }

  function getCustomProviders() {
    return Object.entries(editingProviders)
      .filter(([id]) => !$builtinProviders.find(b => b.id === id))
      .map(([id, config]) => ({ id, config }));
  }

  function isConfigured(providerId: string) {
    return $providers.find(p => p.id === providerId)?.configured ?? false;
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
    <!-- Provider Categories -->
    {#each categories as category}
      {@const categoryProviders = getCategoryProviders(category.id)}
      {#if categoryProviders.length > 0}
        <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div class="flex items-center gap-3">
              <category.icon class="text-{category.color}-600" size={24} />
              <h2 class="text-lg font-semibold text-gray-900">{category.label}</h2>
            </div>
          </div>

          <div class="divide-y divide-gray-200">
            {#each categoryProviders as provider}
              {@const editing = editingProviders[provider.id] || {}}
              {@const configured = isConfigured(provider.id)}
              {@const currentPreset = getAuthPresetId(editing.authHeader || provider.authHeader, editing.authPrefix || provider.authPrefix)}
              <div class="p-6">
                <div class="flex items-start justify-between mb-4">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg bg-{category.color}-100 flex items-center justify-center">
                      <Server class="text-{category.color}-600" size={20} />
                    </div>
                    <div>
                      <h3 class="font-semibold text-gray-900 flex items-center gap-2">
                        {provider.name}
                        {#if configured}
                          <CheckCircle class="text-green-500" size={16} />
                        {:else}
                          <XCircle class="text-gray-300" size={16} />
                        {/if}
                      </h3>
                      <p class="text-sm text-gray-600">{provider.description}</p>
                    </div>
                  </div>
                  <span class="px-3 py-1 rounded-full text-xs font-medium {configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}">
                    {configured ? 'Configured' : 'Not Configured'}
                  </span>
                </div>

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

                  <!-- API Key (now shown for all providers) -->
                  <div>
                    <label for="{provider.id}-apiKey" class="block text-sm font-medium text-gray-700 mb-1">
                      <span class="flex items-center gap-1">
                        <Key size={14} />
                        API Key (optional)
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

                  <!-- Auth Type (condensed header + prefix into datalist) -->
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
                      Header: <code>{editing.authHeader || provider.authHeader}</code>, 
                      Prefix: <code>"{editing.authPrefix || provider.authPrefix}"</code>
                    </p>
                  </div>
                </div>

                <!-- Streaming Support -->
                <div class="mt-4 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="{provider.id}-streaming"
                    checked={editing.supportsStreaming !== false}
                    onchange={(e) => updateProvider(provider.id, { supportsStreaming: e.currentTarget.checked })}
                    class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label for="{provider.id}-streaming" class="text-sm text-gray-700">
                    Supports streaming responses
                  </label>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/each}

    <!-- Custom Providers -->
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Plus class="text-purple-600" size={24} />
          <h2 class="text-lg font-semibold text-gray-900">Custom Providers</h2>
        </div>
        <button
          type="button"
          onclick={addCustomProvider}
          class="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors"
        >
          <Plus size={16} />
          Add Custom Provider
        </button>
      </div>

      {#if getCustomProviders().length === 0}
        <div class="p-8 text-center text-gray-500">
          No custom providers configured
        </div>
      {:else}
        <div class="divide-y divide-gray-200">
          {#each getCustomProviders() as { id, config: customConfig }}
            {@const currentPreset = getAuthPresetId(customConfig.authHeader, customConfig.authPrefix)}
            <div class="p-6">
              <div class="flex items-center justify-between mb-4">
                <h3 class="font-semibold text-gray-900">{id}</h3>
                <button
                  type="button"
                  onclick={() => removeProvider(id)}
                  class="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  aria-label="Remove provider"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label for="{id}-id" class="block text-sm font-medium text-gray-700 mb-1">
                    Provider ID
                  </label>
                  <input
                    id="{id}-id"
                    type="text"
                    value={id}
                    disabled
                    class="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-500 text-sm"
                  />
                </div>

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

                <!-- Auth Type (condensed) -->
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
                  <p class="text-xs text-gray-500 mt-1">
                    Header: <code>{customConfig.authHeader || 'Authorization'}</code>, 
                    Prefix: <code>"{customConfig.authPrefix || 'Bearer '}"</code>
                  </p>
                </div>
              </div>

              <!-- Streaming Support for Custom -->
              <div class="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="{id}-streaming"
                  checked={customConfig.supportsStreaming !== false}
                  onchange={(e) => updateProvider(id, { supportsStreaming: e.currentTarget.checked })}
                  class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label for="{id}-streaming" class="text-sm text-gray-700">
                  Supports streaming responses
                </label>
              </div>
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
