// ============================================================================
// Anthropic Provider
// ============================================================================

import { BaseProvider } from "../base.ts";
import type { ProviderRequest } from "../types.ts";

/**
 * Anthropic provider with native Messages API support
 */
export class AnthropicProvider extends BaseProvider {
  static override readonly supportedFormats = ["anthropic-messages"];
  static override readonly endpoints = [
    { method: "POST", path: "/v1/messages", format: "anthropic-messages", description: "Anthropic Messages API" },
  ];

  /**
   * Override getHeaders to include anthropic-version
   */
  override getHeaders(): Record<string, string> {
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

  /**
   * Anthropic uses /v1/messages endpoint
   */
  override getEndpointUrl(format: string): string {
    const baseUrl = this.config.baseUrl;
    return `${baseUrl}/v1/messages`;
  }

  /**
   * Get models URL for Anthropic
   */
  override getModelsUrl(): string | null {
    return `${this.config.baseUrl}/v1/models`;
  }

  buildRequest(body: unknown, _originalHeaders: Headers, format?: string): ProviderRequest {
    return {
      url: this.getEndpointUrl(format || "anthropic-messages"),
      headers: this.getHeaders(),
      body,
    };
  }
}
