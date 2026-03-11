// ============================================================================
// Ollama Provider
// ============================================================================

import { BaseProvider } from "../base.ts";
import type { ProviderRequest } from "../types.ts";

/**
 * Ollama provider for local model inference
 * No authentication required
 */
export class OllamaProvider extends BaseProvider {
  /**
   * Ollama uses /api endpoints
   */
  getEndpointUrl(format: string): string {
    const baseUrl = this.config.baseUrl;
    
    switch (format) {
      case "ollama-generate":
        return `${baseUrl}/api/generate`;
      case "ollama-embed":
        return `${baseUrl}/api/embed`;
      case "ollama-tags":
        return `${baseUrl}/api/tags`;
      case "ollama-ps":
        return `${baseUrl}/api/ps`;
      case "ollama-chat":
      default:
        return `${baseUrl}/api/chat`;
    }
  }

  /**
   * Ollama uses /api/tags for models
   */
  getModelsUrl(): string | null {
    return `${this.config.baseUrl}/api/tags`;
  }

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

  /**
   * Ollama doesn't require an API key
   */
  hasApiKey(): boolean {
    return true;
  }
}
