# Provider Update Summary

## Date: 2026-03-27

### Overview
Added 27 new LLM providers to API Map, expanding coverage from 32 to 60+ providers. All new providers are OpenAI-compatible and use the existing `OpenAICompatibleProvider` class, requiring only configuration additions.

### New Providers Added

#### P0 - Required by User
- **Inception Labs** (`inceptionlabs`) - Mercury Coder models
  - Base URL: `https://api.inceptionlabs.ai/v1`
  - Auth: Bearer token via `INCEPTIONLABS_API_KEY`

#### P1 - High-Impact Providers
- **xAI (Grok)** (`xai`) - Grok-2, Grok-2 Vision, Grok Beta
- **Cerebras** (`cerebras`) - Wafer-scale fast inference
- **SambaNova** (`sambanova`) - Hardware-accelerated inference

#### P2 - Medium-Impact Cloud Providers
- **DeepInfra** (`deepinfra`) - Simple model deployment
- **Hyperbolic** (`hyperbolic`) - GPU marketplace
- **Novita AI** (`novita`) - 100+ open source models
- **Lambda Labs** (`lambda`) - GPU cloud infrastructure
- **Moonshot AI** (`moonshot`) - 1M+ token context windows
- **Nebius AI Studio** (`nebius`) - European AI platform
- **NScale** (`nscale`) - GPU cloud
- **NVIDIA NIM** (`nvidia_nim`) - Optimized inference microservices

#### P3 - Niche/Specialized
- **Featherless AI** (`featherless`) - Serverless inference
- **FriendliAI** (`friendliai`) - Korean inference platform
- **Galadriel** (`galadriel`) - Decentralized AI network
- **Gradient AI** (`gradient`) - Private LLMs and fine-tuning
- **Meta Llama API** (`meta_llama`) - Official Meta models
- **Venice AI** (`veniceai`) - Uncensored private models
- **Chutes** (`chutes`) - Distributed inference
- **Public AI** (`publicai`) - Community model hub
- **Poe** (`poe`) - Multi-platform AI assistant API

#### P4 - Platform Integrations
- **Cloudflare Workers AI** (`cloudflare`) - Edge inference
- **GitHub Models** (`github_models`) - Free tier available
- **OVHcloud AI** (`ovhcloud`) - European cloud provider
- **Hosted vLLM** (`hosted_vllm`) - Cloud vLLM instances

#### P5 - Regional Providers
- **GigaChat** (`gigachat`) - Sberbank Russian models
- **Volcengine** (`volcengine`) - ByteDance Doubao models
- **MiniMax** (`minimax`) - Chinese multimodal AI

#### P6 - Local Providers
- **llamafile** (`llamafile`) - Single-file LLMs (Mozilla)
- **NVIDIA Triton** (`triton`) - Moved from enterprise to local tier

### Implementation Details

All new providers were added to `src/providers/builtin.ts` with the following pattern:

```typescript
provider_id: {
  id: "provider_id",
  name: "Provider Name",
  description: "Description of the provider",
  defaultBaseUrl: "https://api.provider.com/v1",
  defaultApiKeyEnv: "PROVIDER_API_KEY",
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  supportsStreaming: true,
  requiresApiKey: true,
  category: "cloud",
}
```

### No Code Changes Required

Since all new providers are OpenAI-compatible, they automatically use the existing `OpenAICompatibleProvider` class. No changes were needed to:
- `src/providers/registry.ts`
- `src/providers/implementations/`
- `src/providers/base.ts`

### Testing

All 243 tests pass, including:
- Provider structure validation
- Unique ID checks
- Required field validation
- Tier-specific tests (local providers don't require API keys, enterprise do)
- Category validation

### Usage Example

To use Inception Labs (or any new provider):

```yaml
# config.yaml
providers:
  inceptionlabs:
    apiKey: "your-api-key-here"  # Or set INCEPTIONLABS_API_KEY env var
    # baseUrl defaults to https://api.inceptionlabs.ai/v1
```

Or via environment variable:
```bash
export INCEPTIONLABS_API_KEY="your-api-key"
```

Then use in API calls:
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Provider: inceptionlabs" \
  -d '{
    "model": "mercury-coder-small",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Files Modified

- `src/providers/builtin.ts` - Added 27 new provider configurations
- `PROVIDERS_COMPARISON.md` - Created detailed comparison document
- `PROVIDERS_UPDATE_SUMMARY.md` - This summary document

### Provider Count by Category

| Category | Before | After |
|----------|--------|-------|
| Cloud | 14 | 38 |
| Local | 9 | 11 |
| Enterprise | 3 | 6 |
| Regional | 5 | 8 |
| Custom | 0 | 0 |
| **Total** | **31** | **63** |

### Next Steps (Optional)

Remaining providers not yet implemented (can be added similarly):
- Databricks - Requires special workspace URL handling
- Snowflake Cortex - Enterprise-focused
- AWS SageMaker - Complex AWS auth
- Azure AI Studio - Enterprise features
- Predibase - LoRA serving
- HuggingFace Inference Endpoints - Additional HF support
- v0 (Vercel) - Requires verification
- Heroku - Dyno-based inference

These require either special authentication or are less commonly requested.
