// ============================================================================
// Base Provider Class
// ============================================================================

import type { ProviderConfig } from "../types/index.ts";
import type { ProviderRequest, ProviderInfo } from "./types.ts";

/**
 * Abstract base class for all providers
 */
export abstract class BaseProvider {
  protected config: ProviderConfig;
  public readonly id: string;

  constructor(id: string, config: ProviderConfig) {
    this.id = id;
    this.config = config;
  }

  /**
   * Get the base URL for this provider
   */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Get the API key for this provider (from config or environment)
   */
  getApiKey(): string | undefined {
    return this.config.apiKey || 
      (this.config.apiKeyEnv ? process.env[this.config.apiKeyEnv] : undefined);
  }

  /**
   * Check if this provider has a valid API key configured
   */
  hasApiKey(): boolean {
    return !!this.getApiKey();
  }

  /**
   * Get authentication headers for requests
   */
  getAuthHeaders(): Record<string, string> {
    const apiKey = this.getApiKey();
    if (!apiKey || !this.config.authHeader) {
      return {};
    }

    return {
      [this.config.authHeader]: `${this.config.authPrefix || ""}${apiKey}`,
    };
  }

  /**
   * Get all headers to send with requests
   */
  getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...this.getAuthHeaders(),
      ...this.config.headers,
    };
  }

  /**
   * Get timeout in milliseconds
   */
  getTimeoutMs(defaultTimeout: number = 120): number {
    return (this.config.timeout || defaultTimeout) * 1000;
  }

  /**
   * Get the chat completions endpoint URL
   * @deprecated Use getEndpointUrl(format) instead
   */
  getChatCompletionsUrl(): string {
    return this.getEndpointUrl("openai-chat");
  }

  /**
   * Get endpoint URL for a specific format variant
   * Override in subclasses for provider-specific mappings
   */
  getEndpointUrl(format: string): string {
    const baseUrl = this.config.baseUrl;
    
    // Default: OpenAI-compatible providers
    switch (format) {
      case "openai-responses":
        return `${baseUrl}/responses`;
      case "openai-completions":
        return `${baseUrl}/completions`;
      case "openai-chat":
      default:
        return `${baseUrl}/chat/completions`;
    }
  }

  /**
   * Get the models endpoint URL for this provider
   * Returns null if the provider doesn't have a models endpoint
   */
  getModelsUrl(): string | null {
    return `${this.config.baseUrl}/models`;
  }

  /**
   * Build a request for this provider
   * @param body - The request body
   * @param originalHeaders - Original request headers
   * @param format - Optional format variant
   */
  abstract buildRequest(body: unknown, originalHeaders: Headers, format?: string): ProviderRequest;

  /**
   * Check if this provider supports streaming
   */
  supportsStreaming(): boolean {
    return this.config.supportsStreaming !== false;
  }

  /**
   * Validate the provider configuration
   */
  validate(): string[] {
    const errors: string[] = [];

    if (!this.config.baseUrl) {
      errors.push(`Provider ${this.id}: baseUrl is required`);
    }

    return errors;
  }

  /**
   * Get provider info for the GUI
   */
  getInfo(): {
    id: string;
    baseUrl: string;
    hasApiKey: boolean;
    supportsStreaming: boolean;
    timeout: number;
  } {
    return {
      id: this.id,
      baseUrl: this.config.baseUrl,
      hasApiKey: this.hasApiKey(),
      supportsStreaming: this.supportsStreaming(),
      timeout: this.config.timeout || 120,
    };
  }
}
