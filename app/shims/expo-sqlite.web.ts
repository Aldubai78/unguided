// WEB store for the on-device SQLite layer (browser dev target).
//
// Metro bundles THIS file on web (via app/db/database.ts) and database.native.ts
// on Android/iOS. The browser has no on-device DB and we do NOT want to drag the
// expo-sqlite wasm worker into the web bundle (that's what broke sign-in), so this
// is a real, in-memory store keyed by table name that satisfies the sync surface
// the app actually uses on the web dev loop:
//
//   runSync / execSync      INSERT ... ON CONFLICT / UPDATE / DELETE
//   getFirstSync            SELECT count(*) n  AND  SELECT ... FROM <t> WHERE uuid = ?
//   getAllSync              SELECT ... FROM outbox ORDER BY id ASC  AND  ... FROM <t>
//
// Data lives in memory for the session (and localStorage when available, so it
// survives a refresh). It is NOT a general SQL engine — it implements exactly the
// queries the app issues. Native (Android/iOS) still uses the real SQLite engine
// via database.native.ts; this module is web-only.

export type { SQLiteDatabase } from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

type Row = Record<string, unknown>;

const LS_KEY = "gymforge.webstore.v1";
const LS_VERSION = 1;

function nowIso(): string {
  return new Date().toISOString();
}

function uuidV4(): string {
  const b = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

class WebStore {
  private tables: Record<string, Row[]> = { workout_logs: [], prs: [], outbox: [] };
  private outboxId = 1;

  constructor() {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.v === LS_VERSION && d.tables) this.tables = d.tables;
        this.outboxId = (d && d.outboxId) || 1;
      }
    } catch {
      /* corrupt / unavailable storage: start fresh */
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(LS_KEY, JSON.stringify({ v: LS_VERSION, tables: this.tables, outboxId: this.outboxId }));
    } catch {
      /* best-effort */
    }
  }

  // ---------------------------------------------------------------- SQL helpers
  private splitTables(s: string): string[] {
    const out: string[] = [];
    for (const m of s.matchAll(/(?:FROM|INTO|UPDATE)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi)) out.push(m[1]);
    return out;
  }

  private bindValues(sql: string, params: unknown[]): unknown[] {
    const n = (sql.match(/\?/g) || []).length;
    const out: unknown[] = new Array(n).fill(null);
    for (let i = 0; i < Math.min(n, params.length); i++) out[i] = params[i];
    return out;
  }

  private insertUpsert(table: string, sql: string, params: unknown[]): void {
    const rows = this.tables[table];
    const m = sql.match(/INSERT\s+INTO\s+\w+\s*\(([^)]*)\)/i);
    const cols = (m ? m[1] : "").split(",").map((c) => c.trim()).filter(Boolean);
    const vals = this.bindValues(sql, params);
    const obj: Row = {};
    cols.forEach((c, i) => (obj[c] = vals[i]));
    const hasUpsert = /ON\s+CONFLICT\s*\(([^)]*)\)/i.test(sql);
    if (table === "outbox") {
      const key = hasUpsert
        ? (sql.match(/ON\s+CONFLICT\s*\(([^)]*)\)/i)![1].split(",").map((c) => c.trim()).filter(Boolean))
        : [];
      if (key.includes("table_name") && key.includes("row_id")) {
        const idx = rows.findIndex((r) => r.table_name === obj.table_name && r.row_id === obj.row_id);
        if (idx >= 0) {
          rows[idx] = { id: rows[idx].id, ...obj, created_at: obj.created_at };
          this.persist();
          return;
        }
      }
      obj.id = this.outboxId++;
    }
    rows.push(obj);
    this.persist();
  }

  private update(table: string, sql: string, params: unknown[]): void {
    const rows = this.tables[table];
    const setPart = (sql.match(/SET\s+([\s\S]*?)(?:\s+WHERE|\s*$)/i) || [])[1] || "";
    const assigns: [string, string][] = [];
    for (const a of setPart.split(",")) {
      const mm = a.match(/([\w.]+)\s*=\s*([\s\S]+)/);
      if (mm) assigns.push([mm[1].trim(), mm[2].trim()]);
    }
    const w = sql.match(/WHERE\s+uuid\s*=\s*\?/i);
    const wvals = this.bindValues(sql, params);
    let wid: unknown = null;
    if (w) {
      const idx = w.index ?? 0;
      const before = sql.slice(0, idx).match(/\?/g);
      wid = wvals ? wvals[(before ? before.length : 0)] : null;
    }
    for (const r of rows) {
      if (wid == null || r.uuid === wid) {
        for (const [col, rhs] of assigns) {
          const base = col.split(".")[0];
          if (rhs === "excluded." + base) continue; // upsert form; not used in plain UPDATE
          const lit = rhs.match(/^'([\s\S]*)'$/);
          r[base] = rhs === "?" ? wid : lit ? lit[1] : this.constVal(rhs);
        }
        if (w && wvals && wvals.length >= 2) {
          // first param is the value, second is the uuid
          const vidx = (sql.match(/\?/g) || []).length;
          for (const [col, rhs] of assigns) {
            const base = col.split(".")[0];
            if (rhs === "?") r[base] = wvals[0];
            else if (rhs !== "excluded." + base) r[base] = this.constVal(rhs);
          }
        }
      }
    }
    this.persist();
  }

  private constVal(s: string): unknown {
    if (/^null$/i.test(s)) return null;
    if (/^'([\s\S]*)'$/.test(s)) return s.slice(1, -1);
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  }

  private delete(table: string, sql: string, params: unknown[]): void {
    const rows = this.tables[table];
    const inM = sql.match(/row_id\s+IN\s*\(([^)]*)\)/i);
    const qm = (inM ? inM[1] : "").split(",").filter(Boolean).length;
    const vals = this.bindValues(sql, params);
    if (table === "outbox" && inM) {
      const tbl = vals[0];
      const ids = vals.slice(1, 1 + qm) as string[];
      this.tables.outbox = rows.filter((r) => !(r.table_name === tbl && ids.includes(r.row_id as string)));
    } else if (/WHERE\s+uuid\s*=\s*\?/i.test(sql)) {
      const wid = vals[vals.length - 1];
      this.tables[table] = rows.filter((r) => r.uuid !== wid);
    } else {
      // Bare DELETE FROM <table> (no WHERE) — clear the whole table. Matches real
      // SQLite semantics; required so localStore.wipe() actually empties the tables
      // (a no-op here made replace() append -> 2x on restore). See Phase 2.8.
      this.tables[table] = [];
    }
    this.persist();
  }

  // ---------------------------------------------------------------- handle API
  runSync(sql: string, params: unknown[] = []): void {
    const up = sql.match(/ON\s+CONFLICT/);
    const kind = up ? "ins" : /UPDATE\s/i.test(sql) ? "upd" : /DELETE\s/i.test(sql) ? "del" : "ins";
    const tables = this.splitTables(sql);
    for (const t of tables) {
      if (!this.tables[t]) this.tables[t] = [];
      if (kind === "ins" && up) this.insertUpsert(t, sql, params);
      else if (kind === "ins") this.insertUpsert(t, sql, params);
      else if (kind === "upd") this.update(t, sql, params);
      else if (kind === "del") this.delete(t, sql, params);
    }
  }

  execSync(_sql: string): void {
    /* no-op on web */
  }

  getFirstSync<T = Row>(sql: string, params: unknown[] = []): T | null {
    return (this.getAllSync<T>(sql, params) || [])[0] ?? null;
  }

  getAllSync<T = Row>(sql: string, params: unknown[] = []): T[] {
    // count(*)
    const cm = sql.match(/SELECT\s+count\(\*\)\s+(?:AS\s+)?(\w+)/i);
    if (cm) {
      const col = cm[1];
      const tables = this.splitTables(sql);
      const t = tables[0];
      let rows = t ? this.tables[t] || [] : [];
      const wd = sql.match(/WHERE\s+deleted\s*=\s*0/i);
      if (wd) rows = rows.filter((r) => !r.deleted);
      return [{ [col]: rows.length }] as unknown as T[];
    }
    // outbox listing
    if (/FROM\s+outbox/i.test(sql)) {
      let rows = [...(this.tables.outbox || [])];
      rows.sort((a, b) => (a.id as number) - (b.id as number));
      return rows.map((r) => ({ table_name: r.table_name, row_id: r.row_id, tombstone: r.tombstone, payload: r.payload })) as unknown as T[];
    }
    // generic single-row-by-uuid
    const w = sql.match(/FROM\s+(\w+)\s+WHERE\s+uuid\s*=\s*\?/i);
    if (w) {
      const t = w[1];
      const wid = params[params.length - 1];
      const row = (this.tables[t] || []).find((r) => r.uuid === wid);
      return row ? ([row] as unknown as T[]) : ([] as unknown as T[]);
    }
    // plain table listing
    const from = sql.match(/FROM\s+(\w+)/i);
    if (from) {
      let rows = [...(this.tables[from[1]] || [])];
      if (/WHERE\s+deleted\s*=\s*0/i.test(sql)) rows = rows.filter((r) => !r.deleted);
      return rows as unknown as T[];
    }
    return [];
  }

  async execAsync(_sql: string): Promise<void> {
    /* no-op on web */
  }
  closeSync(): void {
    /* no-op */
  }
  isNative(): boolean {
    return false;
  }
}

// A single shared store per web page (mirrors one device DB).
let _shared: WebStore | null = null;
function getShared(): WebStore {
  if (!_shared) _shared = new WebStore();
  return _shared;
}

export function openDatabaseSync(_name?: string): SQLiteDatabase {
  return getShared() as unknown as SQLiteDatabase;
}

export default { openDatabaseSync };
