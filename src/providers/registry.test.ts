import { describe, test, expect, beforeEach } from "bun:test";
import { ProviderRegistry, BUILTIN_PROVIDERS } from "./registry.ts";
import type { ProviderConfig } from "../types/index.ts";

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  test("should have built-in providers defined", () => {
    expect(Object.keys(BUILTIN_PROVIDERS).length).toBeGreaterThan(0);
    expect(BUILTIN_PROVIDERS.openai).toBeDefined();
    expect(BUILTIN_PROVIDERS.anthropic).toBeDefined();
    expect(BUILTIN_PROVIDERS.ollama).toBeDefined();
  });

  test("should register a provider", () => {
    registry.register("test", {
      baseUrl: "https://api.test.com",
      apiKey: "test-key",
    });

    expect(registry.has("test")).toBe(true);
    expect(registry.get("test")).toBeDefined();
  });

  test("should unregister a provider", () => {
    registry.register("test", { baseUrl: "https://api.test.com" });
    const removed = registry.unregister("test");
    
    expect(removed).toBe(true);
    expect(registry.has("test")).toBe(false);
  });

  test("should return undefined for unknown provider", () => {
    expect(registry.get("unknown")).toBeUndefined();
  });

  test("should get all registered provider IDs", () => {
    registry.register("test1", { baseUrl: "https://api1.com" });
    registry.register("test2", { baseUrl: "https://api2.com" });
    
    const ids = registry.getIds();
    expect(ids).toContain("test1");
    expect(ids).toContain("test2");
  });

  test("should initialize from config", () => {
    const config: Record<string, ProviderConfig> = {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "custom-key",
        timeout: 180,
      },
      custom: {
        baseUrl: "https://api.custom.com",
        apiKey: "custom-key",
      },
    };

    registry.initializeFromConfig(config);

    expect(registry.has("openai")).toBe(true);
    expect(registry.has("custom")).toBe(true);
    
    const openai = registry.get("openai");
    expect(openai?.getBaseUrl()).toBe("https://api.openai.com/v1");
    expect(openai?.getApiKey()).toBe("custom-key");
  });

  test("should merge with defaults when initializing", () => {
    const config: Record<string, ProviderConfig> = {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        timeout: 300,
      },
    };

    registry.initializeFromConfig(config);
    
    const openai = registry.get("openai");
    // Should use default auth header since not specified
    const headers = openai?.getAuthHeaders();
    // No API key provided, so no auth header
    expect(Object.keys(headers || {}).length).toBe(0);
  });

  test("should get built-in provider infos", () => {
    const infos = registry.getBuiltinProviderInfos();
    expect(infos.length).toBe(Object.keys(BUILTIN_PROVIDERS).length);
    
    const openaiInfo = infos.find(i => i.id === "openai");
    expect(openaiInfo).toBeDefined();
    expect(openaiInfo?.name).toBe("OpenAI");
    expect(openaiInfo?.category).toBe("cloud");
  });

  test("should get registered provider infos", () => {
    registry.initializeFromConfig({
      openai: { baseUrl: "https://api.openai.com/v1", apiKey: "test" },
      ollama: { baseUrl: "http://localhost:11434" },
    });

    const infos = registry.getRegisteredProviderInfos();
    
    const openaiInfo = infos.find(i => i.id === "openai");
    expect(openaiInfo?.configured).toBe(true);
    
    const ollamaInfo = infos.find(i => i.id === "ollama");
    expect(ollamaInfo?.configured).toBe(true); // Local providers don't require keys
  });

  test("should create default config for built-in provider", () => {
    const config = registry.createDefaultConfig("openai");
    expect(config).toBeDefined();
    expect(config?.baseUrl).toBe("https://api.openai.com/v1");
    expect(config?.apiKeyEnv).toBe("OPENAI_API_KEY");
  });

  test("should return null for unknown provider default config", () => {
    const config = registry.createDefaultConfig("unknown");
    expect(config).toBeNull();
  });

  test("should handle multiple providers of same type", () => {
    // Register multiple openai-compatible providers
    registry.register("openai-us", {
      baseUrl: "https://us.api.openai.com",
      apiKey: "us-key",
    });
    registry.register("openai-eu", {
      baseUrl: "https://eu.api.openai.com",
      apiKey: "eu-key",
    });

    expect(registry.get("openai-us")?.getBaseUrl()).toBe("https://us.api.openai.com");
    expect(registry.get("openai-eu")?.getBaseUrl()).toBe("https://eu.api.openai.com");
  });
});
