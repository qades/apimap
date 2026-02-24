# Universal Model Router

The ultimate AI model router - a fast, lightweight gateway that routes requests between different LLM providers (OpenAI, Anthropic, local models, and more) with a unified configuration-driven approach. Built with Bun for maximum performance.

## Features

- 🚀 **Fast**: Built with Bun's high-performance HTTP server
- 🌐 **Multi-API**: Listen on both OpenAI and Anthropic API endpoints simultaneously
- 🔄 **Universal Routing**: Route any model to any provider using pattern matching
- 📋 **YAML Configuration**: Clean, maintainable config with anchors and aliases
- 🏠 **Local LLM Support**: Ollama, LM Studio, llama.cpp, vLLM
- ☁️ **Cloud Providers**: OpenAI, Anthropic, Groq, Together, Fireworks, DeepSeek, and more
- 🔄 **Streaming**: Full SSE streaming support
- 🛠️ **Tool Calls**: Complete tool use/call support
- 🔑 **Flexible Auth**: Environment variables, request headers, or config-based keys
- 📝 **Request Logging**: Detailed conversation logging
- 🌐 **CORS Support**: Configurable CORS headers
- ⏱️ **Timeouts**: Per-provider and global timeout configuration
- 🔥 **Preload**: Warm up models on startup
- 🧩 **Extensible**: Easy to add new providers and API schemes

## Quick Start

1. **Install dependencies**:
```bash
bun install
```

2. **Configure** (edit `config.yaml`):
```yaml
providers:
  openai:
    # Uses OPENAI_API_KEY env var by default
  
  anthropic:
    # Uses ANTHROPIC_API_KEY env var by default
  
  ollama:
    baseUrl: "http://localhost:11434"

routes:
  - pattern: "claude-*"
    provider: anthropic
  
  - pattern: "gpt-*"
    provider: openai
  
  - pattern: "llama*"
    provider: ollama

defaultProvider: openai
```

3. **Run**:
```bash
bun run index.ts
```

## Installation

```bash
# Clone or download the project
cd universal-model-router

# Install dependencies
bun install

# Copy example config
cp config.example.yaml config.yaml

# Edit config.yaml with your settings
```

## Configuration

The router is configured via YAML files. See `config.example.yaml` for a comprehensive example.

### Basic Configuration Structure

```yaml
server:
  port: 3000
  host: "0.0.0.0"
  cors:
    origin: "*"
  timeout: 120

logging:
  dir: "./logs"
  level: "info"

preload:
  enabled: true
  models:
    - "gpt-4o-mini"

schemes:
  - id: anthropic
    path: "/v1/messages"
    format: "anthropic"
  
  - id: openai
    path: "/v1/chat/completions"
    format: "openai"

providers:
  openai:
    timeout: 180
  
  anthropic:
    apiKeyEnv: "ANTHROPIC_API_KEY"
  
  ollama:
    baseUrl: "http://localhost:11434"

routes:
  - pattern: "claude-*"
    provider: anthropic
    priority: 100
  
  - pattern: "gpt-*"
    provider: openai
    priority: 90
  
  - pattern: "local/*"
    provider: ollama
    model: "${1}"
    priority: 80

defaultProvider: openai
```

### Server Options

```yaml
server:
  port: 3000              # Port to listen on
  host: "0.0.0.0"         # Host to bind (0.0.0.0 = all interfaces)
  timeout: 120            # Request timeout in seconds
  cors:
    origin: "*"           # CORS origin (* or specific domain)
    credentials: false    # Allow credentials
```

### Logging Options

```yaml
logging:
  dir: "./logs"           # Log directory (omit to disable)
  level: "info"           # debug, info, warn, error
  maskKeys: true          # Mask API keys in logs
```

### Preload Options

```yaml
preload:
  enabled: true           # Warm up models on startup
  models:                 # List of models to preload
    - "gpt-4o-mini"
    - "claude-3-haiku"
```

### API Schemes

Define which API endpoints to expose:

```yaml
schemes:
  - id: anthropic
    path: "/v1/messages"
    format: "anthropic"
  
  - id: openai
    path: "/v1/chat/completions"
    format: "openai"
```

Supported formats: `openai`, `anthropic`, `openai-compatible`

### Providers

Built-in providers with sensible defaults:

| Provider | Base URL | API Key Env Var |
|----------|----------|-----------------|
| `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `anthropic` | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `google` | `https://generativelanguage.googleapis.com/v1beta` | `GOOGLE_API_KEY` |
| `ollama` | `http://localhost:11434` | - |
| `lmstudio` | `http://localhost:1234/v1` | - |
| `llamacpp` | `http://localhost:8080/v1` | - |
| `vllm` | `http://localhost:8000/v1` | - |
| `fireworks` | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` |
| `together` | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` |
| `groq` | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| `perplexity` | `https://api.perplexity.ai` | `PERPLEXITY_API_KEY` |
| `anyscale` | `https://api.endpoints.anyscale.com/v1` | `ANYSCALE_API_KEY` |
| `deepseek` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` |
| `mistral` | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` |
| `cohere` | `https://api.cohere.ai/v1` | `COHERE_API_KEY` |
| `openrouter` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |

#### Provider Configuration Options

```yaml
providers:
  myprovider:
    baseUrl: "https://api.example.com/v1"    # Required for custom providers
    apiKey: "sk-..."                          # Static API key
    apiKeyEnv: "MY_API_KEY"                   # Environment variable name
    authHeader: "Authorization"               # Header name for auth
    authPrefix: "Bearer "                     # Prefix for auth header
    headers:                                  # Additional headers
      X-Custom-Header: "value"
    timeout: 120                              # Timeout in seconds
    supportsStreaming: true                   # Whether streaming is supported
```

### Routes

Routes define how model names are mapped to providers. Patterns support wildcards:

- `*` - matches any sequence of characters
- `?` - matches any single character

```yaml
routes:
  - pattern: "claude-3-opus*"      # Matches claude-3-opus-20240229, etc.
    provider: anthropic
    priority: 100                   # Higher = checked first
  
  - pattern: "gpt-4*"              # Matches gpt-4, gpt-4-turbo, etc.
    provider: openai
    priority: 90
  
  - pattern: "local/*"             # Matches local/anything
    provider: ollama
    model: "${1}"                   # Use capture group (anything after local/)
    priority: 80
```

### YAML Anchors and Aliases

Use YAML anchors (`&`) and aliases (`*`) to avoid repetition:

```yaml
providers:
  # Define base settings
  openai: &openai-defaults
    baseUrl: "https://api.openai.com/v1"
    apiKeyEnv: "OPENAI_API_KEY"
    timeout: 180
  
  # Inherit and override
  openai-azure:
    <<: *openai-defaults
    baseUrl: "https://myaccount.openai.azure.com/openai/deployments"
    apiKeyEnv: "AZURE_OPENAI_KEY"
  
  # Another override
  openai-backup:
    <<: *openai-defaults
    apiKeyEnv: "OPENAI_BACKUP_KEY"
```

## Usage

### Anthropic API Format

```bash
curl http://localhost:3000/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-3-sonnet-20240229",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### OpenAI API Format

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "authorization: Bearer $OPENAI_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Local Models (Ollama)

```bash
# If you have a route like: pattern: "llama*", provider: ollama
curl http://localhost:3000/v1/chat/completions \
  -H "authorization: Bearer dummy" \
  -d '{
    "model": "llama2:13b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### With Provider Prefix

```yaml
# Config
routes:
  - pattern: "groq/*"
    provider: groq
    model: "${1}"
```

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "authorization: Bearer $GROQ_API_KEY" \
  -d '{
    "model": "groq/llama-3.1-70b-versatile",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## CLI Options

```bash
bun run index.ts [options]

Options:
  --config <path>        Path to YAML config file (default: config.yaml)
  --port <number>        Override port from config
  --log-dir <path>       Override log directory from config
  --timeout <seconds>    Override timeout from config
  --help                 Show help message

Examples:
  bun run index.ts
  bun run index.ts --config ./production.yaml
  bun run index.ts --port 8080 --log-dir ./logs
```

## Environment Variables

The router reads API keys from environment variables based on provider configuration:

```bash
# Required for cloud providers
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GROQ_API_KEY="gsk_..."

# Run the server
bun run index.ts
```

Or use a `.env` file (loaded automatically by Bun):

```bash
# .env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## Advanced Examples

### Example 1: Smart Routing by Model Type

```yaml
routes:
  # Coding models → Anthropic (Claude is great at coding)
  - pattern: "*code*"
    provider: anthropic
    priority: 100
  
  # Fast/cheap models → Groq
  - pattern: "*fast*"
    provider: groq
    priority: 90
  
  # Everything else → OpenAI
  - pattern: "*"
    provider: openai
    priority: 10
```

### Example 2: Multi-Region Fallback

```yaml
providers:
  openai-us: &openai
    baseUrl: "https://api.openai.com/v1"
    apiKeyEnv: "OPENAI_API_KEY"
  
  openai-eu:
    <<: *openai
    baseUrl: "https://api.openai.com/v1"  # Same but different routing logic

routes:
  - pattern: "gpt-4*"
    provider: openai-us
    priority: 100
```

### Example 3: Cost-Optimized Routing

```yaml
routes:
  # Small/fast tasks → Groq (cheap & fast)
  - pattern: "*haiku*"
    provider: groq
    model: "llama-3.1-8b-instant"
    priority: 100
  
  # Medium tasks → Together AI
  - pattern: "*sonnet*"
    provider: together
    model: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo"
    priority: 100
  
  # Complex tasks → Anthropic
  - pattern: "*opus*"
    provider: anthropic
    priority: 100
```

### Example 4: Development vs Production

```yaml
providers:
  # Local development
  local-dev:
    baseUrl: "http://localhost:11434"
  
  # Production
  openai-prod:
    apiKeyEnv: "OPENAI_API_KEY"

routes:
  - pattern: "dev/*"
    provider: local-dev
    model: "${1}"
    priority: 100
  
  - pattern: "prod/*"
    provider: openai-prod
    model: "${1}"
    priority: 100
```

Usage:
```bash
# Development
curl ... -d '{"model": "dev/llama2"}'

# Production
curl ... -d '{"model": "prod/gpt-4o"}'
```

## Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "requestId": "...",
  "version": "2.0.0",
  "schemes": ["anthropic", "openai"],
  "providers": ["openai", "anthropic", "ollama", "groq", ...]
}
```

## Logging

When logging is enabled, each request is saved as a JSON file:

```
logs/
  000001_anthropic_claude-3-opus_abc123.json
  000002_openai_gpt-4o_def456.json
  000003_ollama_llama2_ghi789.json
```

Each log contains:
- Request and response headers (with masked API keys)
- Request body
- Transformed body (if applicable)
- Response body or error
- Duration

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Client        │────▶│  Universal       │────▶│  OpenAI API     │
│                 │     │  Model Router    │     │                 │
│  Anthropic SDK  │────▶│                  │────▶│  Anthropic API  │
│                 │     │  - Route matching│     │                 │
│  OpenAI SDK     │────▶│  - Transform     │────▶│  Groq API       │
│                 │     │  - Auth handling │     │                 │
│  curl/HTTP      │────▶│  - Logging       │────▶│  Ollama         │
│                 │     │                  │     │  (local)        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │  Config YAML │
                        │  (routes)    │
                        └──────────────┘
```

## Adding New Providers

To add a new provider, simply add it to the `providers` section:

```yaml
providers:
  my-provider:
    baseUrl: "https://api.myprovider.com/v1"
    apiKeyEnv: "MY_PROVIDER_KEY"
    authHeader: "Authorization"
    authPrefix: "Bearer "
    headers:
      X-Custom-Header: "value"
```

Then create a route:

```yaml
routes:
  - pattern: "myprovider/*"
    provider: my-provider
    model: "${1}"
```

## Troubleshooting

### Connection refused to local provider

Ensure your local LLM server is running:

```bash
# Ollama
ollama serve

# LM Studio
# Start LM Studio and enable the local server

# llama.cpp
./server -m model.gguf
```

### API key not found

Set the environment variable or configure in YAML:

```yaml
providers:
  openai:
    apiKey: "sk-..."           # Option 1: Direct in config
    # apiKeyEnv: "MY_KEY"      # Option 2: Custom env var name
```

### Request timeouts

Increase timeout for slow providers:

```yaml
providers:
  ollama:
    baseUrl: "http://localhost:11434"
    timeout: 600  # 10 minutes for large local models
```

### Pattern not matching

Routes are checked by priority (higher first), then order. Ensure your pattern is correct:

```yaml
routes:
  - pattern: "claude-*"     # Correct: matches claude-3-opus
  - pattern: "claude*"      # Also correct: matches anything starting with claude
  - pattern: "claude-3*"    # More specific: only matches claude-3 series
```

## License

MIT
