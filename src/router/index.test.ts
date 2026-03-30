import { describe, test, expect, beforeEach } from "bun:test";
import { Router } from "./index.ts";
import type { RouteConfig } from "../types/index.ts";

describe("Router", () => {
  let router: Router;

  beforeEach(() => {
    router = new Router({
      routes: [],
    });
  });

  describe("matchPattern", () => {
    test("should match exact patterns", () => {
      const result = router.matchPattern("gpt-4", "gpt-4");
      expect(result.matched).toBe(true);
      expect(result.captures).toEqual([]);
    });

    test("should match wildcard * patterns", () => {
      const result = router.matchPattern("gpt-4-turbo", "gpt-4*");
      expect(result.matched).toBe(true);
      expect(result.captures).toEqual(["-turbo"]);
    });

    test("should match single character ? patterns", () => {
      const result = router.matchPattern("model-a", "model-?");
      expect(result.matched).toBe(true);
      expect(result.captures).toEqual(["a"]);
    });

    test("should match multiple wildcards", () => {
      const result = router.matchPattern("local/llama2/chat", "local/*/*");
      expect(result.matched).toBe(true);
      expect(result.captures).toEqual(["llama2", "chat"]);
    });

    test("should be case insensitive", () => {
      const result1 = router.matchPattern("GPT-4", "gpt-4");
      const result2 = router.matchPattern("gpt-4", "GPT-4");
      expect(result1.matched).toBe(true);
      expect(result2.matched).toBe(true);
    });

    test("should not match when pattern differs", () => {
      const result = router.matchPattern("claude-3", "gpt-4*");
      expect(result.matched).toBe(false);
      expect(result.captures).toEqual([]);
    });

    test("should escape special regex characters", () => {
      const result = router.matchPattern("model.v1", "model.v1");
      expect(result.matched).toBe(true);
    });
  });

  describe("applyTemplate", () => {
    test("should return original model when template is undefined", () => {
      const result = router.applyTemplate(undefined, "original-model", ["capture1"]);
      expect(result).toBe("original-model");
    });

    test("should substitute capture groups", () => {
      const result = router.applyTemplate("${1}", "original", ["capture1"]);
      expect(result).toBe("capture1");
    });

    test("should substitute multiple capture groups", () => {
      const result = router.applyTemplate("${1}/${2}", "original", ["a", "b"]);
      expect(result).toBe("a/b");
    });

    test("should keep placeholder for missing captures", () => {
      const result = router.applyTemplate("${1}/${2}", "original", ["a"]);
      expect(result).toBe("a/${2}");
    });
  });

  describe("findRoute", () => {
    test("should return null when no routes match", () => {
      router.setRoutes([
        { pattern: "gpt-4*", provider: "openai" },
      ]);
      const result = router.findRoute("claude-3");
      expect(result).toBeNull();
    });

    test("should find matching route", () => {
      router.setRoutes([
        { pattern: "gpt-4*", provider: "openai" },
      ]);
      const result = router.findRoute("gpt-4-turbo");
      expect(result).not.toBeNull();
      expect(result?.provider).toBe("openai");
      expect(result?.model).toBe("gpt-4-turbo");
    });

    test("should use catch-all * as fallback", () => {
      router.setRoutes([
        { pattern: "gpt-4*", provider: "openai" },
        { pattern: "*", provider: "ollama" },
      ]);
      const result = router.findRoute("unknown-model");
      expect(result).not.toBeNull();
      expect(result?.provider).toBe("ollama");
      expect(result?.model).toBe("unknown-model");
    });

    test("should match top-down (first match wins)", () => {
      router.setRoutes([
        { pattern: "gpt-4-turbo*", provider: "openai-turbo" },
        { pattern: "gpt-4*", provider: "openai" },
        { pattern: "*", provider: "fallback" },
      ]);

      const result = router.findRoute("gpt-4-turbo-preview");
      expect(result?.provider).toBe("openai-turbo");
    });

    test("should apply model template", () => {
      router.setRoutes([
        { pattern: "local/*", provider: "ollama", model: "${1}" },
      ]);
      const result = router.findRoute("local/llama2");
      expect(result?.provider).toBe("ollama");
      expect(result?.model).toBe("llama2");
    });
  });

  describe("canRoute", () => {
    test("should return true when route exists", () => {
      router.setRoutes([
        { pattern: "gpt-4*", provider: "openai" },
      ]);
      expect(router.canRoute("gpt-4")).toBe(true);
    });

    test("should return false when no route exists", () => {
      router.setRoutes([]);
      expect(router.canRoute("gpt-4")).toBe(false);
    });

    test("should return true when catch-all exists", () => {
      router.setRoutes([
        { pattern: "*", provider: "ollama" },
      ]);
      expect(router.canRoute("anything")).toBe(true);
    });
  });

  describe("addRoute", () => {
    test("should add new route", () => {
      router.addRoute({ pattern: "gpt-4*", provider: "openai" });
      expect(router.getRoutes().length).toBe(1);
      expect(router.getRoutes()[0].pattern).toBe("gpt-4*");
    });

    test("should replace existing route with same pattern", () => {
      router.addRoute({ pattern: "gpt-4*", provider: "openai" });
      router.addRoute({ pattern: "gpt-4*", provider: "anthropic" });
      expect(router.getRoutes().length).toBe(1);
      expect(router.getRoutes()[0].provider).toBe("anthropic");
    });

    test("should insert before catch-all", () => {
      router.setRoutes([
        { pattern: "gpt-4*", provider: "openai" },
        { pattern: "*", provider: "fallback" },
      ]);
      router.addRoute({ pattern: "claude-*", provider: "anthropic" });
      const routes = router.getRoutes();
      expect(routes.length).toBe(3);
      expect(routes[0].pattern).toBe("gpt-4*");
      expect(routes[1].pattern).toBe("claude-*");
      expect(routes[2].pattern).toBe("*");
    });
  });

  describe("removeRoute", () => {
    test("should remove route by pattern", () => {
      router.setRoutes([
        { pattern: "gpt-4*", provider: "openai" },
      ]);
      const removed = router.removeRoute("gpt-4*");
      expect(removed).toBe(true);
      expect(router.getRoutes().length).toBe(0);
    });

    test("should return false when pattern not found", () => {
      router.setRoutes([
        { pattern: "gpt-4*", provider: "openai" },
      ]);
      const removed = router.removeRoute("claude-3*");
      expect(removed).toBe(false);
      expect(router.getRoutes().length).toBe(1);
    });
  });

  describe("getStats", () => {
    test("should return correct stats", () => {
      router.setRoutes([
        { pattern: "gpt-4*", provider: "openai" },
        { pattern: "claude-3*", provider: "anthropic" },
        { pattern: "llama2*", provider: "ollama" },
      ]);

      const stats = router.getStats();
      expect(stats.totalRoutes).toBe(3);
      expect(stats.patterns).toContain("gpt-4*");
      expect(stats.patterns).toContain("claude-3*");
      expect(stats.providers).toContain("openai");
      expect(stats.providers).toContain("anthropic");
      expect(stats.providers).toContain("ollama");
    });
  });

  describe("testPattern", () => {
    test("should test pattern against sample models", () => {
      const results = router.testPattern("gpt-4*", [
        "gpt-4",
        "gpt-4-turbo",
        "gpt-3.5",
        "claude-3",
      ]);

      expect(results[0].matched).toBe(true);
      expect(results[0].captures).toEqual([""]);

      expect(results[1].matched).toBe(true);
      expect(results[1].captures).toEqual(["-turbo"]);

      expect(results[2].matched).toBe(false);
      expect(results[3].matched).toBe(false);
    });
  });

  describe("generateQueryableModels", () => {
    describe("single wildcard patterns", () => {
      test("should substitute target model into * wildcard", () => {
        const route: RouteConfig = { pattern: "oai/*", provider: "openai" };
        const targets = ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([
          "oai/gpt-4o",
          "oai/gpt-4-turbo",
          "oai/gpt-3.5-turbo",
        ]);
      });

      test("should substitute target model into ? wildcard", () => {
        const route: RouteConfig = { pattern: "gpt-?", provider: "openai" };
        const targets = ["4", "3", "5"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual(["gpt-4", "gpt-3", "gpt-5"]);
      });

      test("should handle pattern with text after wildcard", () => {
        const route: RouteConfig = { pattern: "model-*-latest", provider: "openai" };
        const targets = ["gpt4o", "claude3"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual(["model-gpt4o-latest", "model-claude3-latest"]);
      });

      test("should handle pattern with multiple text segments", () => {
        const route: RouteConfig = { pattern: "openai/gpt-*-turbo", provider: "openai" };
        const targets = ["4o", "4", "3.5"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([
          "openai/gpt-4o-turbo",
          "openai/gpt-4-turbo",
          "openai/gpt-3.5-turbo",
        ]);
      });
    });

    describe("multiple wildcard patterns", () => {
      test("should split target model by / for two * wildcards", () => {
        const route: RouteConfig = { pattern: "provider/*/*", provider: "ollama" };
        const targets = ["org/model1", "org/model2", "user/custom"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([
          "provider/org/model1",
          "provider/org/model2",
          "provider/user/custom",
        ]);
      });

      test("should split target model by - for two * wildcards", () => {
        const route: RouteConfig = { pattern: "local-*-*", provider: "ollama" };
        const targets = ["llama2-7b", "mistral-7b", "codellama-13b"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([
          "local-llama2-7b",
          "local-mistral-7b",
          "local-codellama-13b",
        ]);
      });

      test("should fallback to first wildcard if split fails", () => {
        const route: RouteConfig = { pattern: "a/*/*", provider: "test" };
        const targets = ["single"]; // Can't split into 2 parts
        
        const result = router.generateQueryableModels(route, targets);
        
        // Puts entire model in first wildcard, second becomes empty
        expect(result).toEqual(["a/single/"]);
      });
    });

    describe("patterns with model template", () => {
      test("should reverse-match simple template", () => {
        const route: RouteConfig = { 
          pattern: "local/*", 
          provider: "ollama",
          model: "${1}",
        };
        const targets = ["llama2", "mistral", "phi3"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([
          "local/llama2",
          "local/mistral",
          "local/phi3",
        ]);
      });

      test("should generate default model for exact template without placeholders", () => {
        // Route with exact model template (no ${N} placeholders)
        const route: RouteConfig = { 
          pattern: "gpt-4*", 
          provider: "openai",
          model: "gpt-4o",  // Exact model, no placeholders
        };
        // Target models from provider don't matter for exact templates
        const targets = ["any-model", "other-model"];
        
        const result = router.generateQueryableModels(route, targets);
        
        // Should return pattern with wildcards stripped
        expect(result).toEqual(["gpt-4"]);
      });

      test("should generate default model for exact template with single char wildcard", () => {
        const route: RouteConfig = { 
          pattern: "claude-?", 
          provider: "anthropic",
          model: "claude-3-opus-20240229",  // Exact model
        };
        const targets = ["irrelevant"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual(["claude-"]);
      });

      test("should generate default model for exact template with multiple wildcards", () => {
        const route: RouteConfig = { 
          pattern: "azure-*-gpt-*", 
          provider: "azure",
          model: "gpt-4o",  // Exact model
        };
        const targets = ["some-model"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual(["azure--gpt-"]);
      });

      test("should handle mix of exact and templated routes for same provider", () => {
        const exactRoute: RouteConfig = { 
          pattern: "fast-*", 
          provider: "openai",
          model: "gpt-4o-mini",  // Exact
        };
        const templatedRoute: RouteConfig = { 
          pattern: "custom/*", 
          provider: "openai",
          model: "${1}",  // With placeholder
        };
        
        const targets = ["gpt-4o", "gpt-4-turbo", "custom-model"];
        
        const exactResults = router.generateQueryableModels(exactRoute, targets);
        const templatedResults = router.generateQueryableModels(templatedRoute, targets);
        
        // Exact template generates default from pattern
        expect(exactResults).toEqual(["fast-"]);
        
        // Templated route matches against targets
        expect(templatedResults).toContain("custom/gpt-4o");
        expect(templatedResults).toContain("custom/gpt-4-turbo");
        expect(templatedResults).toContain("custom/custom-model");
      });

      test("should reverse-match template with suffix", () => {
        const route: RouteConfig = { 
          pattern: "my-*", 
          provider: "openai",
          model: "${1}-official",
        };
        // Target models from provider
        const targets = ["gpt4-official", "claude3-official", "other-model"];
        
        const result = router.generateQueryableModels(route, targets);
        
        // Only models matching the "*-official" pattern should match
        expect(result).toContain("my-gpt4");
        expect(result).toContain("my-claude3");
        // "other-model" doesn't match "*-official", so it shouldn't be included
      });

      test("should reverse-match template with prefix and suffix", () => {
        const route: RouteConfig = { 
          pattern: "prefix-*-suffix", 
          provider: "test",
          model: "org/${1}/model",
        };
        const targets = [
          "org/gpt4/model",
          "org/claude3/model", 
          "org/llama2/model",
          "unrelated/model", // Should not match
        ];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toContain("prefix-gpt4-suffix");
        expect(result).toContain("prefix-claude3-suffix");
        expect(result).toContain("prefix-llama2-suffix");
        expect(result).not.toContain("prefix-unrelated/model-suffix");
      });

      test("should handle multi-capture template", () => {
        const route: RouteConfig = { 
          pattern: "*/*", 
          provider: "test",
          model: "${1}/${2}",
        };
        const targets = ["org/model1", "org/model2"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual(["org/model1", "org/model2"]);
      });

      test("should handle template with literal parts", () => {
        const route: RouteConfig = { 
          pattern: "azure-*", 
          provider: "azure",
          model: "gpt-${1}",
        };
        const targets = ["gpt-4o", "gpt-4-turbo", "claude-3"];
        
        const result = router.generateQueryableModels(route, targets);
        
        // Only gpt- models should match
        expect(result).toContain("azure-4o");
        expect(result).toContain("azure-4-turbo");
        // "claude-3" doesn't match "gpt-${1}" pattern
      });
    });

    describe("exact patterns (no wildcards)", () => {
      test("should only include exact matches", () => {
        const route: RouteConfig = { 
          pattern: "gpt-4o", 
          provider: "openai",
        };
        const targets = ["gpt-4o", "gpt-4-turbo", "claude-3"];
        
        const result = router.generateQueryableModels(route, targets);
        
        // Only exact match should be returned
        expect(result).toEqual(["gpt-4o"]);
      });

      test("should return empty array when no exact match", () => {
        const route: RouteConfig = { 
          pattern: "specific-model", 
          provider: "openai",
        };
        const targets = ["other-model", "another-model"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([]);
      });

      test("should only return pattern if exact model template exists on provider", () => {
        // This is the "test" -> "MARTHA-0.8B-Q4_K_M" case
        const route: RouteConfig = { 
          pattern: "test", 
          provider: "llamacpp",
          model: "MARTHA-0.8B-Q4_K_M",  // Exact model, no placeholders
        };
        
        // Case 1: Provider doesn't have the model - pattern should NOT be returned
        const targetsWithout = ["llama2", "mistral", "codellama"];
        const resultWithout = router.generateQueryableModels(route, targetsWithout);
        expect(resultWithout).toEqual([]);
        
        // Case 2: Provider has the model - pattern SHOULD be returned
        const targetsWith = ["llama2", "MARTHA-0.8B-Q4_K_M", "codellama"];
        const resultWith = router.generateQueryableModels(route, targetsWith);
        expect(resultWith).toEqual(["test"]);
      });
    });

    describe("edge cases and deduplication", () => {
      test("should deduplicate results", () => {
        const route: RouteConfig = { pattern: "shared/*", provider: "test" };
        const targets = ["model", "model", "model"]; // Duplicates in input
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual(["shared/model"]);
      });

      test("should handle empty target models", () => {
        const route: RouteConfig = { pattern: "test/*", provider: "test" };
        const targets: string[] = [];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([]);
      });

      test("should handle catch-all pattern", () => {
        const route: RouteConfig = { pattern: "*", provider: "fallback" };
        const targets = ["any-model", "another-model"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual(["any-model", "another-model"]);
      });

      test("should handle pattern with only wildcards", () => {
        // Note: Pattern "***" (consecutive wildcards) is degenerate - 
        // there's no delimiter to distinguish captures. The behavior is
        // to concatenate captures, which is acceptable for this edge case.
        const route: RouteConfig = { pattern: "***", provider: "test" };
        const targets = ["abc", "xyz"];
        
        const result = router.generateQueryableModels(route, targets);
        
        // Without delimiters, captures get concatenated
        expect(result).toEqual(["abc", "xyz"]);
      });

      test("should be case preserving", () => {
        const route: RouteConfig = { pattern: "provider/*", provider: "test" };
        const targets = ["GPT-4o", "Claude-3-Opus", "LLaMA-2"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([
          "provider/GPT-4o",
          "provider/Claude-3-Opus",
          "provider/LLaMA-2",
        ]);
      });
    });

    describe("real-world scenarios", () => {
      test("OpenAI with oai/* prefix route", () => {
        const route: RouteConfig = { pattern: "oai/*", provider: "openai" };
        const targets = ["gpt-4o", "gpt-4-turbo", "gpt-4o-mini", "gpt-3.5-turbo"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([
          "oai/gpt-4o",
          "oai/gpt-4-turbo",
          "oai/gpt-4o-mini",
          "oai/gpt-3.5-turbo",
        ]);
      });

      test("Ollama with local/* route", () => {
        const route: RouteConfig = { 
          pattern: "local/*", 
          provider: "ollama",
          model: "${1}",
        };
        const targets = ["llama2", "mistral", "codellama", "phi3"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([
          "local/llama2",
          "local/mistral",
          "local/codellama",
          "local/phi3",
        ]);
      });

      test("Anthropic with claude/* prefix", () => {
        const route: RouteConfig = { pattern: "claude/*", provider: "anthropic" };
        const targets = [
          "claude-3-opus-20240229",
          "claude-3-sonnet-20240229",
          "claude-3-haiku-20240307",
        ];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([
          "claude/claude-3-opus-20240229",
          "claude/claude-3-sonnet-20240229",
          "claude/claude-3-haiku-20240307",
        ]);
      });

      test("Complex nested provider pattern", () => {
        const route: RouteConfig = { pattern: "azure/openai/*", provider: "azure-openai" };
        const targets = ["gpt-4", "gpt-35-turbo"];
        
        const result = router.generateQueryableModels(route, targets);
        
        expect(result).toEqual([
          "azure/openai/gpt-4",
          "azure/openai/gpt-35-turbo",
        ]);
      });

      test("Multiple routes with same provider - different prefixes", () => {
        const routes: RouteConfig[] = [
          { pattern: "fast/*", provider: "openai", model: "gpt-${1}" },
          { pattern: "smart/*", provider: "openai", model: "gpt-${1}" },
        ];
        const targets = ["gpt-4o", "gpt-3.5-turbo"];

        // Both routes should generate queryable models
        const fastResults = router.generateQueryableModels(routes[0], targets);
        const smartResults = router.generateQueryableModels(routes[1], targets);

        // With template "gpt-${1}", targets "gpt-4o" and "gpt-3.5-turbo" 
        // should match and produce "fast/4o", "fast/3.5-turbo", etc.
        expect(fastResults).toContain("fast/4o");
        expect(fastResults).toContain("fast/3.5-turbo");
        expect(smartResults).toContain("smart/4o");
        expect(smartResults).toContain("smart/3.5-turbo");
      });
    });
  });
});
