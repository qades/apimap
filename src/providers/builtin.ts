// ============================================================================
// Built-in Provider Definitions
// Organized by tier according to API_MAP_PROVIDERS.md
// ============================================================================

import type { ProviderInfo } from "./types.ts";

// ============================================================================
// TIER 1: CORE PROVIDERS
// ============================================================================

const TIER1_PROVIDERS: Record<string, ProviderInfo> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI GPT models (GPT-4o, GPT-4, GPT-3.5, o1, o3, etc.)",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultApiKeyEnv: "OPENAI_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models (Claude 3.5 Sonnet, Opus, Haiku, etc.)",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultApiKeyEnv: "ANTHROPIC_API_KEY",
    authHeader: "x-api-key",
    authPrefix: "",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  google: {
    id: "google",
    name: "Google Gemini",
    description: "Google Gemini models (Gemini 1.5 Pro/Flash, etc.)",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultApiKeyEnv: "GOOGLE_API_KEY",
    authHeader: "x-goog-api-key",
    authPrefix: "",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  azure: {
    id: "azure",
    name: "Azure OpenAI",
    description: "Azure OpenAI Service with enterprise features",
    defaultBaseUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}",
    defaultApiKeyEnv: "AZURE_OPENAI_API_KEY",
    authHeader: "api-key",
    authPrefix: "",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "enterprise",
  },
  bedrock: {
    id: "bedrock",
    name: "AWS Bedrock",
    description: "AWS Bedrock - Multiple models via AWS",
    defaultBaseUrl: "https://bedrock-runtime.{region}.amazonaws.com",
    defaultApiKeyEnv: "AWS_ACCESS_KEY_ID",
    authHeader: "Authorization",
    authPrefix: "",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "enterprise",
  },
};

// ============================================================================
// TIER 2: MAJOR PLAYERS
// ============================================================================

const TIER2_PROVIDERS: Record<string, ProviderInfo> = {
  groq: {
    id: "groq",
    name: "Groq",
    description: "Ultra-fast inference with Groq LPU",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultApiKeyEnv: "GROQ_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  together: {
    id: "together",
    name: "Together AI",
    description: "Together AI inference platform - 200+ models",
    defaultBaseUrl: "https://api.together.xyz/v1",
    defaultApiKeyEnv: "TOGETHER_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  fireworks: {
    id: "fireworks",
    name: "Fireworks AI",
    description: "Fast inference with Fireworks AI",
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    defaultApiKeyEnv: "FIREWORKS_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    description: "Mistral AI models (Large, Medium, Small, Codestral)",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultApiKeyEnv: "MISTRAL_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    description: "Cohere Command models with RAG capabilities",
    defaultBaseUrl: "https://api.cohere.ai/v1",
    defaultApiKeyEnv: "COHERE_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek AI models with reasoning capabilities",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultApiKeyEnv: "DEEPSEEK_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
};

// ============================================================================
// TIER 3: ECOSYSTEM PROVIDERS
// ============================================================================

const TIER3_PROVIDERS: Record<string, ProviderInfo> = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    description: "OpenRouter - unified API for 200+ models",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultApiKeyEnv: "OPENROUTER_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    description: "Perplexity AI with citations and search",
    defaultBaseUrl: "https://api.perplexity.ai",
    defaultApiKeyEnv: "PERPLEXITY_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  ai21: {
    id: "ai21",
    name: "AI21 Labs",
    description: "AI21 Labs Jamba and Jurassic models",
    defaultBaseUrl: "https://api.ai21.com/studio/v1",
    defaultApiKeyEnv: "AI21_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  replicate: {
    id: "replicate",
    name: "Replicate",
    description: "Replicate - run open-source models",
    defaultBaseUrl: "https://api.replicate.com/v1",
    defaultApiKeyEnv: "REPLICATE_API_TOKEN",
    authHeader: "Authorization",
    authPrefix: "Token ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  huggingface: {
    id: "huggingface",
    name: "Hugging Face",
    description: "Hugging Face Inference API - 100k+ models",
    defaultBaseUrl: "https://api-inference.huggingface.co",
    defaultApiKeyEnv: "HF_API_TOKEN",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  octoai: {
    id: "octoai",
    name: "OctoAI",
    description: "OctoAI - production inference at scale",
    defaultBaseUrl: "https://text.octoai.run/v1",
    defaultApiKeyEnv: "OCTOAI_API_TOKEN",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
  anyscale: {
    id: "anyscale",
    name: "Anyscale",
    description: "Anyscale Endpoints",
    defaultBaseUrl: "https://api.endpoints.anyscale.com/v1",
    defaultApiKeyEnv: "ANYSCALE_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "cloud",
  },
};

// ============================================================================
// TIER 4: LOCAL PROVIDERS
// ============================================================================

function getLocalProviderBaseUrl(port: number, path: string = "/v1"): string {
  const isDocker = envVar("API_MAP_IN_DOCKER") === "true" ||
    envVar("DOCKER_CONTAINER") === "true" ||
    envVar("RUNNING_IN_DOCKER") === "true";
  if (isDocker) {
    return `http://host.containers.internal:${port}${path}`;
  }
  return `http://localhost:${port}${path}`;
}

function envVar(name: string): string | undefined {
  return Bun.env[name];
}

const TIER4_LOCAL_PROVIDERS: Record<string, ProviderInfo> = {
  ollama: {
    id: "ollama",
    name: "Ollama",
    description: "Local models via Ollama (Llama, Mistral, Gemma, etc.)",
    defaultBaseUrl: getLocalProviderBaseUrl(11434),
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    description: "Local models via LM Studio",
    defaultBaseUrl: getLocalProviderBaseUrl(1234, "/v1"),
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
  llamacpp: {
    id: "llamacpp",
    name: "llama.cpp",
    description: "Local models via llama.cpp server",
    defaultBaseUrl: getLocalProviderBaseUrl(8080, "/v1"),
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
  vllm: {
    id: "vllm",
    name: "vLLM",
    description: "High-throughput inference with vLLM and PagedAttention",
    defaultBaseUrl: getLocalProviderBaseUrl(8000, "/v1"),
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
  localai: {
    id: "localai",
    name: "LocalAI",
    description: "Self-hosted OpenAI-compatible API",
    defaultBaseUrl: getLocalProviderBaseUrl(8080, "/v1"),
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
  tabbyapi: {
    id: "tabbyapi",
    name: "TabbyAPI",
    description: "ExLlamaV2 optimized local inference",
    defaultBaseUrl: getLocalProviderBaseUrl(5000, "/v1"),
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
  textgenwebui: {
    id: "textgenwebui",
    name: "Text Generation WebUI",
    description: "oobabooga Text Generation WebUI",
    defaultBaseUrl: getLocalProviderBaseUrl(5000, "/v1"),
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
  koboldcpp: {
    id: "koboldcpp",
    name: "KoboldCpp",
    description: "KoboldCpp local inference",
    defaultBaseUrl: getLocalProviderBaseUrl(5001),
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: false,
    category: "local",
  },
};

// ============================================================================
// TIER 4: ENTERPRISE PROVIDERS
// ============================================================================

const TIER4_ENTERPRISE_PROVIDERS: Record<string, ProviderInfo> = {
  vertexai: {
    id: "vertexai",
    name: "Google Vertex AI",
    description: "Google Cloud Vertex AI Platform",
    defaultBaseUrl: "https://{region}-aiplatform.googleapis.com/v1",
    defaultApiKeyEnv: "GOOGLE_APPLICATION_CREDENTIALS",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "enterprise",
  },
  watsonx: {
    id: "watsonx",
    name: "IBM watsonx.ai",
    description: "IBM watsonx.ai enterprise AI platform",
    defaultBaseUrl: "https://{region}.ml.cloud.ibm.com",
    defaultApiKeyEnv: "WATSONX_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "enterprise",
  },
  oracle: {
    id: "oracle",
    name: "Oracle Cloud",
    description: "Oracle Cloud Infrastructure Generative AI",
    defaultBaseUrl: "https://generativeai.{region}.oci.oraclecloud.com",
    defaultApiKeyEnv: "OCI_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: false,
    requiresApiKey: true,
    category: "enterprise",
  },
};

// ============================================================================
// TIER 5: REGIONAL PROVIDERS
// ============================================================================

const TIER5_PROVIDERS: Record<string, ProviderInfo> = {
  dashscope: {
    id: "dashscope",
    name: "Alibaba DashScope",
    description: "Alibaba Cloud DashScope with Qwen models",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
    defaultApiKeyEnv: "DASHSCOPE_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "regional",
  },
  baidu: {
    id: "baidu",
    name: "Baidu ERNIE",
    description: "Baidu ERNIE Bot API",
    defaultBaseUrl: "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop",
    defaultApiKeyEnv: "BAIDU_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "regional",
  },
  tencent: {
    id: "tencent",
    name: "Tencent Hunyuan",
    description: "Tencent Hunyuan large model",
    defaultBaseUrl: "https://hunyuan.tencentcloudapi.com",
    defaultApiKeyEnv: "TENCENT_SECRET_KEY",
    authHeader: "Authorization",
    authPrefix: "",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "regional",
  },
  yandex: {
    id: "yandex",
    name: "Yandex GPT",
    description: "Yandex Foundation Models",
    defaultBaseUrl: "https://llm.api.cloud.yandex.net",
    defaultApiKeyEnv: "YANDEX_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Api-Key ",
    supportsStreaming: false,
    requiresApiKey: true,
    category: "regional",
  },
  hyperclova: {
    id: "hyperclova",
    name: "Naver HyperCLOVA",
    description: "Naver HyperCLOVA X",
    defaultBaseUrl: "https://clovastudio.stream.ntruss.com",
    defaultApiKeyEnv: "HYPERCLOVA_API_KEY",
    authHeader: "Authorization",
    authPrefix: "Bearer ",
    supportsStreaming: true,
    requiresApiKey: true,
    category: "regional",
  },
};

// ============================================================================
// Combined BUILTIN_PROVIDERS export
// ============================================================================

export type { ProviderInfo } from "./types.ts";

export const BUILTIN_PROVIDERS: Record<string, ProviderInfo> = {
  ...TIER1_PROVIDERS,
  ...TIER2_PROVIDERS,
  ...TIER3_PROVIDERS,
  ...TIER4_LOCAL_PROVIDERS,
  ...TIER4_ENTERPRISE_PROVIDERS,
  ...TIER5_PROVIDERS,
};

// Export individual tiers for potential filtering
export {
  TIER1_PROVIDERS,
  TIER2_PROVIDERS,
  TIER3_PROVIDERS,
  TIER4_LOCAL_PROVIDERS,
  TIER4_ENTERPRISE_PROVIDERS,
  TIER5_PROVIDERS,
};
