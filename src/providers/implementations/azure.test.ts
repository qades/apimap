import { describe, test, expect, beforeEach } from "bun:test";
import { AzureProvider } from "./azure.ts";
import type { ProviderConfig } from "../../types/index.ts";

describe("AzureProvider", () => {
  let provider: AzureProvider;
  const config: ProviderConfig = {
    baseUrl: "https://my-resource.openai.azure.com/openai/deployments/my-deployment",
    apiKey: "test-azure-key",
    authHeader: "api-key",
    supportsStreaming: true,
    timeout: 120,
  };

  beforeEach(() => {
    provider = new AzureProvider("azure", config);
  });

  test("should return correct base URL", () => {
    expect(provider.getBaseUrl()).toBe("https://my-resource.openai.azure.com/openai/deployments/my-deployment");
  });

  test("should use api-key header instead of Authorization", () => {
    const headers = provider.getHeaders();
    expect(headers["api-key"]).toBe("test-azure-key");
    expect(headers["Authorization"]).toBeUndefined();
  });

  test("should return api-key in auth headers", () => {
    const authHeaders = provider.getAuthHeaders();
    expect(authHeaders).toEqual({ "api-key": "test-azure-key" });
  });

  test("should build chat completions URL with API version", () => {
    const url = provider.getEndpointUrl("openai-chat");
    expect(url).toBe("https://my-resource.openai.azure.com/openai/deployments/my-deployment/chat/completions?api-version=2024-06-01");
  });

  test("should build completions URL with API version", () => {
    const url = provider.getEndpointUrl("openai-completions");
    expect(url).toBe("https://my-resource.openai.azure.com/openai/deployments/my-deployment/completions?api-version=2024-06-01");
  });

  test("should build responses URL with preview API version", () => {
    const url = provider.getEndpointUrl("openai-responses");
    expect(url).toBe("https://my-resource.openai.azure.com/openai/deployments/my-deployment/responses?api-version=2024-12-01-preview");
  });

  test("should use custom API version from headers", () => {
    const customProvider = new AzureProvider("azure", {
      ...config,
      headers: { "api-version": "2024-02-01" },
    });
    const url = customProvider.getEndpointUrl("openai-chat");
    expect(url).toContain("api-version=2024-02-01");
  });

  test("should build request correctly", () => {
    const request = provider.buildRequest({ model: "gpt-4", messages: [] }, new Headers());
    expect(request.url).toContain("chat/completions");
    expect(request.headers["api-key"]).toBe("test-azure-key");
    expect(request.headers["Content-Type"]).toBe("application/json");
  });

  test("should return models URL with API version", () => {
    const url = provider.getModelsUrl();
    expect(url).toBe("https://my-resource.openai.azure.com/openai/deployments/my-deployment/models?api-version=2024-06-01");
  });

  test("should check API key correctly", () => {
    expect(provider.hasApiKey()).toBe(true);
    
    const noKeyProvider = new AzureProvider("azure", {
      baseUrl: "https://test.openai.azure.com",
    });
    expect(noKeyProvider.hasApiKey()).toBe(false);
  });
});
