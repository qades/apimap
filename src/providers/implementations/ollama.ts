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
  static override readonly supportedFormats = ["ollama-chat", "openai-chat"];
  static override readonly endpoints = [
    { method: "POST", path: "/api/chat", format: "ollama-chat", description: "Ollama chat" },
    { method: "POST", path: "/api/generate", format: "ollama-generate", description: "Ollama generate" },
    { method: "POST", path: "/v1/chat/completions", format: "openai-chat", description: "Ollama OpenAI-compatible" },
  ];

  /**
   * Ollama uses /api endpoints
   */
  override getEndpointUrl(format: string): string {
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
  override getModelsUrl(): string | null {
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
  override hasApiKey(): boolean {
    return true;
  }
}
