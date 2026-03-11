// ============================================================================
// OpenAI-Compatible Provider
// Works with Groq, Together, Fireworks, Mistral, DeepSeek, and many others
// ============================================================================

import { BaseProvider } from "../base.ts";
import type { ProviderRequest } from "../types.ts";

/**
 * OpenAI-compatible provider implementation
 * Used by most cloud providers that follow OpenAI's API format
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
