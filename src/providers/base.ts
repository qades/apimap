// ============================================================================
// Base Provider Class
// ============================================================================

import type { ProviderConfig } from "../types/index.ts";
import type { ProviderRequest, ProviderInfo } from "./types.ts";
import type {
  InternalRequest,
  InternalResponse,
  InternalStreamChunk,
} from "../types/internal.ts";

/**
 * Provider endpoint metadata
 */
export interface ProviderEndpoint {
  method: string;
  path: string;
  format: string;
  description?: string;
}

/**
 * Provider metadata for introspection
 */
export interface ProviderMetadata {
  /** Supported API formats */
  formats: string[];
  /** Egress endpoints this provider calls */
  endpoints: ProviderEndpoint[];
  /** Implementation class name */
  implementation: string;
  /** Whether provider uses native vs OpenAI-compatible API */
  nativeApi: boolean;
}

/**
 * Abstract base class for all providers
 */
export abstract class BaseProvider {
  protected config: ProviderConfig;
  public readonly id: string;

  /** Supported formats - override in subclasses */
  static readonly supportedFormats: string[] = ["openai-chat"];
  
  /** Egress endpoints - override in subclasses */
  static readonly endpoints: ProviderEndpoint[] = [
    { method: "POST", path: "/v1/chat/completions", format: "openai-chat" },
  ];

  constructor(id: string, config: ProviderConfig) {
    this.id = id;
    this.config = config;
  }

  /**
   * Get provider metadata for introspection
   */
  getMetadata(): ProviderMetadata {
    const ctor = this.constructor as typeof BaseProvider;
    return {
      formats: ctor.supportedFormats,
      endpoints: ctor.endpoints,
      implementation: this.constructor.name,
      nativeApi: this.constructor.name === "OpenAICompatibleProvider",
    };
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

  // ============================================================================
  // Format Transformation Methods
  // Override these in subclasses to support specific formats.
  // Return null if the format is not supported.
  // ============================================================================

  /**
   * Parse incoming request from client format to internal format.
   * Return null if this provider cannot handle the given format.
   */
  parseRequest(
    _format: string,
    _body: unknown,
    _metadata: InternalRequest["metadata"]
  ): InternalRequest | null {
    return null;
  }

  /**
   * Convert internal request to provider's expected format.
   * Return null if this provider cannot handle the given format.
   */
  toProviderRequest(_format: string, _request: InternalRequest): unknown | null {
    return null;
  }

  /**
   * Parse provider response to internal format.
   * Return null if this provider cannot handle the given format.
   */
  parseResponse(_format: string, _data: unknown): InternalResponse | null {
    return null;
  }

  /**
   * Convert internal response to client's expected format.
   * Return null if this provider cannot handle the given format.
   */
  toClientResponse(_format: string, _response: InternalResponse): unknown | null {
    return null;
  }

  /**
   * Parse a streaming chunk from provider format to internal format.
   * Return null if this provider cannot handle the given format or chunk is invalid.
   */
  parseStreamChunk(_format: string, _line: string): InternalStreamChunk | null {
    return null;
  }

  /**
   * Convert internal stream chunk to client's expected SSE format.
   * Return empty string if this provider cannot handle the given format.
   */
  toClientStreamChunk(_format: string, _chunk: InternalStreamChunk, _model: string): string {
    return "";
  }

  /**
   * Create stream start events for a provider format.
   * Return empty string if no start events needed or format not supported.
   */
  createStreamStart(_format: string, _messageId: string, _usage?: { input_tokens?: number }): string {
    return "";
  }

  /**
   * Create stream stop events for a provider format.
   * Return empty string if format not supported.
   */
  createStreamStop(_format: string, _stopReason: string | null, _outputTokens: number): string {
    return "";
  }
}
