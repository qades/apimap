// ============================================================================
// Cohere Provider
// ============================================================================

import { BaseProvider } from "../base.ts";
import type { ProviderRequest } from "../types.ts";

/**
 * Cohere provider with native API support
 * Has its own chat format with chat_history field
 */
export class CohereProvider extends BaseProvider {
  /**
   * Cohere uses /chat endpoint for chat completions
   */
  getEndpointUrl(format: string): string {
    const baseUrl = this.config.baseUrl;
    
    switch (format) {
      case "cohere-generate":
        return `${baseUrl}/generate`;
      case "cohere-embed":
        return `${baseUrl}/embed`;
      case "cohere-rerank":
        return `${baseUrl}/rerank`;
      case "cohere-chat":
      default:
        return `${baseUrl}/chat`;
    }
  }

  /**
   * Get models URL for Cohere
   */
  getModelsUrl(): string | null {
    return `${this.config.baseUrl}/models`;
  }

  buildRequest(body: unknown, originalHeaders: Headers, format?: string): ProviderRequest {
    return {
      url: this.getEndpointUrl(format || "cohere-chat"),
      headers: this.getHeaders(),
      body,
    };
  }
}
