import { describe, expect, it } from "vitest";
import { csvCell, encodeCsv } from "./csv.ts";

describe("csvCell", () => {
  it("wraps fields containing commas in quotes", () => {
    expect(csvCell("hello,world")).toBe('"hello,world"');
  });

  it("doubles interior double-quotes", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps fields containing newlines", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("neutralizes leading formula triggers with single-quote prefix", () => {
    expect(csvCell("=cmd|' /C calc'!A1")).toBe("'=cmd|' /C calc'!A1");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2+3+4")).toBe("'-2+3+4");
    expect(csvCell("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
  });

  it("does not neutralize plain numbers", () => {
    expect(csvCell("-50")).toBe("-50");
    expect(csvCell("123.45")).toBe("123.45");
  });

  it("quotes leading/trailing whitespace", () => {
    expect(csvCell(" leading")).toBe('" leading"');
    expect(csvCell("trailing ")).toBe('"trailing "');
  });

  it("converts null/undefined to empty string", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("encodeCsv", () => {
  it("produces RFC 4180-compliant output with CRLF line endings", () => {
    const rows = [
      { file: "invoice.pdf", total: "1.234,56" },
      { file: "quote.csv", total: "=evil" },
    ];
    const result = encodeCsv(rows, ["file", "total"]);
    expect(result).toBe("file,total\r\ninvoice.pdf,\"1.234,56\"\r\nquote.csv,'=evil");
  });

  it("returns header only when body is empty", () => {
    expect(encodeCsv([], ["a", "b"])).toBe("a,b");
  });
});
