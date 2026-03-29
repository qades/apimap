import { describe, test, expect } from "bun:test";
import {
  BUILTIN_PROVIDERS,
  TIER1_PROVIDERS,
  TIER2_PROVIDERS,
  TIER3_PROVIDERS,
  TIER4_LOCAL_PROVIDERS,
  TIER4_ENTERPRISE_PROVIDERS,
  TIER5_PROVIDERS,
} from "./builtin.ts";

describe("BUILTIN_PROVIDERS", () => {
  test("should have all providers defined", () => {
    const providerIds = Object.keys(BUILTIN_PROVIDERS);
    expect(providerIds.length).toBeGreaterThan(0);
    
    // Check that we have providers from all tiers
    expect(providerIds).toContain("openai");
    expect(providerIds).toContain("anthropic");
    expect(providerIds).toContain("google");
    expect(providerIds).toContain("azure");
    expect(providerIds).toContain("bedrock");
    expect(providerIds).toContain("groq");
    expect(providerIds).toContain("together");
    expect(providerIds).toContain("ollama");
  });

  test("should have correct provider structure", () => {
    const openai = BUILTIN_PROVIDERS.openai;
    expect(openai.id).toBe("openai");
    expect(openai.name).toBe("OpenAI");
    expect(openai.defaultBaseUrl).toBe("https://api.openai.com");
    expect(openai.defaultApiKeyEnv).toBe("OPENAI_API_KEY");
    expect(openai.authHeader).toBe("Authorization");
    expect(openai.authPrefix).toBe("Bearer ");
    expect(openai.supportsStreaming).toBe(true);
    expect(openai.requiresApiKey).toBe(true);
    expect(openai.category).toBe("cloud");
  });

  test("should have unique provider IDs", () => {
    const ids = Object.keys(BUILTIN_PROVIDERS);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).toBe(uniqueIds.length);
  });

  test("all providers should have required fields", () => {
    for (const [id, provider] of Object.entries(BUILTIN_PROVIDERS)) {
      expect(provider.id).toBe(id);
      expect(provider.name).toBeTruthy();
      expect(provider.description).toBeTruthy();
      expect(provider.defaultBaseUrl).toBeTruthy();
      expect(provider.authHeader).toBeTruthy();
      expect(typeof provider.supportsStreaming).toBe("boolean");
      expect(typeof provider.requiresApiKey).toBe("boolean");
      expect(["cloud", "local", "enterprise", "regional", "custom"]).toContain(provider.category);
    }
  });
});

describe("Tier 1: Core Providers", () => {
  test("should have all core providers", () => {
    expect(Object.keys(TIER1_PROVIDERS)).toContain("openai");
    expect(Object.keys(TIER1_PROVIDERS)).toContain("anthropic");
    expect(Object.keys(TIER1_PROVIDERS)).toContain("google");
    expect(Object.keys(TIER1_PROVIDERS)).toContain("azure");
    expect(Object.keys(TIER1_PROVIDERS)).toContain("bedrock");
  });

  test("core providers should have API key env vars", () => {
    for (const provider of Object.values(TIER1_PROVIDERS)) {
      if (provider.requiresApiKey) {
        expect(provider.defaultApiKeyEnv).toBeTruthy();
      }
    }
  });
});

describe("Tier 2: Major Players", () => {
  test("should have all major player providers", () => {
    expect(Object.keys(TIER2_PROVIDERS)).toContain("groq");
    expect(Object.keys(TIER2_PROVIDERS)).toContain("together");
    expect(Object.keys(TIER2_PROVIDERS)).toContain("fireworks");
    expect(Object.keys(TIER2_PROVIDERS)).toContain("mistral");
    expect(Object.keys(TIER2_PROVIDERS)).toContain("cohere");
    expect(Object.keys(TIER2_PROVIDERS)).toContain("deepseek");
  });

  test("all tier 2 providers should support streaming", () => {
    for (const provider of Object.values(TIER2_PROVIDERS)) {
      expect(provider.supportsStreaming).toBe(true);
    }
  });

  test("all tier 2 providers should be cloud category", () => {
    for (const provider of Object.values(TIER2_PROVIDERS)) {
      expect(provider.category).toBe("cloud");
    }
  });
});

describe("Tier 3: Ecosystem Providers", () => {
  test("should have ecosystem providers", () => {
    expect(Object.keys(TIER3_PROVIDERS)).toContain("openrouter");
    expect(Object.keys(TIER3_PROVIDERS)).toContain("perplexity");
    expect(Object.keys(TIER3_PROVIDERS)).toContain("ai21");
    expect(Object.keys(TIER3_PROVIDERS)).toContain("replicate");
    expect(Object.keys(TIER3_PROVIDERS)).toContain("huggingface");
    expect(Object.keys(TIER3_PROVIDERS)).toContain("octoai");
    expect(Object.keys(TIER3_PROVIDERS)).toContain("anyscale");
  });
});

describe("Tier 4: Local Providers", () => {
  test("should have local providers", () => {
    expect(Object.keys(TIER4_LOCAL_PROVIDERS)).toContain("ollama");
    expect(Object.keys(TIER4_LOCAL_PROVIDERS)).toContain("lmstudio");
    expect(Object.keys(TIER4_LOCAL_PROVIDERS)).toContain("llamacpp");
    expect(Object.keys(TIER4_LOCAL_PROVIDERS)).toContain("vllm");
    expect(Object.keys(TIER4_LOCAL_PROVIDERS)).toContain("localai");
    expect(Object.keys(TIER4_LOCAL_PROVIDERS)).toContain("tabbyapi");
    expect(Object.keys(TIER4_LOCAL_PROVIDERS)).toContain("textgenwebui");
    expect(Object.keys(TIER4_LOCAL_PROVIDERS)).toContain("koboldcpp");
  });

  test("local providers should not require API keys", () => {
    for (const provider of Object.values(TIER4_LOCAL_PROVIDERS)) {
      expect(provider.requiresApiKey).toBe(false);
      expect(provider.category).toBe("local");
    }
  });

  test("local providers should use correct URLs", () => {
    for (const provider of Object.values(TIER4_LOCAL_PROVIDERS)) {
      const url = provider.defaultBaseUrl;
      expect(url.startsWith("http://")).toBe(true);
      expect(url.includes("11434") || url.includes("1234") || url.includes("8080") || 
             url.includes("8000") || url.includes("5000") || url.includes("5001")).toBe(true);
    }
  });
});

describe("Tier 4: Enterprise Providers", () => {
  test("should have enterprise providers", () => {
    expect(Object.keys(TIER4_ENTERPRISE_PROVIDERS)).toContain("vertexai");
    expect(Object.keys(TIER4_ENTERPRISE_PROVIDERS)).toContain("watsonx");
    expect(Object.keys(TIER4_ENTERPRISE_PROVIDERS)).toContain("oracle");
  });

  test("enterprise providers should be in enterprise category", () => {
    for (const provider of Object.values(TIER4_ENTERPRISE_PROVIDERS)) {
      expect(provider.category).toBe("enterprise");
    }
  });

  test("enterprise providers should require API keys", () => {
    for (const provider of Object.values(TIER4_ENTERPRISE_PROVIDERS)) {
      expect(provider.requiresApiKey).toBe(true);
    }
  });
});

describe("Tier 5: Regional Providers", () => {
  test("should have regional providers", () => {
    expect(Object.keys(TIER5_PROVIDERS)).toContain("dashscope");
    expect(Object.keys(TIER5_PROVIDERS)).toContain("baidu");
    expect(Object.keys(TIER5_PROVIDERS)).toContain("tencent");
    expect(Object.keys(TIER5_PROVIDERS)).toContain("yandex");
    expect(Object.keys(TIER5_PROVIDERS)).toContain("hyperclova");
  });

  test("regional providers should be in regional category", () => {
    for (const provider of Object.values(TIER5_PROVIDERS)) {
      expect(provider.category).toBe("regional");
    }
  });

  test("yandex should use Api-Key prefix", () => {
    const yandex = TIER5_PROVIDERS.yandex;
    expect(yandex.authPrefix).toBe("Api-Key ");
  });

  test("tencent should not use auth prefix", () => {
    const tencent = TIER5_PROVIDERS.tencent;
    expect(tencent.authPrefix).toBe("");
  });
});

describe("Provider Categories", () => {
  test("should count providers by category", () => {
    const categories: Record<string, number> = {};
    
    for (const provider of Object.values(BUILTIN_PROVIDERS)) {
      categories[provider.category] = (categories[provider.category] || 0) + 1;
    }
    
    // We should have providers in each category
    expect(categories["cloud"]).toBeGreaterThan(0);
    expect(categories["local"]).toBeGreaterThan(0);
    expect(categories["enterprise"]).toBeGreaterThan(0);
    expect(categories["regional"]).toBeGreaterThan(0);
  });

  test("should have at least 34 total providers", () => {
    const count = Object.keys(BUILTIN_PROVIDERS).length;
    expect(count).toBeGreaterThanOrEqual(34);
  });
});
