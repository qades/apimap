# API Map Benchmark Suite

A comprehensive benchmarking suite for measuring API Map performance against other AI gateways. Optimized for both **developer velocity** (easy local runs) and **CI/CD integration** (automated tracking).

## Quick Start

```bash
# Run benchmark against your current (possibly modified) source
# This builds from local source and benchmarks it
bun run bench

# Or use make from the bench directory
cd bench && ./run.sh

# Full comprehensive benchmark (15 min)
bun run bench:full
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Benchmark Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐ │
│   │  Mock LLM    │◄─────│   LiteLLM    │◄─────│  Benchmark   │ │
│   │  Server      │      │  (Gateway)   │      │   Runner     │ │
│   │  :9999       │      │  :4000       │      │              │ │
│   └──────────────┘      └──────────────┘      └──────┬───────┘ │
│          ▲                                           │         │
│          │           ┌──────────────┐               │         │
│          └───────────│   API Map    │◄──────────────┘         │
│                      │  (Source)    │                         │
│                      │  :3000       │  ← Built from local      │
│                      └──────────────┘    source code           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Development Workflow

### Running Benchmarks Locally

```bash
# 1. Quick benchmark (2-3 min) - recommended for development
bun run bench

# 2. After making changes, run again to see impact
# Edit src/... (make your changes)
bun run bench  # Compare with previous results

# 3. Full benchmark before committing (comprehensive)
bun run bench:full
```

### Understanding Results

Benchmark results are saved to `bench/results/`:

```
bench/results/
├── benchmark_2026-03-27T143022.json    # Raw data
├── benchmark_2026-03-27T143022.md      # Human-readable report
└── latest.json -> benchmark_*.json     # Symlink to latest
```

Quick summary displayed after run:

```
Latency Results:
  LiteLLM: Mean=145ms, P95=189ms
  API Map: Mean=132ms, P95=175ms  ← Your local build

Throughput Results (highest concurrency):
  LiteLLM: 45 req/sec @ 50 concurrent
  API Map: 52 req/sec @ 50 concurrent
```

### Comparing Changes

```bash
# Baseline: Run benchmark on main branch
git checkout main
bun run bench
cp bench/results/benchmark_*.json bench/results/baseline.json

# Test: Run benchmark on your branch
git checkout your-feature-branch
bun run bench

# Compare results
bun run bench:compare bench/results/baseline.json bench/results/latest.json
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_LATENCY_MEAN_MS` | 0 | Mock LLM base latency (0 = instant) |
| `MOCK_TOKENS_PER_SEC` | 100 | Streaming token generation speed |
| `BENCHMARK_SCENARIOS` | 1:50,10:100,50:200 | Concurrency:Requests pairs |
| `BENCHMARK_WARMUP` | 5 | Warmup requests before timing |

### Custom Scenarios

```bash
# Test specific concurrency levels
MOCK_LATENCY_MEAN_MS=50 \
BENCHMARK_SCENARIOS="1:100,10:500,50:1000" \
bun run bench
```

## CI/CD Integration

Benchmarks run automatically on:

| Trigger | Type | Purpose |
|---------|------|---------|
| Push to `main` | Quick | Performance regression detection |
| Pull Request | Quick | Impact assessment on PR |
| Weekly (Sun) | Full | Comprehensive performance tracking |
| Manual | Either | On-demand testing |

### Viewing CI Results

1. Check PR comments for benchmark summary
2. Download full results from Actions artifacts
3. View trend graphs in GitHub Insights

## Scripts Reference

```bash
# Root package.json scripts
bun run bench           # Quick benchmark (local source)
bun run bench:full      # Full benchmark suite
bun run bench:clean     # Clean up benchmark containers
bun run bench:status    # Check benchmark service status

# Direct bench/ usage
cd bench && ./run.sh           # Quick benchmark
cd bench && ./run.sh full      # Full benchmark
cd bench && ./run.sh clean     # Clean up
cd bench && ./run.sh status    # Show status
```

## Implementation Details

### Local Source Building

The benchmark uses Docker Compose with a **build context** for API Map:

```yaml
# bench/docker-compose.yml
services:
  apimap:
    build:
      context: ..           # ← Parent directory (project root)
      dockerfile: Dockerfile
    # Falls back to image: ghcr.io/qades/apimap:latest
    # if APIMAP_IMAGE env var is set
```

This ensures:
- **Dev mode**: Local changes are always tested
- **CI mode**: Fresh image built from PR/branch source
- **Release mode**: Can test published images

### Mock Server Design

The mock server is a **multi-provider LLM simulator** that exposes all major API formats simultaneously:

```
Mock Server Endpoints (Always Active)
├── /v1/chat/completions    → OpenAI format
├── /v1/messages            → Anthropic format  
├── /deepseek/...           → DeepSeek format (with reasoning)
└── /generic/...            → Generic OpenAI-compatible
```

**Design Principles:**
- **All endpoints always enabled** - No configuration needed, just like API Map itself
- **Strict validation by default** - Returns 400 errors for malformed requests (disable with `MOCK_STRICT_VALIDATION=false`)
- **Provider-specific behavior** - Simulates thinking/reasoning blocks, logprobs, etc.
- **Realistic latency simulation** - Configurable mean/std dev for testing performance

### Performance Optimization

The benchmark suite is optimized for:

1. **Speed**: Mock LLM server eliminates network variability
2. **Consistency**: Deterministic latency settings
3. **Isolation**: Docker containers ensure clean state
4. **Reproducibility**: Locked dependency versions

## Troubleshooting

### "Port already in use"

```bash
# Change ports in bench/.env
EXTERNAL_PORT=3002
EXTERNAL_GUI_PORT=3003
```

### "Containers fail to start"

```bash
# Check logs
cd bench && ./run.sh logs

# Full reset
cd bench && ./run.sh clean
```

### Benchmark timing out

Increase health check timeouts in `bench/docker-compose.yml`:

```yaml
healthcheck:
  retries: 30
  start_period: 60s
```

## Contributing

To add new benchmark scenarios:

1. Edit `bench/src/benchmark/index.ts`
2. Add test to appropriate section (latency/throughput/features)
3. Update this documentation
4. Run `bun run bench:full` to validate

## License

MIT - See [LICENSE](LICENSE)
