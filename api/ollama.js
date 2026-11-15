// Ollama runs on the developer's computer; no cloud key or per-request quota.
export async function generateWithOllama({ input, env, systemInstruction, schema }) {
  const baseUrl = (env.OLLAMA_URL?.trim() || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: env.OLLAMA_MODEL?.trim() || 'qwen3:8b',
      messages: [
        { role: 'system', content: `${systemInstruction}\nReturn only JSON matching the required schema.` },
        { role: 'user', content: JSON.stringify(input) },
      ],
      format: schema,
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
  const result = await response.json();
  if (typeof result.message?.content !== 'string') throw new Error('Ollama returned no message content.');
  return result.message.content;
}
