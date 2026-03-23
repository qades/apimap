// ============================================================================
// Configuration Manager - YAML config with backup/restore
// ============================================================================

import { existsSync } from "fs";
import { mkdir, writeFile, readFile, copyFile, readdir, stat, unlink } from "fs/promises";
import { join, basename, dirname, resolve } from "path";
import type { RouterConfig, ProviderConfig, RouteConfig, ApiSchemeConfig } from "../types/index.ts";
import { BUILTIN_PROVIDERS, TIER4_LOCAL_PROVIDERS, type ProviderInfo } from "../providers/builtin.ts";
import { log } from "../logger.ts";

export interface ConfigBackup {
  filename: string;
  path: string;
  createdAt: Date;
  size: number;
}

export interface ConfigChangeEvent {
  type: "providers" | "routes" | "schemes" | "server" | "logging" | "preload" | "full";
  timestamp: Date;
}

type ConfigChangeListener = (event: ConfigChangeEvent) => void;

export class ConfigManager {
  private configPath: string;
  private backupDir: string;
  private config: RouterConfig | null = null;
  private listeners: ConfigChangeListener[] = [];
  private lastModified: Date | null = null;

  constructor(configPath: string = "config/config.yaml") {
    this.configPath = resolve(configPath);
    this.backupDir = join(dirname(this.configPath), "backups");
  }

  /**
   * Add a change listener
   */
  onChange(listener: ConfigChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify listeners of changes
   */
  private notifyChange(type: ConfigChangeEvent["type"]): void {
    const event: ConfigChangeEvent = {
      type,
      timestamp: new Date(),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        log.error(`Config change listener error: ${err}`);
      }
    }
  }

  /**
   * Ensure backup directory exists
   */
  private async ensureBackupDir(): Promise<void> {
    if (!existsSync(this.backupDir)) {
      await mkdir(this.backupDir, { recursive: true });
    }
  }

  /**
   * Load configuration from file
   */
  async load(): Promise<RouterConfig> {
    if (!existsSync(this.configPath)) {
      throw new Error(`Config file not found: ${this.configPath}`);
    }

    const file = Bun.file(this.configPath);
    const content = await file.text();

    let parsed: Partial<RouterConfig>;
    try {
      const yamlModule = await import("yaml");
      parsed = yamlModule.parse(content) as Partial<RouterConfig>;
    } catch {
      try {
        parsed = JSON.parse(content) as Partial<RouterConfig>;
      } catch {
        throw new Error("Failed to parse config file. Ensure it's valid YAML or JSON.");
      }
    }

    // Merge with defaults
    this.config = this.mergeWithDefaults(parsed);

    // Track modification time
    const stats = await stat(this.configPath);
    this.lastModified = stats.mtime;

    return this.config;
  }

  /**
   * Merge config with defaults
   */
  private mergeWithDefaults(parsed: Partial<RouterConfig>): RouterConfig {
    const config: RouterConfig = {
      server: {
        port: 3000,
        host: "0.0.0.0",
        cors: { origin: "*", credentials: false },
        timeout: 120,
        ...parsed.server,
      },
      logging: {
        level: "info",
        maskKeys: true,
        ...parsed.logging,
      },
      preload: {
        enabled: false,
        ...parsed.preload,
      },
      schemes: parsed.schemes || [
        { id: "openai-chat", format: "openai-chat" },
        { id: "anthropic-messages", format: "anthropic-messages" },
      ],
      providers: parsed.providers || {},
      routes: parsed.routes || [],
    };

    return config;
  }

  /**
   * Get current configuration
   */
  getConfig(): RouterConfig {
    if (!this.config) {
      throw new Error("Config not loaded. Call load() first.");
    }
    return this.config;
  }

  /**
   * Check if config has been modified externally
   */
  async hasExternalChanges(): Promise<boolean> {
    if (!this.lastModified) return false;

    try {
      const stats = await stat(this.configPath);
      return stats.mtime > this.lastModified;
    } catch {
      return false;
    }
  }

  /**
   * Reload if externally modified
   */
  async reloadIfChanged(): Promise<boolean> {
    if (await this.hasExternalChanges()) {
      await this.load();
      return true;
    }
    return false;
  }

  /**
   * Save configuration to file (with automatic backup)
   */
  async save(config?: RouterConfig, createBackup: boolean = true): Promise<void> {
    const configToSave = config || this.config;
    if (!configToSave) {
      throw new Error("No config to save");
    }

    // Create backup before saving
    if (createBackup && existsSync(this.configPath)) {
      await this.createBackup();
    }

    // Serialize to YAML with comments
    const yaml = this.serializeToYaml(configToSave);

    // Ensure directory exists
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Write file
    await writeFile(this.configPath, yaml, "utf-8");

    // Update in-memory config
    this.config = configToSave;

    // Update modification time
    const stats = await stat(this.configPath);
    this.lastModified = stats.mtime;

    this.notifyChange("full");
  }

  /**
   * Serialize config to YAML with helpful comments
   */
  private serializeToYaml(config: RouterConfig): string {
    const lines: string[] = [];

    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# Universal Model Router - Configuration");
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("");

    // Server section
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# Server Configuration");
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("server:");
    lines.push(`  port: ${config.server?.port ?? 3000}                    # Port to listen on`);
    lines.push(`  host: "${config.server?.host ?? "0.0.0.0"}"              # Host to bind to`);
    lines.push(`  timeout: ${config.server?.timeout ?? 120}                 # Request timeout in seconds`);
    lines.push("  cors:");
    lines.push(`    origin: ${JSON.stringify(config.server?.cors?.origin ?? "*")}                # CORS origin`);
    lines.push(`    credentials: ${config.server?.cors?.credentials ?? false}         # Allow credentials`);
    lines.push("");

    // Logging section
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# Logging Configuration");
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("logging:");
    lines.push(`  dir: ${JSON.stringify(config.logging?.dir ?? "./logs")}                # Log directory (null to disable)`);
    lines.push(`  level: "${config.logging?.level ?? "info"}"                # Log level: debug, info, warn, error`);
    lines.push(`  maskKeys: ${config.logging?.maskKeys ?? true}               # Mask API keys in logs`);
    lines.push("");

    // Preload section
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# Preload Configuration (warm up models on startup)");
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("preload:");
    lines.push(`  enabled: ${config.preload?.enabled ?? false}                # Enable preload`);
    lines.push("  models:");
    for (const model of config.preload?.models || []) {
      lines.push(`    - "${model}"`);
    }
    lines.push("");

    // Schemes section
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# API Schemes (endpoints to expose)");
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("schemes:");
    for (const scheme of config.schemes || []) {
      lines.push(`  - id: "${scheme.id}"`);
      lines.push(`    format: "${scheme.format}"`);
    }
    lines.push("");

    // Providers section
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# Provider Configurations");
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# Only specify values that differ from defaults");
    lines.push("providers:");
    for (const [id, provider] of Object.entries(config.providers || {})) {
      lines.push(`  ${id}:`);

      // Only include baseUrl if it differs from builtin default
      const builtin = this.getBuiltinProviderInfo(id);
      if (provider.baseUrl !== builtin?.defaultBaseUrl) {
        lines.push(`    baseUrl: "${provider.baseUrl}"`);
      }

      // Save apiKey if set
      if (provider.apiKey) {
        lines.push(`    apiKey: "${provider.apiKey}"`);
      }
      if (provider.apiKeyEnv && provider.apiKeyEnv !== builtin?.defaultApiKeyEnv) {
        lines.push(`    apiKeyEnv: "${provider.apiKeyEnv}"`);
      }
      if (provider.authHeader && provider.authHeader !== builtin?.authHeader) {
        lines.push(`    authHeader: "${provider.authHeader}"`);
      }
      if (provider.authPrefix && provider.authPrefix !== builtin?.authPrefix) {
        lines.push(`    authPrefix: "${provider.authPrefix}"`);
      }
      if (provider.timeout) {
        lines.push(`    timeout: ${provider.timeout}`);
      }
      if (provider.supportsStreaming !== undefined && provider.supportsStreaming !== builtin?.supportsStreaming) {
        lines.push(`    supportsStreaming: ${provider.supportsStreaming}`);
      }
      if (provider.headers) {
        lines.push(`    headers:`);
        for (const [key, value] of Object.entries(provider.headers)) {
          lines.push(`      "${key}": "${value}"`);
        }
      }
    }
    lines.push("");

    // Routes section
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# Routing Rules - matched top-down, first match wins");
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# Patterns support: * (any chars), ? (single char)");
    lines.push("# Use ${1}, ${2}, etc. to capture wildcard values in model name");
    lines.push("# Put catch-all \"*\" pattern last as a default fallback");
    lines.push("routes:");
    for (const route of config.routes || []) {
      lines.push(`  - pattern: "${route.pattern}"`);
      lines.push(`    provider: "${route.provider}"`);
      if (route.model) {
        lines.push(`    model: "${route.model}"`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Create a backup of the current config
   */
  async createBackup(): Promise<ConfigBackup> {
    await this.ensureBackupDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `config-backup-${timestamp}.yaml`;
    const backupPath = join(this.backupDir, filename);

    await copyFile(this.configPath, backupPath);

    const stats = await stat(backupPath);

    return {
      filename,
      path: backupPath,
      createdAt: stats.mtime,
      size: stats.size,
    };
  }

  /**
   * List all backups
   */
  async listBackups(): Promise<ConfigBackup[]> {
    await this.ensureBackupDir();

    const files = await readdir(this.backupDir);
    const backups: ConfigBackup[] = [];

    for (const filename of files) {
      if (filename.endsWith(".yaml") || filename.endsWith(".yml")) {
        const filepath = join(this.backupDir, filename);
        try {
          const stats = await stat(filepath);
          backups.push({
            filename,
            path: filepath,
            createdAt: stats.mtime,
            size: stats.size,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Sort by date, newest first
    return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Restore from a backup
   */
  async restoreBackup(filename: string): Promise<void> {
    const backupPath = join(this.backupDir, filename);

    if (!existsSync(backupPath)) {
      throw new Error(`Backup not found: ${filename}`);
    }

    // Create backup of current before restoring
    if (existsSync(this.configPath)) {
      await this.createBackup();
    }

    await copyFile(backupPath, this.configPath);
    await this.load();

    this.notifyChange("full");
  }

  /**
   * Delete a backup
   */
  async deleteBackup(filename: string): Promise<void> {
    const backupPath = join(this.backupDir, filename);

    if (existsSync(backupPath)) {
      await unlink(backupPath);
    }
  }

  /**
   * Update providers
   */
  async updateProviders(providers: Record<string, ProviderConfig>): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    this.config.providers = providers;
    await this.save(this.config, true);
    this.notifyChange("providers");
  }

  /**
   * Update routes (order is preserved as-is)
   */
  async updateRoutes(routes: RouteConfig[]): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    this.config.routes = routes;
    await this.save(this.config, true);
    this.notifyChange("routes");
  }

  /**
   * Update schemes
   */
  async updateSchemes(schemes: ApiSchemeConfig[]): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    this.config.schemes = schemes;
    await this.save(this.config, true);
    this.notifyChange("schemes");
  }

  /**
   * Update server config
   */
  async updateServer(server: RouterConfig["server"]): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    this.config.server = { ...this.config.server, ...server };
    await this.save(this.config, true);
    this.notifyChange("server");
  }

  /**
   * Update logging config
   */
  async updateLogging(logging: RouterConfig["logging"]): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    this.config.logging = { ...this.config.logging, ...logging };
    await this.save(this.config, true);
    this.notifyChange("logging");
  }

  /**
   * Add a new route (before catch-all if present)
   */
  async addRoute(route: RouteConfig): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    // Insert before catch-all "*" if one exists at the end
    const lastRoute = this.config.routes[this.config.routes.length - 1];
    if (lastRoute && lastRoute.pattern === "*") {
      this.config.routes.splice(this.config.routes.length - 1, 0, route);
    } else {
      this.config.routes.push(route);
    }

    await this.save(this.config, true);
    this.notifyChange("routes");
  }

  /**
   * Remove a route by pattern
   */
  async removeRoute(pattern: string): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    this.config.routes = this.config.routes.filter(r => r.pattern !== pattern);

    await this.save(this.config, true);
    this.notifyChange("routes");
  }

  /**
   * Get the config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Get the backup directory path
   */
  getBackupDir(): string {
    return this.backupDir;
  }

  /**
   * Get builtin provider info for a given provider ID
   */
  private getBuiltinProviderInfo(id: string): ProviderInfo | undefined {
    return BUILTIN_PROVIDERS[id];
  }

  /**
   * Auto-detect reachable local providers and create initial config
   */
  static async createInitialConfig(configPath: string): Promise<RouterConfig> {
    log.info("First-time setup: detecting reachable local providers...");

    const providers: Record<string, ProviderConfig> = {};
    const routes: RouteConfig[] = [];
    let firstReachableLocal: string | null = null;

    // Check each local provider
    for (const [id, info] of Object.entries(TIER4_LOCAL_PROVIDERS)) {
      const baseUrl = info.defaultBaseUrl;
      let found = false;
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(baseUrl, {
          signal: controller.signal,
        }).catch(() => null);
        clearTimeout(timeoutId);

        if (response && (response.ok || response.status < 500)) {
          log.info(`  Found ${info.name} at ${baseUrl}`);
          providers[id] = {
            baseUrl: baseUrl,
          };
          if (!firstReachableLocal) {
            firstReachableLocal = id;
          }
          found = true;
        }
      } catch {
        // First attempt failed, try fallback
      }
      
      // If first attempt failed and baseUrl contains host.containers.internal, try localhost
      if (!found && baseUrl.includes("host.containers.internal")) {
        const fallbackUrl = baseUrl.replace("host.containers.internal", "localhost");
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const response = await fetch(fallbackUrl, {
            signal: controller.signal,
          }).catch(() => null);
          clearTimeout(timeoutId);

          if (response && (response.ok || response.status < 500)) {
            log.info(`  Found ${info.name} at ${fallbackUrl} (fallback)`);
            providers[id] = {
              baseUrl: fallbackUrl,
            };
            if (!firstReachableLocal) {
              firstReachableLocal = id;
            }
            found = true;
          }
        } catch {
          // Fallback also failed
        }
      }
    }

    // Also check cloud providers with API keys in env
    for (const [id, info] of Object.entries(BUILTIN_PROVIDERS)) {
      if (info.category === "local") continue; // Already handled
      if (info.defaultApiKeyEnv && process.env[info.defaultApiKeyEnv]) {
        log.info(`  Found ${info.name} API key in environment (${info.defaultApiKeyEnv})`);
        providers[id] = {
          baseUrl: info.defaultBaseUrl,
        };
      }
    }

    // Build default routes for detected providers
    // Cloud providers with API keys get specific routes
    if (providers["openai"]) {
      routes.push({ pattern: "gpt-*", provider: "openai" });
      routes.push({ pattern: "o1*", provider: "openai" });
      routes.push({ pattern: "o3*", provider: "openai" });
    }
    if (providers["anthropic"]) {
      routes.push({ pattern: "claude-*", provider: "anthropic" });
    }
    if (providers["google"]) {
      routes.push({ pattern: "gemini-*", provider: "google" });
    }
    if (providers["groq"]) {
      routes.push({ pattern: "groq/*", provider: "groq", model: "${1}" });
    }
    if (providers["deepseek"]) {
      routes.push({ pattern: "deepseek-*", provider: "deepseek" });
    }

    // Add catch-all to first reachable local provider (or first cloud)
    const catchAllProvider = firstReachableLocal || Object.keys(providers)[0];
    if (catchAllProvider) {
      routes.push({ pattern: "*", provider: catchAllProvider });
    }

    const providerCount = Object.keys(providers).length;
    if (providerCount === 0) {
      log.warn("No reachable providers found. You'll need to configure providers manually.");
    } else {
      log.info(`Detected ${providerCount} provider(s). Config created with ${routes.length} route(s).`);
    }

    return {
      server: {
        port: 3000,
        host: "0.0.0.0",
        cors: { origin: "*", credentials: false },
        timeout: 120,
      },
      logging: {
        dir: "./logs",
        level: "info",
        maskKeys: true,
      },
      preload: {
        enabled: false,
      },
      schemes: [
        { id: "openai", format: "openai-chat" },
        { id: "anthropic", format: "anthropic-messages" },
      ],
      providers,
      routes,
    };
  }
}

// Export singleton
export const configManager = new ConfigManager();
