// ============================================================================
// Router - Request routing and pattern matching
// ============================================================================

import type { RouteConfig, RouteMatch, MatchResult } from "../types/index.ts";

export interface RouterOptions {
  routes: RouteConfig[];
  defaultProvider?: string;
}

export class Router {
  private routes: RouteConfig[];
  private defaultProvider?: string;

  constructor(options: RouterOptions) {
    this.routes = [...options.routes];
    this.defaultProvider = options.defaultProvider;
    this.sortRoutes();
  }

  /**
   * Sort routes by priority (highest first)
   */
  private sortRoutes(): void {
    this.routes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * Update routes
   */
  setRoutes(routes: RouteConfig[]): void {
    this.routes = [...routes];
    this.sortRoutes();
  }

  /**
   * Update default provider
   */
  setDefaultProvider(provider: string | undefined): void {
    this.defaultProvider = provider;
  }

  /**
   * Match a model name against a pattern
   * Supports wildcards: * (any chars) and ? (single char)
   * Returns captured groups for use in template substitution
   */
  matchPattern(model: string, pattern: string): MatchResult {
    // Escape special regex characters except * and ?
    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&");
    
    // Replace wildcards with capture groups
    const captures: string[] = [];
    let captureIndex = 1;
    
    regexPattern = regexPattern
      .replace(/\*/g, () => {
        captures.push(`$${captureIndex++}`);
        return "(.*)";
      })
      .replace(/\?/g, () => {
        captures.push(`$${captureIndex++}`);
        return "(.)";
      });

    const regex = new RegExp(`^${regexPattern}$`, "i");
    const match = model.match(regex);
    
    if (!match) {
      return { matched: false, captures: [] };
    }
    
    return {
      matched: true,
      captures: match.slice(1),
    };
  }

  /**
   * Apply captured groups to a template
   * Template uses ${1}, ${2}, etc. for captured values
   */
  applyTemplate(template: string | undefined, originalModel: string, captures: string[]): string {
    if (!template) return originalModel;
    
    return template.replace(/\$\{(\d+)\}/g, (match, num) => {
      const index = parseInt(num, 10) - 1;
      return captures[index] ?? match;
    });
  }

  /**
   * Find a route for a model
   */
  findRoute(model: string): RouteMatch | null {
    for (const route of this.routes) {
      const matchResult = this.matchPattern(model, route.pattern);
      
      if (matchResult.matched) {
        return {
          provider: route.provider,
          model: this.applyTemplate(route.model, model, matchResult.captures),
          pattern: route.pattern,
        };
      }
    }

    // Fall back to default provider
    if (this.defaultProvider) {
      return {
        provider: this.defaultProvider,
        model,
      };
    }

    return null;
  }

  /**
   * Check if a model can be routed
   */
  canRoute(model: string): boolean {
    return this.findRoute(model) !== null;
  }

  /**
   * Add a new route
   */
  addRoute(route: RouteConfig): void {
    // Remove existing route with same pattern
    this.routes = this.routes.filter(r => r.pattern !== route.pattern);
    this.routes.push(route);
    this.sortRoutes();
  }

  /**
   * Remove a route by pattern
   */
  removeRoute(pattern: string): boolean {
    const initialLength = this.routes.length;
    this.routes = this.routes.filter(r => r.pattern !== pattern);
    return this.routes.length < initialLength;
  }

  /**
   * Get all routes
   */
  getRoutes(): RouteConfig[] {
    return [...this.routes];
  }

  /**
   * Get route statistics
   */
  getStats(): {
    totalRoutes: number;
    patterns: string[];
    providers: string[];
  } {
    const providers = new Set<string>();
    
    for (const route of this.routes) {
      providers.add(route.provider);
    }
    
    if (this.defaultProvider) {
      providers.add(this.defaultProvider);
    }

    return {
      totalRoutes: this.routes.length,
      patterns: this.routes.map(r => r.pattern),
      providers: Array.from(providers),
    };
  }

  /**
   * Suggest a route for a model name
   */
  suggestRoute(model: string): Partial<RouteConfig> | null {
    // Common patterns
    if (model.startsWith("gpt-")) {
      return { provider: "openai", priority: 70 };
    }
    if (model.startsWith("claude-")) {
      return { provider: "anthropic", priority: 100 };
    }
    if (model.includes("llama")) {
      return { provider: "ollama", priority: 80 };
    }
    if (model.includes("mistral") || model.includes("mixtral")) {
      return { provider: "ollama", priority: 80 };
    }
    if (model.startsWith("gemini-")) {
      return { provider: "google", priority: 70 };
    }

    return null;
  }

  /**
   * Test a pattern against sample models
   */
  testPattern(pattern: string, sampleModels: string[]): Array<{ model: string; matched: boolean; captures: string[] }> {
    return sampleModels.map(model => {
      const result = this.matchPattern(model, pattern);
      return {
        model,
        matched: result.matched,
        captures: result.captures,
      };
    });
  }
}

// Export factory function
export function createRouter(options: RouterOptions): Router {
  return new Router(options);
}
