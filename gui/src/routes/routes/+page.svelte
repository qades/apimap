<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { 
    Route, 
    Plus, 
    Trash2, 
    Save, 
    AlertCircle, 
    CheckCircle,
    Search,
    Star,
    X,
    Loader2,
    ChevronDown
  } from '@lucide/svelte';
  import { routes, providers, isLoadingRoutes, unroutedRequests } from '$lib/stores';
  import { routesApi, providersApi, modelsApi } from '$lib/utils/api';
  import type { RouteConfig, ModelInfo } from '$lib/utils/api';

  let editingRoutes: RouteConfig[] = $state([]);
  let hasChanges = $state(false);
  let saveError: string | null = $state(null);
  let saveSuccess = $state(false);
  let newRoute: Partial<RouteConfig> = $state({});
  let showAddModal = $state(false);
  let testPattern = $state('');
  let testResults: Array<{ model: string; matched: boolean; captures: string[] }> = $state([]);
  
  // Model fetching state
  let availableModels = $state<ModelInfo[]>([]);
  let loadingModels = $state(false);
  let modelSearchQuery = $state('');
  let showModelDropdown = $state(false);
  let selectedProviderModels = $state<ModelInfo[]>([]);

  // Get model from URL query params (when coming from unrouted requests)
  $effect(() => {
    const urlModel = $page.url.searchParams.get('model');
    if (urlModel && showAddModal === false && editingRoutes.length > 0) {
      newRoute = { 
        pattern: urlModel.includes('/') ? urlModel : `${urlModel}*`,
        priority: 50 
      };
      showAddModal = true;
    }
  });

  async function loadData() {
    isLoadingRoutes.set(true);
    try {
      const [routesData, providersData] = await Promise.all([
        routesApi.getAll(),
        providersApi.getAll(),
      ]);
      
      editingRoutes = [...routesData.routes];
      providers.set(providersData.registered);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      isLoadingRoutes.set(false);
    }
  }

  function updateRoute(index: number, updates: Partial<RouteConfig>) {
    editingRoutes[index] = { ...editingRoutes[index], ...updates };
    hasChanges = true;
    saveSuccess = false;
  }

  function removeRoute(index: number) {
    editingRoutes.splice(index, 1);
    editingRoutes = editingRoutes;
    hasChanges = true;
    saveSuccess = false;
  }

  async function fetchModelsForProvider(providerId: string) {
    if (!providerId) {
      selectedProviderModels = [];
      return;
    }
    
    loadingModels = true;
    try {
      const allModels = await modelsApi.getAll();
      selectedProviderModels = allModels.models.filter(m => m.provider === providerId);
    } catch (err) {
      console.error('Failed to fetch models:', err);
      selectedProviderModels = [];
    } finally {
      loadingModels = false;
    }
  }
  
  function onProviderChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const providerId = select.value;
    newRoute.provider = providerId;
    newRoute.model = ''; // Reset model when provider changes
    fetchModelsForProvider(providerId);
  }
  
  function selectModel(modelId: string) {
    // For model mapping, we suggest ${1} to capture from pattern
    newRoute.model = modelId.includes('/') ? '${1}' : modelId;
    showModelDropdown = false;
    modelSearchQuery = '';
  }
  
  function addRoute() {
    if (!newRoute.pattern || !newRoute.provider) return;
    
    editingRoutes.push({
      pattern: newRoute.pattern,
      provider: newRoute.provider,
      model: newRoute.model,
      priority: newRoute.priority || 50,
    });
    
    // Sort by priority
    editingRoutes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    editingRoutes = editingRoutes;
    hasChanges = true;
    saveSuccess = false;
    showAddModal = false;
    newRoute = {};
    selectedProviderModels = [];
    modelSearchQuery = '';
  }

  async function saveRoutes() {
    saveError = null;
    try {
      await routesApi.update(editingRoutes);
      routes.set(editingRoutes);
      hasChanges = false;
      saveSuccess = true;
      setTimeout(() => saveSuccess = false, 3000);
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Failed to save routes';
    }
  }

  function getSuggestedPattern(model: string): string {
    if (model.includes(':')) {
      return model.split(':')[0] + '*';
    }
    if (model.includes('-')) {
      const parts = model.split('-');
      return parts.slice(0, 2).join('-') + '*';
    }
    return model + '*';
  }

  function testRoutePattern() {
    if (!testPattern || editingRoutes.length === 0) return;
    
    const models = testPattern.split(',').map(m => m.trim()).filter(Boolean);
    testResults = [];
    
    for (const model of models) {
      let matched = false;
      let captures: string[] = [];
      
      for (const route of editingRoutes) {
        const regexPattern = route.pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '(.*)')
          .replace(/\?/g, '(.)');
        
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        const match = model.match(regex);
        
        if (match) {
          matched = true;
          captures = match.slice(1);
          break;
        }
      }
      
      testResults.push({ model, matched, captures });
    }
  }

  function suggestRouteFromUnrouted(request: typeof $unroutedRequests[0]) {
    newRoute = {
      pattern: getSuggestedPattern(request.model),
      priority: 50,
    };
    showAddModal = true;
  }

  const priorityHelp = [
    { range: '100+', desc: 'Exact matches, critical routes', color: 'red' },
    { range: '70-99', desc: 'High priority (e.g., GPT-4, Claude)', color: 'orange' },
    { range: '50-69', desc: 'Medium priority (e.g., specific providers)', color: 'yellow' },
    { range: '30-49', desc: 'Low priority (e.g., generic patterns)', color: 'green' },
    { range: '0-29', desc: 'Fallback routes', color: 'gray' },
  ];

  onMount(() => {
    loadData();
  });
</script>

<svelte:head>
  <title>Routes - API Map</title>
</svelte:head>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Routes</h1>
      <p class="text-gray-600 mt-1">Configure model routing rules</p>
    </div>
    <div class="flex gap-3">
      <button
        type="button"
        onclick={() => showAddModal = true}
        class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        <Plus size={18} />
        Add Route
      </button>
      <button
        type="button"
        onclick={saveRoutes}
        disabled={!hasChanges}
        class="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
      Routes saved successfully!
    </div>
  {/if}

  {#if $isLoadingRoutes}
    <div class="text-center py-12 text-gray-500">Loading routes...</div>
  {:else}
    <!-- Routes Table -->
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h2 class="text-lg font-semibold text-gray-900">Routing Rules</h2>
        <p class="text-sm text-gray-600 mt-1">
          Routes are checked in priority order (highest first). First match wins.
        </p>
      </div>

      {#if editingRoutes.length === 0}
        <div class="p-8 text-center">
          <Route class="mx-auto text-gray-300 mb-3" size={48} />
          <p class="text-gray-600">No routes configured</p>
          <p class="text-sm text-gray-500 mt-1">Add your first route to start routing requests</p>
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-gray-50 border-b border-gray-200">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pattern</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model Mapping</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              {#each editingRoutes as route, index}
                <tr class="hover:bg-gray-50">
                  <td class="px-6 py-4">
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      value={route.priority || 0}
                      oninput={(e) => updateRoute(index, { priority: parseInt(e.currentTarget.value) || 0 })}
                      class="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      aria-label="Route priority"
                    />
                  </td>
                  <td class="px-6 py-4">
                    <input
                      type="text"
                      value={route.pattern}
                      oninput={(e) => updateRoute(index, { pattern: e.currentTarget.value })}
                      class="w-full px-2 py-1 border border-gray-300 rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., gpt-4*"
                      aria-label="Route pattern"
                    />
                  </td>
                  <td class="px-6 py-4">
                    <select
                      value={route.provider}
                      onchange={(e) => updateRoute(index, { provider: e.currentTarget.value })}
                      class="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      aria-label="Provider"
                    >
                      <option value="">Select provider...</option>
                      {#each $providers as provider}
                        <option value={provider.id}>{provider.name}</option>
                      {/each}
                    </select>
                  </td>
                  <td class="px-6 py-4">
                    <input
                      type="text"
                      value={route.model || ''}
                      oninput={(e) => updateRoute(index, { model: e.currentTarget.value || undefined })}
                      class="w-full px-2 py-1 border border-gray-300 rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Same as input (auto)"
                      aria-label="Model mapping"
                    />
                  </td>
                  <td class="px-6 py-4 text-right">
                    <button
                      type="button"
                      onclick={() => removeRoute(index)}
                      class="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      aria-label="Delete route"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <!-- Pattern Tester -->
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h2 class="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Search size={20} />
          Pattern Tester
        </h2>
        <p class="text-sm text-gray-600 mt-1">Test your route patterns against model names</p>
      </div>
      
      <div class="p-6 space-y-4">
        <div class="flex gap-3">
          <input
            type="text"
            bind:value={testPattern}
            placeholder="Enter model names (comma-separated): gpt-4, claude-3, llama2..."
            class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            aria-label="Test pattern"
          />
          <button
            type="button"
            onclick={testRoutePattern}
            disabled={!testPattern}
            class="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Test
          </button>
        </div>

        {#if testResults.length > 0}
          <div class="border rounded-lg overflow-hidden">
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-2 text-left text-sm font-medium text-gray-600">Model</th>
                  <th class="px-4 py-2 text-left text-sm font-medium text-gray-600">Status</th>
                  <th class="px-4 py-2 text-left text-sm font-medium text-gray-600">Captures</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                {#each testResults as result}
                  <tr class={result.matched ? 'bg-green-50' : 'bg-red-50'}>
                    <td class="px-4 py-2 font-mono text-sm">{result.model}</td>
                    <td class="px-4 py-2">
                      {#if result.matched}
                        <span class="flex items-center gap-1 text-green-700 text-sm">
                          <CheckCircle size={16} />
                          Matched
                        </span>
                      {:else}
                        <span class="flex items-center gap-1 text-red-700 text-sm">
                          <X size={16} />
                          No match
                        </span>
                      {/if}
                    </td>
                    <td class="px-4 py-2 text-sm">
                      {#if result.captures.length > 0}
                        [{result.captures.join(', ')}]
                      {:else}
                        -
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </div>

    <!-- Priority Guide -->
    <div class="bg-white rounded-xl border border-gray-200 p-6">
      <h3 class="font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Star size={20} class="text-yellow-500" />
        Priority Guide
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {#each priorityHelp as help}
          <div class="p-3 rounded-lg" class:bg-red-50={help.color === 'red'} class:bg-orange-50={help.color === 'orange'} class:bg-yellow-50={help.color === 'yellow'} class:bg-green-50={help.color === 'green'} class:bg-gray-50={help.color === 'gray'} class:border-red-200={help.color === 'red'} class:border-orange-200={help.color === 'orange'} class:border-yellow-200={help.color === 'yellow'} class:border-green-200={help.color === 'green'} class:border-gray-200={help.color === 'gray'} class:border={true}>
            <div class="font-semibold" class:text-red-700={help.color === 'red'} class:text-orange-700={help.color === 'orange'} class:text-yellow-700={help.color === 'yellow'} class:text-green-700={help.color === 'green'} class:text-gray-700={help.color === 'gray'}>{help.range}</div>
            <div class="text-sm mt-1" class:text-red-600={help.color === 'red'} class:text-orange-600={help.color === 'orange'} class:text-yellow-600={help.color === 'yellow'} class:text-green-600={help.color === 'green'} class:text-gray-600={help.color === 'gray'}>{help.desc}</div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Quick Add from Unrouted -->
    {#if $unroutedRequests.length > 0}
      <div class="bg-yellow-50 rounded-xl border border-yellow-200 p-6">
        <h3 class="font-semibold text-yellow-900 mb-3">Quick Add from Unrouted Requests</h3>
        <p class="text-sm text-yellow-800 mb-4">
          These models were recently requested but couldn't be routed. Click to create a route:
        </p>
        <div class="flex flex-wrap gap-2">
          {#each $unroutedRequests.slice(0, 5) as request}
            <button
              type="button"
              onclick={() => suggestRouteFromUnrouted(request)}
              class="px-3 py-2 bg-white border border-yellow-300 rounded-lg text-sm text-yellow-800 hover:bg-yellow-100 transition-colors"
            >
              {request.model}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Help Section -->
    <div class="bg-blue-50 rounded-xl border border-blue-200 p-6">
      <h3 class="font-semibold text-blue-900 mb-3 flex items-center gap-2">
        <AlertCircle size={20} />
        Pattern Syntax Help
      </h3>
      <div class="text-sm text-blue-800 space-y-2">
        <p><code>*</code> - Matches any sequence of characters (e.g., <code>gpt-4*</code> matches gpt-4, gpt-4-turbo, etc.)</p>
        <p><code>?</code> - Matches any single character (e.g., <code>model-?</code> matches model-1, model-a, etc.)</p>
        <p><code>${'{'}n{'}'}</code> - Capture groups for model mapping (e.g., <code>local/*</code> → model: "${'{'}1{'}'}")</p>
        <p class="mt-3">
          <strong>Example:</strong> Pattern <code>local/*</code> with model <code>${'{'}1{'}'}</code> will route 
          <code>local/llama2</code> to provider with model name <code>llama2</code>.
        </p>
      </div>
    </div>
  {/if}
</div>

<!-- Add Route Modal -->
{#if showAddModal}
  <div 
    class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="add-route-title"
  >
    <div class="bg-white rounded-xl shadow-xl max-w-lg w-full">
      <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h3 id="add-route-title" class="text-lg font-semibold text-gray-900">Add New Route</h3>
        <button
          type="button"
          onclick={() => showAddModal = false}
          class="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      
      <div class="p-6 space-y-4">
        <div>
          <label for="route-pattern" class="block text-sm font-medium text-gray-700 mb-1">
            Pattern <span class="text-red-500">*</span>
          </label>
          <input
            id="route-pattern"
            type="text"
            bind:value={newRoute.pattern}
            placeholder="e.g., gpt-4*"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
          />
          <p class="text-xs text-gray-500 mt-1">Use * for wildcards, ? for single characters</p>
        </div>

        <div>
          <label for="route-provider" class="block text-sm font-medium text-gray-700 mb-1">
            Provider <span class="text-red-500">*</span>
          </label>
          <select
            id="route-provider"
            value={newRoute.provider}
            onchange={onProviderChange}
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Select provider...</option>
            {#each $providers as provider}
              <option value={provider.id}>{provider.name}</option>
            {/each}
          </select>
        </div>

        {#if newRoute.provider}
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Model Mapping (optional)
            </label>
            
            <!-- Model Selection Dropdown -->
            <div class="relative">
              <button
                type="button"
                onclick={() => showModelDropdown = !showModelDropdown}
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-left flex items-center justify-between"
                class:bg-gray-50={loadingModels}
              >
                <span class={newRoute.model ? 'font-mono text-gray-900' : 'text-gray-500'}>
                  {newRoute.model || 'Select a model or type custom...'}
                </span>
                {#if loadingModels}
                  <Loader2 size={16} class="animate-spin text-gray-400" />
                {:else}
                  <ChevronDown size={16} class="text-gray-400" />
                {/if}
              </button>
              
              {#if showModelDropdown}
                <div class="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-auto">
                  <!-- Search input -->
                  <div class="p-2 border-b border-gray-200 sticky top-0 bg-white">
                    <input
                      type="text"
                      bind:value={modelSearchQuery}
                      placeholder="Search models..."
                      class="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  
                  <!-- Model list -->
                  <div class="py-1">
                    <button
                      type="button"
                      onclick={() => { newRoute.model = ''; showModelDropdown = false; }}
                      class="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 text-gray-600"
                    >
                      Auto (same as input pattern)
                    </button>
                    
                    {#if selectedProviderModels.length > 0}
                      <div class="px-3 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Available Models ({selectedProviderModels.length})
                      </div>
                      {#each selectedProviderModels.filter(m => m.id.toLowerCase().includes(modelSearchQuery.toLowerCase())) as model}
                        <button
                          type="button"
                          onclick={() => selectModel(model.id)}
                          class="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex flex-col"
                        >
                          <span class="font-mono text-gray-900">{model.id}</span>
                          {#if model.description}
                            <span class="text-xs text-gray-500 truncate">{model.description}</span>
                          {/if}
                        </button>
                      {/each}
                    {:else}
                      <div class="px-3 py-2 text-sm text-gray-500">
                        No models found from provider. Type custom mapping below.
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
            
            <!-- Custom Model Input -->
            <div class="mt-2">
              <input
                id="route-model"
                type="text"
                bind:value={newRoute.model}
                placeholder="e.g., gpt-4o or ${1} for wildcard capture"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
              />
            </div>
            <p class="text-xs text-gray-500 mt-1">
              Use <code class="bg-gray-100 px-1 rounded">${'{'}1{'}'}</code>, 
              <code class="bg-gray-100 px-1 rounded">${'{'}2{'}'}</code>, etc. to insert captured wildcards from pattern
            </p>
          </div>
        {/if}

        <div>
          <label for="route-priority" class="block text-sm font-medium text-gray-700 mb-1">
            Priority
          </label>
          <input
            id="route-priority"
            type="number"
            bind:value={newRoute.priority}
            min="0"
            max="1000"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <p class="text-xs text-gray-500 mt-1">Higher priority routes are checked first (default: 50)</p>
        </div>
      </div>

      <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
        <button
          type="button"
          onclick={() => { showAddModal = false; selectedProviderModels = []; modelSearchQuery = ''; showModelDropdown = false; }}
          class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={addRoute}
          disabled={!newRoute.pattern || !newRoute.provider}
          class="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add Route
        </button>
      </div>
    </div>
  </div>
{/if}
