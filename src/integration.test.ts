import { describe, test, expect } from "bun:test";
import { Router } from "./router/index.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { parseRequest, toProviderRequest } from "./transformers/index.ts";
import type { OpenAIRequest, AnthropicRequest, RouterConfig } from "./types/index.ts";

describe("Integration Tests", () => {
  describe("End-to-end request flow", () => {
    test("should route OpenAI request to OpenAI-compatible provider", () => {
      // Setup router
      const router = new Router({
        routes: [
          { pattern: "gpt-4*", provider: "openai" },
        ],
      });

      // Setup providers
      const registry = new ProviderRegistry();
      registry.initializeFromConfig({
        openai: { baseUrl: "https://api.openai.com/v1" },
      });

      // Parse incoming OpenAI request
      const openaiReq: OpenAIRequest = {
        model: "gpt-4-turbo",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
      };

      const internalReq = parseRequest("openai", openaiReq, {
        sourceFormat: "openai",
        endpoint: "/v1/chat/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      // Find route
      const route = router.findRoute(internalReq.model);
      expect(route).not.toBeNull();
      expect(route?.provider).toBe("openai");

      // Get provider and transform
      const provider = registry.get(route!.provider);
      expect(provider).toBeDefined();

      internalReq.targetModel = route!.model;

      // Transform to provider format
      const providerReq = toProviderRequest("openai", internalReq);
      expect(providerReq.model).toBe("gpt-4-turbo");
    });

    test("should route Anthropic request to OpenAI provider", () => {
      const router = new Router({
        routes: [
          { pattern: "claude-3*", provider: "openai", model: "gpt-4" },
        ],
      });

      const registry = new ProviderRegistry();
      registry.initializeFromConfig({
        openai: { baseUrl: "https://api.openai.com/v1" },
      });

      // Parse incoming Anthropic request
      const anthropicReq: AnthropicRequest = {
        model: "claude-3-opus",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
      };

      const internalReq = parseRequest("anthropic", anthropicReq, {
        sourceFormat: "anthropic",
        endpoint: "/v1/messages",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      // Find route
      const route = router.findRoute(internalReq.model);
      expect(route?.provider).toBe("openai");
      expect(route?.model).toBe("gpt-4");

      internalReq.targetModel = route!.model;

      // Transform to OpenAI format
      const openaiReq = toProviderRequest("openai", internalReq);
      expect(openaiReq.model).toBe("gpt-4");
      expect(openaiReq.max_tokens).toBe(1024);
    });

    test("should handle wildcard pattern with capture", () => {
      const router = new Router({
        routes: [
          { pattern: "local/*", provider: "ollama", model: "${1}" },
        ],
      });

      const registry = new ProviderRegistry();
      registry.initializeFromConfig({
        ollama: { baseUrl: "http://localhost:11434" },
      });

      const openaiReq: OpenAIRequest = {
        model: "local/llama2:13b",
        messages: [{ role: "user", content: "Hello" }],
      };

      const internalReq = parseRequest("openai", openaiReq, {
        sourceFormat: "openai",
        endpoint: "/v1/chat/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      const route = router.findRoute(internalReq.model);
      expect(route?.provider).toBe("ollama");
      expect(route?.model).toBe("llama2:13b");
    });

    test("should use catch-all * as fallback when no specific route matches", () => {
      const router = new Router({
        routes: [
          { pattern: "*", provider: "openai" },
        ],
      });

      const route = router.findRoute("unknown-model");
      expect(route?.provider).toBe("openai");
      expect(route?.model).toBe("unknown-model");
    });

    test("should handle complex multi-provider setup", () => {
      const router = new Router({
        routes: [
          { pattern: "claude-3*", provider: "anthropic" },
          { pattern: "gpt-4*", provider: "openai" },
          { pattern: "gpt-3.5*", provider: "openai" },
          { pattern: "local/*", provider: "ollama", model: "${1}" },
          { pattern: "*", provider: "groq" },
        ],
      });

      const registry = new ProviderRegistry();
      registry.initializeFromConfig({
        openai: { baseUrl: "https://api.openai.com/v1" },
        anthropic: { baseUrl: "https://api.anthropic.com" },
        ollama: { baseUrl: "http://localhost:11434" },
        groq: { baseUrl: "https://api.groq.com/openai/v1" },
      });

      // Test various models
      const testCases = [
        { model: "claude-3-opus", expectedProvider: "anthropic", expectedModel: "claude-3-opus" },
        { model: "gpt-4-turbo", expectedProvider: "openai", expectedModel: "gpt-4-turbo" },
        { model: "gpt-3.5-turbo", expectedProvider: "openai", expectedModel: "gpt-3.5-turbo" },
        { model: "local/mistral", expectedProvider: "ollama", expectedModel: "mistral" },
        { model: "mixtral-8x7b", expectedProvider: "groq", expectedModel: "mixtral-8x7b" },
      ];

      for (const tc of testCases) {
        const route = router.findRoute(tc.model);
        expect(route?.provider).toBe(tc.expectedProvider);
        expect(route?.model).toBe(tc.expectedModel);
      }
    });
  });

  describe("Configuration initialization", () => {
    test("should initialize full system from config", () => {
      const config: RouterConfig = {
        server: { port: 3000 },
        logging: { dir: "./logs" },
        providers: {
          openai: { baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
          anthropic: { baseUrl: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY" },
        },
        routes: [
          { pattern: "claude-3*", provider: "anthropic" },
          { pattern: "gpt-4*", provider: "openai" },
          { pattern: "*", provider: "openai" },
        ],
      };

      // Initialize router (top-down matching)
      const router = new Router({
        routes: config.routes,
      });

      // Initialize providers
      const registry = new ProviderRegistry();
      registry.initializeFromConfig(config.providers);

      // Verify router
      expect(router.findRoute("claude-3-opus")?.provider).toBe("anthropic");
      expect(router.findRoute("gpt-4-turbo")?.provider).toBe("openai");
      expect(router.findRoute("unknown")?.provider).toBe("openai");

      // Verify providers
      expect(registry.has("openai")).toBe(true);
      expect(registry.has("anthropic")).toBe(true);
      expect(registry.get("openai")?.getBaseUrl()).toBe("https://api.openai.com/v1");
    });
  });
});
