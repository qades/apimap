# API Map - Universal Model Router

[![CI](https://github.com/qades/apimap/actions/workflows/ci.yml/badge.svg)](https://github.com/qades/apimap/actions/workflows/ci.yml)
[![Benchmark](https://github.com/qades/apimap/actions/workflows/benchmark.yml/badge.svg)](https://github.com/qades/apimap/actions/workflows/benchmark.yml)
[![Benchmark Results](https://img.shields.io/badge/benchmark-results-green?logo=github)](https://qades.github.io/apimap/)
[![Feature Matrix](https://img.shields.io/badge/features-vs%20LiteLLM-blue)](./FEATURE_MATRIX.md)
[![Docker Image](https://img.shields.io/badge/docker-ghcr.io%2Fqades%2Fapimap-blue?logo=docker)](https://ghcr.io/qades/apimap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A powerful AI model gateway that routes requests between OpenAI, Anthropic, local models (Ollama, LM Studio), and more. Features a modern SvelteKit GUI for easy configuration and request monitoring.

## Features

- **Multi-Provider Support**: Route requests to OpenAI, Anthropic, Google Gemini, Groq, Together AI, Fireworks, DeepSeek, Mistral, Cohere, OpenRouter, and local providers (Ollama, LM Studio, llama.cpp, vLLM)
- **Protocol Bridging**: Use Anthropic's API format to call OpenAI-compatible providers and vice versa
- **Pattern-Based Routing**: Wildcard patterns for flexible model matching (e.g., `gpt-4*` matches all GPT-4 variants)
- **Real-Time Monitoring**: Web GUI shows unrouted requests, routing statistics, and request logs
- **Configuration Management**: Visual editor for providers, routes, and YAML configuration with automatic backups
- **Streaming Support**: Full support for streaming responses across all compatible providers

## Installation

### Option 1: Docker (Recommended)

The fastest way to get started. Works on Linux, macOS, and Windows.

```bash
curl -fsSL https://raw.githubusercontent.com/qades/apimap/main/scripts/install.sh | bash
```

This will:
- Install API Map to `~/.local/share/apimap`
- Create proper directories with correct permissions
- Set up a convenient `apimap` command
- Optionally configure systemd service (Linux)

Then start the server:
```bash
~/.local/share/apimap/apimap start
```

Or with Docker Compose:
```bash
# Create directories with correct permissions
mkdir -p config logs
sudo chown -R 1001:1001 config logs  # Linux/macOS

# Set your API keys
export OPENAI_API_KEY="your-key"
export ANTHROPIC_API_KEY="your-key"

# Start
docker-compose up -d
```

### Option 2: Binary Installation (No Docker)

For systems without Docker, install the standalone binary:

```bash
curl -fsSL https://raw.githubusercontent.com/qades/apimap/main/scripts/install-binary.sh | bash
```

This requires [Bun](https://bun.sh) (auto-installed if missing). The binary will be built from source.

Then:
```bash
apimap start
```

### Option 3: Manual Installation

See [Development](#development) section below for building from source.

## Quick Start

After installation, access:
- **API**: http://localhost:3000
- **GUI**: http://localhost:3001

Configure your providers in `config/config.yaml` or through the web GUI.

Example configuration:
```yaml
providers:
  openai:
    apiKeyEnv: "OPENAI_API_KEY"
  
  anthropic:
    apiKeyEnv: "ANTHROPIC_API_KEY"

routes:
  - pattern: "gpt-4*"
    provider: openai
    priority: 100
  
  - pattern: "claude-3*"
    provider: anthropic
    priority: 90

defaultProvider: openai
```

## Project Structure

```
/home/mk/apimap/
├── src/                          # Core source code
│   ├── types/                    # TypeScript type definitions
│   │   ├── index.ts              # Main types (config, requests, responses)
│   │   └── internal.ts           # Internal message format
│   ├── providers/                # Provider implementations
│   │   ├── base.ts               # Base provider class
│   │   ├── registry.ts           # Provider registry
│   │   └── index.ts              # Module exports
│   ├── transformers/             # Format transformers
│   │   ├── openai.ts             # OpenAI format transformer
│   │   ├── anthropic.ts          # Anthropic format transformer
│   │   └── index.ts              # Transformer registry
│   ├── config/                   # Configuration management
│   │   └── manager.ts            # Config manager with backups
│   ├── logging/                  # Logging system
│   │   └── index.ts              # Request logging and unrouted capture
│   ├── router/                   # Request routing
│   │   └── index.ts              # Pattern matching and routing
│   ├── server.ts                 # Main server entry
│   └── index.ts                  # CLI entry point
├── gui/                          # SvelteKit management GUI
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/       # Svelte components
│   │   │   ├── stores/           # Svelte stores
│   │   │   └── utils/            # API client utilities
│   │   ├── routes/               # SvelteKit routes
│   │   ├── app.html
│   │   └── app.css
│   ├── static/
│   ├── package.json
│   ├── svelte.config.js
│   └── vite.config.ts
├── config/                       # Configuration files
│   ├── config.yaml               # Active configuration
│   └── backups/                  # Config backups
├── logs/                         # Request logs
├── package.json
├── tsconfig.json
└── README.md
```

## Configuration

### Basic Example

```yaml
server:
  port: 3000
  host: "0.0.0.0"
  timeout: 120

logging:
  dir: "./logs"
  level: "info"
  maskKeys: true

providers:
  openai:
    apiKeyEnv: "OPENAI_API_KEY"
    timeout: 180
  
  anthropic:
    apiKeyEnv: "ANTHROPIC_API_KEY"
    timeout: 180
  
  ollama:
    baseUrl: "http://localhost:11434"
    timeout: 300

routes:
  - pattern: "claude-3*"
    provider: anthropic
    priority: 100
  
  - pattern: "gpt-4*"
    provider: openai
    priority: 90
  
  - pattern: "local/*"
    provider: ollama
    model: "${1}"
    priority: 80

defaultProvider: openai
```

### Pattern Syntax

- `*` - Matches any sequence of characters
- `?` - Matches any single character
- `${1}`, `${2}`, etc. - Capture groups for model mapping

### Priority System

Routes are checked in priority order (highest first). First match wins.

- `100+` - Exact matches, critical routes
- `70-99` - High priority (e.g., GPT-4, Claude)
- `50-69` - Medium priority
- `30-49` - Low priority
- `0-29` - Fallback routes

## Usage

### Using OpenAI API Format

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Using Anthropic API Format

```bash
curl http://localhost:3000/v1/messages \
  -H "x-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-opus-20240229",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Local Models via Ollama

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer dummy" \
  -d '{
    "model": "llama2:13b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Listing Available Models

The server provides a models endpoint that works like OpenAI's and Anthropic's native endpoints:

```bash
# OpenAI format (default)
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer your-key"

# Anthropic format (auto-detected by headers)
curl http://localhost:3000/v1/models \
  -H "x-api-key: your-key" \
  -H "anthropic-version: 2023-06-01"
```

The endpoint aggregates models from all configured providers and route patterns.

## GUI Features

### Dashboard
- Real-time request statistics
- Unrouted requests list with one-click route creation
- Provider status and routing overview

### Providers
- Visual configuration of all providers
- API key management (direct or environment variables)
- Custom provider support

### Routes
- Interactive route editor with priority management
- Pattern tester for validating wildcards
- Quick-add from unrouted requests

### Configuration
- Raw YAML editor with syntax validation
- Download/upload configuration
- Automatic backup on every change

### Backups
- Automatic backup creation
- One-click restore
- Backup history management

### Logs
- Request/response logging
- Error tracking
- Detailed request inspection

## Environment Variables

All built-in providers support environment variables for API keys:

- `OPENAI_API_KEY` - OpenAI
- `ANTHROPIC_API_KEY` - Anthropic
- `GOOGLE_API_KEY` - Google Gemini
- `GROQ_API_KEY` - Groq
- `TOGETHER_API_KEY` - Together AI
- `FIREWORKS_API_KEY` - Fireworks AI
- `DEEPSEEK_API_KEY` - DeepSeek
- `MISTRAL_API_KEY` - Mistral AI
- `COHERE_API_KEY` - Cohere
- `OPENROUTER_API_KEY` - OpenRouter
- `PERPLEXITY_API_KEY` - Perplexity
- `ANYSCALE_API_KEY` - Anyscale

## Management API

The server exposes a management API at `/api/admin/`:

- `GET /api/admin/status` - System status
- `GET /api/admin/providers` - List providers
- `PUT /api/admin/providers` - Update providers
- `GET /api/admin/routes` - List routes
- `PUT /api/admin/routes` - Update routes
- `GET /api/admin/unrouted` - Get unrouted requests
- `GET /api/admin/backups` - List backups
- `POST /api/admin/backups` - Create backup
- `POST /api/admin/backups/:filename` - Restore backup

## Performance

API Map is designed for high-performance routing with minimal overhead:

| Metric | Typical Value |
|--------|---------------|
| **Cold Start** | ~50ms |
| **Request Latency** | <5ms overhead |
| **Throughput** | 1000+ req/sec |
| **Memory Usage** | ~50MB base |

### Running Benchmarks

Benchmark your changes locally (runs entirely in Docker):

```bash
# Default benchmark (~5-10 minutes) - OpenAI→OpenAI protocol
bun run bench

# Full benchmark (~15-25 minutes) - ALL 16 protocol combinations
bun run bench:full

# Quick validation (~2-3 minutes) - minimal scenarios
bun run bench:quick
```

Results are saved to `bench/results/` and `bench/reports/` with detailed metrics comparing API Map against LiteLLM and Direct (baseline).

See [BENCHMARK.md](BENCHMARK.md) for detailed documentation.

See [BENCHMARK.md](BENCHMARK.md) for detailed documentation.

## Development

### API Server

```bash
bun run dev
```

### GUI

```bash
cd gui
bun run dev
```

### Build GUI for Production

```bash
cd gui
bun run build
```

## Deployment

### Automated Installation (Recommended)

Use the install script for the easiest setup:

```bash
curl -fsSL https://raw.githubusercontent.com/qades/apimap/main/scripts/install.sh | bash
```

This handles directory creation, permission setup, and provides convenient commands:
```bash
~/.local/share/apimap/apimap start   # Start server
~/.local/share/apimap/apimap stop    # Stop server
~/.local/share/apimap/apimap logs    # View logs
~/.local/share/apimap/apimap update  # Update to latest
```

### Docker Compose

For manual Docker deployment:

```bash
# 1. Clone the repository
git clone https://github.com/qades/apimap.git
cd apimap

# 2. Create directories with correct permissions
mkdir -p config logs

# Linux/macOS: Set ownership to container user (UID 1001)
sudo chown -R 1001:1001 config logs

# Alternative (less secure): Make directories world-writable
# chmod -R 777 config logs

# 3. Start with docker-compose
docker-compose up -d
```

### Docker Run

For direct Docker execution:

```bash
# Create directories with proper permissions
mkdir -p config logs
sudo chown -R 1001:1001 config logs  # Linux/macOS only

# Run container
docker run -d \
  --name apimap \
  --restart unless-stopped \
  -p 3000:3000 \
  -p 3001:3001 \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -v "$(pwd)/config:/app/config:rw" \
  -v "$(pwd)/logs:/app/logs:rw" \
  ghcr.io/qades/apimap:latest
```

### Docker with Custom Port Mapping

When running behind a reverse proxy or with custom external ports, you must tell the container about the external ports so the GUI can correctly reach the API:

```bash
# Example: Map external port 8080 to internal 3000 (API)
#          and external port 8081 to internal 3001 (GUI)
mkdir -p config logs
sudo chown -R 1001:1001 config logs

docker run -d \
  --name apimap \
  --restart unless-stopped \
  -p 8080:3000 \
  -p 8081:3001 \
  -e EXTERNAL_PORT=8080 \
  -e EXTERNAL_GUI_PORT=8081 \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -v "$(pwd)/config:/app/config:rw" \
  -v "$(pwd)/logs:/app/logs:rw" \
  ghcr.io/qades/apimap:latest
```

Access the services at:
- API: http://localhost:8080
- GUI: http://localhost:8081

The `EXTERNAL_PORT` and `EXTERNAL_GUI_PORT` environment variables ensure the GUI knows how to reach the API from the browser's perspective.

### Permission Troubleshooting

The container runs as user `apimap` (UID 1001). If you see "permission denied" errors:

**Linux/macOS:**
```bash
# Set ownership to container user
sudo chown -R 1001:1001 ./config ./logs
```

**All platforms (fallback):**
```bash
# Make directories world-writable (less secure, but works everywhere)
chmod -R 777 ./config ./logs
```

**Without persistent volumes:**
Simply omit the volume mounts (logs/config will be lost when container stops):
```bash
docker run -d -p 3000:3000 -p 3001:3001 ghcr.io/qades/apimap:latest
```

### Environment Variables

#### Port Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `EXTERNAL_PORT` | External port for API (when using port mapping) | Same as internal port (3000) |
| `EXTERNAL_GUI_PORT` | External port for GUI (when using port mapping) | Same as internal port (3001) |
| `API_PORT` | Internal API port (inside container) | 3000 |
| `GUI_PORT` | Internal GUI port (inside container) | 3001 |

**Important for Docker users:** When mapping ports (e.g., `-p 8080:3000`), always set `EXTERNAL_PORT=8080` so the GUI can correctly reach the API.

#### API Keys

All supported API keys can be passed as environment variables:

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GOOGLE_API_KEY` | Google Gemini |
| `GROQ_API_KEY` | Groq |
| `TOGETHER_API_KEY` | Together AI |
| `FIREWORKS_API_KEY` | Fireworks AI |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `MISTRAL_API_KEY` | Mistral AI |
| `COHERE_API_KEY` | Cohere |
| `OPENROUTER_API_KEY` | OpenRouter |
| `PERPLEXITY_API_KEY` | Perplexity |
| `ANYSCALE_API_KEY` | Anyscale |

### Building from Source

```bash
# Build the Docker image (image will be lowercase: qades/apimap:latest)
docker build -t qades/apimap:latest .

# Or use docker-compose with local build
docker-compose build
```

## License

MIT
