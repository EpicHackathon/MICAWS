import type { PendingChange } from "../shared/savedMeeting.js";

// Store only encrypted pending commands. The decryption key is supplied after meeting authorization.
const encode = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const decode = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export async function draftVault(keyText: string, storage = localStorage) {
  const key = await crypto.subtle.importKey(
    "raw",
    decode(keyText),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  return {
    async save(id: string, draft: PendingChange) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) },
        key,
        new TextEncoder().encode(JSON.stringify(draft)),
      );
      storage.setItem(
        `micaws-draft:${id}`,
        JSON.stringify({
          iv: encode(iv),
          data: encode(new Uint8Array(encrypted)),
        }),
      );
    },
    async read(id: string): Promise<PendingChange | null> {
      const saved = storage.getItem(`micaws-draft:${id}`);
      if (!saved) return null;
      const { iv, data } = JSON.parse(saved);
      return JSON.parse(
        new TextDecoder().decode(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: decode(iv),
              additionalData: new TextEncoder().encode(id),
            },
            key,
            decode(data),
          ),
        ),
      );
    },
    clear(id: string) {
      storage.removeItem(`micaws-draft:${id}`);
    },
  };
}
