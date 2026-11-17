/**
 * File-picker for CSV import (PRs + History).
 *
 * - web: hidden <input type=file accept=".csv"> whose onChange hands back a
 *   File; we read its text (the port in importPrsCsv.ts wants a string).
 * - native (android/ios): expo-document-picker + expo-file-system (new API).
 *   Accepts multiple MIME types because file managers / Google Drive label
 *   CSVs inconsistently (text/csv, text/comma-separated-values,
 *   application/vnd.ms-excel, text/plain...); we enforce the .csv extension
 *   ourselves after the picker returns.
 *
 * Resolves with the chosen file's text, or null if the user cancelled or
 * picked a non-CSV.
 */

import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";

let pickInFlight = false;

/** Resolves with the chosen file's text, or null if the user cancelled. */
export type PickCsvResult = { text: string } | null;

export function pickCsvFile(): Promise<PickCsvResult> {
  if (pickInFlight) {
    console.warn("[pickCsvFile] already in flight — ignoring second call");
    return Promise.resolve(null);
  }
  if (Platform.OS !== "web") {
    pickInFlight = true;
    return pickCsvNative().finally(() => { pickInFlight = false; });
  }
  return new Promise<PickCsvResult>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv,text/plain";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.opacity = "0";
    input.style.pointerEvents = "none"; // don't steal clicks; we .click() it
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      if (!settled) return;
      input.onchange = null;
      input.oncancel = null;
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) {
        settled = true; cleanup(); resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : String(reader.result ?? "");
        settled = true; cleanup(); resolve({ text });
      };
      reader.onerror = () => {
        settled = true; cleanup(); resolve(null);
      };
      reader.readAsText(file);
    };

    // The cancel event (ESC / "Cancel" in the dialog) is not reliably fired by
    // all browsers; if no file is chosen and the user just closes, we rely on
    // the user re-tapping. Treat a change with no file as cancel.
    input.oncancel = () => {
      settled = true; cleanup(); resolve(null);
    };

    input.click();
  });
}

async function pickCsvNative(): Promise<PickCsvResult> {
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: [
        "text/csv",
        "text/comma-separated-values",
        "application/csv",
        "application/vnd.ms-excel",
        "text/plain",
      ],
      copyToCacheDirectory: true,
    });
    if (res.canceled) return null;
    const asset = res.assets[0];
    if (!asset) return null;
    // The picker can return non-CSVs (text/plain, Excel); enforce the
    // extension ourselves.
    if (!asset.name.toLowerCase().endsWith(".csv")) {
      console.warn(`[pickCsvFile] picked "${asset.name}" — not a .csv file`);
      return null;
    }
    let text = await new File(asset.uri).text();
    // Excel adds an invisible BOM; strip it (the import port also strips,
    // belt and braces).
    text = text.replace(/^\uFEFF/, "");
    return { text };
  } catch (e) {
    console.error("[pickCsvFile] native picker failed:", e?.message ?? e);
    console.error("[pickCsvFile] stack:", e instanceof Error ? e.stack : "(not an Error)");
    return null;
  }
}
