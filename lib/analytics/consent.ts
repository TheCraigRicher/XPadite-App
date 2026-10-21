// Analytics consent for the App.
//
// The App had no consent system, and XPadite holds private tasks, journals and planning data, so analytics is OFF by
// default here: nothing is loaded or sent until the user explicitly chooses "Allow" in the notice
// (components/analytics/AnalyticsProvider). The choice is stored in this browser and can be changed by clearing it
// (see docs/ANALYTICS.md). The Website has its own consent record on its own domain; browsers do not share it.

export type AnalyticsConsent = { v: 1; analytics: boolean; decidedAt: string };

const KEY = "xpadite-analytics-consent";
const CHANGE = "xpadite:analytics-consent-change";

let memory: AnalyticsConsent | null = null; // used when browser storage is blocked
let cachedRaw: string | null | undefined;
let cachedValue: AnalyticsConsent | null = null;

function read(): AnalyticsConsent | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return memory;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as AnalyticsConsent) : null;
    cachedValue = parsed && parsed.v === 1 && typeof parsed.analytics === "boolean" ? parsed : null;
  } catch {
    cachedValue = null;
  }
  return cachedValue;
}

export const getConsentSnapshot = (): AnalyticsConsent | null => read();
export const getServerConsentSnapshot = (): AnalyticsConsent | null => null;

export function subscribeConsent(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener(CHANGE, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Sign-out: the next person on this browser must make their own choice (the server copy is per user). */
export function clearConsent(): void {
  memory = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CHANGE));
}

export function saveConsent(analytics: boolean): void {
  const value: AnalyticsConsent = { v: 1, analytics, decidedAt: new Date().toISOString() };
  memory = value;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* storage blocked: the choice applies for this page session only */
  }
  window.dispatchEvent(new Event(CHANGE));
}
