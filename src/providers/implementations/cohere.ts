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
  static override readonly supportedFormats = ["cohere-chat", "openai-chat"];
  static override readonly endpoints = [
    { method: "POST", path: "/v1/chat", format: "cohere-chat", description: "Cohere chat" },
    { method: "POST", path: "/v1/generate", format: "cohere-chat", description: "Cohere generate (legacy)" },
  ];

  /**
   * Cohere uses /chat endpoint for chat completions
   */
  override getEndpointUrl(format: string): string {
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
  override getModelsUrl(): string | null {
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
