# Agent Workflow Guidelines

## Critical Reminders (MUST FOLLOW)

### 1. Always Create/Modify Tests
- **Every code change must include tests**
- Update existing tests when changing behavior
- Add new tests for new features
- Test files should be in `*.test.ts` format alongside source files

### 2. Always Test Until No Errors Remain
- Run full test suite: `bun test`
- Fix ALL errors before declaring completion
- Don't ignore warnings - they often indicate real issues
- Verify both unit tests and integration tests pass

### 3. Always Clean Up Background Processes
- **Kill servers immediately after testing**: `pkill -f "bun.*server.ts"`
- Stop any dev servers, watchers, or background jobs
- Verify cleanup: `ps aux | grep -E "(bun|vite|node)" | grep -v grep`
- Don't leave processes running "just in case"

### 4. Resource Management
- Close file handles
- Clean up temporary files
- Release ports (3000, 3001, etc.)
- Terminate WebSocket connections

### 5. CI/CD Cleanup: Non-Destructive Only
- **NEVER run `docker system prune -af`** in CI workflows - it deletes images needed by other jobs
- **NEVER remove system folders** like `/usr/local/lib/android`, `/opt/ghc`, etc.
- **NEVER stop random containers** with `docker ps -aq` - shared runners have other jobs
- **ONLY clean up what you started**: 
  - Use `docker-compose down` (or `docker compose down`) for compose-managed services
  - Kill only processes you spawned
  - Use `|| true` for cleanup commands to prevent failures from breaking the build

## Pre-Completion Checklist

Before marking any task complete:

- [ ] Tests written/modified for all changes
- [ ] **ALL tests passing** (`bun test` exits 0) - no exceptions, no "just the WebSocket tests fail"
- [ ] No syntax errors or type errors
- [ ] All background processes killed
- [ ] No orphaned processes remaining
- [ ] Resources properly released

### Test Requirements
ALL tests must pass - no exceptions. If tests require a server, the tests must start one themselves on a random free port. Never leave tests failing because "they need a server" - make the tests self-contained.

## Common Commands

```bash
# Run all tests
bun test

# Run specific test file
bun test src/transformers/openai.test.ts

# Kill server processes
pkill -f "bun.*server.ts"
pkill -f "vite"

# Check for remaining processes
ps aux | grep -E "(bun|vite|node)" | grep -v grep

# Build GUI
cd gui && bun run build
```

## Code Design Principles

### 6. Dynamic Discovery Over Static Duplication
- **NEVER duplicate data that exists in source code** - always query it dynamically
- When creating introspection/discovery tools (like `bun run endpoints`), query the actual implementations
- Add metadata to classes (static properties like `supportedFormats`, `endpoints`) to enable runtime introspection
- Use abstract interfaces and base classes - no hardcoded references to specific implementations
- Benefits:
  - Single source of truth (the actual implementation)
  - No stale data when implementations change
  - New implementations automatically appear in listings
  - Tools stay in sync with code automatically

### Example: Provider Metadata
```typescript
// In provider implementation
export class AnthropicProvider extends BaseProvider {
  // Static metadata for introspection
  static override readonly supportedFormats = ["anthropic-messages"];
  static override readonly endpoints = [
    { method: "POST", path: "/v1/messages", format: "anthropic-messages" },
  ];
  
  // Instance method to access metadata
  getMetadata() {
    return {
      formats: (this.constructor as typeof BaseProvider).supportedFormats,
      endpoints: (this.constructor as typeof BaseProvider).endpoints,
      implementation: this.constructor.name,
    };
  }
}
```

### 7. Single Source of Truth for Configuration
- **NEVER hardcode the same URL, port, or service name in multiple files**
- Define base values once (e.g., in `.env` or a central config module) and derive all other values from them
- Docker Compose, application code, health checks, and gateway configs must all reference the same source
- Use environment-variable substitution in config files where supported; use templates or generation where it isn't
- Benefits:
  - Changing a port or hostname requires editing exactly one place
  - Eliminates subtle mismatches between internal Docker network names and external localhost URLs
  - Makes the stack portable and easier to run in different environments

#### Example: Benchmark Service URLs
```bash
# bench/.env  (single source of truth)
MOCK_SERVER_PORT=9999
MOCK_SERVER_HOST=mock-server
MOCK_SERVER_URL=http://${MOCK_SERVER_HOST}:${MOCK_SERVER_PORT}
MOCK_SERVER_API_BASE=${MOCK_SERVER_URL}/v1
LITELLM_PORT=4000
APIMAP_PORT=3000
```

```yaml
# bench/docker-compose.yml derives ports and env vars from .env
services:
  mock-server:
    ports:
      - "${MOCK_SERVER_PORT:-9999}:${MOCK_SERVER_PORT:-9999}"
```

```yaml
# bench/configs/litellm_config.yaml uses env substitution
litellm_params:
  api_base: ${MOCK_SERVER_API_BASE}
```

```typescript
// bench/src/benchmark/index.ts reads the same values via Bun.env
const mockUrl = Bun.env.MOCK_SERVER_DIRECT_URL || 'http://localhost:9999';
```

## Consequences of Not Following

- **Memory leaks** from orphaned processes
- **Port conflicts** from lingering servers
- **False positives** from incomplete testing
- **Regression bugs** from missing test coverage
- **System instability** on long-running sessions
- **Stale documentation** when static data diverges from implementations
- **Configuration drift** when the same value is copy-pasted into multiple files
- **Maintenance burden** of updating multiple places for every change

---

*These guidelines are non-negotiable and must be followed for every task.*
