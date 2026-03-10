<script lang="ts">
  import { onMount } from 'svelte';
  import { 
    Settings, 
    Save, 
    AlertCircle, 
    CheckCircle,
    Download,
    Upload
  } from '@lucide/svelte';
  import { config, isLoadingConfig } from '$lib/stores';
  import { configApi } from '$lib/utils/api';
  import YAML from 'yaml';

  let configYaml = $state('');
  let hasChanges = $state(false);
  let saveError: string | null = $state(null);
  let saveSuccess = $state(false);
  let parseError: string | null = $state(null);

  async function loadConfig() {
    isLoadingConfig.set(true);
    try {
      const data = await configApi.get();
      config.set(data);
      configYaml = YAML.stringify(data);
      parseError = null;
    } catch (err) {
      console.error('Failed to load config:', err);
      saveError = err instanceof Error ? err.message : 'Failed to load config';
    } finally {
      isLoadingConfig.set(false);
    }
  }

  function onConfigChange(newValue: string) {
    configYaml = newValue;
    hasChanges = true;
    saveSuccess = false;
    
    // Validate YAML
    try {
      YAML.parse(newValue);
      parseError = null;
    } catch (err) {
      parseError = err instanceof Error ? err.message : 'Invalid YAML';
    }
  }

  async function saveConfig() {
    if (parseError) return;
    
    saveError = null;
    try {
      const parsed = YAML.parse(configYaml);
      await configApi.save(parsed);
      hasChanges = false;
      saveSuccess = true;
      setTimeout(() => saveSuccess = false, 3000);
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Failed to save config';
    }
  }

  function downloadConfig() {
    const blob = new Blob([configYaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `apimap-config-${new Date().toISOString().split('T')[0]}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        onConfigChange(content);
      };
      reader.readAsText(file);
    }
  }

  onMount(() => {
    loadConfig();
  });
</script>

<svelte:head>
  <title>Configuration - API Map</title>
</svelte:head>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Configuration</h1>
      <p class="text-gray-600 mt-1">Edit the router configuration YAML directly</p>
    </div>
    <div class="flex gap-3">
      <button
        type="button"
        onclick={downloadConfig}
        class="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
      >
        <Download size={18} />
        Download
      </button>
      <label class="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer">
        <Upload size={18} />
        Upload
        <input
          type="file"
          accept=".yaml,.yml"
          onchange={handleFileUpload}
          class="hidden"
        />
      </label>
      <button
        type="button"
        onclick={saveConfig}
        disabled={!hasChanges || !!parseError}
        class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Save size={18} />
        Save Changes
      </button>
    </div>
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
      Configuration saved successfully!
    </div>
  {/if}

  {#if parseError}
    <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3 text-yellow-700">
      <AlertCircle size={20} />
      <div>
        <p class="font-medium">YAML Parse Error</p>
        <p class="text-sm">{parseError}</p>
      </div>
    </div>
  {/if}

  {#if $isLoadingConfig}
    <div class="text-center py-12 text-gray-500">Loading configuration...</div>
  {:else}
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Settings class="text-blue-600" size={24} />
          <h2 class="text-lg font-semibold text-gray-900">config.yaml</h2>
        </div>
        {#if hasChanges}
          <span class="text-sm text-amber-600 font-medium">Unsaved changes</span>
        {/if}
      </div>

      <div class="p-0">
        <textarea
          value={configYaml}
          oninput={(e) => onConfigChange(e.currentTarget.value)}
          class="w-full h-[600px] p-6 font-mono text-sm bg-gray-900 text-gray-100 resize-none focus:outline-none"
          spellcheck="false"
          aria-label="Configuration YAML"
        ></textarea>
      </div>
    </div>

    <!-- Help Section -->
    <div class="bg-blue-50 rounded-xl border border-blue-200 p-6">
      <h3 class="font-semibold text-blue-900 mb-3 flex items-center gap-2">
        <AlertCircle size={20} />
        Configuration Reference
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-800">
        <div>
          <h4 class="font-medium mb-2">Server Settings</h4>
          <ul class="space-y-1 list-disc list-inside">
            <li><code>server.port</code> - HTTP port (default: 3000)</li>
            <li><code>server.host</code> - Bind address (default: 0.0.0.0)</li>
            <li><code>server.timeout</code> - Request timeout in seconds (default: 120)</li>
            <li><code>server.cors.origin</code> - CORS allowed origins</li>
          </ul>
        </div>
        <div>
          <h4 class="font-medium mb-2">Provider Settings</h4>
          <ul class="space-y-1 list-disc list-inside">
            <li><code>baseUrl</code> - Provider API endpoint</li>
            <li><code>apiKey</code> - Direct API key (optional)</li>
            <li><code>apiKeyEnv</code> - Environment variable name</li>
            <li><code>authHeader</code> - Authentication header name</li>
            <li><code>authPrefix</code> - Authentication prefix (e.g., "Bearer ")</li>
          </ul>
        </div>
      </div>
    </div>
  {/if}
</div>
