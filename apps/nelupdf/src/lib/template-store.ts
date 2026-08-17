import type { Bbox, MatchedField, Template } from "./types";

const DB_KEY = "nelupdf:templates:v1";
const MATCH_THRESHOLD = 0.8;

export interface TemplateStore {
  save(template: Template): Promise<void>;
  getByProvider(providerId: string): Promise<Template[]>;
  findMatch(
    fieldPositions: MatchedField[],
    providerId: string,
  ): Promise<Template | null>;
  clear(): Promise<void>;
}

function fingerprint(positions: { label: string; bbox: Bbox | null }[]): string {
  const sorted = positions
    .filter((p) => p.bbox !== null)
    .map((p) => ({
      label: p.label,
      x: Math.round((p.bbox!.x / 100) * 10),
      y: Math.round((p.bbox!.y / 100) * 10),
      w: Math.round((p.bbox!.width / 100) * 10),
      h: Math.round((p.bbox!.height / 100) * 10),
    }))
    .sort((a, b) => {
      if (a.label !== b.label) return a.label.localeCompare(b.label);
      return a.y - b.y;
    });
  return JSON.stringify(sorted);
}

function fingerprintSimilar(a: string, b: string): number {
  if (a === b) return 1;
  try {
    const arrA = JSON.parse(a) as Array<{
      label: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }>;
    const arrB = JSON.parse(b) as Array<{
      label: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }>;
    if (arrA.length === 0 || arrB.length === 0) return 0;
    if (arrA.length !== arrB.length) return 0;

    let matched = 0;
    for (let i = 0; i < arrA.length; i++) {
      const p = arrA[i];
      const q = arrB[i];
      if (!p || !q) continue;
      if (p.label !== q.label) return 0;
      const dx = Math.abs(p.x - q.x);
      const dy = Math.abs(p.y - q.y);
      const dw = Math.abs(p.w - q.w);
      const dh = Math.abs(p.h - q.h);
      if (dx <= 1 && dy <= 1 && dw <= 1 && dh <= 1) matched += 1;
    }
    return matched / arrA.length;
  } catch {
    return 0;
  }
}

export class LocalTemplateStore implements TemplateStore {
  private readonly dbKey: string;

  constructor(dbKey: string = DB_KEY) {
    this.dbKey = dbKey;
  }

  private readAll(): Template[] {
    try {
      const raw = localStorage.getItem(this.dbKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Template[]) : [];
    } catch {
      return [];
    }
  }

  private writeAll(templates: Template[]): void {
    localStorage.setItem(this.dbKey, JSON.stringify(templates));
  }

  async save(template: Template): Promise<void> {
    const all = this.readAll().filter((t) => t.id !== template.id);
    all.push(template);
    this.writeAll(all);
  }

  async getByProvider(providerId: string): Promise<Template[]> {
    return this.readAll().filter((t) => t.providerId === providerId);
  }

  async findMatch(
    fieldPositions: MatchedField[],
    providerId: string,
  ): Promise<Template | null> {
    const input = fingerprint(
      fieldPositions.map((f) => ({ label: f.label, bbox: f.bbox })),
    );
    const candidates = await this.getByProvider(providerId);
    let best: { template: Template; score: number } | null = null;
    for (const candidate of candidates) {
      const score = fingerprintSimilar(
        fingerprint(candidate.fields),
        input,
      );
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
        best = { template: candidate, score };
      }
    }
    return best?.template ?? null;
  }

  async clear(): Promise<void> {
    localStorage.removeItem(this.dbKey);
  }
}