import { GoogleGenAI } from '@google/genai';

export async function generateGemini(
  input: unknown,
  env: NodeJS.ProcessEnv,
  model: string,
  systemInstruction: string,
  responseJsonSchema: object,
) {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY?.trim(), httpOptions: { timeout: 45_000 } });
  return (await ai.models.generateContent({
    model,
    contents: JSON.stringify(input),
    config: { systemInstruction, responseMimeType: 'application/json', responseJsonSchema },
  })).text;
}

export function isQuotaError(cause: unknown) {
  return Number((cause as { status?: number } | null)?.status) === 429;
}

export function createLiveFallback(
  env: NodeJS.ProcessEnv,
  { minCooldown = 1, snapshotReadyModels = false } = {},
) {
  const blocked = new Map<string, number>();
  const ready = (model: string) => (blocked.get(model) || 0) <= Date.now();
  return async (attempt: (model: string) => Promise<string | undefined>, models = [
    ...new Set([
      env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
      ...(env.GEMINI_MODELS || '').split(',').map(model => model.trim()).filter(Boolean),
    ]),
  ]) => {
    const cooldown = Math.max(minCooldown, Number(env.GEMINI_QUOTA_COOLDOWN_MS) || 60_000);
    const candidates = snapshotReadyModels ? models.filter(ready) : models;
    for (const model of candidates) {
      if (!snapshotReadyModels && !ready(model)) continue;
      try {
        return { text: await attempt(model), ready: models.some(ready) };
      } catch (cause) {
        if (!isQuotaError(cause)) throw cause;
        blocked.set(model, Date.now() + cooldown);
      }
    }
    return { text: undefined, ready: models.some(ready) };
  };
}
