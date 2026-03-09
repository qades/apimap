// ============================================================================
// Configuration Manager - YAML config with backup/restore
// ============================================================================

import { existsSync } from "fs";
import { mkdir, writeFile, readFile, copyFile, readdir, stat, unlink } from "fs/promises";
import { join, basename, dirname, resolve } from "path";
import type { RouterConfig, ProviderConfig, RouteConfig, ApiSchemeConfig } from "../types/index.ts";

// Use Bun's built-in YAML support
// @ts-ignore - Bun's YAML import
const YAML = await import("bun").then(b => b.file);

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
        console.error("Config change listener error:", err);
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

    // Use Bun's built-in YAML parsing
    const file = Bun.file(this.configPath);
    const content = await file.text();
    
    // Parse YAML using Bun's native support or fallback
    let parsed: Partial<RouterConfig>;
    try {
      // Try to use YAML parser
      const yamlModule = await import("yaml");
      parsed = yamlModule.parse(content) as Partial<RouterConfig>;
    } catch {
      // Fallback to JSON
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
      defaultProvider: parsed.defaultProvider,
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
    const yaml = {
      server: config.server,
      logging: config.logging,
      preload: config.preload,
      schemes: config.schemes,
      providers: config.providers,
      routes: config.routes,
      defaultProvider: config.defaultProvider,
    };

    // Use YAML library for proper serialization
    // Include comments using a template approach
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
    lines.push("# Built-in providers with defaults:");
    lines.push("#   - openai, anthropic, google, groq, together, fireworks");
    lines.push("#   - ollama, lmstudio, llamacpp, vllm (local - no API key needed)");
    lines.push("providers:");
    for (const [id, provider] of Object.entries(config.providers || {})) {
      lines.push(`  ${id}:`);
      lines.push(`    baseUrl: "${provider.baseUrl}"`);
      if (provider.apiKey) {
        lines.push(`    # apiKey: "***"  # Set via environment variable for security`);
      }
      if (provider.apiKeyEnv) {
        lines.push(`    apiKeyEnv: "${provider.apiKeyEnv}"`);
      }
      if (provider.timeout) {
        lines.push(`    timeout: ${provider.timeout}`);
      }
      if (provider.supportsStreaming !== undefined) {
        lines.push(`    supportsStreaming: ${provider.supportsStreaming}`);
      }
    }
    lines.push("");

    // Routes section
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# Routing Rules - Pattern matching for models");
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# Patterns support: * (any chars), ? (single char)");
    lines.push("# Use ${1}, ${2}, etc. to capture wildcard values in model name");
    lines.push("routes:");
    for (const route of config.routes || []) {
      lines.push(`  - pattern: "${route.pattern}"`);
      lines.push(`    provider: "${route.provider}"`);
      if (route.model) {
        lines.push(`    model: "${route.model}"`);
      }
      if (route.priority !== undefined) {
        lines.push(`    priority: ${route.priority}`);
      }
    }
    lines.push("");

    // Default provider
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    lines.push("# Default Provider - Used when no route matches");
    lines.push("# ═══════════════════════════════════════════════════════════════════════════════");
    if (config.defaultProvider) {
      lines.push(`defaultProvider: "${config.defaultProvider}"`);
    } else {
      lines.push('# defaultProvider: "openai"');
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
   * Update routes
   */
  async updateRoutes(routes: RouteConfig[]): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    // Sort by priority
    routes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
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
   * Update default provider
   */
  async updateDefaultProvider(defaultProvider: string | undefined): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    this.config.defaultProvider = defaultProvider;
    await this.save(this.config, true);
    // Note: save() already calls notifyChange("full")
  }

  /**
   * Add a new route
   */
  async addRoute(route: RouteConfig): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    this.config.routes.push(route);
    this.config.routes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
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
}

// Export singleton
export const configManager = new ConfigManager();
