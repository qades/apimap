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
- [ ] All tests passing (`bun test` exits 0)
- [ ] No syntax errors or type errors
- [ ] All background processes killed
- [ ] No orphaned processes remaining
- [ ] Resources properly released

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

## Consequences of Not Following

- **Memory leaks** from orphaned processes
- **Port conflicts** from lingering servers
- **False positives** from incomplete testing
- **Regression bugs** from missing test coverage
- **System instability** on long-running sessions

---

*These guidelines are non-negotiable and must be followed for every task.*
