import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ConfigManager } from "./manager.ts";
import { existsSync } from "fs";
import { mkdir, writeFile, rmdir, unlink } from "fs/promises";
import { join } from "path";
import type { RouterConfig } from "../types/index.ts";

describe("ConfigManager", () => {
  const testDir = "/tmp/apimap-test-config";
  const testConfigPath = join(testDir, "config.yaml");
  const testBackupDir = join(testDir, "backups");

  let manager: ConfigManager;

  beforeEach(async () => {
    // Create test directory
    if (!existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }
    manager = new ConfigManager(testConfigPath);
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      if (existsSync(testConfigPath)) {
        await unlink(testConfigPath);
      }
      if (existsSync(testDir)) {
        await rmdir(testDir, { recursive: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("load", () => {
    test("should throw if config file doesn't exist", async () => {
      const nonExistentManager = new ConfigManager("/non/existent/config.yaml");
      expect(nonExistentManager.load()).rejects.toThrow();
    });

    test("should load valid YAML config", async () => {
      const yamlContent = `
server:
  port: 3000
  host: "0.0.0.0"

providers:
  openai:
    baseUrl: "https://api.openai.com/v1"
    timeout: 120

routes:
  - pattern: "gpt-4*"
    provider: openai
`;
      await writeFile(testConfigPath, yamlContent);

      const config = await manager.load();

      expect(config.server?.port).toBe(3000);
      expect(config.providers.openai?.baseUrl).toBe("https://api.openai.com/v1");
      expect(config.routes.length).toBe(1);
      expect(config.routes[0].pattern).toBe("gpt-4*");
    });

    test("should merge with defaults", async () => {
      const yamlContent = `
providers:
  openai:
    baseUrl: "https://api.openai.com/v1"

routes: []
`;
      await writeFile(testConfigPath, yamlContent);

      const config = await manager.load();

      // Should have default values
      expect(config.server?.port).toBe(3000);
      expect(config.server?.host).toBe("0.0.0.0");
      expect(config.logging?.level).toBe("info");
      expect(config.logging?.maskKeys).toBe(true);
    });

    test("should add default schemes if none specified", async () => {
      const yamlContent = `
providers: {}
routes: []
`;
      await writeFile(testConfigPath, yamlContent);

      const config = await manager.load();

      expect(config.schemes?.length).toBe(2);
      expect(config.schemes?.[0].id).toBe("openai-chat");
      expect(config.schemes?.[1].id).toBe("anthropic-messages");
    });
  });

  describe("save", () => {
    test("should save config to file", async () => {
      const config: RouterConfig = {
        server: { port: 8080 },
        providers: {
          openai: { baseUrl: "https://api.openai.com/v1" },
        },
        routes: [{ pattern: "gpt-4*", provider: "openai" }],
      };

      // Need to load first to initialize
      await writeFile(testConfigPath, "providers: {}\nroutes: []");
      await manager.load();

      await manager.save(config, false);

      const savedContent = await Bun.file(testConfigPath).text();
      expect(savedContent).toContain("port: 8080");
      expect(savedContent).toContain("gpt-4*");
    });
  });

  describe("getConfig", () => {
    test("should throw if config not loaded", () => {
      const freshManager = new ConfigManager(testConfigPath);
      expect(() => freshManager.getConfig()).toThrow("Config not loaded");
    });
  });

  describe("createBackup", () => {
    test("should create backup file", async () => {
      const yamlContent = `
providers: {}
routes: []
`;
      await writeFile(testConfigPath, yamlContent);
      await manager.load();

      const backup = await manager.createBackup();

      expect(backup.filename).toContain("config-backup-");
      expect(backup.path).toContain("backups");
      expect(backup.size).toBeGreaterThan(0);
    });
  });

  describe("listBackups", () => {
    test("should return empty list when no backups", async () => {
      const yamlContent = `
providers: {}
routes: []
`;
      await writeFile(testConfigPath, yamlContent);
      await manager.load();

      const backups = await manager.listBackups();
      expect(backups).toEqual([]);
    });
  });

  describe("updateProviders", () => {
    test("should update providers and save", async () => {
      const yamlContent = `
providers: {}
routes: []
`;
      await writeFile(testConfigPath, yamlContent);
      await manager.load();

      await manager.updateProviders({
        openai: { baseUrl: "https://api.openai.com/v1", timeout: 180 },
      });

      const config = manager.getConfig();
      expect(config.providers.openai?.timeout).toBe(180);
    });
  });

  describe("updateRoutes", () => {
    test("should update routes preserving order", async () => {
      const yamlContent = `
providers: {}
routes: []
`;
      await writeFile(testConfigPath, yamlContent);
      await manager.load();

      await manager.updateRoutes([
        { pattern: "gpt-4*", provider: "openai" },
        { pattern: "claude-*", provider: "anthropic" },
        { pattern: "*", provider: "fallback" },
      ]);

      const config = manager.getConfig();
      expect(config.routes[0].pattern).toBe("gpt-4*");
      expect(config.routes[1].pattern).toBe("claude-*");
      expect(config.routes[2].pattern).toBe("*");
    });
  });

  describe("addRoute", () => {
    test("should add new route", async () => {
      const yamlContent = `
providers: {}
routes: []
`;
      await writeFile(testConfigPath, yamlContent);
      await manager.load();

      await manager.addRoute({ pattern: "gpt-4*", provider: "openai" });

      const config = manager.getConfig();
      expect(config.routes.length).toBe(1);
      expect(config.routes[0].pattern).toBe("gpt-4*");
    });

    test("should insert before catch-all", async () => {
      const yamlContent = `
providers: {}
routes:
  - pattern: "*"
    provider: fallback
`;
      await writeFile(testConfigPath, yamlContent);
      await manager.load();

      await manager.addRoute({ pattern: "gpt-4*", provider: "openai" });

      const config = manager.getConfig();
      expect(config.routes.length).toBe(2);
      expect(config.routes[0].pattern).toBe("gpt-4*");
      expect(config.routes[1].pattern).toBe("*");
    });
  });

  describe("removeRoute", () => {
    test("should remove route by pattern", async () => {
      const yamlContent = `
providers: {}
routes:
  - pattern: "gpt-4*"
    provider: openai
`;
      await writeFile(testConfigPath, yamlContent);
      await manager.load();

      await manager.removeRoute("gpt-4*");

      const config = manager.getConfig();
      expect(config.routes.length).toBe(0);
    });
  });

  describe("change listeners", () => {
    test("should notify listeners of changes", async () => {
      const yamlContent = `
providers: {}
routes: []
`;
      await writeFile(testConfigPath, yamlContent);
      await manager.load();

      let changeCount = 0;
      const unsubscribe = manager.onChange(() => {
        changeCount++;
      });

      await manager.updateProviders({ test: { baseUrl: "http://test" } });

      expect(changeCount).toBeGreaterThan(0);

      // Cleanup
      unsubscribe();
    });

    test("should allow unsubscribing", async () => {
      const yamlContent = `
providers: {}
routes: []
`;
      await writeFile(testConfigPath, yamlContent);
      await manager.load();

      let changeCount = 0;
      const unsubscribe = manager.onChange(() => {
        changeCount++;
      });

      unsubscribe();

      await manager.updateProviders({ test: { baseUrl: "http://test" } });

      expect(changeCount).toBe(0);
    });
  });

  describe("paths", () => {
    test("should return config path", () => {
      expect(manager.getConfigPath()).toBe(testConfigPath);
    });

    test("should return backup dir", () => {
      expect(manager.getBackupDir()).toBe(testBackupDir);
    });
  });
});
