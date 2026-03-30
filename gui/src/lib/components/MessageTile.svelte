<script lang="ts">
  import { ChevronDown, ChevronUp, CheckCircle, AlertCircle, ArrowRight } from '@lucide/svelte';
  import type { LogEntry } from '$lib/utils/api';
  import StatusIcon from './StatusIcon.svelte';
  import JsonViewer from './JsonViewer.svelte';
  import MessageDisplay from './MessageDisplay.svelte';

  interface Props {
    log: LogEntry;
    isExpanded: boolean;
    activeTab: string;
    onToggle: () => void;
    onTabChange: (tab: string) => void;
  }

  let { log, isExpanded, activeTab, onToggle, onTabChange }: Props = $props();

  // Derive status from log
  function deriveStatus(log: LogEntry): 'completed' | 'error' | 'pending' | 'streaming' | 'unrouted' {
    if (!log.routed) return 'unrouted';
    if (log.error || log.responseStatus >= 400) return 'error';
    return 'completed';
  }

  const status = $derived(deriveStatus(log));
  const isSuccess = $derived(log.responseStatus < 400 && !log.error && log.routed);

  // Format time
  function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  // Format duration
  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  // Calculate t/s from response
  function calculateTokensPerSecond(log: LogEntry): number | null {
    // Use pre-calculated if available
    if (log.tokensPerSecond) return log.tokensPerSecond;
    
    // Calculate from response usage
    const body = log.responseBody;
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    
    // OpenAI format
    const usage = b.usage as { completion_tokens?: number } | undefined;
    if (usage?.completion_tokens && log.durationMs > 0) {
      return Math.round((usage.completion_tokens / log.durationMs) * 1000);
    }
    
    // Anthropic format
    const anthropicUsage = b.usage as { output_tokens?: number } | undefined;
    if (anthropicUsage?.output_tokens && log.durationMs > 0) {
      return Math.round((anthropicUsage.output_tokens / log.durationMs) * 1000);
    }
    
    return null;
  }

  // Extract prompt from request body
  function extractPrompt(body: unknown): string {
    if (!body || typeof body !== 'object') return '';
    const b = body as Record<string, unknown>;
    
    // OpenAI format
    if (b.messages && Array.isArray(b.messages)) {
      const userMsgs = b.messages.filter((m: {role?: string}) => m.role === 'user');
      if (userMsgs.length > 0) {
        const lastMsg = userMsgs[userMsgs.length - 1];
        if (typeof lastMsg.content === 'string') return lastMsg.content;
        if (Array.isArray(lastMsg.content)) {
          return lastMsg.content.map((c: {text?: string}) => c.text || '').join(' ');
        }
      }
    }
    
    // Anthropic format
    if (typeof b.prompt === 'string') return b.prompt;
    
    return '';
  }

  // Truncate prompt
  function truncatePrompt(prompt: string, maxLength: number = 50): string {
    if (!prompt) return '';
    if (prompt.length <= maxLength) return prompt;
    return prompt.slice(0, maxLength) + '…';
  }

  // Extract response content for Message tab
  function extractResponseContent(body: unknown): string {
    if (!body || typeof body !== 'object' || body === null) return '';
    
    // OpenAI format
    const choices = (body as {choices?: unknown[]}).choices;
    if (choices && Array.isArray(choices) && choices.length > 0) {
      const choice = choices[0] as {message?: {content?: unknown}; delta?: {content?: unknown}};
      if (choice.message?.content) return String(choice.message.content);
      if (choice.delta?.content) return String(choice.delta.content);
    }
    
    // Anthropic format
    const content = (body as {content?: unknown[]}).content;
    if (content && Array.isArray(content) && content.length > 0) {
      return content.map((c: {text?: string; type?: string}) => {
        if (c.type === 'text') return c.text || '';
        return '';
      }).join('');
    }
    
    // String response
    if (typeof body === 'string') return body;
    
    return '';
  }

  // Extract reasoning content
  function extractReasoningContent(body: unknown): string {
    if (!body || typeof body !== 'object' || body === null) return '';
    
    // DeepSeek/OpenAI reasoning
    const choices = (body as {choices?: unknown[]}).choices;
    if (choices && Array.isArray(choices) && choices.length > 0) {
      const choice = choices[0] as {message?: {reasoning_content?: unknown}};
      if (choice.message?.reasoning_content) return String(choice.message.reasoning_content);
    }
    
    // Anthropic thinking
    const content = (body as {content?: unknown[]}).content;
    if (content && Array.isArray(content)) {
      const thinking = content.find((c: {type?: string; thinking?: string}) => c.type === 'thinking');
      if (thinking?.thinking) return thinking.thinking;
    }
    
    return '';
  }

  const prompt = $derived(extractPrompt(log.requestBody));
  const responseContent = $derived(extractResponseContent(log.responseBody));
  const reasoningContent = $derived(extractReasoningContent(log.responseBody));
  const tps = $derived(calculateTokensPerSecond(log));

  // Tabs configuration
  const tabs = [
    { id: 'message', label: 'Message' },
    { id: 'request', label: 'Request' },
    { id: 'transformedRequest', label: 'Transformed Request' },
    { id: 'response', label: 'Response' },
    { id: 'transformedResponse', label: 'Transformed Response' },
    { id: 'metadata', label: 'Metadata' },
  ];
</script>

<div class="bg-white rounded-lg border border-gray-200 overflow-hidden hover:bg-gray-50 transition-colors">
  <!-- Header Row (Logs page style) -->
  <button
    type="button"
    class="w-full px-6 py-4 text-left"
    onclick={onToggle}
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4 min-w-0">
        <!-- Success/Error Indicator -->
        {#if isSuccess}
          <CheckCircle class="text-green-500 shrink-0" size={20} />
        {:else}
          <AlertCircle class="text-red-500 shrink-0" size={20} />
        {/if}

        <!-- Model Info -->
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-mono text-sm font-medium text-gray-900">{log.model}</span>
            <ArrowRight size={14} class="text-gray-400" />
            <span class="font-mono text-sm text-gray-600">{log.targetModel}</span>
            {#if !log.routed}
              <span class="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                Unrouted
              </span>
            {/if}
          </div>
          <div class="flex items-center gap-4 mt-1 text-sm text-gray-500">
            <span>{log.provider}</span>
            <span>⏰ {formatTime(log.timestamp)}</span>
          </div>
        </div>
      </div>

      <div class="flex flex-col items-end gap-1 flex-shrink-0">
        <!-- Duration -->
        <span class="text-sm font-medium text-gray-600">
          {formatDuration(log.durationMs)}
        </span>
        
        <!-- Tokens/Second -->
        {#if tps}
          <span class="text-xs text-gray-500">
            {tps} t/s
          </span>
        {/if}
      </div>

      <div class="flex items-center gap-3 flex-shrink-0">
        <!-- HTTP Status Pill -->
        <span 
          class="px-2 py-1 rounded text-sm font-mono"
          class:bg-green-100={log.responseStatus < 400}
          class:text-green-700={log.responseStatus < 400}
          class:bg-red-100={log.responseStatus >= 400}
          class:text-red-700={log.responseStatus >= 400}
        >
          {log.responseStatus}
        </span>

        <!-- Expand/Collapse Chevron -->
        {#if isExpanded}
          <ChevronUp size={20} class="text-gray-400" />
        {:else}
          <ChevronDown size={20} class="text-gray-400" />
        {/if}
      </div>
    </div>

    <!-- Prompt Preview (2nd line) -->
    <div class="mt-2 text-sm text-gray-600 truncate pl-9" title={prompt}>
      {truncatePrompt(prompt, 100)}
    </div>
  </button>

  <!-- Expanded Content -->
  {#if isExpanded}
    <div class="border-t border-gray-200">
      <!-- Tabs -->
      <div class="flex border-b border-gray-200 overflow-x-auto">
        {#each tabs as tab}
          <button
            type="button"
            onclick={() => onTabChange(tab.id)}
            class="px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
            class:border-blue-500={activeTab === tab.id}
            class:text-blue-600={activeTab === tab.id}
            class:border-transparent={activeTab !== tab.id}
            class:text-gray-500={activeTab !== tab.id}
            class:hover:text-gray-700={activeTab !== tab.id}
          >
            {tab.label}
          </button>
        {/each}
      </div>

      <!-- Tab Content -->
      <div class="p-6">
        <!-- Message Tab -->
        {#if activeTab === 'message'}
          <div class="space-y-4">
            <!-- Prompt -->
            {#if prompt}
              <div class="bg-blue-50 rounded-lg p-4">
                <h4 class="text-sm font-medium text-blue-700 mb-2">Prompt</h4>
                <pre class="text-sm text-blue-900 whitespace-pre-wrap">{prompt}</pre>
              </div>
            {/if}
            
            <!-- Response -->
            <div>
              <h4 class="text-sm font-medium text-gray-700 mb-2">Response</h4>
              <MessageDisplay 
                content={responseContent}
                reasoningContent={reasoningContent}
                isStreaming={false}
              />
            </div>
          </div>
        {/if}

        <!-- Request Tab -->
        {#if activeTab === 'request'}
          <div class="space-y-3">
            <div class="flex flex-wrap gap-4 text-sm text-gray-500">
              <span>Format: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{log.sourceScheme}</code></span>
              <span>Endpoint: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{log.method} {log.path}</code></span>
            </div>
            <JsonViewer data={log.requestBody} />
          </div>
        {/if}

        <!-- Transformed Request Tab -->
        {#if activeTab === 'transformedRequest'}
          <div class="space-y-3">
            <div class="flex flex-wrap gap-4 text-sm text-gray-500">
              <span>Target Format: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{log.targetScheme}</code></span>
              <span>Provider: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{log.provider}</code></span>
            </div>
            {#if log.transformedBody}
              <JsonViewer data={log.transformedBody} />
            {:else}
              <p class="text-gray-500 italic">No transformation applied</p>
            {/if}
          </div>
        {/if}

        <!-- Response Tab (raw upstream) -->
        {#if activeTab === 'response'}
          <div class="space-y-3">
            <div class="flex flex-wrap gap-4 text-sm text-gray-500 items-center">
              <span>Original Format: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{log.targetScheme}</code></span>
              <span>From: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{log.provider}</code></span>
              <span class="ml-auto flex items-center gap-3">
                <span>Duration: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{formatDuration(log.durationMs)}</code></span>
                {#if log.stream && log.latencyMs}
                  <span>Latency: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{formatDuration(log.latencyMs)}</code></span>
                {/if}
                {#if tps}
                  <span>Tokens/s: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{tps}</code></span>
                {/if}
              </span>
            </div>
            {#if log.rawUpstreamResponse}
              <JsonViewer data={log.rawUpstreamResponse} />
            {:else if log.responseBody}
              <JsonViewer data={log.responseBody} />
            {:else}
              <p class="text-gray-500 italic">No response captured</p>
            {/if}
          </div>
        {/if}

        <!-- Transformed Response Tab -->
        {#if activeTab === 'transformedResponse'}
          <div class="space-y-3">
            <div class="flex flex-wrap gap-4 text-sm text-gray-500 items-center">
              <span>Transformed Format: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{log.sourceScheme}</code></span>
              <span class="ml-auto flex items-center gap-3">
                <span>Duration: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{formatDuration(log.durationMs)}</code></span>
                {#if log.stream && log.latencyMs}
                  <span>Latency: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{formatDuration(log.latencyMs)}</code></span>
                {/if}
                {#if tps}
                  <span>Tokens/s: <code class="bg-gray-100 px-1.5 py-0.5 rounded">{tps}</code></span>
                {/if}
              </span>
            </div>
            {#if log.transformedResponse}
              <JsonViewer data={log.transformedResponse} />
            {:else if log.responseBody}
              <JsonViewer data={log.responseBody} />
            {:else}
              <p class="text-gray-500 italic">No transformed response</p>
            {/if}
          </div>
        {/if}

        <!-- Metadata Tab -->
        {#if activeTab === 'metadata'}
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div>
              <span class="text-gray-500 block text-xs uppercase tracking-wider">Request ID</span>
              <p class="font-mono text-xs break-all text-gray-900">{log.requestId}</p>
            </div>
            <div>
              <span class="text-gray-500 block text-xs uppercase tracking-wider">Provider URL</span>
              <p class="font-mono text-xs break-all text-gray-900" title={log.providerUrl}>
                {log.providerUrl || 'N/A'}
              </p>
            </div>
            <div>
              <span class="text-gray-500 block text-xs uppercase tracking-wider">Authentication</span>
              <p class="font-mono text-xs text-gray-900">
                {#if log.authScheme}
                  {log.authScheme.header}: {log.authScheme.prefix}{log.authScheme.maskedKey}
                {:else}
                  N/A
                {/if}
              </p>
            </div>
            <div>
              <span class="text-gray-500 block text-xs uppercase tracking-wider">Source Format</span>
              <p class="font-mono text-xs text-gray-900">{log.sourceScheme}</p>
            </div>
            <div>
              <span class="text-gray-500 block text-xs uppercase tracking-wider">Target Format</span>
              <p class="font-mono text-xs text-gray-900">{log.targetScheme}</p>
            </div>
            <div>
              <span class="text-gray-500 block text-xs uppercase tracking-wider">Matched Pattern</span>
              <p class="font-mono text-xs text-gray-900">{log.matchedPattern || 'N/A'}</p>
            </div>
            <div>
              <span class="text-gray-500 block text-xs uppercase tracking-wider">Duration</span>
              <p class="text-gray-900">{formatDuration(log.durationMs)}</p>
            </div>
            <div>
              <span class="text-gray-500 block text-xs uppercase tracking-wider">Timestamp</span>
              <p class="text-xs text-gray-900">{log.timestamp}</p>
            </div>
            <div>
              <span class="text-gray-500 block text-xs uppercase tracking-wider">Stream</span>
              <p class="text-gray-900">{log.stream ? 'Yes' : 'No'}</p>
            </div>
            {#if log.tokensPerSecond || tps}
              <div>
                <span class="text-gray-500 block text-xs uppercase tracking-wider">Tokens/Second</span>
                <p class="text-gray-900">{log.tokensPerSecond || tps}</p>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
