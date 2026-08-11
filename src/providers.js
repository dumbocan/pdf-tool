// AI provider catalog for pdf-tool.
// All providers here use the OpenAI-compatible chat/completions format, so the
// runtime only needs baseUrl + model + key. Adding a provider = adding one row.
// "needsKey: false" providers (local servers) skip the API key prompt.
// "models" is a short pick-list for non-engineers: the wizard shows numbers and
// the user never has to know exact model ids (they can still type "other").
//
// The installer wizard (pdf-tool config) lets a non-engineer pick a provider,
// pick a model and paste a key — base URL and model defaults come from here.

export const PROVIDERS = [
  {
    id: "minimax",
    name: "MiniMax",
    tagline: "Rápido y barato, muy bueno en español",
    baseUrl: "https://api.minimax.io/v1",
    models: ["MiniMax-M3"],
    needsKey: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    tagline: "GPT — el clásico",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-5", "gpt-5-mini"],
    needsKey: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    tagline: "Una sola clave para muchos modelos",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      "openai/gpt-5",
      "anthropic/claude-sonnet-4.6",
      "google/gemini-2.5-pro",
      "deepseek/deepseek-chat",
    ],
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
    id: "groq",
    name: "Groq",
    tagline: "Ultra rápido, con capa gratuita",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    needsKey: true,
  },
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
