// AI provider catalog for pdf-tool.
// Almost all providers use the OpenAI-compatible chat/completions format, so
// the runtime only needs baseUrl + model + key. Anthropic is the exception:
// it uses /v1/messages (flag `anthropic: true`), handled by the runtime.
// "needsKey: false" providers (local servers) skip the API key prompt.
// "models" is a short pick-list for non-engineers: the wizard shows numbers
// and the user never has to know exact model ids (they can still type "other").
//
// The installer wizard (pdf-tool config) lets a non-engineer pick a provider,
// pick a model and paste a key — base URL and model defaults come from here.

export const PROVIDERS = [
  // ── Americanos ────────────────────────────────────────────────────────────
  {
    id: "openai",
    name: "OpenAI",
    tagline: "GPT — el clásico",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-5", "gpt-5-mini"],
    needsKey: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    tagline: "Claude — muy bueno escribiendo",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-sonnet-4-5", "claude-opus-4-1"],
    needsKey: true,
    anthropic: true,
  },
  {
    id: "google",
    name: "Google (Gemini)",
    tagline: "Gemini — gratis para probar",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    needsKey: true,
  },
  {
    id: "groq",
    name: "Groq",
    tagline: "Ultra rápido, con capa gratuita",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    needsKey: true,
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    tagline: "Grok — rápido y directo",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-3", "grok-3-mini"],
    needsKey: true,
  },
  {
    id: "together",
    name: "Together AI",
    tagline: "Muchos modelos abiertos (Llama, DeepSeek...)",
    baseUrl: "https://api.together.xyz/v1",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-R1"],
    needsKey: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    tagline: "Una sola clave para cientos de modelos",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      "openai/gpt-5",
      "anthropic/claude-sonnet-4-5",
      "google/gemini-2.5-pro",
      "deepseek/deepseek-chat",
    ],
    needsKey: true,
  },
  // ── Chinos ────────────────────────────────────────────────────────────────
  {
    id: "minimax",
    name: "MiniMax",
    tagline: "Rápido y barato, muy bueno en español",
    baseUrl: "https://api.minimax.io/v1",
    models: ["MiniMax-M3"],
    needsKey: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    tagline: "Muy barato y con buen razonamiento",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsKey: true,
  },
  {
    id: "qwen",
    name: "Qwen (Alibaba)",
    tagline: "Muy barato, bueno en varios idiomas",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-max", "qwen-plus"],
    needsKey: true,
  },
  {
    id: "kimi",
    name: "Kimi (Moonshot)",
    tagline: "Chino, muy bueno con textos largos",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["kimi-k2", "moonshot-v1-32k"],
    needsKey: true,
  },
  {
    id: "glm",
    name: "GLM (Zhipu)",
    tagline: "Chino, con capa gratuita",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-plus", "glm-4-flash"],
    needsKey: true,
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    tagline: "Chino, modelos abiertos baratos",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"],
    needsKey: true,
  },
  // ── Europeos ──────────────────────────────────────────────────────────────
  {
    id: "mistral",
    name: "Mistral (Francia)",
    tagline: "Europeo, muy bueno y respeta tu privacidad",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest"],
    needsKey: true,
  },
  {
    id: "alephalpha",
    name: "Aleph Alpha (Alemania)",
    tagline: "Europeo, centrado en empresas y privacidad",
    baseUrl: "https://api.aleph-alpha.com/v1",
    models: ["Pharia-1-LLM-7B-control", "Llama-3.1-70B-Instruct"],
    needsKey: true,
  },
  // ── Locales (sin internet ni clave) ───────────────────────────────────────
  {
    id: "ollama",
    name: "Local (Ollama)",
    tagline: "Sin internet ni clave — corre en tu máquina",
    baseUrl: "http://localhost:11434/v1",
    // The wizard detects the models actually installed via `ollama list`;
    // this list is only the fallback when Ollama isn't running.
    models: ["llama3.2", "llama3.3", "qwen2.5", "mistral"],
    needsKey: false,
  },
  {
    id: "lmstudio",
    name: "Local (LM Studio)",
    tagline: "Sin clave — servidor local en tu PC",
    baseUrl: "http://localhost:1234/v1",
    models: ["local-model"],
    needsKey: false,
  },
  // ── Cualquier otro ────────────────────────────────────────────────────────
  {
    id: "custom",
    name: "Otro (compatible OpenAI)",
    tagline: "Cualquier servicio OpenAI-compatible",
    baseUrl: "",
    models: [],
    needsKey: true,
  },
];

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

export function defaultModel(provider) {
  return provider.models?.[0] ?? "";
}
