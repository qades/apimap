<script lang="ts">
  import { onMount } from 'svelte';
  import { 
    Beaker, 
    Send, 
    Settings2, 
    ChevronDown, 
    ChevronUp, 
    Clock, 
    CheckCircle, 
    AlertCircle,
    Sparkles,
    Terminal,
    Bot,
    User,
    Loader2,
    Copy,
    Check,
    Zap,
    X
  } from '@lucide/svelte';

  // State
  let model = $state('');
  let message = $state('');
  let systemMessage = $state('');
  let temperature = $state(0.7);
  let maxTokens = $state(1024);
  let stream = $state(false);
  let apiFormat = $state<'openai' | 'anthropic'>('openai');
  let endpointPath = $state('/chat/completions');
  let showAdvanced = $state(false);
  
  // Endpoint options
  const endpointOptions = [
    { value: '/chat/completions', label: 'Chat Completions (/chat/completions)', format: 'openai' },
    { value: '/v1/messages', label: 'Messages (/v1/messages)', format: 'anthropic' },
    { value: '/completions', label: 'Legacy Completions (/completions)', format: 'openai' },
  ];
  
  // Response state
  let loading = $state(false);
  let response: { 
    success: boolean; 
    content?: string; 
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    provider?: string;
    targetModel?: string;
    duration?: number;
    error?: string;
    details?: string;
  } | null = $state(null);
  let streamingContent = $state('');
  let copied = $state(false);
  
  // Available models from routes
  let availableModels: string[] = $state([]);
  let loadingModels = $state(true);
  let quickPrompts = [
    { label: 'Say hello', text: 'Say a brief, friendly hello!' },
    { label: 'Explain', text: 'Explain what you are in one sentence.' },
    { label: 'Code', text: 'Write a simple "Hello, World!" in Python.' },
    { label: 'Creative', text: 'Write a haiku about artificial intelligence.' },
  ];

  onMount(async () => {
    await loadModels();
  });

  async function loadModels() {
    try {
      const res = await fetch('/api/admin/routes');
      if (res.ok) {
        const data = await res.json();
        // Extract patterns from routes as model suggestions
        const patterns = data.routes.map((r: any) => r.pattern);
        // Add some common examples based on patterns
        const examples: string[] = [];
        for (const pattern of patterns) {
          if (pattern.includes('gpt-4')) {
            examples.push('gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo');
          } else if (pattern.includes('claude')) {
            examples.push('claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307');
          } else if (pattern.includes('local/')) {
            examples.push('local/llama2', 'local/mistral', 'local/codellama');
          } else {
            examples.push(pattern.replace(/\*/g, ''));
          }
        }
        availableModels = [...new Set([...examples, ...patterns])].slice(0, 20);
      }
    } catch (err) {
      console.error('Failed to load models:', err);
    } finally {
      loadingModels = false;
    }
  }

  async function sendTest() {
    if (!model.trim() || !message.trim()) return;
    
    loading = true;
    response = null;
    streamingContent = '';
    
    try {
      const res = await fetch('/api/admin/test-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.trim(),
          message: message.trim(),
          systemMessage: systemMessage.trim() || undefined,
          temperature,
          maxTokens,
          stream,
          apiFormat,
          endpoint: endpointPath,
        }),
      });
      
      if (stream && res.ok) {
        // Handle streaming response
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.choices?.[0]?.delta?.content) {
                    streamingContent += parsed.choices[0].delta.content;
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }
        }
        
        response = {
          success: true,
          content: streamingContent,
          provider: res.headers.get('X-Provider') || undefined,
          targetModel: res.headers.get('X-Target-Model') || undefined,
        };
      } else {
        const data = await res.json();
        response = data;
      }
    } catch (err) {
      response = {
        success: false,
        error: 'Request failed',
        details: err instanceof Error ? err.message : String(err),
      };
    } finally {
      loading = false;
    }
  }

  function setQuickPrompt(text: string) {
    message = text;
  }

  function copyResponse() {
    if (response?.content) {
      navigator.clipboard.writeText(response.content);
      copied = true;
      setTimeout(() => copied = false, 2000);
    }
  }

  function clearAll() {
    model = '';
    message = '';
    systemMessage = '';
    temperature = 0.7;
    maxTokens = 1024;
    response = null;
    streamingContent = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      sendTest();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-start justify-between">
    <div>
      <h1 class="text-2xl font-bold text-gray-900 flex items-center gap-3">
        <Beaker class="text-blue-600" size={28} />
        Test Models
      </h1>
      <p class="text-gray-600 mt-1">Test your configured models directly from the GUI</p>
    </div>
    {#if response || message}
      <button
        onclick={clearAll}
        class="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
      >
        <X size={16} />
        Clear
      </button>
    {/if}
  </div>

  <!-- Quick Prompts (when empty) -->
  {#if !message && !loading}
    <div class="flex flex-wrap gap-2">
      {#each quickPrompts as prompt}
        <button
          onclick={() => setQuickPrompt(prompt.text)}
          class="text-sm px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition-colors"
        >
          {prompt.label}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Main Testing Interface -->
  <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
    <!-- Input Panel -->
    <div class="space-y-4">
      <!-- Model Selection -->
      <div class="bg-white rounded-xl border border-gray-200 p-5">
        <label class="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
          <Bot size={16} class="text-gray-400" />
          Model
        </label>
        <div class="relative">
          <input
            type="text"
            bind:value={model}
            placeholder="Enter model name (e.g., gpt-4o, claude-3-opus)"
            class="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            list="available-models"
          />
          {#if loadingModels}
            <Loader2 size={18} class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
          {/if}
        </div>
        <datalist id="available-models">
          {#each availableModels as m}
            <option value={m}></option>
          {/each}
        </datalist>
        
        {#if availableModels.length > 0}
          <div class="mt-3 flex flex-wrap gap-1.5">
            {#each availableModels.slice(0, 6) as m}
              <button
                onclick={() => model = m}
                class="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
              >
                {m.length > 20 ? m.slice(0, 20) + '...' : m}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Message Input -->
      <div class="bg-white rounded-xl border border-gray-200 p-5">
        <label class="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
          <User size={16} class="text-gray-400" />
          Your Message
        </label>
        <div class="relative">
          <textarea
            bind:value={message}
            placeholder="Type your message here..."
            rows="5"
            class="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none transition-all"
          ></textarea>
          <!-- Floating Send Button -->
          <button
            onclick={sendTest}
            disabled={!model.trim() || !message.trim() || loading}
            class="absolute right-2 bottom-2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-sm"
            title="Send (Cmd/Ctrl + Enter)"
          >
            {#if loading}
              <Loader2 size={18} class="animate-spin" />
            {:else}
              <Send size={18} />
            {/if}
          </button>
        </div>
        <div class="mt-2 flex items-center justify-between text-xs text-gray-500">
          <span>Press Cmd/Ctrl + Enter to send</span>
          <span>{message.length} chars</span>
        </div>
      </div>

      <!-- Advanced Settings (Collapsible) -->
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onclick={() => showAdvanced = !showAdvanced}
          class="w-full px-5 py-3 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <span class="flex items-center gap-2">
            <Settings2 size={16} />
            Advanced Settings
          </span>
          {#if showAdvanced}
            <ChevronUp size={18} />
          {:else}
            <ChevronDown size={18} />
          {/if}
        </button>
        
        {#if showAdvanced}
          <div class="px-5 pb-5 pt-2 border-t border-gray-100 space-y-4">
            <!-- System Message -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1.5">
                System Message
              </label>
              <textarea
                bind:value={systemMessage}
                placeholder="Optional system instructions..."
                rows="2"
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              ></textarea>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <!-- Temperature -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1.5 flex justify-between">
                  <span>Temperature</span>
                  <span class="text-blue-600 font-mono">{temperature}</span>
                </label>
                <input
                  type="range"
                  bind:value={temperature}
                  min="0"
                  max="2"
                  step="0.1"
                  class="w-full accent-blue-600"
                />
                <div class="flex justify-between text-xs text-gray-400 mt-1">
                  <span>Precise</span>
                  <span>Creative</span>
                </div>
              </div>

              <!-- Max Tokens -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1.5 flex justify-between">
                  <span>Max Tokens</span>
                  <span class="text-blue-600 font-mono">{maxTokens}</span>
                </label>
                <input
                  type="range"
                  bind:value={maxTokens}
                  min="1"
                  max="8192"
                  step="64"
                  class="w-full accent-blue-600"
                />
              </div>
            </div>

            <!-- Endpoint Path -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1.5">
                Endpoint Path
              </label>
              <select
                bind:value={endpointPath}
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
              >
                {#each endpointOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
              <p class="text-xs text-gray-500 mt-1">
                The API endpoint path appended to the provider's base URL
              </p>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <!-- API Format -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1.5">
                  API Format
                </label>
                <div class="flex rounded-lg border border-gray-300 overflow-hidden">
                  <button
                    onclick={() => apiFormat = 'openai'}
                    class="flex-1 py-2 text-sm font-medium transition-colors"
                    class:bg-blue-600={apiFormat === 'openai'}
                    class:text-white={apiFormat === 'openai'}
                    class:bg-white={apiFormat !== 'openai'}
                    class:text-gray-700={apiFormat !== 'openai'}
                    class:hover:bg-gray-50={apiFormat !== 'openai'}
                  >
                    OpenAI
                  </button>
                  <button
                    onclick={() => apiFormat = 'anthropic'}
                    class="flex-1 py-2 text-sm font-medium transition-colors"
                    class:bg-blue-600={apiFormat === 'anthropic'}
                    class:text-white={apiFormat === 'anthropic'}
                    class:bg-white={apiFormat !== 'anthropic'}
                    class:text-gray-700={apiFormat !== 'anthropic'}
                    class:hover:bg-gray-50={apiFormat !== 'anthropic'}
                  >
                    Anthropic
                  </button>
                </div>
              </div>

              <!-- Stream Toggle -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1.5">
                  Streaming
                </label>
                <button
                  onclick={() => stream = !stream}
                  class="w-full py-2 px-3 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  class:border-blue-600={stream}
                  class:bg-blue-50={stream}
                  class:text-blue-700={stream}
                  class:border-gray-300={!stream}
                  class:bg-white={!stream}
                  class:text-gray-700={!stream}
                >
                  {#if stream}
                    <Zap size={16} class="fill-current" />
                    Enabled
                  {:else}
                    <Zap size={16} />
                    Disabled
                  {/if}
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Send Button -->
      <button
        onclick={sendTest}
        disabled={!model.trim() || !message.trim() || loading}
        class="w-full py-3 px-4 bg-blue-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
      >
        {#if loading}
          <Loader2 size={20} class="animate-spin" />
          Sending...
        {:else}
          <Send size={20} />
          Send Test Request
        {/if}
      </button>
    </div>

    <!-- Response Panel -->
    <div class="bg-white rounded-xl border border-gray-200 min-h-[500px] flex flex-col">
      <div class="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
        <h3 class="font-semibold text-gray-900 flex items-center gap-2">
          <Terminal size={18} class="text-gray-500" />
          Response
        </h3>
        {#if response?.content}
          <button
            onclick={copyResponse}
            class="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          >
            {#if copied}
              <Check size={16} class="text-green-600" />
              Copied!
            {:else}
              <Copy size={16} />
              Copy
            {/if}
          </button>
        {/if}
      </div>

      <div class="flex-1 p-5 overflow-auto">
        {#if !response && !loading && !streamingContent}
          <div class="h-full flex flex-col items-center justify-center text-gray-400">
            <Sparkles size={48} class="mb-4 opacity-50" />
            <p class="text-center">Enter a model and message,<br>then click Send to see the response</p>
          </div>
        {:else if loading && !stream}
          <div class="h-full flex flex-col items-center justify-center text-gray-400">
            <Loader2 size={32} class="animate-spin mb-3" />
            <p>Waiting for response...</p>
          </div>
        {:else if response?.error}
          <div class="bg-red-50 border border-red-200 rounded-lg p-4">
            <div class="flex items-start gap-3">
              <AlertCircle class="text-red-500 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <h4 class="font-medium text-red-800">Error</h4>
                <p class="text-red-700 text-sm mt-1">{response.error}</p>
                {#if response.details}
                  <pre class="mt-3 text-xs bg-red-100 p-2 rounded overflow-auto max-h-40">{response.details}</pre>
                {/if}
              </div>
            </div>
          </div>
        {:else if response?.content || streamingContent}
          <div class="space-y-4">
            <!-- Response Content -->
            <div class="prose prose-sm max-w-none">
              <div class="whitespace-pre-wrap text-gray-800 leading-relaxed">
                {streamingContent || response?.content}
                {#if loading && stream}
                  <span class="inline-block w-2 h-4 bg-blue-500 ml-1 animate-pulse"></span>
                {/if}
              </div>
            </div>

            <!-- Response Metadata -->
            {#if response?.usage || response?.provider}
              <div class="border-t border-gray-200 pt-4 mt-4">
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  {#if response.provider}
                    <div class="bg-gray-50 rounded-lg p-3">
                      <span class="text-gray-500 text-xs uppercase tracking-wide">Provider</span>
                      <p class="font-medium text-gray-900 capitalize">{response.provider}</p>
                    </div>
                  {/if}
                  {#if response.targetModel}
                    <div class="bg-gray-50 rounded-lg p-3">
                      <span class="text-gray-500 text-xs uppercase tracking-wide">Target Model</span>
                      <p class="font-medium text-gray-900 truncate" title={response.targetModel}>
                        {response.targetModel.length > 20 ? response.targetModel.slice(0, 20) + '...' : response.targetModel}
                      </p>
                    </div>
                  {/if}
                  {#if response.duration}
                    <div class="bg-gray-50 rounded-lg p-3">
                      <span class="text-gray-500 text-xs uppercase tracking-wide">Duration</span>
                      <p class="font-medium text-gray-900 flex items-center gap-1">
                        <Clock size={14} />
                        {response.duration}ms
                      </p>
                    </div>
                  {/if}
                  {#if response.usage}
                    <div class="bg-gray-50 rounded-lg p-3">
                      <span class="text-gray-500 text-xs uppercase tracking-wide">Tokens</span>
                      <p class="font-medium text-gray-900">{response.usage.total_tokens}</p>
                    </div>
                  {/if}
                </div>
                
                {#if response.usage}
                  <div class="mt-3 flex items-center gap-4 text-xs text-gray-500">
                    <span class="flex items-center gap-1">
                      <span class="w-2 h-2 rounded-full bg-blue-400"></span>
                      Prompt: {response.usage.prompt_tokens}
                    </span>
                    <span class="flex items-center gap-1">
                      <span class="w-2 h-2 rounded-full bg-green-400"></span>
                      Completion: {response.usage.completion_tokens}
                    </span>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
