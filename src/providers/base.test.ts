import { describe, test, expect, beforeEach } from "bun:test";
import {
  OpenAICompatibleProvider,
  AnthropicProvider,
  GoogleProvider,
  OllamaProvider,
} from "./implementations/index.ts";
import type { ProviderConfig } from "../types/index.ts";

describe("BaseProvider", () => {
  describe("OpenAICompatibleProvider", () => {
    let provider: OpenAICompatibleProvider;
    const config: ProviderConfig = {
      baseUrl: "https://api.openai.com",
      apiKey: "test-api-key",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      supportsStreaming: true,
      timeout: 120,
    };

    beforeEach(() => {
      provider = new OpenAICompatibleProvider("openai", config);
    });

    test("should return correct base URL", () => {
      expect(provider.getBaseUrl()).toBe("https://api.openai.com");
    });

    test("should return API key from config", () => {
      expect(provider.getApiKey()).toBe("test-api-key");
    });

    test("should check if API key exists", () => {
      expect(provider.hasApiKey()).toBe(true);
      
      const noKeyProvider = new OpenAICompatibleProvider("test", {
        baseUrl: "http://localhost",
      });
      expect(noKeyProvider.hasApiKey()).toBe(false);
    });

    test("should return auth headers", () => {
      const headers = provider.getAuthHeaders();
      expect(headers).toEqual({
        Authorization: "Bearer test-api-key",
      });
    });

    test("should return all headers", () => {
      const headers = provider.getHeaders();
      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer test-api-key",
      });
    });

    test("should return timeout in ms", () => {
      expect(provider.getTimeoutMs()).toBe(120000);
      expect(provider.getTimeoutMs(60)).toBe(120000);
      
      const customTimeout = new OpenAICompatibleProvider("test", {
        baseUrl: "http://localhost",
        timeout: 60,
      });
      expect(customTimeout.getTimeoutMs(120)).toBe(60000);
    });

    test("should return chat completions URL", () => {
      expect(provider.getChatCompletionsUrl()).toBe("https://api.openai.com/v1/chat/completions");
    });

    test("should build request correctly", () => {
      const request = provider.buildRequest({ model: "gpt-4", messages: [] }, new Headers());
      expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
      expect(request.headers["Content-Type"]).toBe("application/json");
      expect(request.headers["Authorization"]).toBe("Bearer test-api-key");
      expect(request.body).toEqual({ model: "gpt-4", messages: [] });
    });

    test("should support streaming by default", () => {
      expect(provider.supportsStreaming()).toBe(true);
    });

    test("should return provider info", () => {
      const info = provider.getInfo();
      expect(info.id).toBe("openai");
      expect(info.baseUrl).toBe("https://api.openai.com");
      expect(info.hasApiKey).toBe(true);
      expect(info.supportsStreaming).toBe(true);
      expect(info.timeout).toBe(120);
    });
  });

  describe("AnthropicProvider", () => {
    let provider: AnthropicProvider;
    const config: ProviderConfig = {
      baseUrl: "https://api.anthropic.com",
      apiKey: "test-ant-api-key",
      authHeader: "x-api-key",
      supportsStreaming: true,
    };

    beforeEach(() => {
      provider = new AnthropicProvider("anthropic", config);
    });

    test("should use x-api-key header", () => {
      const headers = provider.getAuthHeaders();
      expect(headers).toEqual({
        "x-api-key": "test-ant-api-key",
      });
    });

    test("should return anthropic-specific headers", () => {
      const headers = provider.getHeaders();
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["x-api-key"]).toBe("test-ant-api-key");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
    });

    test("should use /v1/messages endpoint", () => {
      expect(provider.getChatCompletionsUrl()).toBe("https://api.anthropic.com/v1/messages");
    });

    test("should build request with anthropic headers", () => {
      const request = provider.buildRequest({ model: "claude-3", messages: [] }, new Headers());
      expect(request.url).toBe("https://api.anthropic.com/v1/messages");
      expect(request.headers["x-api-key"]).toBe("test-ant-api-key");
      expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    });
  });

  describe("GoogleProvider", () => {
    let provider: GoogleProvider;
    const config: ProviderConfig = {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "test-google-key",
      authHeader: "x-goog-api-key",
    };

    beforeEach(() => {
      provider = new GoogleProvider("google", config);
    });

    test("should include API key in URL", () => {
      const request = provider.buildRequest({ model: "gemini-pro" }, new Headers());
      expect(request.url).toContain("?key=test-google-key");
    });

    test("should not include API key in headers", () => {
      const request = provider.buildRequest({ model: "gemini-pro" }, new Headers());
      expect(request.headers["x-goog-api-key"]).toBeUndefined();
    });
  });

  describe("OllamaProvider", () => {
    let provider: OllamaProvider;
    const config: ProviderConfig = {
      baseUrl: "http://localhost:11434",
      supportsStreaming: true,
    };

    beforeEach(() => {
      provider = new OllamaProvider("ollama", config);
    });

    test("should use /api/chat endpoint", () => {
      const request = provider.buildRequest({ model: "llama2" }, new Headers());
      expect(request.url).toBe("http://localhost:11434/api/chat");
    });

    test("should not require API key", () => {
      expect(provider.hasApiKey()).toBe(true); // Ollama returns true by default
    });

    test("should have no auth headers", () => {
      const headers = provider.getAuthHeaders();
      expect(Object.keys(headers).length).toBe(0);
    });
  });
});
