import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { LoggingManager } from "./index.ts";
import { existsSync } from "fs";
import { mkdir, rmdir, unlink, readdir } from "fs/promises";
import { join } from "path";
import type { LogEntry } from "../types/index.ts";

describe("LoggingManager", () => {
  const testLogDir = "/tmp/apimap-test-logs";
  let manager: LoggingManager;

  beforeEach(async () => {
    if (existsSync(testLogDir)) {
      await rmdir(testLogDir, { recursive: true });
    }
    await mkdir(testLogDir, { recursive: true });
    manager = new LoggingManager(testLogDir, true);
    await manager.initialize();
  });

  afterEach(async () => {
    if (existsSync(testLogDir)) {
      await rmdir(testLogDir, { recursive: true });
    }
  });

  describe("initialize", () => {
    test("should create log directory if not exists", async () => {
      const newDir = "/tmp/apimap-test-logs-new";
      if (existsSync(newDir)) {
        await rmdir(newDir, { recursive: true });
      }

      const newManager = new LoggingManager(newDir);
      await newManager.initialize();

      expect(existsSync(newDir)).toBe(true);

      // Cleanup
      await rmdir(newDir, { recursive: true });
    });
  });

  describe("log", () => {
    test("should log entry and emit event", async () => {
      let receivedEntry: LogEntry | null = null;
      manager.on("request", (entry: LogEntry) => {
        receivedEntry = entry;
      });

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: "req-123",
        method: "POST",
        path: "/v1/chat/completions",
        sourceScheme: "openai",
        targetScheme: "openai",
        provider: "openai",
        model: "gpt-4",
        targetModel: "gpt-4",
        requestHeaders: {},
        responseStatus: 200,
        durationMs: 100,
        routed: true,
      };

      await manager.log(entry);

      expect(receivedEntry).not.toBeNull();
      expect(receivedEntry?.requestId).toBe("req-123");
    });

    test("should capture unrouted requests", async () => {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: "req-456",
        method: "POST",
        path: "/v1/chat/completions",
        sourceScheme: "openai",
        targetScheme: "none",
        provider: "none",
        model: "unknown-model",
        targetModel: "unknown-model",
        requestHeaders: {},
        responseStatus: 404,
        durationMs: 10,
        routed: false,
      };

      await manager.log(entry);

      const unrouted = manager.getUnroutedRequests();
      expect(unrouted.length).toBe(1);
      expect(unrouted[0].model).toBe("unknown-model");
    });

    test("should emit unrouted event", async () => {
      let unroutedModel: string | null = null;
      manager.on("unrouted", (req) => {
        unroutedModel = req.model;
      });

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: "req-789",
        method: "POST",
        path: "/v1/chat/completions",
        sourceScheme: "openai",
        targetScheme: "none",
        provider: "none",
        model: "test-model",
        targetModel: "test-model",
        requestHeaders: {},
        responseStatus: 404,
        durationMs: 10,
        routed: false,
      };

      await manager.log(entry);

      expect(unroutedModel).toBe("test-model");
    });

    test("should mask sensitive headers", async () => {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: "req-mask",
        method: "POST",
        path: "/v1/chat/completions",
        sourceScheme: "openai",
        targetScheme: "openai",
        provider: "openai",
        model: "gpt-4",
        targetModel: "gpt-4",
        requestHeaders: {
          authorization: "Bearer sk-1234567890abcdef",
          "x-api-key": "secret-key-12345",
          "content-type": "application/json",
        },
        responseStatus: 200,
        durationMs: 100,
        routed: true,
      };

      let loggedEntry: LogEntry | null = null;
      manager.on("request", (e: LogEntry) => {
        loggedEntry = e;
      });

      await manager.log(entry);

      // Headers should be masked (format: first4...last4 for values > 10 chars)
      expect(loggedEntry?.requestHeaders.authorization).toContain("...");
      expect(loggedEntry?.requestHeaders["x-api-key"]).toContain("...");
      // Non-sensitive headers should not be masked
      expect(loggedEntry?.requestHeaders["content-type"]).toBe("application/json");
    });

    test("should not mask when maskKeys is false", async () => {
      const unmaskedManager = new LoggingManager(testLogDir, false);
      await unmaskedManager.initialize();

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: "req-unmask",
        method: "POST",
        path: "/v1/chat/completions",
        sourceScheme: "openai",
        targetScheme: "openai",
        provider: "openai",
        model: "gpt-4",
        targetModel: "gpt-4",
        requestHeaders: {
          authorization: "Bearer sk-secret",
        },
        responseStatus: 200,
        durationMs: 100,
        routed: true,
      };

      let loggedEntry: LogEntry | null = null;
      unmaskedManager.on("request", (e: LogEntry) => {
        loggedEntry = e;
      });

      await unmaskedManager.log(entry);

      expect(loggedEntry?.requestHeaders.authorization).toBe("Bearer sk-secret");
    });
  });

  describe("getUnroutedRequests", () => {
    test("should return copy of unrouted requests array", async () => {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: "req-1",
        method: "POST",
        path: "/v1/chat/completions",
        sourceScheme: "openai",
        targetScheme: "none",
        provider: "none",
        model: "model-1",
        targetModel: "model-1",
        requestHeaders: {},
        responseStatus: 404,
        durationMs: 10,
        routed: false,
      };

      await manager.log(entry);

      const unrouted = manager.getUnroutedRequests();
      // Modifying the returned array should not affect internal state
      unrouted.pop();

      const unroutedAgain = manager.getUnroutedRequests();
      expect(unroutedAgain.length).toBe(1);
      expect(unroutedAgain[0].model).toBe("model-1");
    });

    test("should limit stored unrouted requests", async () => {
      // Add more than 100 unrouted requests
      for (let i = 0; i < 110; i++) {
        const entry: LogEntry = {
          timestamp: new Date().toISOString(),
          requestId: `req-${i}`,
          method: "POST",
          path: "/v1/chat/completions",
          sourceScheme: "openai",
          targetScheme: "none",
          provider: "none",
          model: `model-${i}`,
          targetModel: `model-${i}`,
          requestHeaders: {},
          responseStatus: 404,
          durationMs: 10,
          routed: false,
        };
        await manager.log(entry);
      }

      const unrouted = manager.getUnroutedRequests();
      expect(unrouted.length).toBe(100);
      // Most recent should be first
      expect(unrouted[0].model).toBe("model-109");
    });
  });

  describe("clearUnroutedRequests", () => {
    test("should clear all unrouted requests", async () => {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId: "req-1",
        method: "POST",
        path: "/v1/chat/completions",
        sourceScheme: "openai",
        targetScheme: "none",
        provider: "none",
        model: "model-1",
        targetModel: "model-1",
        requestHeaders: {},
        responseStatus: 404,
        durationMs: 10,
        routed: false,
      };

      await manager.log(entry);
      manager.clearUnroutedRequests();

      const unrouted = manager.getUnroutedRequests();
      expect(unrouted.length).toBe(0);
    });

    test("should emit unrouted-cleared event", async () => {
      let cleared = false;
      manager.on("unrouted-cleared", () => {
        cleared = true;
      });

      manager.clearUnroutedRequests();

      expect(cleared).toBe(true);
    });
  });

  describe("getStats", () => {
    test("should return stats with no logs", async () => {
      const stats = await manager.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.routedRequests).toBe(0);
      expect(stats.unroutedRequests).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.averageLatency).toBe(0);
    });

    test("should calculate stats correctly", async () => {
      // Log some requests
      for (let i = 0; i < 5; i++) {
        await manager.log({
          timestamp: new Date().toISOString(),
          requestId: `req-${i}`,
          method: "POST",
          path: "/v1/chat/completions",
          sourceScheme: "openai",
          targetScheme: "openai",
          provider: "openai",
          model: "gpt-4",
          targetModel: "gpt-4",
          requestHeaders: {},
          responseStatus: i === 4 ? 500 : 200,
          durationMs: 100 * (i + 1),
          routed: true,
          error: i === 4 ? "Error" : undefined,
        });
      }

      const stats = await manager.getStats();

      expect(stats.totalRequests).toBe(5);
      expect(stats.routedRequests).toBe(5);
      expect(stats.errors).toBe(1);
      // Average: (100 + 200 + 300 + 400 + 500) / 5 = 300
      expect(stats.averageLatency).toBe(300);
    });
  });

  describe("setMaskKeys", () => {
    test("should update masking setting", () => {
      manager.setMaskKeys(false);
      // The setting is applied on next log
      expect(() => manager.setMaskKeys(true)).not.toThrow();
    });
  });

  describe("setLogDir", () => {
    test("should update log directory", () => {
      manager.setLogDir("/new/log/dir");
      // Directory is created lazily
      expect(() => manager.setLogDir(null)).not.toThrow();
    });
  });
});
