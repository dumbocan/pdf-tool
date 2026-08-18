import assert from "node:assert/strict";
import test from "node:test";
import { createPseudonymizer } from "../src/pseudonymize.js";

test("PII identifiers replaced consistently across multiple occurrences", () => {
  const p = createPseudonymizer();
  const text = "NIF: 12345678Z, otra vez 12345678Z, y email cliente@example.com";
  const out1 = p.pseudonymize(text);
  const out2 = p.pseudonymize(text);
  assert.equal(out1, out2, "determinista: el mismo input -> el mismo output");
  assert.ok(!out1.includes("12345678Z"), "NIF real no debe aparecer (ni la 1ª ni la 2ª ocurrencia)");
  assert.ok(!out1.includes("cliente@example.com"), "email real no debe aparecer");
  // ambas ocurrencias del NIF -> el MISMO ficticio [NIF-n] (consistencia 1-a-1)
  const occurrences = out1.match(/\[NIF-\d+\]/g) ?? [];
  assert.equal(occurrences.length, 2, "el mismo NIF real -> el mismo marcador [NIF-n] 2 veces");
});

test("amounts mapped affinely preserving arithmetic (factor entero)", () => {
  const p = createPseudonymizer();
  const out = p.pseudonymize("Subtotal: 1250.00 € + IVA: 262.50 € = Total: 1512.50 €");
  // factor entero: el monto ficticio = real × factor, en euros (no ÷100)
  const fakeSub = (1250 * p.factor).toFixed(2);
  const fakeIva = (262.5 * p.factor).toFixed(2);
  const fakeTotal = (1512.5 * p.factor).toFixed(2);
  assert.ok(out.includes(`${fakeSub} €`), `subtotal ficticio ${fakeSub} €`);
  assert.ok(out.includes(`${fakeIva} €`), `iva ficticio ${fakeIva} €`);
  assert.ok(out.includes(`${fakeTotal} €`), `total ficticio ${fakeTotal} €`);
  // aritmética ficticia exacta en céntimos: fakeSub + fakeIva === fakeTotal
  const sum = (Math.round(parseFloat(fakeSub) * 100) + Math.round(parseFloat(fakeIva) * 100)) / 100;
  assert.equal(sum.toFixed(2), fakeTotal, "subtotal×F + iva×F = total×F exacto");
  assert.ok(!out.includes("1250.00"), "importe real no debe aparecer");
});

test("reverseAmount restores real values exactly", () => {
  const p = createPseudonymizer();
  p.pseudonymize("Total: 1512.50 €");
  const fake = (1512.5 * p.factor).toFixed(2);
  assert.equal(p.reverseAmount(fake), "1512.50");
  assert.equal(p.reverseAmount("0.00"), "0.00");
  assert.equal(p.reverseAmount(null), null);
});

test("reverseFields restores totals and PII", () => {
  const p = createPseudonymizer();
  const real = "NIF: 12345678Z, Total: 2190.50 €";
  const pseudo = p.pseudonymize(real);
  const fakeTotal = (2190.5 * p.factor).toFixed(2);
  const reversed = p.reverseFields({
    invoiceNumber: pseudo.match(/\[NIF-\d+\]/)?.[0],
    totals: { total: fakeTotal },
  });
  assert.equal(reversed.invoiceNumber, "12345678Z");
  assert.equal(reversed.totals.total, "2190.50");
});

test("company names heuristic leaves headers intact", () => {
  const p = createPseudonymizer();
  const out = p.pseudonymize("TecnoSuministros SL\nSubtotal: 1250.00 €");
  assert.ok(out.includes("TecnoSuministros SL"), "nombres no se tocan en v1 (limitación documentada)");
});

test("IBAN and phone are masked", () => {
  const p = createPseudonymizer();
  const out = p.pseudonymize("IBAN ES9101234567890123456789 y tel +34 600 123 456");
  assert.ok(!out.includes("ES9101234567890123456789"), "IBAN real no aparece");
  assert.ok(!out.includes("600 123 456"), "teléfono real no aparece");
});

test("LATAM identifiers are masked", () => {
  const p = createPseudonymizer();
  const out = p.pseudonymize("RUT 11.222.333-4, RFC MEF780101A01, CUIT 20-12345678-9");
  assert.ok(!out.includes("11.222.333-4"), "RUT real no aparece");
  assert.ok(!out.includes("MEF780101A01"), "RFC real no aparece");
  assert.ok(!out.includes("20-12345678-9"), "CUIT real no aparece");
});

test("deterministic factor with seed", () => {
  const p1 = createPseudonymizer({ seed: 42 });
  const p2 = createPseudonymizer({ seed: 42 });
  assert.equal(p1.factor, p2.factor, "same seed -> same deterministic factor");
  // 3 + (42 % 10) = 3 + 2 = 5
  assert.equal(p1.factor, 5, "seed=42 -> factor=5 (3 + seed%10)");
  const out1 = p1.pseudonymize("NIF: 12345678Z, Total: 1512.50 €");
  const out2 = p2.pseudonymize("NIF: 12345678Z, Total: 1512.50 €");
  assert.equal(out1, out2, "same seed -> same pseudonymized output (snapshot-reproducible)");
  // negative seed: Math.abs() lo trata igual que positivo
  const pNeg = createPseudonymizer({ seed: -42 });
  assert.equal(pNeg.factor, 5, "seed=-42 -> factor=5 (Math.abs)");
  // otro seed produce otro factor (rango 3..12)
  const pOther = createPseudonymizer({ seed: 7 });
  assert.equal(pOther.factor, 10, "seed=7 -> factor=10 (3 + 7%10)");
  // no seed -> factor aleatorio en [3,12]
  const pRandom = createPseudonymizer();
  assert.ok(pRandom.factor >= 3 && pRandom.factor <= 12, "sin seed -> factor aleatorio en rango");
});
