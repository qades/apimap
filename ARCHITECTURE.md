# API Map - Architecture Overview

This document provides a high-level overview of how the API and GUI work together.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                     │
│  (Claude Desktop, Continue.dev, OpenWebUI, Custom Apps, curl, etc.)     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/WebSocket
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API MAP SERVER                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   OpenAI     │  │  Anthropic   │  │    Other     │  │  Management  │ │
│  │   Endpoint   │  │   Endpoint   │  │   Endpoints  │  │     API      │ │
│  │/v1/chat/... │  │ /v1/messages │  │              │  │ /api/admin/* │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                 │                 │                 │         │
│         └─────────────────┴─────────────────┘                 │         │
│                           │                                   │         │
│                    ┌──────▼──────┐                    ┌──────▼──────┐  │
│                    │   Router    │◄───────────────────│  Config     │  │
│                    │  (Pattern   │    Auto-reload on  │  Manager    │  │
│                    │   Matching) │    change          │  (YAML +    │  │
│                    └──────┬──────┘                    │  Backups)   │  │
│                           │                           └─────────────┘  │
│                    ┌──────▼──────┐                                      │
│                    │ Transformers│  ┌──────────────┐  ┌──────────────┐ │
│                    │(Format Conv)│  │   Provider   │  │    Logger    │ │
│                    └──────┬──────┘  │   Registry   │  │              │ │
│                           │         │              │  │              │ │
└───────────────────────────┼─────────┴──────┬───────┴──┴──────┬───────┘
                            │                │                 │
                            ▼                ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         UPSTREAM PROVIDERS                               │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌─────────┐  │
│  │ OpenAI  │ │Anthropic │ │  Groq  │ │Ollama  │ │ Custom │ │   ...   │  │
│  └─────────┘ └──────────┘ └────────┘ └────────┘ └────────┘ └─────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket / HTTP
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         MANAGEMENT GUI                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │Dashboard │ │Providers │ │ Routes   │ │  Test    │ │  Logs    │       │
│  │          │ │          │ │          │ │  Models  │ │          │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                                         │
│  ┌──────────┐ ┌──────────┐                                              │
│  │ Backups  │ │  Config  │                                              │
│  │(Rollback)│ │  (YAML)  │                                              │
│  └──────────┘ └──────────┘                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Request Flow (Client → Provider)

```
Client Request
      │
      ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Parse Model │────►│ Find Route  │────►│ Get Provider│
│    Name     │     │ by Pattern  │     │   Config    │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
      ┌────────────────────────────────────────┘
      ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Transform  │────►│   Forward   │────►│   Return    │
│   Request   │     │  Upstream   │     │  Response   │
└─────────────┘     └─────────────┘     └─────────────┘
```

### 2. Config Change Flow (GUI → Server)

```
User Action
      │
      ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Validate   │────►│ Create      │────►│   Update    │
│    Input    │     │ Backup      │     │   Server    │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │ Auto-reload │
                                        │   Config    │
                                        └─────────────┘
```

## Key Design Decisions

### 1. Single Config File

Everything lives in `config/config.yaml`:
- Server settings
- Provider configurations  
- Routing rules
- Logging preferences

**Benefits:**
- Easy backup/restore
- Version control friendly
- Human readable
- Single source of truth

### 2. Pattern-Based Routing

Instead of maintaining a database of every model, use patterns:

```yaml
routes:
  - pattern: "gpt-4*"        # Matches gpt-4o, gpt-4-turbo, etc.
    provider: openai
  - pattern: "claude-3*"     # Matches all Claude 3 variants
    provider: anthropic
  - pattern: "local/*"       # User-defined prefix
    provider: ollama
    model: "${1}"            # Strip the prefix
```

**Benefits:**
- Works with new models automatically
- No DB migrations needed
- Expressive and flexible
- Easy to understand

### 3. Format Translation

The server speaks multiple API formats:

| Client Speaks | Provider Speaks | Translation |
|--------------|-----------------|-------------|
| OpenAI       | OpenAI          | Passthrough |
| Anthropic    | Anthropic       | Passthrough |
| OpenAI       | Anthropic       | Converted   |
| Anthropic    | OpenAI          | Converted   |

**Benefits:**
- Any client works with any provider
- No client-side changes needed
- Gradual migration path

### 4. Auto-Save with Backups

Every configuration change:
1. Creates a timestamped backup
2. Saves to YAML
3. Notifies running server
4. Server reloads config

**Benefits:**
- Never lose work
- Easy rollback
- No restart required
- Audit trail

### 5. API Key Flexibility

Three ways to provide API keys (in priority order):

1. **Direct in config** - For quick testing
2. **Environment variable** - For production
3. **Request header** - For per-request override

```yaml
providers:
  openai:
    # Option 1: Direct (shown masked in GUI)
    apiKey: "sk-..."
    
    # Option 2: Environment variable
    apiKeyEnv: "OPENAI_API_KEY"
```

**Benefits:**
- Security flexibility
- Easy to get started
- Production-ready

## File Structure

```
apimap/
├── config/
│   ├── config.yaml          # Active configuration
│   └── backups/             # Auto-generated backups
│       ├── config-backup-2024-01-15T10-30-00.yaml
│       └── ...
├── logs/                    # Request logs (JSON)
│   ├── 000001_openai_gpt-4_req_abc123.json
│   └── ...
├── src/
│   ├── server.ts            # Main HTTP server
│   ├── config/
│   │   └── manager.ts       # Config persistence
│   ├── router/
│   │   └── index.ts         # Pattern matching
│   ├── transformers/
│   │   ├── openai.ts        # OpenAI format
│   │   └── anthropic.ts     # Anthropic format
│   ├── providers/
│   │   └── registry.ts      # Provider definitions
│   └── logging/
│       └── index.ts         # Request logging
├── gui/                     # SvelteKit GUI
│   ├── src/
│   │   ├── routes/          # Page components
│   │   ├── lib/
│   │   │   ├── components/  # Shared UI
│   │   │   ├── stores/      # State management
│   │   │   └── utils/       # API client
│   │   └── app.html
│   └── package.json
├── API.md                   # API specification
├── GUI.md                   # GUI specification
└── package.json
```

## State Management

### Server State

```typescript
interface ServerState {
  config: ConfigManager;      // YAML config + backups
  router: Router;             // Pattern matching engine
  logging: LoggingManager;    // Request logs
  version: string;
  startTime: Date;
}
```

### GUI State

```typescript
// Svelte 5 runes
let providers = $state<ProviderInfo[]>([]);
let routes = $state<RouteConfig[]>([]);
let status = $state<SystemStatus | null>(null);
let unrouted = $state<UnroutedRequest[]>([]);
```

## API Endpoints Summary

### Public (for LLM clients)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/v1/chat/completions` | POST | OpenAI format |
| `/v1/messages` | POST | Anthropic format |
| `/v1/models` | GET | List available models |

### Management (for GUI)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/status` | GET | System status |
| `/api/admin/providers` | GET/PUT | Manage providers |
| `/api/admin/routes` | GET/PUT/POST | Manage routes |
| `/api/admin/config` | GET/POST | Raw config |
| `/api/admin/backups` | GET/POST | Backup list/create |
| `/api/admin/backups/:file` | POST/DELETE | Restore/delete |
| `/api/admin/unrouted` | GET/DELETE | Unrouted requests |
| `/api/admin/logs` | GET | Request logs |
| `/api/admin/test-model` | POST | Test endpoint |

## Development Workflow

### Adding a New Provider

1. Add to `src/providers/registry.ts`:
   ```typescript
   myprovider: {
     baseUrl: "https://api.myprovider.com/v1",
     apiKeyEnv: "MYPROVIDER_API_KEY",
     supportsStreaming: true,
   }
   ```

2. GUI automatically shows it in Providers page

3. Users can enable it with just an API key

### Adding a New API Format

1. Create `src/transformers/newformat.ts`
2. Implement `parseRequest`, `toProviderRequest`, `parseResponse`, `toProviderResponse`
3. Add scheme to config
4. Register in transformers index

### Adding a GUI Page

1. Create `gui/src/routes/newpage/+page.svelte`
2. Add route to sidebar in `+layout.svelte`
3. Create API client in `gui/src/lib/utils/api.ts`
4. Use existing stores or create new ones

## Testing Strategy

### Unit Tests

```bash
# Router pattern matching
bun test src/router/index.test.ts

# Format transformers
bun test src/transformers/*.test.ts

# Config manager
bun test src/config/manager.test.ts
```

### Integration Tests

```bash
# Full request flow
bun test src/integration.test.ts
```

### Manual Testing

Use the built-in Test Models page in GUI:
- Test any configured model
- View raw request/response
- Debug routing decisions

## Deployment Options

### Local Development

```bash
bun run src/server.ts --port 3000 --gui-port 3001
```

### Production (API only)

```bash
bun run src/server.ts --port 8080 --gui-port 0
```

### Docker

```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY . .
RUN bun install
EXPOSE 3000
CMD ["bun", "run", "src/server.ts"]
```

## Security Considerations

1. **API Keys**: Never commit keys to git. Use environment variables in production.

2. **CORS**: Configure `server.cors.origin` appropriately:
   - `"*"` for development
   - Specific domains for production

3. **Logging**: Enable `maskKeys` to hide API keys in logs.

4. **GUI**: In production, either:
   - Disable with `--gui-port 0`
   - Or restrict access at reverse proxy level

## Future Extensibility

The architecture supports:
- New providers (add to registry)
- New API formats (add transformers)
- New GUI pages (add routes)
- Custom middleware (modify server.ts)
- Authentication (add to management API)
- Rate limiting (add middleware)
- Load balancing (extend router)
