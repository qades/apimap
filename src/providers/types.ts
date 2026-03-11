// ============================================================================
// Provider Types
// ============================================================================

import type { ProviderConfig } from "../types/index.ts";

/**
 * Provider request structure
 */
export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Provider response structure
 */
export interface ProviderResponse {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | string | null;
}

/**
 * Provider category
 */
export type ProviderCategory = "cloud" | "local" | "enterprise" | "regional" | "custom";

/**
 * Provider information (display/metadata)
 */
export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  defaultBaseUrl: string;
  defaultApiKeyEnv?: string;
  authHeader: string;
  authPrefix: string;
  supportsStreaming: boolean;
  requiresApiKey: boolean;
  category: ProviderCategory;
}

/**
 * AWS credentials for Bedrock provider
 */
export interface AWSCredentials {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
}

/**
 * Provider category metadata
 */
export interface CategoryInfo {
  id: ProviderCategory;
  name: string;
  description: string;
}
