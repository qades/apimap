import { describe, test, expect, beforeEach } from "bun:test";
import { CohereProvider } from "./cohere.ts";
import type { ProviderConfig } from "../../types/index.ts";

describe("CohereProvider", () => {
  let provider: CohereProvider;
  const config: ProviderConfig = {
    baseUrl: "https://api.cohere.ai",
    apiKey: "test-cohere-key",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    timeout: 120,
  };

  beforeEach(() => {
    provider = new CohereProvider("cohere", config);
  });

  test("should return correct base URL", () => {
    expect(provider.getBaseUrl()).toBe("https://api.cohere.ai");
  });

  test("should use Bearer token auth", () => {
    const headers = provider.getHeaders();
    expect(headers["Authorization"]).toBe("Bearer test-cohere-key");
  });

  test("should build chat endpoint URL", () => {
    const url = provider.getEndpointUrl("cohere-chat");
    expect(url).toBe("https://api.cohere.ai/v1/chat");
  });

  test("should build generate endpoint URL", () => {
    const url = provider.getEndpointUrl("cohere-generate");
    expect(url).toBe("https://api.cohere.ai/v1/generate");
  });

  test("should build embed endpoint URL", () => {
    const url = provider.getEndpointUrl("cohere-embed");
    expect(url).toBe("https://api.cohere.ai/v1/embed");
  });

  test("should build rerank endpoint URL", () => {
    const url = provider.getEndpointUrl("cohere-rerank");
    expect(url).toBe("https://api.cohere.ai/v1/rerank");
  });

  test("should default to chat endpoint", () => {
    const url = provider.getEndpointUrl("unknown");
    expect(url).toBe("https://api.cohere.ai/v1/chat");
  });

  test("should build request correctly", () => {
    const request = provider.buildRequest(
      { model: "command-r", message: "Hello" },
      new Headers()
    );
    expect(request.url).toBe("https://api.cohere.ai/v1/chat");
    expect(request.headers["Authorization"]).toBe("Bearer test-cohere-key");
    expect(request.headers["Content-Type"]).toBe("application/json");
  });

  test("should return models URL", () => {
    const url = provider.getModelsUrl();
    expect(url).toBe("https://api.cohere.ai/v1/models");
  });

  test("should support streaming", () => {
    expect(provider.supportsStreaming()).toBe(true);
  });

  test("should validate configuration", () => {
    const errors = provider.validate();
    expect(errors.length).toBe(0);
  });

  test("should detect missing baseUrl in validation", () => {
    const invalidProvider = new CohereProvider("cohere", {
      baseUrl: "",
    });
    const errors = invalidProvider.validate();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("baseUrl is required");
  });
});
