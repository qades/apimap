# Provider Support Comparison: LiteLLM vs API Map

## Overview

This document compares the LLM provider support between **LiteLLM** and **API Map** to identify gaps and track implementation progress.

| Metric | LiteLLM | API Map (Before) | API Map (After) |
|--------|---------|-----------------|-----------------|
| Total Chat Providers | 90+ | 32 | **60+** |
| OpenAI-Compatible | 60+ | 20+ | **45+** |
| Custom/Unique | 15+ | 5 | 5 |

### ✅ Recently Added Providers (27 new)

**P0 (Required):**
- Inception Labs

**P1 (High-Impact):**
- xAI (Grok)
- Cerebras
- SambaNova

**P2 (Medium-Impact):**
- DeepInfra
- Hyperbolic
- Novita AI
- Lambda Labs
- Moonshot AI
- Nebius AI Studio
- NScale
- NVIDIA NIM

**P3 (Niche/Specialized):**
- Featherless AI
- FriendliAI
- Galadriel
- Gradient AI
- Meta Llama API
- Venice AI
- Chutes
- Public AI
- Poe

**P4 (Platform Integrations):**
- Cloudflare Workers AI
- GitHub Models
- OVHcloud AI
- Hosted vLLM

**P5 (Regional):**
- GigaChat
- Volcengine
- MiniMax

**P6 (Local):**
- llamafile
- NVIDIA Triton (moved from enterprise to local)

---

## Provider Comparison Table

### Tier 1: Major Cloud Providers

| Provider | LiteLLM | API Map | Notes |
|----------|---------|---------|-------|
| OpenAI | ✅ | ✅ | GPT-4, GPT-3.5, o1, o3 |
| Anthropic | ✅ | ✅ | Claude 3.5, Opus, Haiku |
| Google Gemini | ✅ | ✅ | gemini-1.5-pro/flash |
| Azure OpenAI | ✅ | ✅ | Enterprise OpenAI |
| AWS Bedrock | ✅ | ✅ | Multi-model platform |

### Tier 2: High-Performance Inference

| Provider | LiteLLM | API Map | Notes |
|----------|---------|---------|-------|
| Groq | ✅ | ✅ | Ultra-fast LPU inference |
| Together AI | ✅ | ✅ | 200+ open source models |
| Fireworks AI | ✅ | ✅ | Fast inference |
| Mistral AI | ✅ | ✅ | European models |
| Cohere | ✅ | ✅ | Command R/R+, RAG |
| DeepSeek | ✅ | ✅ | Chinese reasoning models |
| **xAI (Grok)** | ✅ | ✅ | Elon Musk's Grok models |
| **Cerebras** | ✅ | ✅ | Wafer-scale inference |
| **SambaNova** | ✅ | ✅ | DataScale SN systems |

### Tier 3: Specialized & Niche Providers

| Provider | LiteLLM | API Map | Notes |
|----------|---------|---------|-------|
| OpenRouter | ✅ | ✅ | Unified API for 200+ models |
| Perplexity | ✅ | ✅ | Search-augmented |
| AI21 Labs | ✅ | ✅ | Jamba, Jurassic |
| Replicate | ✅ | ✅ | OSS model hosting |
| HuggingFace | ✅ | ✅ | 100k+ models |
| OctoAI | ✅ | ✅ | Production inference |
| Anyscale | ✅ | ✅ | Ray-based endpoints |
| **DeepInfra** | ✅ | ✅ | Simple model deployment |
| **Hyperbolic** | ✅ | ✅ | GPU marketplace |
| **Novita AI** | ✅ | ✅ | Model hub |
| **Lambda Labs** | ✅ | ✅ | GPU cloud |
| **Featherless AI** | ✅ | ✅ | Serverless inference |
| **FriendliAI** | ✅ | ✅ | Dedicated AI inference |
| **Galadriel** | ✅ | ✅ | Decentralized AI |
| **Gradient AI** | ✅ | ✅ | Private LLMs |
| **Inception Labs** | ✅ | ✅ | **REQUIRED** - Mercury models |
| **Moonshot AI** | ✅ | ✅ | Chinese long-context |
| **Nebius** | ✅ | ✅ | Yandex Cloud spin-off |
| **NScale** | ✅ | ✅ | GPU cloud |
| **SambaNova** | ✅ | ✅ | Hardware+accelerated |
| **v0 (Vercel)** | ✅ | ❌ | Vercel AI SDK |
| **Meta Llama** | ✅ | ✅ | Meta's official API |
| **NVIDIA NIM** | ✅ | ✅ | NIM microservices |

### Tier 4: Local & Self-Hosted

| Provider | LiteLLM | API Map | Notes |
|----------|---------|---------|-------|
| Ollama | ✅ | ✅ | Local model runner |
| LM Studio | ✅ | ✅ | Desktop GUI |
| llama.cpp | ✅ | ✅ | C++ inference |
| vLLM | ✅ | ✅ | PagedAttention |
| LocalAI | ✅ | ✅ | Self-hosted API |
| TabbyAPI | ✅ | ✅ | ExLlamaV2 |
| Text Generation WebUI | ✅ | ✅ | Oobabooga |
| KoboldCpp | ✅ | ✅ | Kobold++ |
| llamafile | ✅ | ✅ | Single-file LLMs |
| Hosted vLLM | ✅ | ✅ | Cloud vLLM |

### Tier 5: Enterprise Cloud

| Provider | LiteLLM | API Map | Notes |
|----------|---------|---------|-------|
| Google Vertex AI | ✅ | ✅ | GCP platform |
| IBM watsonx | ✅ | ✅ | Enterprise AI |
| Oracle Cloud | ✅ | ✅ | OCI Generative AI |
| **Databricks** | ✅ | ⏳ | MLflow models |
| **Snowflake** | ✅ | ⏳ | Cortex LLM |
| **AWS SageMaker** | ✅ | ⏳ | AWS ML platform |
| **Azure AI** | ✅ | ⏳ | Azure ML Studio |
| **Predibase** | ✅ | ⏳ | LoRA serving |
| **Triton Inference** | ✅ | ✅ | NVIDIA Triton (local) |

### Tier 6: Regional Providers

| Provider | LiteLLM | API Map | Notes |
|----------|---------|---------|-------|
| Alibaba DashScope | ✅ | ✅ | Qwen models |
| Baidu ERNIE | ✅ | ✅ | Chinese models |
| Tencent Hunyuan | ✅ | ✅ | Tencent LLM |
| Yandex GPT | ✅ | ✅ | Russian models |
| Naver HyperCLOVA | ✅ | ✅ | Korean models |
| **GigaChat** | ✅ | ✅ | Sberbank Russian |
| **Volcengine** | ✅ | ✅ | ByteDance cloud |
| **MiniMax** | ✅ | ✅ | Chinese startup |

### Tier 7: Special Integrations

| Provider | LiteLLM | API Map | Notes |
|----------|---------|---------|-------|
| GitHub Copilot | ✅ | ❌ | Copilot Chat API |
| ChatGPT (subscription) | ✅ | ❌ | Plus/Pro API |
| **GitHub Models** | ✅ | ✅ | GitHub marketplace |
| **Cloudflare Workers AI** | ✅ | ✅ | Edge inference |
| **Vercel AI Gateway** | ✅ | ❌ | AI SDK |
| **HuggingFace Inference** | ✅ | ❌ | HF Endpoints |
| **OVHcloud AI** | ✅ | ✅ | European cloud |
| **Heroku** | ✅ | ❌ | Dyno inference |

---

## OpenAI-Compatible Providers Summary

These providers use standard OpenAI-compatible endpoints (`/v1/chat/completions`) and require minimal implementation:

### Already Implemented (via OpenAICompatibleProvider)
- openai
- groq
- together
- fireworks
- mistral
- deepseek
- openrouter
- perplexity
- replicate
- anyscale
- octoai
- lmstudio
- vllm
- localai
- llamacpp
- ollama
- tabbyapi
- textgenwebui
- koboldcpp

### Missing OpenAI-Compatible (Easy to Add)
| Provider | Base URL | Auth Header | Environment Variable |
|----------|----------|-------------|---------------------|
| **xai** | `https://api.x.ai/v1` | `Authorization` | `XAI_API_KEY` |
| **cerebras** | `https://api.cerebras.ai/v1` | `Authorization` | `CEREBRAS_API_KEY` |
| **sambanova** | `https://api.sambanova.ai/v1` | `Authorization` | `SAMBANOVA_API_KEY` |
| **deepinfra** | `https://api.deepinfra.com/v1/openai` | `Authorization` | `DEEPINFRA_API_KEY` |
| **hyperbolic** | `https://api.hyperbolic.xyz/v1` | `Authorization` | `HYPERBOLIC_API_KEY` |
| **novita** | `https://api.novita.ai/v3/openai` | `Authorization` | `NOVITA_API_KEY` |
| **lambda** | `https://api.lambdalabs.com/v1` | `Authorization` | `LAMBDA_API_KEY` |
| **featherless** | `https://api.featherless.ai/v1` | `Authorization` | `FEATHERLESS_API_KEY` |
| **friendliai** | `https://inference.friendli.ai/v1` | `Authorization` | `FRIENDLI_API_KEY` |
| **inceptionlabs** | `https://api.inceptionlabs.ai/v1` | `Authorization` | `INCEPTIONLABS_API_KEY` |
| **moonshot** | `https://api.moonshot.cn/v1` | `Authorization` | `MOONSHOT_API_KEY` |
| **nebius** | `https://api.studio.nebius.ai/v1` | `Authorization` | `NEBIUS_API_KEY` |
| **nscale** | `https://api.nscale.com/v1` | `Authorization` | `NSCALE_API_KEY` |
| **nvidia_nim** | `https://integrate.api.nvidia.com/v1` | `Authorization` | `NVIDIA_NIM_API_KEY` |
| **codestral** | `https://api.mistral.ai/v1` | `Authorization` | `CODESTRAL_API_KEY` |
| **meta_llama** | `https://api.llama.com/v1` | `Authorization` | `LLAMA_API_KEY` |
| **v0** | `https://api.v0.dev/v1` | `Authorization` | `V0_API_KEY` |
| **publicai** | `https://api.publicai.co/v1` | `Authorization` | `PUBLICAI_API_KEY` |
| **veniceai** | `https://api.venice.ai/api/v1` | `Authorization` | `VENICE_AI_API_KEY` |
| **chutes** | `https://llm.chutes.ai/v1` | `Authorization` | `CHUTES_API_KEY` |
| **poe** | `https://api.poe.com/v1` | `Authorization` | `POE_API_KEY` |
| **nano-gpt** | `https://nano-gpt.com/api/v1` | `Authorization` | `NANOGPT_API_KEY` |

---

## Implementation Priority

### P0: Required by User ✅ IMPLEMENTED
1. **Inception Labs** - Mercury Coder models

### P1: High-Impact OpenAI-Compatible ✅ IMPLEMENTED
2. **xAI (Grok)** - Major player, Twitter/X integration
3. **Cerebras** - Fast inference, unique hardware
4. **SambaNova** - Enterprise hardware acceleration

### P2: Medium-Impact OpenAI-Compatible ✅ IMPLEMENTED
5. DeepInfra - Simple deployment
6. Hyperbolic - Cost-effective GPU
7. Novita - Growing model hub
8. Lambda Labs - Popular GPU cloud
9. Moonshot - 1M+ context window
10. Nebius - European alternative
11. NScale - GPU cloud infrastructure
12. NVIDIA NIM - Optimized inference microservices

### P3: Niche/Specialized ✅ IMPLEMENTED
13. Featherless AI - Serverless
14. FriendliAI - Korean provider
15. Galadriel - Decentralized
16. Gradient AI - Private models
17. Meta Llama - Official Meta API
18. Venice AI - Uncensored private models
19. Chutes - Distributed AI inference
20. Public AI - Community model hub
21. Poe - Multi-platform AI assistant

### P4: Additional Cloud/Platform Integrations ✅ IMPLEMENTED
22. Cloudflare Workers AI - Edge inference
23. GitHub Models - Free tier available
24. OVHcloud AI - European cloud
25. Hosted vLLM - Cloud vLLM instances

### P5: Enterprise/Complex ⏳ PENDING
26. Databricks - Requires special auth
27. Snowflake - Enterprise focus
28. AWS SageMaker - Complex setup
29. Azure AI - Enterprise features
30. Predibase - LoRA serving

### P6: Regional Providers ✅ IMPLEMENTED
31. GigaChat - Russian foundation models
32. Volcengine - ByteDance cloud
33. MiniMax - Chinese multimodal AI

---

## Implementation Approach

### For OpenAI-Compatible Providers
All OpenAI-compatible providers can use the existing `OpenAICompatibleProvider` class with only configuration additions to `builtin.ts`:

```typescript
provider_id: {
  id: "provider_id",
  name: "Provider Name",
  description: "Description",
  defaultBaseUrl: "https://api.provider.com/v1",
  defaultApiKeyEnv: "PROVIDER_API_KEY",
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  supportsStreaming: true,
  requiresApiKey: true,
  category: "cloud",
}
```

No additional implementation code needed!

### For Custom Providers
Providers requiring custom request/response transformation need dedicated classes:
- Anthropic (custom message format)
- Google (custom endpoint structure)
- Azure (deployment-based URLs)
- AWS Bedrock (AWS SigV4 auth)
- Cohere (custom RAG features)
- Ollama (special endpoints)

---

## Missing Model Coverage

Some providers have unique models not available elsewhere:

| Provider | Unique Models |
|----------|---------------|
| Inception Labs | mercury-coder-small, mercury-coder-large |
| xAI | grok-2, grok-2-vision, grok-beta |
| Cerebras | llama-3.1-8b, llama-3.1-70b, llama-3.1-405b |
| SambaNova | Llama-3.2, EVO-1-32K, EVO-1-128K |
| Moonshot | moonshot-v1-128k, moonshot-v1-1m |
| Hyperbolic | Various finetuned models |
| Novita | 100+ open source models |

---

## Recommendations

1. **Immediate**: Add Inception Labs and 5-10 high-impact OpenAI-compatible providers
2. **Short-term**: Add all easy OpenAI-compatible providers (25+)
3. **Medium-term**: Evaluate custom providers (Databricks, SageMaker)
4. **Long-term**: Consider auto-discovery via LiteLLM's provider list

---

*Last updated: 2026-03-27 - 27 new providers added*
