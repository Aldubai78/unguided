/**
 * debugLog.ts — Debug build: verbose logging of every server call.
 *
 * Enabled via __DEV__ (Metro dev builds + Expo Go). In release builds this
 * file is a no-op: `debug()` returns immediately, `setDebugBanner()` does
 * nothing. The banner component in SignInScreen only renders when __DEV__.
 *
 * This is temporary scaffolding for diagnosing the "app not connecting"
 * report (2026-11-25). Remove after diagnosis.
 */

export interface DebugEntry {
  ts: string;
  label: string;
  detail: string;
}

let entries: DebugEntry[] = [];
let listeners: ((e: DebugEntry) => void)[] = [];

export function debug(label: string, detail: string): void {
  if (!__DEV__) return;
  const e: DebugEntry = { ts: new Date().toISOString().slice(11, 19), label, detail };
  entries.push(e);
  // keep the last 200 entries
  if (entries.length > 200) entries = entries.slice(-200);
  for (const l of listeners) l(e);
}

export function getDebugEntries(): DebugEntry[] {
  return entries;
}

export function clearDebug(): void {
  entries = [];
  for (const l of listeners) l(null as unknown as DebugEntry);
}

export function subscribeDebug(listener: (e: DebugEntry | null) => void): () => void {
  listeners.push(listener);
  return () => { listeners = listeners.filter((l) => l !== listener); };
}

export function setDebugBanner(text: string): void {
  // no-op in release; in dev the banner state is held by the component
}
