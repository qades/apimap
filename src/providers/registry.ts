// ============================================================================
// Provider Registry - Manages all provider instances
// ============================================================================

import type { ProviderConfig, ProviderInfo } from "../types/index.ts";
import { 
  BaseProvider, 
  OpenAICompatibleProvider, 
  AnthropicProvider, 
  GoogleProvider,
  OllamaProvider 
} from "./base.ts";

// Built-in provider definitions
export const BUILTIN_PROVIDERS: Record<string, ProviderInfo> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI GPT models (GPT-4, GPT-3.5, etc.)",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultApiKeyEnv: "OPENAI_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models (Claude 3 Opus, Sonnet, Haiku)",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultApiKeyEnv: "ANTHROPIC_API_KEY",
    authHeader: "x-api-key",
    authPrefix: "",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  google: {
    id: "google",
    name: "Google Gemini",
    description: "Google Gemini models",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultApiKeyEnv: "GOOGLE_API_KEY",
    authHeader: "x-goog-api-key",
    authPrefix: "",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    description: "Local models via Ollama (Llama, Mistral, etc.)",
    defaultBaseUrl: "http://localhost:11434",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    description: "Local models via LM Studio",
    defaultBaseUrl: "http://localhost:1234/v1",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
  llamacpp: {
    id: "llamacpp",
    name: "llama.cpp",
    description: "Local models via llama.cpp server",
    defaultBaseUrl: "http://localhost:8080/v1",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
  vllm: {
    id: "vllm",
    name: "vLLM",
    description: "High-throughput inference with vLLM",
    defaultBaseUrl: "http://localhost:8000/v1",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
  fireworks: {
    id: "fireworks",
    name: "Fireworks AI",
    description: "Fast inference with Fireworks AI",
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    defaultApiKeyEnv: "FIREWORKS_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  together: {
    id: "together",
    name: "Together AI",
    description: "Together AI inference platform",
    defaultBaseUrl: "https://api.together.xyz/v1",
    defaultApiKeyEnv: "TOGETHER_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  groq: {
    id: "groq",
    name: "Groq",
    description: "Ultra-fast inference with Groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultApiKeyEnv: "GROQ_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    description: "Perplexity AI API",
    defaultBaseUrl: "https://api.perplexity.ai",
    defaultApiKeyEnv: "PERPLEXITY_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  anyscale: {
    id: "anyscale",
    name: "Anyscale",
    description: "Anyscale Endpoints",
    defaultBaseUrl: "https://api.endpoints.anyscale.com/v1",
    defaultApiKeyEnv: "ANYSCALE_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek AI models",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultApiKeyEnv: "DEEPSEEK_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    description: "Mistral AI models",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultApiKeyEnv: "MISTRAL_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    description: "Cohere Command models",
    defaultBaseUrl: "https://api.cohere.ai/v1",
    defaultApiKeyEnv: "COHERE_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    description: "OpenRouter - unified API for many models",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultApiKeyEnv: "OPENROUTER_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
};

export class ProviderRegistry {
  private providers: Map<string, BaseProvider> = new Map();

  /**
   * Create a provider instance based on its type
   */
  private createProvider(id: string, config: ProviderConfig): BaseProvider {
    const info = BUILTIN_PROVIDERS[id];
    
    // Determine provider type
    switch (id) {
      case "anthropic":
        return new AnthropicProvider(id, config);
      case "google":
        return new GoogleProvider(id, config);
      case "ollama":
        return new OllamaProvider(id, config);
      default:
        // Most providers are OpenAI-compatible
        return new OpenAICompatibleProvider(id, config);
    }
  }

  /**
   * Register a provider
   */
  register(id: string, config: ProviderConfig): void {
    const provider = this.createProvider(id, config);
    this.providers.set(id, provider);
  }

  /**
   * Unregister a provider
   */
  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  /**
   * Get a provider by ID
   */
  get(id: string): BaseProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Check if a provider exists
   */
  has(id: string): boolean {
    return this.providers.has(id);
  }

  /**
   * Get all registered providers
   */
  getAll(): Map<string, BaseProvider> {
    return new Map(this.providers);
  }

  /**
   * Get all registered provider IDs
   */
  getIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Initialize providers from config
   */
  initializeFromConfig(configs: Record<string, ProviderConfig>): void {
    this.providers.clear();

    // First, add all built-in providers with their defaults
    for (const [id, info] of Object.entries(BUILTIN_PROVIDERS)) {
      const userConfig = configs[id];
      
      const mergedConfig: ProviderConfig = {
        baseUrl: info.defaultBaseUrl,
        apiKeyEnv: info.defaultApiKeyEnv,
        authHeader: info.authHeader,
        authPrefix: info.authPrefix,
        supportsStreaming: info.supportsStreaming,
        ...userConfig, // User config overrides defaults
      };

      this.register(id, mergedConfig);
    }

    // Then add any custom providers not in built-ins
    for (const [id, config] of Object.entries(configs)) {
      if (!BUILTIN_PROVIDERS[id]) {
        this.register(id, config);
      }
    }
  }

  /**
   * Get provider info for all built-in providers
   */
  getBuiltinProviderInfos(): ProviderInfo[] {
    return Object.values(BUILTIN_PROVIDERS);
  }

  /**
   * Get provider info for all registered providers
   */
  getRegisteredProviderInfos(): Array<ProviderInfo & { configured: boolean }> {
    return this.getIds().map(id => {
      const builtin = BUILTIN_PROVIDERS[id];
      const provider = this.get(id);
      
      if (builtin) {
        return {
          ...builtin,
          configured: provider?.hasApiKey() || !builtin.requiresApiKey,
        };
      }

      // Custom provider
      return {
        id,
        name: id,
        description: "Custom provider",
        defaultBaseUrl: provider?.getBaseUrl() || "",
        authHeader: "Authorization",
        authPrefix: "Bearer ",
        supportsStreaming: true,
        requiresApiKey: true,
        category: "custom",
        configured: provider?.hasApiKey() || false,
      };
    });
  }

  /**
   * Create a default config for a built-in provider
   */
  createDefaultConfig(id: string): ProviderConfig | null {
    const info = BUILTIN_PROVIDERS[id];
    if (!info) return null;

    return {
      baseUrl: info.defaultBaseUrl,
      apiKeyEnv: info.defaultApiKeyEnv,
      authHeader: info.authHeader,
      authPrefix: info.authPrefix,
      supportsStreaming: info.supportsStreaming,
    };
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry();
