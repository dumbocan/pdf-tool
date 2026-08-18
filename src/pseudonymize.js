// Pseudonimización determinista para el modo --llm (Fase 2, privacidad).
//
// ARQUITECTURA CONFORME — alineada con:
//   - EDPB Guidelines 01/2025 on Pseudonymisation: la pseudonimización reduce
//     riesgo pero NO saca los datos del GDPR (Art. 4(5)); la clave (mapa de
//     traducción) vive SEPARADA, en la máquina del controlador (el usuario).
//   - ISO/IEC 25237:2017: el servicio de pseudonimización (traducción) está
//     separado del tratamiento; la gestión de la clave es responsabilidad del
//     controlador.
//   - AEPD: guía práctica de anonimización/seudonimización.
//
// Ver DOC-PSEUDONIMIZACION.md para el análisis de riesgos de re-identificación
// (quién podría re-identificar y con qué medios) — el registro que la AEPD
// espera documentar.
//
// Estrategia:
//   1. PII multi-región (identificadores fiscales, IBAN, email, teléfono) →
//      sustituida por valores ficticios CONSISTENTES (1-a-1). La tabla de
//      traducción (real<->ficticio) vive solo en la máquina del usuario.
//   2. Importes × FACTOR ENTERO por sesión (mapeo afín): subtotal+impuesto=total
//      se preserva exacto en céntimos; el LLM valida la aritmética sin ver
//      valores reales.
//   3. reverseMap devuelve los campos reales tras el parseo.
//
// Limitación honesta (EDPB: "medios razonablemente utilizables"): con 2+
// facturas del mismo proveedor el factor es inferible → los datos siguen
// siendo personales. La defensa real es la minimización (solo el texto mínimo)
// y la elección de proveedor de confianza.

// Patrones por tipo. El reemplazo usa MARCADORES únicos (\x01) para que un
// patrón posterior nunca re-tokenice el ficticio de un patrón anterior (los
// marcadores no matchean dígitos/letras). Flag /g: TODAS las ocurrencias.
const PII_PATTERNS = [
  { re: /[XYZ]?\d{7,8}[A-Z]/gi, kind: "NIF" }, // España: DNI/NIE
  { re: /[ABCDEFGHJNPQRSUVW](?:[O0]\d{7}[A-Z0-9]?|\d{7}[A-Z0-9]|\d{8})/gi, kind: "CIF" }, // España: CIF (B+8díg, B+0+7díg OCR canarios)
  { re: /\b(?:20|23|24|27|30|33|34)-?\d{8}-?\d\b/g, kind: "CUIT" }, // Argentina
  { re: /\b\d{1,3}(?:\.\d{3}){1,2}-[\dkK]\b/g, kind: "RUT" }, // Chile
  { re: /\b\d{9,10}-\d\b/g, kind: "NIT" }, // Colombia
  { re: /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{2,3}\b/g, kind: "RFC" }, // México
  { re: /\b\d{11}\b/g, kind: "RUC" }, // Perú/Ecuador/Uruguay
  { re: /\b[A-Z]{2}\d{2}[ ]?\d{4}[ ]?\d{4}[ ]?\d{4}[ ]?\d{4}[ ]?\d{4}\b/g, kind: "IBAN" },
  { re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, kind: "EMAIL" },
  { re: /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,3}\)[\s.-]?)?\d{3}[\s.-]?\d{3}[\s.-]?\d{3,4}\b/g, kind: "PHONE" },
];

const AMOUNT_PATTERN = /\b\d+(?:[.,]\d{3})*(?:[.,]\d{2})?\s*(?:€|EUR|USD|\$)(?=\s|$)/g;

export function createPseudonymizer(options = {}) {
  const { seed } = options;
  // factor entero por sesión: preserva la aritmética en céntimos exacta.
  // `seed` opcional: si se pasa, el factor es determinista (3..12) — pensado
  // para tests reproducibles; en producción PrivacyTransactionService sigue
  // creando un pseudonymizer SIN seed (factor aleatorio por transacción).
  const factor = typeof seed === "number"
    ? 3 + (Math.abs(Math.floor(seed)) % 10) // determinista: 3 + (seed % 10)
    : 3 + Math.floor(Math.random() * 10);   // aleatorio: 3..12
  const piiMap = new Map(); // real -> ficticio (la "clave" que nunca sale)
  const reversePii = new Map(); // ficticio -> real
  const reverseAmounts = new Map(); // ficticio -> real (string literal)

  // Los ficticios son marcadores [TIPO-n]: imposibles de colisionar con valores
  // reales, y legibles en la preview de privacidad (el usuario VE la sustitución).
  function pseudonymizePii(text) {
    let out = text;
    let marker = 0;
    const tokens = new Map(); // marcador -> ficticio
    for (const { re, kind } of PII_PATTERNS) {
      out = out.replace(re, (match) => {
        const key = `${kind}:${match}`;
        if (!piiMap.has(key)) {
          const fake = `[${kind}-${piiMap.size + 1}]`;
          piiMap.set(key, fake);
          reversePii.set(fake, match);
        }
        const id = `\x01p${marker++}\x01`;
        tokens.set(id, piiMap.get(key));
        return id;
      });
    }
    for (const [id, fake] of tokens) out = out.replaceAll(id, fake);
    return out;
  }

  function pseudonymizeAmounts(text) {
    return text.replace(AMOUNT_PATTERN, (match) => {
      const cleaned = match.replace(/[€\s]/g, "");
      const realLiteral = match.trim();
      const cents = Math.round(parseFloat(cleaned.replace(",", ".")) * 100);
      if (!Number.isFinite(cents)) return match;
      const fakeCents = cents * factor;
      const fake = (fakeCents / 100).toFixed(2) + " €";
      reverseAmounts.set(fake, realLiteral);
      return fake;
    });
  }

  return {
    factor,
    pseudonymize(text) {
      return pseudonymizeAmounts(pseudonymizePii(text));
    },
    reverseAmount(fakeValue) {
      if (fakeValue == null || fakeValue === "") return fakeValue;
      const cleaned = String(fakeValue).replace(/[€\s]/g, "");
      const fakeCents = Math.round(parseFloat(cleaned.replace(",", ".")) * 100);
      if (!Number.isFinite(fakeCents) || fakeCents % factor !== 0) return fakeValue;
      const realCents = fakeCents / factor;
      return (realCents / 100).toFixed(2);
    },
    reversePii(fakeValue) {
      if (fakeValue == null) return fakeValue;
      return reversePii.get(String(fakeValue)) ?? fakeValue;
    },
    // Des-mapea RECURSIVAMENTE todo el JSON que devuelve el LLM: cualquier
    // string que sea un marcador [TIPO-n] o un monto ficticio (divisible por el
    // factor) se revierte a su valor real. Cubre los campos anidados que el LLM
    // devuelve (seller.taxId, buyer.taxId, bankAccount, taxBreakdown...).
    reverseDeep(value) {
      if (typeof value === "string") {
        // Marcadores DENTRO de strings compuestos (ej. "ES30... [PHONE-5]").
        let out = value.replace(/\[([A-Z]+)-\d+\]/g, (marker) => this.reversePii(marker) ?? marker);
        const pii = this.reversePii(out);
        if (pii !== out) out = pii;
        const m = out.match(/^([\d.,]+)\s*(?:€|EUR|USD|\$)?$/);
        if (m) {
          const amt = this.reverseAmount(m[1]);
          if (amt !== m[1]) return amt;
        }
        return out;
      }
      if (Array.isArray(value)) return value.map((v) => this.reverseDeep(v));
      if (value && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = this.reverseDeep(v);
        return out;
      }
      return value;
    },
    reverseFields(fields) {
      if (!fields) return fields;
      return this.reverseDeep(fields);
    },
    reverseLineItems(lineItems) {
      if (!Array.isArray(lineItems)) return lineItems;
      return lineItems.map((li) => ({
        ...li,
        unitPrice: li.unitPrice != null ? this.reverseAmount(li.unitPrice) : li.unitPrice,
        amount: li.amount != null ? this.reverseAmount(li.amount) : li.amount,
      }));
    },
  };
}
