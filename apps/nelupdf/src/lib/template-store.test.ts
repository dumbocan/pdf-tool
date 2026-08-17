import { afterEach, describe, expect, it } from "vitest";

import { LocalTemplateStore } from "./template-store";
import type { Bbox, MatchedField } from "./types";

const bbox = (overrides: Partial<Bbox> = {}): Bbox => ({
  page: 1,
  x: 10,
  y: 20,
  width: 30,
  height: 5,
  ...overrides,
});

const field = (label: string, b: Bbox): MatchedField => ({
  label,
  value: "v",
  bbox: b,
  editable: true,
});

afterEach(() => localStorage.clear());

describe("LocalTemplateStore", () => {
  it("saves a template and retrieves it by provider", async () => {
    const store = new LocalTemplateStore();
    const template = {
      id: "t-1",
      providerId: "default",
      fields: [{ label: "total", bbox: bbox() }],
      createdAt: Date.now(),
    };

    await store.save(template);

    const found = await store.getByProvider("default");
    expect(found.length).toBe(1);
    expect(found[0].id).toBe("t-1");
    expect(found[0].fields[0].label).toBe("total");
  });

  it("returns an empty array for an unknown provider", async () => {
    const store = new LocalTemplateStore();

    const found = await store.getByProvider("never-seen");
    expect(found).toEqual([]);
  });

  it("finds a matching template when field positions share the layout fingerprint", async () => {
    const store = new LocalTemplateStore();
    const templateFields = [
      { label: "invoice_number", bbox: bbox({ x: 5, y: 5, width: 30, height: 5 }) },
      { label: "total", bbox: bbox({ x: 60, y: 80, width: 30, height: 5 }) },
    ];
    await store.save({
      id: "t-1",
      providerId: "default",
      fields: templateFields,
      createdAt: 1,
    });

    const newFields = [
      field("invoice_number", bbox({ x: 5.5, y: 5.5, width: 30, height: 5 })),
      field("total", bbox({ x: 60.5, y: 80.5, width: 30, height: 5 })),
    ];

    const match = await store.findMatch(newFields, "default");
    expect(match).not.toBeNull();
    expect(match?.id).toBe("t-1");
  });

  it("returns null when the layout does not match any template", async () => {
    const store = new LocalTemplateStore();
    await store.save({
      id: "t-1",
      providerId: "default",
      fields: [
        { label: "invoice_number", bbox: bbox({ x: 5, y: 5 }) },
        { label: "total", bbox: bbox({ x: 60, y: 80 }) },
      ],
      createdAt: 1,
    });

    const newFields = [
      field("invoice_number", bbox({ x: 50, y: 50 })),
      field("total", bbox({ x: 10, y: 10 })),
    ];

    const match = await store.findMatch(newFields, "default");
    expect(match).toBeNull();
  });

  it("scopes templates per provider", async () => {
    const store = new LocalTemplateStore();
    await store.save({
      id: "t-a",
      providerId: "vendor-a",
      fields: [{ label: "total", bbox: bbox() }],
      createdAt: 1,
    });
    await store.save({
      id: "t-b",
      providerId: "vendor-b",
      fields: [{ label: "total", bbox: bbox() }],
      createdAt: 2,
    });

    const a = await store.getByProvider("vendor-a");
    const b = await store.getByProvider("vendor-b");

    expect(a.map((t) => t.id)).toEqual(["t-a"]);
    expect(b.map((t) => t.id)).toEqual(["t-b"]);
  });

  it("clear removes all templates", async () => {
    const store = new LocalTemplateStore();
    await store.save({
      id: "t-1",
      providerId: "default",
      fields: [{ label: "total", bbox: bbox() }],
      createdAt: 1,
    });

    await store.clear();

    expect(await store.getByProvider("default")).toEqual([]);
  });
});