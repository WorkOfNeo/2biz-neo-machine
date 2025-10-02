import fs from "fs/promises";
import path from "path";

export type StyleRecord = {
  styleNo: string;
  url?: string;
  href?: string;
  styleName?: string;
  brand?: string;
  season?: string;
  supplier?: string;
  imageUrl?: string;
  noos?: boolean;
  colorNoos?: Record<string, boolean>;
  sizeset?: { first: string; last: string };
  freeStat?: any;
  updatedAt: string;
};

function getDataFile(): string {
  const dir = path.join(process.cwd(), "data");
  return path.join(dir, "styles.json");
}

async function ensureDataFile(): Promise<string> {
  const dir = path.join(process.cwd(), "data");
  const file = path.join(dir, "styles.json");
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
  try {
    await fs.access(file);
  } catch {
    try { await fs.writeFile(file, JSON.stringify({ byKey: {}, allKeys: [] }, null, 2), "utf-8"); } catch {}
  }
  return file;
}

type DbShape = { byKey: Record<string, StyleRecord>; allKeys: string[] };

async function readDb(): Promise<DbShape> {
  const file = await ensureDataFile();
  try {
    const txt = await fs.readFile(file, "utf-8");
    const obj = JSON.parse(txt);
    const byKey = typeof obj?.byKey === "object" && obj.byKey ? obj.byKey as Record<string, StyleRecord> : {};
    const allKeys = Array.isArray(obj?.allKeys) ? obj.allKeys as string[] : Object.keys(byKey);
    return { byKey, allKeys };
  } catch {
    return { byKey: {}, allKeys: [] };
  }
}

async function writeDb(db: DbShape): Promise<void> {
  const file = await ensureDataFile();
  const payload: DbShape = { byKey: db.byKey || {}, allKeys: Array.from(new Set(db.allKeys || [])) };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf-8");
}

export async function getAllStyles(): Promise<StyleRecord[]> {
  const db = await readDb();
  return db.allKeys.map((k) => db.byKey[k]).filter(Boolean);
}

export async function getStyle(styleNo: string): Promise<StyleRecord | null> {
  const db = await readDb();
  return db.byKey[styleNo] || null;
}

export async function upsertStyles(items: Array<Partial<StyleRecord> & { styleNo: string }>): Promise<{ upserted: number }> {
  const db = await readDb();
  let count = 0;
  const now = new Date().toISOString();
  for (const raw of items) {
    if (!raw || typeof raw.styleNo !== "string" || !raw.styleNo.trim()) continue;
    const key = raw.styleNo.trim();
    const prev = db.byKey[key] || { styleNo: key, updatedAt: now } as StyleRecord;
    const next: StyleRecord = {
      ...prev,
      ...raw,
      styleNo: key,
      updatedAt: now,
    };
    db.byKey[key] = next;
    if (!db.allKeys.includes(key)) db.allKeys.push(key);
    count += 1;
  }
  await writeDb(db);
  return { upserted: count };
}


