// ============================================================================
// Provider Registry - Manages all provider instances
// ============================================================================

import type { ProviderConfig } from "../types/index.ts";
import type { ProviderInfo, CategoryInfo } from "./types.ts";
import { BaseProvider } from "./base.ts";
import { BUILTIN_PROVIDERS } from "./builtin.ts";
import {
  OpenAICompatibleProvider,
  AnthropicProvider,
  GoogleProvider,
  AzureProvider,
  AWSBedrockProvider,
  CohereProvider,
  OllamaProvider,
} from "./implementations/index.ts";

export class ProviderRegistry {
  private providers: Map<string, BaseProvider> = new Map();

  /**
   * Create a provider instance based on its type
   */
  private createProvider(id: string, config: ProviderConfig): BaseProvider {
    switch (id) {
      case "anthropic":
        return new AnthropicProvider(id, config);
      case "google":
        return new GoogleProvider(id, config);
      case "azure":
        return new AzureProvider(id, config);
      case "bedrock":
        return new AWSBedrockProvider(id, config);
      case "cohere":
        return new CohereProvider(id, config);
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
   * Get providers by category
   */
  getProvidersByCategory(category: ProviderInfo["category"]): ProviderInfo[] {
    return Object.values(BUILTIN_PROVIDERS).filter(p => p.category === category);
  }

  /**
   * Get provider categories
   */
  getCategories(): CategoryInfo[] {
    return [
      { id: "cloud", name: "Cloud Providers", description: "Commercial LLM APIs" },
      { id: "local", name: "Local Providers", description: "Self-hosted and local inference" },
      { id: "enterprise", name: "Enterprise", description: "Enterprise cloud platforms" },
      { id: "regional", name: "Regional", description: "Region-specific providers" },
      { id: "custom", name: "Custom", description: "User-defined providers" },
    ];
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
