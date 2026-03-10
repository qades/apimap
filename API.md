# API Map - API Specification

> **One API endpoint. Every LLM. Zero config changes.**

## Overview

The API Map server provides a unified gateway that translates between different LLM API formats (OpenAI, Anthropic, Ollama, etc.). Point any LLM client at `http://localhost:3000` and it just works—regardless of which provider the client expects to talk to.

## Quick Start

```bash
# Start the server
bun run src/server.ts

# Use it like OpenAI
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'

# Or use it like Anthropic
curl http://localhost:3000/v1/messages \
  -H "x-api-key: sk-your-key" \
  -d '{"model": "claude-3-opus", "messages": [{"role": "user", "content": "Hello"}]}'
```

## Core Philosophy: Zero-Config Switching

The API Map handles three things automatically:

1. **Format Translation** - Convert between OpenAI, Anthropic, and other formats
2. **Model Routing** - Send requests to the correct upstream provider
3. **Authentication** - Manage API keys transparently

You set the base URL once. Everything else is handled.

---

## Public API Endpoints

### Health Check
```
GET /
GET /health
```

Returns server status and available schemes.

**Response:**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "requestId": "abc123",
  "providers": ["openai", "anthropic", "ollama"],
  "schemes": ["openai", "anthropic"]
}
```

### Chat Completions (OpenAI Format)
```
POST /v1/chat/completions
```

Standard OpenAI-compatible endpoint. Supports both streaming and non-streaming.

**Headers:**
- `Authorization: Bearer <token>` - API key (optional if configured in provider)
- `Content-Type: application/json`

**Request Body:**
```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "Hello!"}
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": false
}
```

**Response (non-streaming):**
```json
{
  "id": "chat-123",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "gpt-4o",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

**Response (streaming):**
```
data: {"id":"chat-123","choices":[{"delta":{"content":"Hello"}}]}

data: {"id":"chat-123","choices":[{"delta":{"content":"!"}}]}

data: [DONE]
```

### Messages (Anthropic Format)
```
POST /v1/messages
```

Standard Anthropic Messages API endpoint.

**Headers:**
- `x-api-key: <token>` - API key (optional if configured in provider)
- `anthropic-version: 2023-06-01` - Required by Anthropic format
- `Content-Type: application/json`

**Request Body:**
```json
{
  "model": "claude-3-opus-20240229",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": "Hello!"}
  ]
}
```

**Response:**
```json
{
  "id": "msg_01234",
  "type": "message",
  "role": "assistant",
  "model": "claude-3-opus-20240229",
  "content": [{"type": "text", "text": "Hello! How can I help?"}],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 20
  }
}
```

### List Models
```
GET /v1/models
```

Returns available models from all configured providers and routes. The server fetches models from upstream providers (OpenAI, Anthropic, Ollama, etc.) and merges them with configured route patterns.

**OpenAI-Compatible Format** (default):
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1700000000,
      "owned_by": "openai"
    },
    {
      "id": "claude-3-opus-20240229",
      "object": "model",
      "created": 1700000000,
      "owned_by": "anthropic"
    }
  ]
}
```

**Anthropic-Compatible Format** (when using `anthropic-version` or `x-api-key` header):
```json
{
  "data": [
    {
      "type": "model",
      "id": "claude-3-opus-20240229",
      "display_name": "Claude 3 Opus",
      "created_at": "2024-01-01T00:00:00Z"
    },
    {
      "type": "model",
      "id": "gpt-4o",
      "display_name": "gpt-4o",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "has_more": false,
  "first_id": "claude-3-opus-20240229",
  "last_id": "gpt-4o"
}
```

**Headers:**
- `Authorization: Bearer <token>` - Standard OpenAI auth
- `x-api-key: <token>` - Anthropic-style auth (switches response format)
- `anthropic-version: 2023-06-01` - Required for Anthropic format

The endpoint automatically detects the expected format based on request headers:
- If `anthropic-version` or `x-api-key` header is present, returns Anthropic format
- Otherwise, returns OpenAI format

---

## Management API

Base path: `/api/admin`

All management endpoints return JSON and support CORS for GUI access.

### System Status
```
GET /api/admin/status
```

**Response:**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "uptime": 3600,
  "configPath": "/path/to/config.yaml",
  "providers": ["openai", "anthropic"],
  "routes": 12,
  "totalRequests": 1523,
  "routedRequests": 1500,
  "unroutedRequests": 23,
  "averageLatency": 450
}
```

### Providers

#### List Providers
```
GET /api/admin/providers
```

**Response:**
```json
{
  "registered": [
    {
      "id": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY",
      "configured": true
    }
  ],
  "builtin": [
    {
      "id": "openai",
      "name": "OpenAI",
      "description": "GPT-4, GPT-3.5 models",
      "defaultBaseUrl": "https://api.openai.com/v1",
      "defaultApiKeyEnv": "OPENAI_API_KEY",
      "requiresApiKey": true,
      "supportsStreaming": true,
      "category": "cloud"
    }
  ]
}
```

#### Update Providers
```
PUT /api/admin/providers
```

**Request Body:**
```json
{
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY",
      "timeout": 120
    }
  }
}
```

### Routes

#### List Routes
```
GET /api/admin/routes
```

**Response:**
```json
{
  "routes": [
    {
      "pattern": "gpt-4*",
      "provider": "openai",
      "priority": 100
    },
    {
      "pattern": "claude-3*",
      "provider": "anthropic",
      "priority": 90
    }
  ]
}
```

#### Update All Routes
```
PUT /api/admin/routes
```

**Request Body:**
```json
{
  "routes": [
    {"pattern": "gpt-4*", "provider": "openai", "priority": 100},
    {"pattern": "claude-3*", "provider": "anthropic", "priority": 90}
  ]
}
```

#### Add Single Route
```
POST /api/admin/routes
```

**Request Body:**
```json
{
  "pattern": "custom/*",
  "provider": "ollama",
  "model": "${1}",
  "priority": 50
}
```

### Configuration

#### Get Full Config
```
GET /api/admin/config
```

Returns the complete configuration object.

#### Save Config
```
POST /api/admin/config
```

**Request Body:** Complete RouterConfig object (see Configuration Schema below).

### Schemes

#### List Schemes
```
GET /api/admin/schemes
```

#### Update Schemes
```
PUT /api/admin/schemes
```

### Backups

#### List Backups
```
GET /api/admin/backups
```

**Response:**
```json
{
  "backups": [
    {
      "filename": "config-backup-2024-01-15T10-30-00-000Z.yaml",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "size": 2048
    }
  ]
}
```

#### Create Backup
```
POST /api/admin/backups
```

Creates a timestamped backup of current config.

#### Restore Backup
```
POST /api/admin/backups/:filename
```

Restores configuration from a backup file.

#### Delete Backup
```
DELETE /api/admin/backups/:filename
```

### Unrouted Requests

#### Get Unrouted
```
GET /api/admin/unrouted
```

Returns requests that couldn't be matched to any route.

**Response:**
```json
{
  "unrouted": [
    {
      "id": "req_123",
      "timestamp": "2024-01-15T10:30:00Z",
      "model": "unknown-model",
      "endpoint": "/v1/chat/completions",
      "fullRequest": {...}
    }
  ]
}
```

#### Clear Unrouted
```
DELETE /api/admin/unrouted
```

### Logs

#### Get Recent Logs
```
GET /api/admin/logs?limit=50
```

Returns recent request logs with full request/response details.

**Response:**
```json
{
  "logs": [
    {
      "timestamp": "2024-01-15T10:30:00Z",
      "requestId": "req_123",
      "model": "gpt-4o",
      "provider": "openai",
      "responseStatus": 200,
      "durationMs": 450,
      "requestBody": {...},
      "responseBody": {...}
    }
  ]
}
```

### Default Provider

#### Get Default
```
GET /api/admin/default-provider
```

#### Update Default
```
PUT /api/admin/default-provider
```

**Request Body:**
```json
{"defaultProvider": "openai"}
```

### Test Model
```
POST /api/admin/test-model
```

Test a model directly from the GUI.

**Request Body:**
```json
{
  "model": "gpt-4o",
  "message": "Hello",
  "systemMessage": "Be helpful",
  "temperature": 0.7,
  "maxTokens": 1024,
  "stream": false,
  "apiFormat": "openai-chat"
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | Yes | Model identifier to test |
| `message` | string | Yes | Test message to send |
| `systemMessage` | string | No | System/instructions message |
| `temperature` | number | No | Sampling temperature (0-2) |
| `maxTokens` | number | No | Maximum tokens to generate |
| `stream` | boolean | No | Enable streaming response |
| `apiFormat` | string | No | API format identifier (see below) |

**API Formats:**

The `apiFormat` field identifies both the serialization format and the endpoint type:

| Value | Format | Endpoint Type | Description |
|-------|--------|---------------|-------------|
| `openai-chat` | OpenAI | Chat Completions | Standard chat completions (`/v1/chat/completions`) |
| `openai-completions` | OpenAI | Legacy Completions | Text completions (`/v1/completions`) |
| `openai-responses` | OpenAI | Responses API | New responses API (`/v1/responses`) |
| `anthropic-messages` | Anthropic | Messages | Anthropic messages (`/v1/messages`) |
| `ollama-generate` | Ollama | Generate | Ollama generate endpoint |
| `ollama-chat` | Ollama | Chat | Ollama chat endpoint |

**Default:** If `apiFormat` is omitted, the server attempts to infer the appropriate format based on the configured schemes and model routing.

---

## Architecture Overview

The API Map uses a three-layer architecture that separates concerns between how requests are received, how they're transformed, and where they're sent:

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Scheme    │────▶│ Transformer  │────▶│  Provider   │
│  (abstract) │     │  (format)    │     │ (endpoints) │
└─────────────┘     └──────────────┘     └─────────────┘
```

### Schemes
Schemes define how the API Map **receives** requests. Each scheme has an ID and references a transformer format. Example schemes: `openai-chat`, `anthropic-messages`, `openai-responses`.

### Transformers
Transformers handle format conversion between the internal representation and provider-specific formats. They are shared across providers - for example, the `openai-chat` transformer is used by OpenAI, Groq, Together, and any other OpenAI-compatible provider.

### Providers
Providers define **where** requests are sent. Each provider internally maps format variants to their specific endpoint URIs. For example, the OpenAI provider knows that `openai-chat` maps to `/v1/chat/completions` while `openai-responses` maps to `/v1/responses`.

### Request Flow

1. Request arrives at a scheme endpoint (e.g., `/v1/chat/completions` for `openai-chat` scheme)
2. Request is parsed into internal format by the scheme's transformer
3. Router finds the appropriate provider based on model routing rules
4. Provider's endpoint is selected based on the format variant
5. Request is serialized to provider format and sent

---

## Configuration Schema

### RouterConfig

```typescript
interface RouterConfig {
  server?: {
    port?: number;           // Default: 3000
    host?: string;           // Default: "0.0.0.0"
    cors?: {
      origin?: string | string[];  // Default: "*"
      credentials?: boolean;       // Default: false
    };
    timeout?: number;        // Default: 120 (seconds)
  };
  
  logging?: {
    dir?: string;            // Default: "./logs"
    level?: "debug" | "info" | "warn" | "error";  // Default: "info"
    maskKeys?: boolean;      // Default: true
  };
  
  preload?: {
    enabled?: boolean;       // Default: false
    models?: string[];       // Models to warm up on startup
  };
  
  schemes?: ApiSchemeConfig[];
  providers: Record<string, ProviderConfig>;
  routes: RouteConfig[];
  defaultProvider?: string;
}
```

### ProviderConfig

```typescript
interface ProviderConfig {
  baseUrl: string;           // API base URL
  apiKey?: string;           // Direct API key (optional)
  apiKeyEnv?: string;        // Environment variable name (optional)
  authHeader?: string;       // Default: "Authorization"
  authPrefix?: string;       // Default: "Bearer "
  headers?: Record<string, string>;  // Additional headers
  timeout?: number;          // Override default timeout
  supportsStreaming?: boolean;
  format?: string;           // Default transformer format for this provider
}
```

**Provider Endpoints (Internal):**

Each provider internally maps format variants to their endpoint URIs:

| Provider | Format | Internal Endpoint |
|----------|--------|-------------------|
| openai | openai-chat | /v1/chat/completions |
| openai | openai-completions | /v1/completions |
| openai | openai-responses | /v1/responses |
| anthropic | anthropic-messages | /v1/messages |
| ollama | ollama-chat | /api/chat |
| ollama | ollama-generate | /api/generate |

These mappings are internal implementation details - users configure schemes using abstract format identifiers.

### RouteConfig

```typescript
interface RouteConfig {
  pattern: string;           // Model name pattern (* = wildcard)
  provider: string;          // Provider ID
  model?: string;            // Upstream model name (optional)
  priority?: number;         // Auto-assigned from array order (optional)
}
```

**Note:** Routes are matched in **array order** (first match wins). The `priority` field is automatically computed from the array position when not explicitly provided. The first route has the highest priority, the last route has the lowest. This simplifies configuration—just order your routes from most specific to most general.

### ApiSchemeConfig

```typescript
interface ApiSchemeConfig {
  id: string;               // Scheme identifier (e.g., "openai-chat", "anthropic-messages")
  format: string;           // Transformer format (e.g., "openai-chat", "openai-responses")
}
```

**Note:** The `format` field references a transformer that handles both request parsing and response serialization. Schemes are abstract - the actual endpoint URIs are internal to provider implementations.

---

## Pattern Matching

Routes use glob-style patterns for model matching:

| Pattern | Matches |
|---------|---------|
| `gpt-4*` | gpt-4o, gpt-4-turbo, gpt-4o-mini |
| `claude-3-*` | claude-3-opus, claude-3-sonnet |
| `local/*` | local/llama2, local/mistral |
| `??` | Any two characters |

### Capture Groups

Use `${1}`, `${2}`, etc. to capture wildcard values:

```yaml
routes:
  - pattern: "local/*"
    provider: ollama
    model: "${1}"  # "local/mistral" → "mistral"
```

### Route Ordering

Routes are checked in **array order** (first to last, top to bottom). The first matching route wins.

```yaml
routes:
  # Checked first - specific patterns at top
  - pattern: "claude-3-opus*"
    provider: anthropic
  
  # Checked second
  - pattern: "gpt-4*"
    provider: openai
  
  # Checked last - catch-all patterns at bottom
  - pattern: "local/*"
    provider: ollama
```

**Design principle:** Order routes from **most specific** to **most general**. The `priority` field is auto-assigned internally based on array position—you don't need to specify it in the config file.

---

## Built-in Providers

| Provider | Base URL | API Key Env | Category |
|----------|----------|-------------|----------|
| openai | https://api.openai.com/v1 | OPENAI_API_KEY | cloud |
| anthropic | https://api.anthropic.com | ANTHROPIC_API_KEY | cloud |
| google | https://generativelanguage.googleapis.com/v1beta | GOOGLE_API_KEY | cloud |
| groq | https://api.groq.com/openai/v1 | GROQ_API_KEY | cloud |
| together | https://api.together.xyz/v1 | TOGETHER_API_KEY | cloud |
| fireworks | https://api.fireworks.ai/inference/v1 | FIREWORKS_API_KEY | cloud |
| deepseek | https://api.deepseek.com | DEEPSEEK_API_KEY | cloud |
| mistral | https://api.mistral.ai/v1 | MISTRAL_API_KEY | cloud |
| cohere | https://api.cohere.ai/v1 | COHERE_API_KEY | cloud |
| openrouter | https://openrouter.ai/api/v1 | OPENROUTER_API_KEY | cloud |
| perplexity | https://api.perplexity.ai | PERPLEXITY_API_KEY | cloud |
| anyscale | https://api.endpoints.anyscale.com/v1 | ANYSCALE_API_KEY | cloud |
| ollama | http://localhost:11434 | - | local |
| lmstudio | http://localhost:1234/v1 | - | local |
| llamacpp | http://localhost:8080/v1 | - | local |
| vllm | http://localhost:8000/v1 | - | local |

---

## Error Responses

All errors return JSON with an `error` field:

```json
{
  "error": "No route found for model",
  "model": "unknown-model",
  "requestId": "req_abc123"
}
```

Common status codes:

| Code | Meaning |
|------|---------|
| 400 | Invalid request (missing model, bad JSON) |
| 404 | No route found for model |
| 401/403 | Authentication failed |
| 502 | Upstream provider error |
| 504 | Request timeout |

---

## Streaming Format

The API Map transparently passes through streaming responses. Both OpenAI (`data: {...}\n\n`) and Anthropic (`data: {...}\n\n`) SSE formats are supported.

When translating between formats, the server:
1. Receives the upstream stream
2. Parses each chunk
3. Re-serializes in the requested format
4. Streams to the client

This allows an Anthropic-format client to receive streaming responses from an OpenAI-compatible provider.

---

## CLI Options

```bash
bun run src/server.ts [options]

Options:
  --config <path>        Config file path (default: config/config.yaml)
  --port <number>        Override port from config
  --log-dir <path>       Override log directory
  --timeout <seconds>    Override timeout
  --gui-port <number>    Port for GUI server (default: 3001, 0 to disable)
  --help                 Show help
```

---

## Environment Variables

The server respects these environment variables for provider API keys:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `GROQ_API_KEY`
- `TOGETHER_API_KEY`
- `FIREWORKS_API_KEY`
- `DEEPSEEK_API_KEY`
- `MISTRAL_API_KEY`
- `COHERE_API_KEY`
- `OPENROUTER_API_KEY`
- `PERPLEXITY_API_KEY`
- `ANYSCALE_API_KEY`

These are used when `apiKeyEnv` is configured for a provider and no direct `apiKey` is set.
