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
});
