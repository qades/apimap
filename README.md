# API Map - Universal Model Router

A powerful AI model gateway that routes requests between OpenAI, Anthropic, local models (Ollama, LM Studio), and more. Features a modern SvelteKit GUI for easy configuration and request monitoring.

## Features

- **Multi-Provider Support**: Route requests to OpenAI, Anthropic, Google Gemini, Groq, Together AI, Fireworks, DeepSeek, Mistral, Cohere, OpenRouter, and local providers (Ollama, LM Studio, llama.cpp, vLLM)
- **Protocol Bridging**: Use Anthropic's API format to call OpenAI-compatible providers and vice versa
- **Pattern-Based Routing**: Wildcard patterns for flexible model matching (e.g., `gpt-4*` matches all GPT-4 variants)
- **Real-Time Monitoring**: Web GUI shows unrouted requests, routing statistics, and request logs
- **Configuration Management**: Visual editor for providers, routes, and YAML configuration with automatic backups
- **Streaming Support**: Full support for streaming responses across all compatible providers

## Quick Start

### 1. Install Dependencies

```bash
bun install
cd gui && bun install && cd ..
```

### 2. Configure

Copy the example config and edit:

```bash
mkdir -p config
cp config.example.yaml config/config.yaml
```

Edit `config/config.yaml` to add your API keys and routes.

### 3. Run

Start both the API server and GUI:

```bash
# Terminal 1: Start API server
bun run dev

# Terminal 2: Start GUI
cd gui && bun run dev
```

Or use the combined start script:

```bash
bun run start:all
```

The API will be available at `http://localhost:3000` and the GUI at `http://localhost:3001`.

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

## License

MIT
