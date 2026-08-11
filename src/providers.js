// AI provider catalog for pdf-tool.
// All providers here use the OpenAI-compatible chat/completions format, so the
// runtime only needs baseUrl + model + key. Adding a provider = adding one row.
// "needsKey: false" providers (local servers) skip the API key prompt.
//
// The installer wizard (pdf-tool config) lets a non-engineer pick a provider,
// paste a key and be done: base URL and model defaults come from this table.

export const PROVIDERS = [
  {
    id: "minimax",
    name: "MiniMax",
    tagline: "Rápido y barato, muy bueno en español",
    baseUrl: "https://api.minimax.io/v1",
    model: "MiniMax-M3",
    needsKey: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    tagline: "GPT — el clásico",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5",
    needsKey: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    tagline: "Una sola clave para muchos modelos",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-5",
    needsKey: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    tagline: "Muy barato y con buen razonamiento",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    needsKey: true,
  },
  {
    id: "groq",
    name: "Groq",
    tagline: "Ultra rápido, con capa gratuita",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    needsKey: true,
  },
  {
    id: "ollama",
    name: "Local (Ollama)",
    tagline: "Sin internet ni clave — corre en tu máquina",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    needsKey: false,
  },
  {
    id: "lmstudio",
    name: "Local (LM Studio)",
    tagline: "Sin clave — servidor local en tu PC",
    baseUrl: "http://localhost:1234/v1",
    model: "local-model",
    needsKey: false,
  },
  {
    id: "custom",
    name: "Otro (compatible OpenAI)",
    tagline: "Cualquier servicio OpenAI-compatible",
    baseUrl: "",
    model: "",
    needsKey: true,
  },
];

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}
