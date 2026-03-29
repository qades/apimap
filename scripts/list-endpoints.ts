#!/usr/bin/env bun
// ============================================================================
// List all available ingress/egress endpoints and transformers
// DYNAMICALLY DISCOVERED at runtime via provider metadata
// ============================================================================

import { 
  BUILTIN_PROVIDERS, 
  OpenAICompatibleProvider,
  AnthropicProvider,
  GoogleProvider,
  AzureProvider,
  AWSBedrockProvider,
  CohereProvider,
  OllamaProvider,
  type ProviderMetadata,
} from "../src/providers/index.ts";
import * as transformers from "../src/transformers/index.ts";

// ============================================================================
// Colors and Formatting
// ============================================================================

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightBlack: "\x1b[90m",
  brightYellow: "\x1b[93m",
  brightMagenta: "[95m",
  brightCyan: "\x1b[96m",
};

function section(title: string): void {
  console.log(`\n${c.bold}${c.brightCyan}━━━ ${title.toUpperCase()} ${"━".repeat(60 - title.length)}${c.reset}\n`);
}

function subSection(title: string): void {
  console.log(`\n${c.bold}${c.cyan}▸ ${title}${c.reset}`);
}

function item(name: string, details: string, file?: string): void {
  const fileInfo = file ? ` ${c.dim}→ ${c.italic}${file}${c.reset}` : "";
  console.log(`  ${c.green}•${c.reset} ${c.bold}${name}${c.reset}${details ? ` ${c.dim}${details}${c.reset}` : ""}${fileInfo}`);
}

function subItem(label: string, value: string): void {
  console.log(`    ${c.dim}${label}:${c.reset} ${value}`);
}

function note(text: string): void {
  console.log(`  ${c.dim}${c.italic}${text}${c.reset}`);
}

// ============================================================================
// Dynamic Module Analysis
// ============================================================================

function getExportedFunctions(module: Record<string, unknown>): Array<{ name: string; type: string }> {
  return Object.entries(module)
    .filter(([key]) => key !== "default")
    .map(([key, value]) => ({
      name: key,
      type: typeof value,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inferFunctionDescription(name: string, type: string): string {
  if (type !== "function") return `(${type})`;
  
  if (name.includes("parse") && name.includes("Request")) return "Parse provider request to internal format";
  if (name.includes("parse") && name.includes("Response")) return "Parse provider response to internal format";
  if (name.includes("parse") && name.includes("Stream")) return "Parse provider streaming chunk/event";
  if (name.includes("to") && name.includes("Request")) return "Convert internal request to provider format";
  if (name.includes("to") && name.includes("Response")) return "Convert internal response to provider format";
  if (name.includes("to") && name.includes("Stream")) return "Convert internal chunk to provider SSE format";
  if (name.includes("create") && name.includes("Start")) return "Create stream start event";
  if (name.includes("create") && name.includes("Stop")) return "Create stream stop event";
  if (name.includes("create")) return "Create SSE event/helper";
  if (name.includes("map") && name.includes("Stop")) return "Map stop reasons between formats";
  if (name.includes("detect")) return "Auto-detect format from request body";
  return "Utility function";
}

// ============================================================================
// Provider Implementation Registry
// ============================================================================

const PROVIDER_IMPLS = [
  OpenAICompatibleProvider,
  AnthropicProvider,
  GoogleProvider,
  AzureProvider,
  AWSBedrockProvider,
  CohereProvider,
  OllamaProvider,
];

// Build a map of provider ID to implementation class
function getProviderImplClass(providerId: string): typeof BaseProvider {
  // Check for special providers
  switch (providerId) {
    case "anthropic": return AnthropicProvider;
    case "google": return GoogleProvider;
    case "azure": return AzureProvider;
    case "bedrock": return AWSBedrockProvider;
    case "cohere": return CohereProvider;
    case "ollama": return OllamaProvider;
    case "openai": return OpenAICompatibleProvider;
    default: return OpenAICompatibleProvider;
  }
}

// Get metadata for a provider
function getProviderMetadata(providerId: string): ProviderMetadata {
  const cls = getProviderImplClass(providerId);
  return {
    formats: cls.supportedFormats,
    endpoints: cls.endpoints,
    implementation: cls.name,
    nativeApi: cls.name !== "OpenAICompatibleProvider" || providerId === "openai",
  };
}

// ============================================================================
// Ingress Endpoints
// ============================================================================

const INGRESS_ENDPOINTS = [
  { id: "openai", format: "openai-chat", path: "/v1/chat/completions" },
  { id: "anthropic", format: "anthropic-messages", path: "/v1/messages" },
  { id: "openai-responses", format: "openai-responses", path: "/v1/responses" },
  { id: "openai-completions", format: "openai-completions", path: "/v1/completions" },
] as const;

function listIngressEndpoints(): void {
  section("Ingress Endpoints (Incoming API)");
  
  console.log(`${c.italic}These are the API endpoints that accept incoming requests.${c.reset}\n`);
  
  for (const endpoint of INGRESS_ENDPOINTS) {
    item(`POST ${endpoint.path}`, `(${endpoint.format})`, "src/server.ts");
  }
  
  note("\nAll ingress endpoints accept POST requests and support both streaming and non-streaming responses.");
}

// ============================================================================
// Egress Endpoints (dynamically discovered from provider metadata)
// ============================================================================

const PROVIDER_CATEGORIES: Record<string, string> = {
  cloud: "☁️  Cloud",
  enterprise: "🏢 Enterprise", 
  local: "🏠 Local",
  custom: "🔧 Custom",
  regional: "🌏 Regional",
};

function listEgressEndpoints(): void {
  section("Egress Endpoints (Upstream Providers)");
  
  console.log(`${c.italic}These are the API endpoints the router calls on upstream providers.${c.reset}\n`);
  
  // Collect all unique endpoints and their providers
  const endpointsMap = new Map<string, { endpoint: { method: string; path: string; format: string; description?: string }; providers: string[] }>();
  const formatsMap = new Map<string, string[]>();
  
  for (const provider of Object.values(BUILTIN_PROVIDERS)) {
    const metadata = getProviderMetadata(provider.id);
    
    for (const format of metadata.formats) {
      if (!formatsMap.has(format)) formatsMap.set(format, []);
      formatsMap.get(format)!.push(provider.id);
    }
    
    for (const endpoint of metadata.endpoints) {
      const key = `${endpoint.method} ${endpoint.path}`;
      if (!endpointsMap.has(key)) {
        endpointsMap.set(key, { endpoint, providers: [] });
      }
      endpointsMap.get(key)!.providers.push(provider.id);
    }
  }
  
  // Group endpoints by implementation file
  const endpointsByImpl = new Map<string, Array<{ endpoint: typeof endpointsMap extends Map<string, infer V> ? V : never; key: string }>>();
  
  for (const [key, data] of endpointsMap) {
    const implFile = `src/providers/implementations/${data.endpoint.format.split("-")[0] === "openai" ? "openai-compatible" : data.endpoint.format.split("-")[0]}.ts`;
    if (!endpointsByImpl.has(implFile)) endpointsByImpl.set(implFile, []);
    endpointsByImpl.get(implFile)!.push({ endpoint: data, key });
  }
  
  // Show endpoints grouped by implementation
  const implOrder = [
    { name: "OpenAI-Compatible", file: "src/providers/implementations/openai-compatible.ts" },
    { name: "Anthropic", file: "src/providers/implementations/anthropic.ts" },
    { name: "Google", file: "src/providers/implementations/google.ts" },
    { name: "Azure", file: "src/providers/implementations/azure.ts" },
    { name: "AWS Bedrock", file: "src/providers/implementations/aws-bedrock.ts" },
    { name: "Cohere", file: "src/providers/implementations/cohere.ts" },
    { name: "Ollama", file: "src/providers/implementations/ollama.ts" },
  ];
  
  for (const { name, file } of implOrder) {
    const endpoints = endpointsByImpl.get(file);
    if (!endpoints || endpoints.length === 0) continue;
    
    subSection(name);
    
    for (const { endpoint: data } of endpoints) {
      const ep = data.endpoint;
      item(`${ep.method} ${ep.path}`, `(${ep.format})`, file);
      
      // Show which providers use this endpoint
      const providerList = data.providers.slice(0, 6).join(", ");
      const more = data.providers.length > 6 ? ` +${data.providers.length - 6} more` : "";
      note(`Providers: ${providerList}${more}`);
    }
  }
  
  // Provider inventory
  console.log("\n");
  subSection("Provider Inventory by Category");
  
  const byCategory: Record<string, typeof BUILTIN_PROVIDERS[string][]> = {};
  for (const provider of Object.values(BUILTIN_PROVIDERS)) {
    if (!byCategory[provider.category]) {
      byCategory[provider.category] = [];
    }
    byCategory[provider.category]!.push(provider);
  }
  
  for (const [category, providers] of Object.entries(byCategory)) {
    const categoryLabel = PROVIDER_CATEGORIES[category] || category;
    console.log(`\n  ${c.bold}${categoryLabel}${c.reset} (${providers.length})`);
    
    for (const provider of providers) {
      const metadata = getProviderMetadata(provider.id);
      const formats = metadata.formats.join(", ");
      console.log(`    ${c.green}•${c.reset} ${c.bold}${provider.id}${c.reset} ${c.dim}(${metadata.implementation}) [${formats}]${c.reset}`);
    }
  }
  
  note(`\nTotal: ${Object.keys(BUILTIN_PROVIDERS).length} built-in providers across ${PROVIDER_IMPLS.length} implementation classes`);
}

// ============================================================================
// Transformers (dynamically extracted from transformer modules)
// ============================================================================

function listTransformers(): void {
  section("Transformers (Format Converters)");
  
  console.log(`${c.italic}Functions that convert between provider formats and internal format.${c.reset}\n`);
  
  // Get all exports from transformers index
  const registryExports = getExportedFunctions(transformers);
  
  // Separate types and functions
  const registryFunctions = registryExports.filter(e => e.type === "function");
  const registryTypes = registryExports.filter(e => e.type !== "function");
  
  subSection(`Transformer Registry (${registryFunctions.length} functions)`);
  console.log(`  ${c.dim}Source: src/transformers/index.ts${c.reset}\n`);
  
  for (const fn of registryFunctions) {
    item(fn.name, "", "src/transformers/index.ts");
    note(inferFunctionDescription(fn.name, fn.type));
  }
  
  if (registryTypes.length > 0) {
    subSection(`Exported Types (${registryTypes.length})`);
    for (const t of registryTypes.slice(0, 10)) {
      console.log(`  ${c.yellow}◆${c.reset} ${t.name}`);
    }
    if (registryTypes.length > 10) {
      note(`... and ${registryTypes.length - 10} more`);
    }
  }
}

// ============================================================================
// Router
// ============================================================================

function listRouter(): void {
  section("Router (src/router/index.ts)");
  
  console.log(`${c.italic}Pattern-based request routing with wildcard support.${c.reset}\n`);
  
  const routerMethods = [
    { name: "Router (class)", desc: "Main router class with route matching logic" },
    { name: "matchPattern", desc: "Match model names against wildcard patterns (*, ?)" },
    { name: "applyTemplate", desc: "Apply capture groups to model templates (${1}, ${2})" },
    { name: "findRoute", desc: "Find matching route (top-down, first match wins)" },
    { name: "canRoute", desc: "Check if a model can be routed" },
    { name: "addRoute", desc: "Add a new route" },
    { name: "removeRoute", desc: "Remove a route by pattern" },
    { name: "setRoutes", desc: "Update all routes" },
    { name: "getRoutes", desc: "Get all configured routes" },
    { name: "getStats", desc: "Get routing statistics" },
    { name: "testPattern", desc: "Test pattern against sample models" },
  ];
  
  for (const method of routerMethods) {
    item(method.name, "", method.name.includes("(class)") ? undefined : "src/router/index.ts");
    if (method.desc) note(method.desc);
  }
}

// ============================================================================
// Provider Registry
// ============================================================================

function listProviderRegistry(): void {
  section("Provider Registry (src/providers/registry.ts)");
  
  console.log(`${c.italic}Manages provider instances and format-to-provider mappings.${c.reset}\n`);
  
  const registryMethods = [
    { name: "ProviderRegistry (class)", desc: "Central provider management" },
    { name: "register", desc: "Register a provider instance" },
    { name: "unregister", desc: "Remove a provider" },
    { name: "get", desc: "Get provider by ID" },
    { name: "has", desc: "Check if a provider exists" },
    { name: "getAll", desc: "Get all registered providers" },
    { name: "getIds", desc: "Get all registered provider IDs" },
    { name: "getProvidersForFormat", desc: "Get providers supporting a format" },
    { name: "getProviderForFormat", desc: "Get first provider for a format" },
    { name: "registerFormat", desc: "Register a format mapping" },
    { name: "initializeFromConfig", desc: "Initialize from YAML config" },
    { name: "getBuiltinProviderInfos", desc: "Get built-in provider metadata" },
    { name: "getRegisteredProviderInfos", desc: "Get registered provider status" },
    { name: "getProvidersByCategory", desc: "Get providers by category" },
    { name: "getCategories", desc: "Get provider categories" },
    { name: "createDefaultConfig", desc: "Create default config for provider" },
  ];
  
  for (const method of registryMethods) {
    item(method.name, "", method.name.includes("(class)") ? undefined : "src/providers/registry.ts");
    if (method.desc) note(method.desc);
  }
  
  // Show format mappings dynamically
  subSection("Format → Provider Mapping (from metadata)");
  
  const formatMap: Record<string, string[]> = {};
  for (const provider of Object.values(BUILTIN_PROVIDERS)) {
    const metadata = getProviderMetadata(provider.id);
    for (const format of metadata.formats) {
      if (!formatMap[format]) formatMap[format] = [];
      formatMap[format]!.push(provider.id);
    }
  }
  
  for (const [format, providers] of Object.entries(formatMap).sort()) {
    item(format, `→ ${providers.slice(0, 5).join(", ")}${providers.length > 5 ? ` +${providers.length - 5}` : ""}`);
  }
}

// ============================================================================
// Main
// ============================================================================

function printHeader(): void {
  console.log(`
${c.brightCyan}╔══════════════════════════════════════════════════════════════════════════════╗${c.reset}
${c.brightCyan}║${c.reset}           ${c.bold}Universal Model Router - Endpoint Registry${c.reset}                    ${c.brightCyan}║${c.reset}
${c.brightCyan}╚══════════════════════════════════════════════════════════════════════════════╝${c.reset}
`);
}

function printSummary(): void {
  section("Summary");
  
  // Dynamically count everything
  const registryExports = getExportedFunctions(transformers);
  const registryFunctionCount = registryExports.filter(e => e.type === "function").length;
  
  // Count unique egress endpoint paths from metadata
  const egressPaths = new Set<string>();
  const allFormats = new Set<string>();
  
  for (const provider of Object.values(BUILTIN_PROVIDERS)) {
    const metadata = getProviderMetadata(provider.id);
    for (const ep of metadata.endpoints) {
      egressPaths.add(ep.path);
    }
    for (const f of metadata.formats) {
      allFormats.add(f);
    }
  }
  
  // Count unique implementations
  const impls = new Set<string>();
  for (const provider of Object.values(BUILTIN_PROVIDERS)) {
    impls.add(getProviderMetadata(provider.id).implementation);
  }
  
  const stats = [
    { label: "Ingress Endpoints", value: INGRESS_ENDPOINTS.length.toString() },
    { label: "Egress Endpoints", value: egressPaths.size.toString() },
    { label: "Upstream Providers", value: Object.keys(BUILTIN_PROVIDERS).length.toString() },
    { label: "Implementation Classes", value: impls.size.toString() },
    { label: "Supported Formats", value: allFormats.size.toString() },
    { label: "Registry Functions", value: registryFunctionCount.toString() },
  ];
  
  for (const stat of stats) {
    console.log(`  ${c.bold}${stat.label}:${c.reset} ${c.yellow}${stat.value}${c.reset}`);
  }
  
  console.log(`\n${c.dim}Use ${c.reset}${c.bold}--ingress${c.reset}${c.dim}, ${c.reset}${c.bold}--egress${c.reset}${c.dim}, ${c.reset}${c.bold}--transformers${c.reset}${c.dim}, ${c.reset}${c.bold}--router${c.reset}${c.dim}, or ${c.reset}${c.bold}--providers${c.reset}${c.dim} to filter.${c.reset}`);
}

// Parse CLI args
const args = process.argv.slice(2);
const showAll = args.length === 0;
const showIngress = args.includes("--ingress");
const showEgress = args.includes("--egress");
const showTransformers = args.includes("--transformers");
const showRouter = args.includes("--router");
const showProviders = args.includes("--providers");

printHeader();

if (showAll || showIngress) {
  listIngressEndpoints();
}

if (showAll || showEgress || showProviders) {
  listEgressEndpoints();
}

if (showAll || showTransformers) {
  listTransformers();
}

if (showAll || showRouter) {
  listRouter();
}

if (showAll || showProviders) {
  listProviderRegistry();
}

if (showAll) {
  printSummary();
}

console.log("\n");
