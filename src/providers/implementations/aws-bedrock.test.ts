import { describe, test, expect, beforeEach } from "bun:test";
import { AWSBedrockProvider } from "./aws-bedrock.ts";
import type { ProviderConfig } from "../../types/index.ts";

describe("AWSBedrockProvider", () => {
  let provider: AWSBedrockProvider;
  const config: ProviderConfig = {
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com",
    supportsStreaming: true,
    timeout: 120,
  };

  // Store original env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
    provider = new AWSBedrockProvider("bedrock", config);
  });

  test("should return base URL with region substitution", () => {
    process.env.AWS_REGION = "us-west-2";
    expect(provider.getBaseUrl()).toBe("https://bedrock-runtime.us-west-2.amazonaws.com");
  });

  test("should use default region when AWS_REGION not set", () => {
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    expect(provider.getBaseUrl()).toBe("https://bedrock-runtime.us-east-1.amazonaws.com");
  });

  test("should get AWS credentials from environment", () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    process.env.AWS_SESSION_TOKEN = "test-session-token";
    process.env.AWS_REGION = "eu-west-1";

    const creds = provider.getAWSCredentials();
    expect(creds.accessKeyId).toBe("AKIAIOSFODNN7EXAMPLE");
    expect(creds.secretAccessKey).toBe("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(creds.sessionToken).toBe("test-session-token");
    expect(creds.region).toBe("eu-west-1");
  });

  test("should check if has API key with credentials", () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    expect(provider.hasApiKey()).toBe(true);
  });

  test("should check if missing API key without credentials", () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    expect(provider.hasApiKey()).toBe(false);
  });

  test("should check if missing API key with only access key", () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    delete process.env.AWS_SECRET_ACCESS_KEY;
    expect(provider.hasApiKey()).toBe(false);
  });

  test("should build invoke endpoint URL", () => {
    process.env.AWS_REGION = "us-east-1";
    const url = provider.getEndpointUrl("bedrock-invoke");
    expect(url).toBe("https://bedrock-runtime.us-east-1.amazonaws.com/model/{modelId}/invoke");
  });

  test("should build streaming invoke endpoint URL", () => {
    process.env.AWS_REGION = "us-east-1";
    const url = provider.getEndpointUrl("bedrock-invoke-stream");
    expect(url).toBe("https://bedrock-runtime.us-east-1.amazonaws.com/model/{modelId}/invoke-with-response-stream");
  });

  test("should build converse endpoint URL", () => {
    process.env.AWS_REGION = "us-east-1";
    const url = provider.getEndpointUrl("bedrock-converse");
    expect(url).toBe("https://bedrock-runtime.us-east-1.amazonaws.com/model/{modelId}/converse");
  });

  test("should build streaming converse endpoint URL", () => {
    process.env.AWS_REGION = "us-east-1";
    const url = provider.getEndpointUrl("bedrock-converse-stream");
    expect(url).toBe("https://bedrock-runtime.us-east-1.amazonaws.com/model/{modelId}/converse-stream");
  });

  test("should return null for models URL", () => {
    expect(provider.getModelsUrl()).toBeNull();
  });

  test("should build request with model ID substitution", () => {
    process.env.AWS_REGION = "us-west-2";
    const request = provider.buildRequest(
      { model: "anthropic.claude-3-sonnet-20240229-v1:0", messages: [] },
      new Headers()
    );
    expect(request.url).toBe("https://bedrock-runtime.us-west-2.amazonaws.com/model/anthropic.claude-3-sonnet-20240229-v1:0/invoke");
    expect(request.headers["Content-Type"]).toBe("application/json");
  });

  test("should build request without model substitution if no model in body", () => {
    process.env.AWS_REGION = "us-west-2";
    const request = provider.buildRequest({ messages: [] }, new Headers());
    expect(request.url).toBe("https://bedrock-runtime.us-west-2.amazonaws.com/model/{modelId}/invoke");
  });
});
