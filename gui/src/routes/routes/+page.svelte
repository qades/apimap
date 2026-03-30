<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { page } from '$app/stores';
  import { 
    Route, 
    Plus, 
    Trash2, 
    Save, 
    AlertCircle, 
    CheckCircle,
    Search,
    X,
    Loader2,
    GripVertical
  } from '@lucide/svelte';
  import { routes, providers, isLoadingRoutes, unroutedRequests } from '$lib/stores';
  import { routesApi, providersApi, modelsApi } from '$lib/utils/api';
  import type { RouteConfig, ModelInfo } from '$lib/utils/api';
  import type { ProviderInfo } from '$lib/utils/api';

  let editingRoutes: RouteConfig[] = $state([]);
  let hasChanges = $state(false);
  let saveError: string | null = $state(null);
  let saveSuccess = $state(false);
  let testPattern = $state('');
  let testResults: Array<{ 
    model: string; 
    matched: boolean; 
    captures: string[];
    provider?: string;
    resolvedModel?: string;
    pattern?: string;
  }> = $state([]);
  
  // New route row state
  let isAdding = $state(false);
  let newPattern = $state('');
  let newProvider = $state('');
  let newModel = $state('');
  let providerModels = $state<ModelInfo[]>([]);
  let loadingModels = $state(false);

  // Models cache for existing routes when editing
  let routeProviderModels = $state<Record<string, ModelInfo[]>>({});
  let loadingRouteModels = $state<Record<string, boolean>>({});

  // Drag and drop state
  let draggedIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  // Get model from URL query params (when coming from unrouted requests)
  $effect(() => {
    const urlModel = $page.url.searchParams.get('model');
    if (urlModel && !isAdding && editingRoutes.length > 0) {
      newPattern = urlModel.includes('/') ? urlModel : `${urlModel}*`;
      isAdding = true;
    }
  });

  async function loadData() {
    isLoadingRoutes.set(true);
    try {
      const [routesData, providersData] = await Promise.all([
        routesApi.getAll(),
        providersApi.getAll(),
      ]);
      
      // Routes are in top-down order (first match wins)
      editingRoutes = [...routesData.routes];
      // Only show enabled providers in dropdown
      providers.set(providersData.registered.filter((p: ProviderInfo & { enabled?: boolean }) => p.enabled));
      
      // Preload models for each unique provider in routes
      const uniqueProviders = new Set(editingRoutes.map(r => r.provider).filter(Boolean));
      for (const providerId of uniqueProviders) {
        const indices = editingRoutes
          .map((r, i) => r.provider === providerId ? i : -1)
          .filter(i => i >= 0);
        
        // Load models once per provider and assign to all matching routes
        try {
          const result = await modelsApi.getAll({ source: 'provider', provider: providerId });
          for (const index of indices) {
            routeProviderModels[index] = result.models;
          }
        } catch (err) {
          console.log(`Provider ${providerId} has no models endpoint`);
        }
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      isLoadingRoutes.set(false);
    }
  }

  async function onProviderChange(providerId: string) {
    newProvider = providerId;
    newModel = ''; // Reset model when provider changes
    
    if (!providerId) {
      providerModels = [];
      return;
    }
    
    loadingModels = true;
    try {
      // Fetch only provider models (not route patterns)
      const result = await modelsApi.getAll({ source: 'provider', provider: providerId });
      providerModels = result.models;
    } catch (err) {
      console.error('Failed to fetch models:', err);
      providerModels = [];
    } finally {
      loadingModels = false;
    }
  }

  function addRoute() {
    if (!newPattern.trim() || !newProvider) return;
    
    // Add new route before catch-all "*" if present, else at end
    const newRoute: RouteConfig = {
      pattern: newPattern.trim(),
      provider: newProvider,
      model: newModel || undefined,
    };
    const lastRoute = editingRoutes[editingRoutes.length - 1];
    if (lastRoute && lastRoute.pattern === '*') {
      editingRoutes.splice(editingRoutes.length - 1, 0, newRoute);
    } else {
      editingRoutes.push(newRoute);
    }
    
    editingRoutes = editingRoutes;
    hasChanges = true;
    saveSuccess = false;
    
    // Reset add form
    cancelAdd();
  }

  function cancelAdd() {
    isAdding = false;
    newPattern = '';
    newProvider = '';
    newModel = '';
    providerModels = [];
  }

  async function loadModelsForRoute(providerId: string, routeIndex: number) {
    if (!providerId) {
      routeProviderModels[routeIndex] = [];
      return;
    }
    
    loadingRouteModels[routeIndex] = true;
    try {
      const result = await modelsApi.getAll({ source: 'provider', provider: providerId });
      routeProviderModels[routeIndex] = result.models;
    } catch (err) {
      console.error('Failed to fetch models for route:', err);
      routeProviderModels[routeIndex] = [];
    } finally {
      loadingRouteModels[routeIndex] = false;
    }
  }

  function updateRoute(index: number, updates: Partial<RouteConfig>) {
    editingRoutes[index] = { ...editingRoutes[index], ...updates };
    hasChanges = true;
    saveSuccess = false;
    
    // If provider changed, fetch models for the new provider
    if ('provider' in updates) {
      // Reset model when provider changes
      editingRoutes[index].model = undefined;
      // Load models for new provider
      loadModelsForRoute(updates.provider || '', index);
    }
  }

  function removeRoute(index: number) {
    editingRoutes.splice(index, 1);
    editingRoutes = editingRoutes;
    hasChanges = true;
    saveSuccess = false;
  }

  async function saveRoutes() {
    saveError = null;
    try {
      // Save routes in current order (top-down matching)
      await routesApi.update(editingRoutes);
      routes.set(editingRoutes);
      hasChanges = false;
      saveSuccess = true;
      setTimeout(() => saveSuccess = false, 3000);
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Failed to save routes';
    }
  }

  // Drag and drop handlers
  function handleDragStart(index: number) {
    draggedIndex = index;
  }

  function handleDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    dragOverIndex = index;
  }

  function handleDragLeave() {
    dragOverIndex = null;
  }

  function handleDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      draggedIndex = null;
      dragOverIndex = null;
      return;
    }

    // Reorder routes
    const [movedRoute] = editingRoutes.splice(draggedIndex, 1);
    editingRoutes.splice(targetIndex, 0, movedRoute);
    
    // Update models cache to match new indices
    const newRouteProviderModels: Record<string, ModelInfo[]> = {};
    const newLoadingRouteModels: Record<string, boolean> = {};
    editingRoutes.forEach((_, newIndex) => {
      const oldIndex = Object.keys(routeProviderModels).find(key => 
        editingRoutes[newIndex] === editingRoutes[parseInt(key)]
      );
      if (oldIndex !== undefined) {
        newRouteProviderModels[newIndex] = routeProviderModels[oldIndex];
        newLoadingRouteModels[newIndex] = loadingRouteModels[oldIndex];
      }
    });
    routeProviderModels = newRouteProviderModels;
    loadingRouteModels = newLoadingRouteModels;
    
    editingRoutes = editingRoutes;
    hasChanges = true;
    saveSuccess = false;
    draggedIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    draggedIndex = null;
    dragOverIndex = null;
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
      let matchedRoute: RouteConfig | undefined;
      
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
          matchedRoute = route;
          break;
        }
      }
      
      // Calculate resolved model if there's a match
      let resolvedModel: string | undefined;
      if (matchedRoute) {
        if (matchedRoute.model) {
          // Apply template substitution
          resolvedModel = matchedRoute.model.replace(/\$\{(\d+)\}/g, (match, num) => {
            const index = parseInt(num, 10) - 1;
            return captures[index] ?? match;
          });
        } else {
          // No model mapping - use the original model
          resolvedModel = model;
        }
      }
      
      testResults.push({ 
        model, 
        matched, 
        captures,
        provider: matchedRoute?.provider,
        resolvedModel,
        pattern: matchedRoute?.pattern
      });
    }
  }

  function suggestRouteFromUnrouted(request: typeof $unroutedRequests[0]) {
    newPattern = getSuggestedPattern(request.model);
    isAdding = true;
  }

  // Warn on unsaved changes
  beforeNavigate(({ cancel }) => {
    if (hasChanges && !confirm('You have unsaved route changes. Leave without saving?')) {
      cancel();
    }
  });

  function handleBeforeUnload(e: BeforeUnloadEvent) {
    if (hasChanges) {
      e.preventDefault();
    }
  }

  onMount(() => {
    loadData();
  });
</script>

<svelte:window onbeforeunload={handleBeforeUnload} />

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
        onclick={() => isAdding = true}
        disabled={isAdding}
        class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          Routes are matched top-down. Drag to reorder. First match wins. Put catch-all "*" last.
        </p>
      </div>

      {#if editingRoutes.length === 0 && !isAdding}
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
                <th class="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10"></th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pattern</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">Provider</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model Mapping</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              {#each editingRoutes as route, index}
                <tr 
                  class="hover:bg-gray-50 transition-colors {draggedIndex === index ? 'opacity-50' : ''} {dragOverIndex === index ? 'bg-blue-50 border-t-2 border-blue-300' : ''}"
                  draggable="true"
                  ondragstart={() => handleDragStart(index)}
                  ondragover={(e) => handleDragOver(e, index)}
                  ondragleave={handleDragLeave}
                  ondrop={(e) => handleDrop(e, index)}
                  ondragend={handleDragEnd}
                >
                  <td class="px-2 py-3 cursor-move">
                    <GripVertical size={18} class="text-gray-400" />
                  </td>
                  <td class="px-4 py-3">
                    <input
                      type="text"
                      value={route.pattern}
                      oninput={(e) => updateRoute(index, { pattern: e.currentTarget.value })}
                      class="w-full px-2 py-1 text-sm font-mono border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </td>
                  <td class="px-4 py-3">
                    <select
                      value={route.provider}
                      onchange={(e) => updateRoute(index, { provider: e.currentTarget.value })}
                      class="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {#each $providers as provider}
                        <option value={provider.id}>{provider.name}</option>
                      {/each}
                    </select>
                  </td>
                  <td class="px-4 py-3">
                    {#if loadingRouteModels[index]}
                      <div class="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 size={14} class="animate-spin" />
                        Loading...
                      </div>
                    {:else}
                      {@const modelsList = routeProviderModels[index] || []}
                      {@const datalistId = `models-${index}`}
                      <input
                        type="text"
                        value={route.model || ''}
                        oninput={(e) => updateRoute(index, { model: e.currentTarget.value || undefined })}
                        placeholder="Auto (same as pattern)"
                        list={modelsList.length > 0 ? datalistId : undefined}
                        class="w-full px-2 py-1 text-sm font-mono border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      {#if modelsList.length > 0}
                        <datalist id={datalistId}>
                          <option value="">Auto (same as pattern)</option>
                          {#each modelsList as model}
                            <option value={model.id}>{model.id}</option>
                          {/each}
                        </datalist>
                      {/if}
                    {/if}
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button
                      type="button"
                      onclick={() => removeRoute(index)}
                      class="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                      aria-label="Delete route"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              {/each}
              
              <!-- Add New Route Row -->
              {#if isAdding}
                <tr class="bg-blue-50">
                  <td class="px-2 py-3">
                    <GripVertical size={18} class="text-gray-300" />
                  </td>
                  <td class="px-4 py-3">
                    <input
                      type="text"
                      bind:value={newPattern}
                      placeholder="e.g., gpt-4*"
                      class="w-full px-2 py-1 text-sm font-mono border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </td>
                  <td class="px-4 py-3">
                    <select
                      value={newProvider}
                      onchange={(e) => onProviderChange(e.currentTarget.value)}
                      class="w-full px-2 py-1 text-sm border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Select provider...</option>
                      {#each $providers as provider}
                        <option value={provider.id}>{provider.name}</option>
                      {/each}
                    </select>
                  </td>
                  <td class="px-4 py-3">
                    {#if loadingModels}
                      <div class="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 size={14} class="animate-spin" />
                        Loading models...
                      </div>
                    {:else}
                      {@const datalistId = `new-route-models`}
                      <input
                        type="text"
                        bind:value={newModel}
                        placeholder={newProvider ? "Select or type custom mapping (e.g., ${1})" : "Select provider first"}
                        disabled={!newProvider}
                        list={providerModels.length > 0 ? datalistId : undefined}
                        class="w-full px-2 py-1 text-sm font-mono border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                      />
                      {#if providerModels.length > 0}
                        <datalist id={datalistId}>
                          <option value="">Auto (same as pattern)</option>
                          {#each providerModels as model}
                            <option value={model.id}>{model.id}</option>
                          {/each}
                        </datalist>
                      {/if}
                    {/if}
                  </td>
                  <td class="px-4 py-3 text-right">
                    <div class="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onclick={addRoute}
                        disabled={!newPattern.trim() || !newProvider}
                        class="p-1.5 text-green-600 hover:bg-green-100 rounded transition-colors disabled:opacity-50"
                        aria-label="Add route"
                      >
                        <CheckCircle size={18} />
                      </button>
                      <button
                        type="button"
                        onclick={cancelAdd}
                        class="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors"
                        aria-label="Cancel"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              {/if}
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
                  <th class="px-4 py-2 text-left text-sm font-medium text-gray-600">Test Model</th>
                  <th class="px-4 py-2 text-left text-sm font-medium text-gray-600">Status</th>
                  <th class="px-4 py-2 text-left text-sm font-medium text-gray-600">Pattern</th>
                  <th class="px-4 py-2 text-left text-sm font-medium text-gray-600">Provider</th>
                  <th class="px-4 py-2 text-left text-sm font-medium text-gray-600">Resolved Model</th>
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
                    <td class="px-4 py-2 font-mono text-sm text-gray-700">
                      {result.pattern ?? '-'}
                    </td>
                    <td class="px-4 py-2 text-sm">
                      {#if result.provider}
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          {result.provider}
                        </span>
                      {:else}
                        <span class="text-gray-400">-</span>
                      {/if}
                    </td>
                    <td class="px-4 py-2 font-mono text-sm text-gray-700">
                      {result.resolvedModel ?? '-'}
                    </td>
                    <td class="px-4 py-2 text-sm">
                      {#if result.captures.length > 0}
                        <code class="bg-gray-100 px-1.5 py-0.5 rounded text-xs">[{result.captures.join(', ')}]</code>
                      {:else}
                        <span class="text-gray-400">-</span>
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
