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

  /**
   * Generate queryable model IDs from a pattern and a list of target models.
   * This reverses the routing process: given a pattern (e.g., "oai/*") and 
   * target models from a provider (e.g., ["gpt-4o", "gpt-4-turbo"]), it 
   * returns queryable model IDs (e.g., ["oai/gpt-4o", "oai/gpt-4-turbo"]).
   * 
   * If the route has a `model` template, it first checks if the target model
   * matches the template structure by attempting to reverse-match.
   * 
   * @param route - The route configuration with pattern and optional model template
   * @param targetModels - Array of model IDs available from the target provider
   * @returns Array of queryable model IDs that would route to those target models
   */
  generateQueryableModels(route: RouteConfig, targetModels: string[]): string[] {
    const results: string[] = [];
    const pattern = route.pattern;
    const modelTemplate = route.model;

    // Count wildcards in pattern
    const wildcardMatches = pattern.match(/[\*\?]/g);
    const wildcardCount = wildcardMatches ? wildcardMatches.length : 0;

    // If no wildcards, the pattern is an exact queryable model ID
    if (wildcardCount === 0) {
      if (modelTemplate) {
        // Check if template has any ${N} placeholders
        const hasPlaceholders = /\$\{\d+\}/.test(modelTemplate);
        
        if (hasPlaceholders) {
          // Template has placeholders - check if any target model matches
          for (const targetModel of targetModels) {
            if (this.matchPattern(targetModel, modelTemplate).matched) {
              results.push(pattern);
            }
          }
        } else {
          // Exact model template (no placeholders) - only valid if the target model exists
          // e.g., pattern: "test", model: "MARTHA-0.8B-Q4_K_M"
          // Only include "test" if "MARTHA-0.8B-Q4_K_M" is in the provider's model list
          if (targetModels.includes(modelTemplate)) {
            results.push(pattern);
          }
        }
      } else {
        // No model template - check if any target model matches the pattern
        for (const targetModel of targetModels) {
          if (this.matchPattern(targetModel, pattern).matched) {
            results.push(pattern);
          }
        }
      }
      return [...new Set(results)]; // Deduplicate
    }

    // If there's a model template, we need to reverse-match
    // The template tells us how the captured values map to the target model
    if (modelTemplate) {
      // Check if template has any ${N} placeholders
      const hasPlaceholders = /\$\{\d+\}/.test(modelTemplate);
      
      if (hasPlaceholders) {
        // Template has placeholders - build reverse pattern and match
        const reversePattern = this.buildReversePattern(pattern, modelTemplate);
        
        for (const targetModel of targetModels) {
          const match = targetModel.match(reversePattern.regex);
          if (match) {
            // We have captures from the target model, now substitute into the route pattern
            const captures = match.slice(1);
            const queryableModel = this.substituteIntoPattern(pattern, captures);
            if (queryableModel) {
              results.push(queryableModel);
            }
          }
        }
      } else {
        // Template has no placeholders (exact model name like "gpt-4o")
        // Generate a default queryable model from the pattern
        // e.g., pattern "gpt-4*" with exact model "gpt-4o" -> "gpt-4" (strip wildcard)
        const defaultQueryableModel = pattern.replace(/[\*\?]/g, '');
        if (defaultQueryableModel) {
          results.push(defaultQueryableModel);
        }
      }
    } else {
      // No template - direct substitution of the entire target model into wildcards
      // This handles cases like "oai/*" with target "gpt-4o" -> "oai/gpt-4o"
      for (const targetModel of targetModels) {
        const queryableModel = this.substituteSingleTargetIntoPattern(pattern, targetModel);
        if (queryableModel) {
          results.push(queryableModel);
        }
      }
    }

    return [...new Set(results)]; // Deduplicate
  }

  /**
   * Build a regex pattern to reverse-match a target model against a template.
   * Returns the regex and the number of captures expected.
   * 
   * For example:
   * - pattern: "local/*", template: "${1}" 
   *   -> regex to match any model (captures the whole thing)
   * - pattern: "my-*-model", template: "${1}-suffix" 
   *   -> regex to match "X-suffix" and capture X
   */
  private buildReversePattern(pattern: string, template: string): { regex: RegExp; captureCount: number } {
    // Find all ${N} placeholders in the template
    const placeholderRegex = /\$\{(\d+)\}/g;
    const placeholders: Array<{ index: number; num: number; fullMatch: string }> = [];
    let match;
    
    while ((match = placeholderRegex.exec(template)) !== null) {
      const group = match[1];
      if (group) {
        placeholders.push({
          index: match.index,
          num: parseInt(group, 10),
          fullMatch: match[0],
        });
      }
    }

    // Sort by position in template
    placeholders.sort((a, b) => a.index - b.index);

    // Build a regex that captures the variable parts
    // We need to escape literal parts of the template and create capture groups for placeholders
    let regexStr = '^';
    let lastIndex = 0;
    
    for (const ph of placeholders) {
      // Add literal text before this placeholder
      const literal = template.slice(lastIndex, ph.index);
      regexStr += this.escapeRegex(literal);
      
      // Add capture group for this placeholder
      regexStr += '(.*?)';
      
      lastIndex = ph.index + ph.fullMatch.length;
    }
    
    // Add remaining literal text
    if (lastIndex < template.length) {
      regexStr += this.escapeRegex(template.slice(lastIndex));
    }
    
    regexStr += '$';

    return {
      regex: new RegExp(regexStr),
      captureCount: placeholders.length,
    };
  }

  /**
   * Substitute captured values into a pattern's wildcards.
   * Captures are applied in order to * and ? wildcards.
   */
  private substituteIntoPattern(pattern: string, captures: string[]): string | null {
    if (captures.length === 0) return null;

    let result = pattern;
    let captureIndex = 0;

    // Replace each wildcard with the corresponding capture
    result = result.replace(/[\*\?]/g, (match) => {
      if (captureIndex >= captures.length) {
        return match; // Keep original if no more captures
      }
      const capture = captures[captureIndex++];
      return capture ?? match; // Fallback to original match if capture is undefined
    });

    return result;
  }

  /**
   * Substitute a single target model into a pattern.
   * For patterns with one wildcard, puts the entire target model there.
   * For patterns with multiple wildcards, attempts to split the target model.
   */
  private substituteSingleTargetIntoPattern(pattern: string, targetModel: string): string | null {
    const wildcardCount = (pattern.match(/[\*\?]/g) || []).length;

    if (wildcardCount === 1) {
      // Simple case: replace the single wildcard with the target model
      return pattern.replace(/[\*\?]/, targetModel);
    }

    // Multiple wildcards: try to split the target model
    // Use common delimiters like /, -, :
    const delimiters = ['/', '-', ':', '.', '_'];
    
    for (const delimiter of delimiters) {
      const parts = targetModel.split(delimiter);
      if (parts.length === wildcardCount) {
        let result = pattern;
        let partIndex = 0;
        result = result.replace(/[\*\?]/g, () => parts[partIndex++] || '');
        return result;
      }
    }

    // If we can't split appropriately, put the whole model in the first wildcard
    // and clear the others
    let result = pattern;
    let first = true;
    result = result.replace(/[\*\?]/g, () => {
      if (first) {
        first = false;
        return targetModel;
      }
      return '';
    });

    return result;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
}

// Export factory function
export function createRouter(options: RouterOptions): Router {
  return new Router(options);
}
