import { messages, type Language, type MessageKey } from "./messages";
export type { Language, MessageKey } from "./messages";

export type MessageParams = Readonly<Record<string, string | number>>;
export type Message = Readonly<{ key: MessageKey; params: MessageParams }>;
let language: Language = "en";
const listeners = new Set<() => void>();

export function detectLanguage(saved: string | null, languages: readonly string[]): Language {
  if (saved === "ja" || saved === "en") return saved;
  return /^ja(?:[-_]|$)/i.test(languages[0] ?? "") ? "ja" : "en";
}

export function getLanguage(): Language { return language; }

export function setLanguage(next: Language): void {
  language = next;
  listeners.forEach((listener) => listener());
}

export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function msg(key: MessageKey, params: MessageParams = {}): Message {
  return { key, params };
}

export function t(key: MessageKey, params: MessageParams = {}): string {
  return messages[language][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder);
}

export function translate(message: Message): string { return t(message.key, message.params); }

export function applyTranslations(root: Document): void {
  root.documentElement.lang = language;
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n as MessageKey);
  });
  for (const attribute of ["aria-label", "title", "placeholder", "alt"] as const) {
    root.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`).forEach((element) => {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`) as MessageKey));
    });
  }
}

export class LocalizedError extends Error {
  readonly localized: Message;
  constructor(key: MessageKey, params: MessageParams = {}) {
    super(t(key, params));
    this.localized = msg(key, params);
  }
}

export function errorMessage(error: unknown): Message {
  if (error instanceof LocalizedError) return error.localized;
  // Native/OS diagnostic details stay available in the console, not mixed into translated UI.
  console.error(error);
  const detail = error instanceof Error ? error.message : String(error);
  const nativeErrors: [RegExp, MessageKey][] = [
    [/Permission denied|Operation not permitted|Access is denied/i, "permissionDenied"],
    [/No such file|not found|cannot find the (?:file|path)/i, "fileUnavailable"],
    [/^Failed to (?:read file|open image)/, "readFailed"],
    [/^Failed to decode/, "decodeFailed"],
    [/^Failed to (?:save|create file)/, "saveFailed"],
    [/^Failed to (?:open window|lock startup file map)/, "windowFailed"]
  ];
  return msg(nativeErrors.find(([pattern]) => pattern.test(detail))?.[1] ?? "operationFailed");
}
