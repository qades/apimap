// ============================================================================
// Google Gemini Provider
// ============================================================================

import { BaseProvider } from "../base.ts";
import type { ProviderRequest } from "../types.ts";

/**
 * Google Gemini provider with native API support
 * Uses URL query parameter for authentication
 */
export class GoogleProvider extends BaseProvider {
  static override readonly supportedFormats = ["google-generate"];
  static override readonly endpoints = [
    { method: "POST", path: "/v1beta/models/{model}:generateContent", format: "google-generate", description: "Gemini generate content" },
    { method: "POST", path: "/v1beta/models/{model}:streamGenerateContent", format: "google-generate", description: "Gemini streaming generate" },
  ];

  /**
   * Google uses models/{model} path format
   */
  override getEndpointUrl(format: string): string {
    const baseUrl = this.config.baseUrl;
    
    // Extract model from format or use generic endpoint
    // Format will be something like "gemini-1.5-pro:generateContent"
    if (format.includes(":")) {
      return `${baseUrl}/models/${format}`;
    }
    
    // Default to models list endpoint
    return `${baseUrl}/models`;
  }

  /**
   * Get models URL for Google
   */
  override getModelsUrl(): string | null {
    return `${this.config.baseUrl}/models`;
  }

  buildRequest(body: unknown, originalHeaders: Headers, format?: string): ProviderRequest {
    const apiKey = this.getApiKey();
    const requestBody = body as Record<string, unknown>;
    const model = requestBody?.model as string | undefined;
    
    // Google uses URL query parameter for API key
    // Format: models/{model}:generateContent or models/{model}:streamGenerateContent
    let endpoint = format || "generateContent";
    if (model && !endpoint.includes(":")) {
      endpoint = `${model}:${requestBody?.stream ? "streamGenerateContent" : "generateContent"}`;
    }
    
    let url = this.getEndpointUrl(endpoint);
    if (apiKey) {
      url += `${url.includes("?") ? "&" : "?"}key=${apiKey}`;
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
