# LiteLLM vs API Map - Comprehensive Benchmark

A configurable benchmark suite for comparing [LiteLLM](https://github.com/BerriAI/litellm) and [API Map](https://github.com/qades/apimap) AI gateway solutions.

> **Note**: This benchmark is integrated into the API Map project. See the [root BENCHMARK.md](../BENCHMARK.md) for the primary documentation.

## 🚀 Quick Start (1 Command)

The easiest way to run the benchmark is using the root package scripts:

```bash
# From the project root
bun run bench        # Quick benchmark
bun run bench:full   # Full benchmark suite
```

Or directly from this directory:

```bash
cd bench
./run.sh             # Quick benchmark
./run.sh full        # Full benchmark suite
```

## 📋 Requirements

- **Docker** 20.10+ ([Install](https://docs.docker.com/get-docker/))
- **Docker Compose** 2.0+ (included with Docker Desktop)
- **~2GB free disk space**
- **~4GB RAM** recommended

## 🎯 Usage Options

### Option 1: Quick Benchmark (Recommended)

```bash
./run.sh
# or explicitly:
./run.sh quick
```

**Duration**: ~2-3 minutes  
**Tests**: Basic latency, throughput at low concurrency, feature comparison

### Option 2: Full Benchmark Suite

```bash
./run.sh full
```

**Duration**: ~10-15 minutes  
**Tests**: Comprehensive latency analysis, high concurrency throughput, streaming performance

### Option 3: Development Mode (Local Source)

By default, the benchmark builds API Map from your local source code:

```bash
# Edit the main project source code
vim ../src/server.ts

# Run benchmark against your changes
./run.sh
```

This is the **recommended workflow** for development.

### Option 4: CI Mode (Published Image)

To test against a published image instead of local source:

```bash
# Test the latest published image
CI=true ./run.sh

# Test a specific version
APIMAP_IMAGE=ghcr.io/qades/apimap:v1.2.3 ./run.sh
```

### Option 5: Manual Docker Control

```bash
# Build and start services
docker-compose up --build -d mock-server litellm apimap

# Wait for services to be healthy (~30 seconds)
sleep 30

# Run benchmark
docker-compose --profile benchmark run --rm benchmark

# Generate visualizations
docker-compose --profile visualize run --rm visualize

# Stop everything
docker-compose down
```

## 📊 Understanding Results

After running the benchmark, results are saved to:

```
bench/
├── results/
│   ├── benchmark_20240326_120000.json    # Raw data
│   └── benchmark_20240326_120000.md      # Human-readable report
└── reports/
    └── benchmark_report.pdf              # Visualizations (if available)
```

### Viewing Results

```bash
# View markdown report
cat results/benchmark_*.md

# View JSON data
jq . results/benchmark_*.json

# Open PDF report (if generated)
open reports/benchmark_report.pdf
```

### Sample Output

```
╔══════════════════════════════════════════════════════════════╗
║     Benchmark Results                                         ║
╚══════════════════════════════════════════════════════════════╝

✓ Results files:
  📄 JSON: results/benchmark_20240326_143022.json
  📄 Markdown: results/benchmark_20240326_143022.md

▶ Quick Summary:

Latency Results:
  LiteLLM: Mean=145ms, P95=189ms
  API Map: Mean=132ms, P95=175ms

Throughput Results (highest concurrency):
  LiteLLM: 45 req/sec @ 50 concurrent
  API Map: 52 req/sec @ 50 concurrent

Feature Score: LiteLLM 35 - API Map 18
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file to customize benchmark behavior:

```bash
# Benchmark parameters
BENCHMARK_DURATION=60          # Duration in seconds
BENCHMARK_CONCURRENCY=1,10,50  # Concurrency levels to test

# Service URLs (for custom setups)
LITELLM_URL=http://litellm:4000
APIMAP_URL=http://apimap:3000
MOCK_SERVER_URL=http://mock-server:9999

# Mock server behavior
LATENCY_MEAN_MS=100           # Average response latency
LATENCY_STD_MS=20             # Latency variation
TOKENS_PER_SEC=50             # Streaming speed
ERROR_RATE=0.01               # Error rate (0-1)
```

See `.env.example` for all available options.

### Mock Server Configuration

The mock server simulates LLM responses for consistent testing. **All provider endpoints are always active** - just like the API Map server itself:

| Endpoint | Format | Always Available |
|----------|--------|------------------|
| `/v1/chat/completions` | OpenAI | ✓ Yes |
| `/v1/messages` | Anthropic | ✓ Yes |
| `/deepseek/v1/chat/completions` | DeepSeek | ✓ Yes |
| `/generic/v1/chat/completions` | Generic OpenAI-compatible | ✓ Yes |

```bash
# Custom mock server settings
docker-compose -f docker-compose.yml -f docker-compose.override.yml up
```

Create `docker-compose.override.yml`:

```yaml
version: '3.8'
services:
  mock-server:
    environment:
      - LATENCY_MEAN_MS=200
      - LATENCY_STD_MS=50
      - ERROR_RATE=0.05
      - MOCK_STRICT_VALIDATION=true  # Validate requests (default: true)
```

**Mock Server Features:**
- **All endpoints always enabled** - No configuration needed
- **Strict validation by default** - Returns 400 errors for malformed requests
- **Provider-specific responses** - Simulates thinking/reasoning for Anthropic/DeepSeek
- **Configurable behavior** - Latency, error rates, token speeds via environment variables

## 🏗️ Architecture

The benchmark creates 4 containers:

```
┌─────────────────────────────────────────────────────────────┐
│                      Docker Network                          │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Mock Server  │    │   LiteLLM    │    │   API Map    │  │
│  │   :9999      │◄───│   :4000      │    │   :3000      │  │
│  │              │    │              │    │              │  │
│  │ Simulates    │    │ AI Gateway   │    │ AI Gateway   │  │
│  │ LLM API      │    │ (Python)     │    │ (Bun/TS)     │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         ▲                                                    │
│         │              ┌──────────────┐                      │
│         └──────────────│  Benchmark   │                      │
│                        │   Runner     │                      │
│                        │              │                      │
│                        └──────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

### Local Source Building

The key feature for development: API Map is built from `../` (parent directory) using the project's main `Dockerfile`. This ensures:

1. Your local changes are immediately tested
2. No need to publish images for development
3. CI can override with specific images using `docker-compose.ci.yml`

## 🧹 Cleanup

```bash
# Stop all containers and clean up
./run.sh clean

# Or manually:
docker-compose down -v          # Remove containers and volumes
docker system prune -f          # Clean unused images
```

## 🔍 Troubleshooting

### "Docker not installed"

Install Docker: https://docs.docker.com/get-docker/

### "Port already in use"

Change ports in `.env`:

```bash
APIMAP_PORT=3002
APIMAP_GUI_PORT=3003
```

### "Containers fail to start"

Check logs:

```bash
# All services
./run.sh logs

# Specific service
docker-compose logs litellm
docker-compose logs apimap
docker-compose logs mock-server
```

### "Benchmark times out"

Services may need more time to start:

```bash
# Increase health check timeouts in docker-compose.yml
healthcheck:
  retries: 30
  start_period: 60s
```

### "Permission denied" (Linux/Mac)

```bash
chmod +x run.sh
chmod +x docker-entrypoint.sh
```

## 📈 Continuous Integration

The benchmark runs automatically on:

| Trigger | Type | Purpose |
|---------|------|---------|
| Push to `main` | Quick | Performance regression detection |
| Pull Request | Quick | Impact assessment on PR |
| Weekly (Sun) | Full | Comprehensive performance tracking |
| Manual | Either | On-demand testing |

Results are:
- Uploaded as artifacts
- Posted as PR comments
- Available in GitHub Step Summary

## 🛠️ Development

### Project Structure

```
bench/
├── run.sh                      # Master script (START HERE)
├── docker-compose.yml          # Service orchestration (builds from ../)
├── docker-compose.ci.yml       # CI override (uses published images)
├── docker-entrypoint.sh        # Benchmark orchestration
├── Dockerfile.*                # Container definitions
│
├── src/
│   ├── benchmark/              # Benchmark runner (Bun/TypeScript)
│   │   └── index.ts
│   └── mock-server/            # Mock LLM server (Bun/Elysia)
│       └── index.ts
│
├── configs/                    # Gateway configurations
│   ├── litellm_config.yaml
│   └── apimap_config.yaml
├── results/                    # Generated results (gitignored)
└── reports/                    # Generated reports (gitignored)
```

### Adding New Tests

1. Edit `src/benchmark/index.ts` for benchmark scenarios
2. Update visualization in `visualize.py` (if needed)
3. Test locally with `./run.sh`
4. Submit PR

### Running Tests

```bash
# Local benchmark (no Docker)
cd ..
bun run dev &                    # Start API Map
cd bench
MOCK_LATENCY_MEAN_MS=0 ./run.sh  # Run against local instance
```

## 📚 Additional Resources

- [Root BENCHMARK.md](../BENCHMARK.md) - Primary benchmark documentation
- [API Map Repository](https://github.com/qades/apimap)
- [LiteLLM Documentation](https://docs.litellm.ai/)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [FEATURE_MATRIX.md](FEATURE_MATRIX.md) - Detailed feature comparison

## 🤝 Contributing

Contributions welcome! Areas for contribution:

- Additional benchmark tests
- New visualizations
- Bug fixes
- Documentation improvements

## 📄 License

MIT License - See [LICENSE](../LICENSE) file.

## 🙏 Acknowledgments

- LiteLLM team for the comprehensive AI gateway
- API Map contributors for the innovative router
- OpenAI for the API specification

---

**Quick Reference:**

| Command | Description |
|---------|-------------|
| `bun run bench` | Quick benchmark from project root |
| `./run.sh` | Quick benchmark (~2 min) |
| `./run.sh full` | Full benchmark (~15 min) |
| `./run.sh status` | Check status |
| `./run.sh clean` | Clean up |
| `./run.sh help` | Show help |
| `CI=true ./run.sh` | Test published image |
