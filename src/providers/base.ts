// ============================================================================
// Base Provider Class
// ============================================================================

import type { ProviderConfig, OpenAIRequest, OpenAIResponse, AnthropicRequest, AnthropicResponse } from "../types/index.ts";

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ProviderResponse {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | string | null;
}

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
   * Maps format identifiers to provider-specific endpoint paths
   */
  getEndpointUrl(format: string): string {
    const baseUrl = this.config.baseUrl;
    
    // Provider-specific endpoint mappings
    switch (this.id) {
      case "anthropic":
        // Anthropic only has messages API
        return `${baseUrl}/v1/messages`;
      
      case "google":
        return `${baseUrl}/models`;
      
      case "ollama":
        switch (format) {
          case "ollama-generate":
            return `${baseUrl}/api/generate`;
          case "ollama-chat":
          default:
            return `${baseUrl}/api/chat`;
        }
      
      case "openai":
      case "groq":
      case "together":
      case "fireworks":
      case "mistral":
      case "cohere":
      case "openrouter":
      case "deepseek":
      default:
        // OpenAI-compatible providers
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
  }

  /**
   * Get the models endpoint URL for this provider
   * Returns null if the provider doesn't have a models endpoint
   */
  getModelsUrl(): string | null {
    const baseUrl = this.config.baseUrl;
    
    switch (this.id) {
      case "anthropic":
        // Anthropic has models at /v1/models
        return `${baseUrl}/v1/models`;
      
      case "google":
        // Google uses a different models endpoint format
        return `${baseUrl}/models`;
      
      case "ollama":
        // Ollama has a local models endpoint
        return `${baseUrl}/api/tags`;
      
      case "openai":
      case "groq":
      case "together":
      case "fireworks":
      case "mistral":
      case "cohere":
      case "openrouter":
      case "deepseek":
      case "lmstudio":
      case "llamacpp":
      case "vllm":
      default:
        // OpenAI-compatible providers use /v1/models
        return `${baseUrl}/models`;
    }
  }

  /**
   * Build a request for this provider
   * @param body - The request body
   * @param originalHeaders - Original request headers
   * @param format - Optional format variant (e.g., "openai-chat", "openai-responses")
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

/**
 * OpenAI-compatible provider (works with most providers)
 */
export class OpenAICompatibleProvider extends BaseProvider {
  buildRequest(body: unknown, originalHeaders: Headers, format?: string): ProviderRequest {
    return {
      url: this.getEndpointUrl(format || "openai-chat"),
      headers: this.getHeaders(),
      body,
    };
  }
}

/**
 * Anthropic provider (requires special handling)
 */
export class AnthropicProvider extends BaseProvider {
  /**
   * Override getHeaders to include anthropic-version
   */
  getHeaders(): Record<string, string> {
    const apiKey = this.getApiKey();
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };

    if (apiKey && this.config.authHeader) {
      headers[this.config.authHeader] = `${this.config.authPrefix || ""}${apiKey}`;
    }

    // Merge with custom headers from config
    Object.assign(headers, this.config.headers);

    return headers;
  }

  buildRequest(body: unknown, originalHeaders: Headers, format?: string): ProviderRequest {
    return {
      url: this.getEndpointUrl(format || "anthropic-messages"),
      headers: this.getHeaders(),
      body,
    };
  }
}

/**
 * Google Gemini provider
 */
export class GoogleProvider extends BaseProvider {
  buildRequest(body: unknown, originalHeaders: Headers, format?: string): ProviderRequest {
    const apiKey = this.getApiKey();
    
    // Google uses URL query parameter for API key
    let url = this.getEndpointUrl(format || "google");
    if (apiKey) {
      url += `?key=${apiKey}`;
    }

    return {
      url,
      headers: {
        "Content-Type": "application/json",
        ...this.config.headers,
      },
      body,
    };
  }
}

/**
 * Ollama provider (local, no auth required)
 */
export class OllamaProvider extends BaseProvider {
  buildRequest(body: unknown, originalHeaders: Headers, format?: string): ProviderRequest {
    return {
      url: this.getEndpointUrl(format || "ollama-chat"),
      headers: {
        "Content-Type": "application/json",
        ...this.config.headers,
      },
      body,
    };
  }

  hasApiKey(): boolean {
    // Ollama doesn't require an API key
    return true;
  }
}
