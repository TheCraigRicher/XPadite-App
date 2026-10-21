// PostHog product analytics for the App (browser side).
//
// Privacy model — deliberately conservative because XPadite holds private tasks, journals and notes:
//  - Starts ONLY after the user chooses "Allow" in the analytics notice (lib/analytics/consent). Until then nothing is
//    loaded or sent. It is a no-op without NEXT_PUBLIC_POSTHOG_KEY, and every call is wrapped so a PostHog failure can
//    never affect the App. Tracking only reads what happened; it never changes behaviour.
//  - Session Replay is DISABLED in the App (it would record private content). Autocapture, heatmaps, dead/rage clicks,
//    web vitals, exceptions, surveys, experiments and feature-flag calls are all off: only the explicit events below.
//  - Event properties are plan keys, controlled feature names and similar. Never emails, names, phone numbers, task or
//    journal text, notes, tokens or payment details. URLs are stripped of every query string and fragment.
//  - People are identified by the stable internal user id only (no email/name). Logout resets the identity.
//
// The key is PostHog's public client-ingestion token (phc_…), not a private API key.

import type { PostHog } from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

/** False when no PostHog key is configured: nothing runs and no consent notice is shown. */
export const analyticsConfigured = Boolean(KEY);

export const APP_SURFACE = "app";
/** Anonymous visitor id handed over by the Website (only when that visitor opted in there). */
export const APP_ID_PARAM = "xp_aid";
const APP_ID_STORE = "xp_aid";

/** Controlled list for core_feature_used — keeps the property low-cardinality and free of user content. */
export type FeatureName =
  | "calendar"
  | "activity_time_tracker"
  | "advanced_task_manager"
  | "mind_mapping_canvas"
  | "analytics_dashboard"
  | "journal_planner_editor";

type Props = Record<string, string | number | boolean | undefined>;

let client: PostHog | null = null;
let loading: Promise<void> | null = null;
let queue: Array<(ph: PostHog) => void> = [];
let identified: string | null = null;
const featureLastSent = new Map<FeatureName, number>();
const FEATURE_WINDOW_MS = 30 * 60_000; // one adoption signal per feature per 30 minutes, not every click

const URL_KEYS = ["$current_url", "$referrer", "$initial_referrer", "$session_entry_url", "$session_entry_referrer", "$initial_current_url"];

function stripUrl(value: unknown): unknown {
  return typeof value === "string" ? value.split(/[?#]/)[0] : value;
}

function scrub(bag: Record<string, unknown> | undefined) {
  if (!bag) return;
  for (const k of URL_KEYS) if (k in bag) bag[k] = stripUrl(bag[k]);
}

/** Stores an anonymous id received from the Website so a visit can be tied to the later sign-up. */
export function rememberWebsiteVisitorId(): void {
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(APP_ID_PARAM);
    if (raw === null) return;
    if (/^[A-Za-z0-9_-]{8,64}$/.test(raw)) window.localStorage.setItem(APP_ID_STORE, raw);
    url.searchParams.delete(APP_ID_PARAM); // keep the address bar (and any shared link) clean
    window.history.replaceState(window.history.state, "", url.pathname + (url.search || "") + url.hash);
  } catch {
    /* ignore */
  }
}

function storedVisitorId(): string | undefined {
  try {
    const v = window.localStorage.getItem(APP_ID_STORE);
    return v && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Starts PostHog once (after consent). Safe to call repeatedly. */
export function startAnalytics(): void {
  if (!KEY || typeof window === "undefined" || client || loading) return;
  const bootstrapId = storedVisitorId();
  loading = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        persistence: "localStorage+cookie",
        cross_subdomain_cookie: false,
        person_profiles: "identified_only",
        ip: false,
        respect_dnt: true,
        ...(bootstrapId ? { bootstrap: { distinctID: bootstrapId, isIdentifiedID: false } } : {}),
        // Only the events sent from this app's code.
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_dead_clicks: false,
        capture_heatmaps: false,
        capture_performance: false,
        capture_exceptions: false,
        rageclick: false,
        disable_session_recording: true, // never record the App: it shows private tasks, journals and notes
        disable_surveys: true,
        disable_conversations: true,
        disable_product_tours: true,
        disable_web_experiments: true,
        advanced_disable_flags: true,
        advanced_disable_toolbar_metrics: true,
        before_send: (event) => {
          if (!event) return null;
          scrub(event.properties);
          scrub(event.$set_once as Record<string, unknown> | undefined);
          scrub(event.$set as Record<string, unknown> | undefined);
          return event;
        },
      });
      if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: false });
      posthog.register({ app_surface: APP_SURFACE });
      client = posthog;
      const run = queue;
      queue = [];
      for (const fn of run) {
        try {
          fn(posthog);
        } catch {
          /* analytics must never throw into the App */
        }
      }
    })
    .catch(() => {
      loading = null; // blocked or failed to load: the App works exactly the same
      queue = [];
    });
}

/** Removes whatever PostHog stored in this browser (visitor id, session, flags) and the Website hand-over id. */
function forgetStoredIdentity(): void {
  try {
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (const k of Object.keys(store)) if (k.startsWith("ph_") || k.startsWith("__ph_")) store.removeItem(k);
    }
    window.localStorage.removeItem(APP_ID_STORE);
    for (const c of document.cookie.split("; ")) {
      const name = c.split("=")[0];
      if (/^ph_.*_posthog$/.test(name)) document.cookie = `${name}=; Max-Age=0; path=/`;
    }
  } catch {
    /* storage blocked: nothing was stored */
  }
}

/**
 * Stop capturing. With `forget` (the user declined or withdrew) this browser's analytics identity is also erased;
 * without it (no decision yet) a hand-over id from the Website is kept for use if the user later says yes.
 */
export function stopAnalytics(forget = true): void {
  queue = [];
  identified = null;
  if (typeof window === "undefined") return;
  if (client) {
    try {
      client.reset(); // clears id and (by design) the consent flag, so opt out AFTER it
      client.opt_out_capturing();
    } catch {
      /* ignore */
    }
  }
  if (forget) forgetStoredIdentity();
}

function withClient(fn: (ph: PostHog) => void): void {
  try {
    if (client) {
      if (!client.has_opted_out_capturing()) fn(client);
    } else if (loading) {
      queue.push(fn);
    }
  } catch {
    /* ignore */
  }
}

/** Sends one named event. Never pass personal data or user content in `props`. */
export function track(event: string, props: Props = {}): void {
  withClient((ph) => ph.capture(event, { app_surface: APP_SURFACE, ...props }));
}

export function trackPageView(path: string): void {
  track("app_page_viewed", { path });
}

/** core_feature_used with a controlled feature name; at most once per feature per 30 minutes. */
export function trackFeature(feature: FeatureName): void {
  const now = Date.now();
  const last = featureLastSent.get(feature);
  if (last !== undefined && now - last < FEATURE_WINDOW_MS) return;
  featureLastSent.set(feature, now);
  track("core_feature_used", { feature_name: feature });
}

/** Ties the anonymous history to the internal user id (no email/name). Called once per distinct user id. */
export function identifyUser(userId: string): void {
  if (!userId || identified === userId) return;
  withClient((ph) => {
    if (identified === userId) return;
    ph.identify(userId);
    identified = userId;
  });
}

/** Logout: forget who this browser was so a shared device is never linked to the previous user. */
export function resetIdentity(): void {
  if (identified === null && !client) return;
  identified = null;
  try {
    if (client) {
      client.reset();
      client.register({ app_surface: APP_SURFACE });
    }
  } catch {
    /* ignore */
  }
}
