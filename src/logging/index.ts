// ============================================================================
// Logging System - Request tracking and unrouted request capture
// ============================================================================

import { existsSync } from "fs";
import { mkdir, writeFile, readFile, readdir, unlink } from "fs/promises";
import { join } from "path";
import type { LogEntry, UnroutedRequest } from "../types/index.ts";
import { EventEmitter } from "events";
import { log } from "../logger.ts";

export interface LogStats {
  totalRequests: number;
  routedRequests: number;
  unroutedRequests: number;
  errors: number;
  averageLatency: number;
}

export class LoggingManager extends EventEmitter {
  private logDir: string | null = null;
  private logIndex = 0;
  private unroutedRequests: UnroutedRequest[] = [];
  private maxUnroutedStored = 100;
  private maskKeys: boolean = true;

  constructor(logDir?: string, maskKeys: boolean = true) {
    super();
    this.logDir = logDir || null;
    this.maskKeys = maskKeys;
  }

  /**
   * Initialize logging directory
   */
  async initialize(): Promise<void> {
    if (this.logDir && !existsSync(this.logDir)) {
      await mkdir(this.logDir, { recursive: true });
    }
  }

  /**
   * Set log directory
   */
  setLogDir(dir: string | null): void {
    this.logDir = dir;
    if (dir && !existsSync(dir)) {
      mkdir(dir, { recursive: true }).catch(err => log.error(`Failed to create log dir: ${err}`));
    }
  }

  /**
   * Mask sensitive values
   */
  private maskSensitive(value: string): string {
    if (!this.maskKeys) return value;
    if (value.length <= 10) return "***";
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  /**
   * Mask sensitive headers
   */
  private maskHeaders(headers: Record<string, string>): Record<string, string> {
    if (!this.maskKeys) return headers;

    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === "authorization" || 
          lowerKey === "x-api-key" || 
          lowerKey.includes("key") ||
          lowerKey.includes("token")) {
        masked[key] = this.maskSensitive(value);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }

  /**
   * Log a completed request/response
   */
  async log(entry: LogEntry): Promise<void> {
    // Mask sensitive data
    if (this.maskKeys) {
      entry.requestHeaders = this.maskHeaders(entry.requestHeaders);
      if (entry.responseHeaders) {
        entry.responseHeaders = this.maskHeaders(entry.responseHeaders);
      }
    }

    // Emit event for real-time monitoring
    this.emit("request", entry);

    // Store unrouted requests separately for the GUI
    if (!entry.routed) {
      this.addUnroutedRequest({
        id: entry.requestId,
        timestamp: entry.timestamp,
        model: entry.model,
        apiKey: this.maskKeys ? this.maskSensitive(entry.requestHeaders["authorization"] || entry.requestHeaders["x-api-key"] || "") : 
                                (entry.requestHeaders["authorization"] || entry.requestHeaders["x-api-key"] || ""),
        streaming: entry.requestBody && typeof entry.requestBody === "object" && 
                   (entry.requestBody as Record<string, unknown>).stream === true,
        endpoint: entry.path,
        fullRequest: entry.requestBody,
        headers: entry.requestHeaders,
      });
    }

    // Write to file if logging is enabled
    let filename: string | undefined;
    if (this.logDir) {
      const now = new Date();
      const dateStr = now.toISOString().replace(/[:T]/g, "-").slice(0, 19);
      const index = String(this.logIndex++).padStart(6, "0");
      filename = `${dateStr}_${index}_${entry.provider}_${entry.model}_${entry.requestId}.json`;
      const filepath = join(this.logDir, filename);

      try {
        await writeFile(filepath, JSON.stringify(entry, null, 2));
      } catch (err) {
        log.error(`Failed to write log: ${err}`);
      }
    }

    // Always emit logged event for WebSocket broadcasting (regardless of file logging)
    this.emit("logged", { entry, filename });
  }

  /**
   * Add an unrouted request to the in-memory list
   */
  private addUnroutedRequest(request: UnroutedRequest): void {
    this.unroutedRequests.unshift(request);
    
    // Keep only the most recent unrouted requests
    if (this.unroutedRequests.length > this.maxUnroutedStored) {
      this.unroutedRequests = this.unroutedRequests.slice(0, this.maxUnroutedStored);
    }

    // Emit event for real-time updates
    this.emit("unrouted", request);
  }

  /**
   * Get all unrouted requests
   */
  getUnroutedRequests(): UnroutedRequest[] {
    return [...this.unroutedRequests];
  }

  /**
   * Clear unrouted requests
   */
  clearUnroutedRequests(): void {
    this.unroutedRequests = [];
    this.emit("unrouted-cleared");
  }

  /**
   * Get log statistics
   */
  async getStats(): Promise<LogStats> {
    if (!this.logDir) {
      return {
        totalRequests: this.logIndex,
        routedRequests: this.logIndex - this.unroutedRequests.length,
        unroutedRequests: this.unroutedRequests.length,
        errors: 0,
        averageLatency: 0,
      };
    }

    try {
      const files = await readdir(this.logDir);
      let totalLatency = 0;
      let errorCount = 0;
      let logCount = 0;

      for (const file of files.slice(-100)) {
        if (file.endsWith(".json")) {
          try {
            const content = await readFile(join(this.logDir, file), "utf-8");
            const entry = JSON.parse(content) as LogEntry;
            totalLatency += entry.durationMs;
            if (entry.error || entry.responseStatus >= 400) {
              errorCount++;
            }
            logCount++;
          } catch {
            // Skip malformed files
          }
        }
      }

      return {
        totalRequests: files.length,
        routedRequests: files.length - this.unroutedRequests.length,
        unroutedRequests: this.unroutedRequests.length,
        errors: errorCount,
        averageLatency: logCount > 0 ? Math.round(totalLatency / logCount) : 0,
      };
    } catch {
      return {
        totalRequests: this.logIndex,
        routedRequests: this.logIndex - this.unroutedRequests.length,
        unroutedRequests: this.unroutedRequests.length,
        errors: 0,
        averageLatency: 0,
      };
    }
  }

  /**
   * Get recent logs
   */
  async getRecentLogs(limit: number = 50): Promise<LogEntry[]> {
    if (!this.logDir) return [];

    try {
      const files = await readdir(this.logDir);
      const sortedFiles = files
        .filter(f => f.endsWith(".json"))
        .sort()
        .reverse()
        .slice(0, limit);

      const logs: LogEntry[] = [];
      for (const file of sortedFiles) {
        try {
          const content = await readFile(join(this.logDir, file), "utf-8");
          const entry = JSON.parse(content) as LogEntry;
          // Attach filename to entry for reference
          (entry as LogEntry & { filename: string }).filename = file;
          logs.push(entry);
        } catch {
          // Skip malformed files
        }
      }

      return logs;
    } catch {
      return [];
    }
  }

  /**
   * Get a specific log entry
   */
  async getLog(requestId: string): Promise<LogEntry | null> {
    if (!this.logDir) return null;

    try {
      const files = await readdir(this.logDir);
      const file = files.find(f => f.includes(requestId));
      
      if (file) {
        const content = await readFile(join(this.logDir, file), "utf-8");
        return JSON.parse(content);
      }
    } catch {
      // Return null on error
    }

    return null;
  }

  /**
   * Clean up old logs
   */
  async cleanup(maxAgeDays: number = 7): Promise<number> {
    if (!this.logDir) return 0;

    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    let deleted = 0;

    try {
      const files = await readdir(this.logDir);
      
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            const filepath = join(this.logDir, file);
            const stats = await import("fs/promises").then(fs => fs.stat(filepath));
            
            if (stats.mtimeMs < cutoff) {
              await unlink(filepath);
              deleted++;
            }
          } catch {
            // Skip files we can't process
          }
        }
      }
    } catch {
      // Return count even on error
    }

    return deleted;
  }

  /**
   * Set masking option
   */
  setMaskKeys(mask: boolean): void {
    this.maskKeys = mask;
  }
}

// Export singleton
export const loggingManager = new LoggingManager();
