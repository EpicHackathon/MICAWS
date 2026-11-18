import { useEffect, useRef, useState } from 'react';

type TranscriptSegment = {
  text: string;
};

type TranslationResult = {
  texts: string[];
  error: string | null;
  busy: boolean;
};

type TranslationCache = {
  language: string;
  texts: string[];
  originals: string[];
};

type TranslationResponse = {
  error?: string;
  translations?: unknown;
};

export function useTranslations(
  segments: TranscriptSegment[],
  targetLanguage: string,
) {
  const [result, setResult] = useState<TranslationResult>({
    texts: [],
    error: null,
    busy: false,
  });

  const [retry, setRetry] = useState(0);

  const cache = useRef<TranslationCache>({
    language: '',
    texts: [],
    originals: [],
  });

  const key = JSON.stringify(segments.map(segment => segment.text));

  useEffect(() => {
    const originals: string[] = JSON.parse(key);

    if (
      cache.current.language !== targetLanguage ||
      cache.current.originals.some((text, i) => text !== originals[i])
    ) {
      cache.current = {
        language: targetLanguage,
        texts: [],
        originals: [],
      };
    }

    const current = cache.current;
    const controller = new AbortController();

    setResult({
      texts: [...current.texts],
      error: null,
      busy: !!targetLanguage && current.texts.length < originals.length,
    });

    if (!targetLanguage) return;

    void (async () => {
      try {
        while (current.texts.length < originals.length) {
          const start = current.texts.length;
          const texts = originals.slice(start, start + 10);

          const response = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts, targetLanguage }),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(180000),
            ]),
          });

          const data: TranslationResponse = await response.json();

          if (controller.signal.aborted) return;

          if (!response.ok) {
            throw new Error(data.error || 'Translation failed.');
          }

          if (
            !Array.isArray(data.translations) ||
            data.translations.length !== texts.length ||
            data.translations.some(text => typeof text !== 'string')
          ) {
            throw new Error('Invalid translation response.');
          }

          current.texts.push(...(data.translations as string[]));
          current.originals.push(...texts);

          setResult({
            texts: [...current.texts],
            error: null,
            busy: current.texts.length < originals.length,
          });
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setResult({
            texts: [...current.texts],
            error: cause instanceof Error ? cause.message : String(cause),
            busy: false,
          });
        }
      }
    })();

    return () => controller.abort();
  }, [key, targetLanguage, retry]);

  return {
    ...result,
    retry: () => setRetry(value => value + 1),
  };
}
