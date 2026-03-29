// ============================================================================
// AWS Bedrock Provider
// ============================================================================

import { BaseProvider } from "../base.ts";
import type { ProviderRequest, AWSCredentials } from "../types.ts";

/**
 * AWS Bedrock provider with SigV4 authentication
 */
export class AWSBedrockProvider extends BaseProvider {
  static override readonly supportedFormats = ["bedrock-converse"];
  static override readonly endpoints = [
    { method: "POST", path: "/model/{modelId}/converse", format: "bedrock-converse", description: "AWS Bedrock converse" },
    { method: "POST", path: "/model/{modelId}/converse-stream", format: "bedrock-converse", description: "AWS Bedrock streaming" },
  ];

  /**
   * Get AWS credentials from environment
   */
  getAWSCredentials(): AWSCredentials {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
    };
  }

  /**
   * Check if AWS credentials are available
   */
  override hasApiKey(): boolean {
    const creds = this.getAWSCredentials();
    return !!(creds.accessKeyId && creds.secretAccessKey);
  }

  /**
   * Get base URL with region substitution
   */
  override getBaseUrl(): string {
    const creds = this.getAWSCredentials();
    return this.config.baseUrl.replace("{region}", creds.region || "us-east-1");
  }

  /**
   * AWS Bedrock uses model-specific paths
   */
  override getEndpointUrl(format: string): string {
    const baseUrl = this.getBaseUrl();
    
    switch (format) {
      case "bedrock-converse-stream":
        return `${baseUrl}/model/{modelId}/converse-stream`;
      case "bedrock-converse":
        return `${baseUrl}/model/{modelId}/converse`;
      case "bedrock-invoke-stream":
        return `${baseUrl}/model/{modelId}/invoke-with-response-stream`;
      case "bedrock-invoke":
      default:
        return `${baseUrl}/model/{modelId}/invoke`;
    }
  }

  /**
   * AWS Bedrock doesn't have a simple models list endpoint
   */
  override getModelsUrl(): string | null {
    return null;
  }

  buildRequest(body: unknown, originalHeaders: Headers, format?: string): ProviderRequest {
    const requestBody = body as Record<string, unknown>;
    const model = requestBody?.model as string | undefined;
    
    // Replace {modelId} placeholder in URL
    let url = this.getEndpointUrl(format || "bedrock-invoke");
    if (model) {
      url = url.replace("{modelId}", model);
    }
    
    // Build headers (AWS SigV4 signing would happen here in production)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    // Note: In production, this would sign the request with AWS Signature V4
    // The actual signing is typically done by the AWS SDK or a middleware

    return {
      url,
      headers,
      body,
    };
  }
}
