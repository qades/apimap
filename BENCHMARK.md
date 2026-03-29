# API Map Benchmark Suite

A comprehensive benchmarking suite for measuring API Map performance against other AI gateways.

## Quick Start

```bash
# Run benchmark (starts Docker services, runs tests, stops services, generates report)
bun run bench              # Quick benchmark (~2-3 min) - tests OpenAI→OpenAI only
bun run bench:full         # Full benchmark suite (~15-25 min) - tests ALL protocol combinations
bun run bench:endpoints    # Comprehensive endpoint testing - all OpenAI & Anthropic transformations
```

That's it. The benchmark runner handles everything automatically.

## Endpoint Coverage

The benchmark now tests **all 16 protocol combinations** for complete transformation performance analysis:

### OpenAI Chat Completions (`/v1/chat/completions`)
- ✅ OpenAI → OpenAI (native passthrough)
- ✅ OpenAI → Anthropic (format conversion)
- ✅ OpenAI → Responses (API conversion)
- ✅ OpenAI → Completions (legacy conversion)

### Anthropic Messages (`/v1/messages`)
- ✅ Anthropic → OpenAI (protocol bridging)
- ✅ Anthropic → Anthropic (native passthrough)
- ✅ Anthropic → Responses (API conversion)
- ✅ Anthropic → Completions (legacy conversion)

### OpenAI Responses (`/v1/responses`)
- ✅ Responses → OpenAI (API conversion)
- ✅ Responses → Anthropic (protocol bridging)
- ✅ Responses → Responses (native passthrough)
- ✅ Responses → Completions (legacy conversion)

### OpenAI Legacy Completions (`/v1/completions`)
- ✅ Completions → OpenAI (API conversion)
- ✅ Completions → Anthropic (protocol bridging)
- ✅ Completions → Responses (API conversion)
- ✅ Completions → Completions (native passthrough)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  bun run bench                                                  │
│  ├── Starts Docker services (mock-server, litellm, apimap)      │
│  ├── Runs benchmarks                                            │
│  ├── Stops services                                             │
│  └── Generates PDF report                                       │
├─────────────────────────────────────────────────────────────────┤
│  Services (Docker):                                             │
│    - Mock LLM Server (Bun) :9999  ← Direct target               │
│    - LiteLLM Proxy         :4000                                │
│    - API Map (local src)   :3000                                │
├─────────────────────────────────────────────────────────────────┤
│  Report Generation: Python + matplotlib (PDF only)              │
└─────────────────────────────────────────────────────────────────┘
```

## Development Workflow

```bash
# Quick benchmark after making changes
bun run bench

# Full benchmark before committing
bun run bench:full
```

## Results

Saved to `bench/results/`:
- `benchmark_*.json` - Raw data
- `benchmark_*.md` - Human-readable report  
- `reports/benchmark_report.pdf` - Visual charts

Example output:
```
Latency Results:
  LiteLLM: Mean=145ms, P95=189ms
  API Map: Mean=132ms, P95=175ms  ← Your local build
  Direct:  Mean=125ms, P95=168ms  ← Baseline (no gateway)
```

## Configuration

```bash
# Custom latency simulation
MOCK_LATENCY_MEAN_MS=50 bun run bench

# Skip targets (e.g., test only Direct)
bun run bench --skip-targets litellm,apimap

# Zero error rate
bun run bench --error-rate 0

# Keep services running after benchmark
bun run bench --keep-services
```

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_LATENCY_MEAN_MS` | 0 | Mock LLM base latency |
| `MOCK_TOKENS_PER_SEC` | 100 | Streaming token speed |
| `BENCHMARK_SCENARIOS` | 1:50,10:100... | Concurrency:Requests pairs |
| `BENCHMARK_ALL_PROTOCOLS` | true | Test all 16 protocol combinations |
| `BENCHMARK_PROMPT_SIZE` | 100 | Character count per request prompt |
| `BENCHMARK_MAX_TOKENS` | 500 | Max tokens in response |

## Manual Control (Optional)

If you need manual control over services:

```bash
cd bench
docker-compose up -d mock-server litellm apimap
bun run benchmark
# ... services keep running ...
docker-compose down
```

## Troubleshooting

```bash
# Check service logs
cd bench && docker-compose logs -f

# Full reset
cd bench && docker-compose down -v

# Port conflicts - change in bench/.env
EXTERNAL_PORT=3002
EXTERNAL_GUI_PORT=3003
```

## Implementation Details

API Map is built from local source (`context: ..` in docker-compose.yml) so your changes are always tested.

The mock server simulates all major API formats:
- `/v1/chat/completions` → OpenAI Chat Completions
- `/v1/messages` → Anthropic Messages  
- `/v1/responses` → OpenAI Responses API
- `/v1/completions` → OpenAI Legacy Completions
- Plus DeepSeek, Gemini, vLLM formats

### Protocol Transformation Matrix

The full benchmark (`bun run bench:full`) now tests the complete transformation matrix between all OpenAI and Anthropic endpoints. This provides comprehensive performance data on:

1. **Native passthrough** latency (e.g., OpenAI→OpenAI)
2. **Protocol bridging** overhead (e.g., Anthropic→OpenAI, OpenAI→Anthropic)
3. **API conversion** performance (e.g., Chat→Responses, Responses→Completions)
4. **Cross-protocol transformation** (e.g., Anthropic→Completions)

Each protocol combination is tested across 4 load scenarios (light/medium/heavy/extreme) for both latency and throughput metrics.
