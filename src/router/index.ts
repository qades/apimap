// ============================================================================
// Router - Request routing and pattern matching (top-down ordering)
// ============================================================================

import type { RouteConfig, RouteMatch, MatchResult } from "../types/index.ts";

export interface RouterOptions {
  routes: RouteConfig[];
}

export class Router {
  private routes: RouteConfig[];

  constructor(options: RouterOptions) {
    this.routes = [...options.routes];
  }

  /**
   * Update routes (order is preserved as-is, matched top-down)
   */
  setRoutes(routes: RouteConfig[]): void {
    this.routes = [...routes];
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
   * Find a route for a model (top-down, first match wins)
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

    return null;
  }

  /**
   * Check if a model can be routed
   */
  canRoute(model: string): boolean {
    return this.findRoute(model) !== null;
  }

  /**
   * Add a new route at the end (before catch-all if present)
   */
  addRoute(route: RouteConfig): void {
    // Remove existing route with same pattern
    this.routes = this.routes.filter(r => r.pattern !== route.pattern);

    // Insert before catch-all "*" if one exists at the end
    const lastRoute = this.routes[this.routes.length - 1];
    if (lastRoute && lastRoute.pattern === "*") {
      this.routes.splice(this.routes.length - 1, 0, route);
    } else {
      this.routes.push(route);
    }
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

    return {
      totalRoutes: this.routes.length,
      patterns: this.routes.map(r => r.pattern),
      providers: Array.from(providers),
    };
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
