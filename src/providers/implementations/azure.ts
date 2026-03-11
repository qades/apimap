// ============================================================================
// Azure OpenAI Provider
// ============================================================================

import { BaseProvider } from "../base.ts";
import type { ProviderRequest } from "../types.ts";

/**
 * Azure OpenAI provider with enterprise features
 * Uses api-key header instead of Authorization
 */
export class AzureProvider extends BaseProvider {
  /**
   * Azure uses api-key header instead of Authorization
   */
  getHeaders(): Record<string, string> {
    const apiKey = this.getApiKey();
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      headers["api-key"] = apiKey;
    }

    // Merge with custom headers from config
    Object.assign(headers, this.config.headers);

    return headers;
  }

  /**
   * Azure uses deployment-specific URLs with API version
   */
  getEndpointUrl(format: string): string {
    // Azure URLs should be configured as: 
    // https://{resource}.openai.azure.com/openai/deployments/{deployment}
    const baseUrl = this.config.baseUrl;
    const apiVersion = this.config.headers?.["api-version"] || "2024-06-01";
    
    switch (format) {
      case "openai-responses":
        return `${baseUrl}/responses?api-version=2024-12-01-preview`;
      case "openai-completions":
        return `${baseUrl}/completions?api-version=${apiVersion}`;
      case "openai-chat":
      default:
        return `${baseUrl}/chat/completions?api-version=${apiVersion}`;
    }
  }

  /**
   * Get models URL for Azure
   */
  getModelsUrl(): string | null {
    const baseUrl = this.config.baseUrl;
    const apiVersion = this.config.headers?.["api-version"] || "2024-06-01";
    return `${baseUrl}/models?api-version=${apiVersion}`;
  }

  buildRequest(body: unknown, originalHeaders: Headers, format?: string): ProviderRequest {
    return {
      url: this.getEndpointUrl(format || "openai-chat"),
      headers: this.getHeaders(),
      body,
    };
  }
}
