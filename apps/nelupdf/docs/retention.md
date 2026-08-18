# Retención de datos — NeluPDF Desktop

## Resumen

NeluPDF Desktop es **local-first**: todo el procesamiento ocurre en tu máquina.
**Nada sale de tu computadora sin tu permiso explícito** (Slice 6 — provider
qualification — aún no está aprobado).

## Datos según su ciclo de vida

### Volátiles (se pierden al recargar o cerrar la ventana)

| Dato | Dónde | Lifetime |
|---|---|---|
| `rows[]` — resultados de extracción (número de factura, importes, etc.) | Estado React en memoria | Se pierde al recargar/cerrar |
| `review` — estado de revisión visual pendiente | Estado React en memoria | Se pierde al recargar/cerrar |
| `DocStore` — bytes PDF registrados + hashes | HashMap en memoria (Rust) | Se pierde cuando el proceso de Rust termina |
| `PrivacyTransactionService` — transacciones activas | Map en memoria (Node sidecar) | Se pierde cuando el sidecar termina |

### Persistentes (localStorage)

| Dato | Key | Lifetime | Cómo borrar |
|---|---|---|---|
| Templates guardados | `nelupdf:templates:v1` | Persiste entre sesiones | "Limpiar templates" en la UI |

### Nunca persistidos

- Bytes PDF (`pdfBase64` / `documentId`) **nunca** se guardan en localStorage.
  Se sirve bajo demanda desde `DocStore` (in-memory) y se descarta después de
  la extracción.
- API keys, credenciales, OCR credentials: **el sidecar las stripa del entorno**
  al arrancar (`enforceProcessSecurity`). Nunca se retienen.
- Salidas de LLM: **el proveedor está `disabled` por defecto**. Hasta que
  Slice 6 apruebe un proveedor, `prepare_llm_extraction_v1` devuelve
  `provider_disabled` sin contacto externo.

## Limpieza manual

- **Limpiar resultados**: el botón "Limpiar resultados" (abajo) borra `rows`,
  `review`, y el `DocStore` del proceso de Rust. No afecta templates.
- **Limpiar templates**: "Limpiar templates" vacía `nelupdf:templates:v1`.
- **Recargar/Cerrar**: cierra la ventana o recarga la página para liberar
  todo estado volátil.

## Nota legal

No hacemos borrado físico garantizado del disco una vez que los bytes PDF pasan
por memoria. El sistema operativo puede escribir datos a intercambio/paging.
NeluPDF no persiste datos sensibles; cualquier template guardado contiene solo
coordenadas de layout (`bbox`) y etiquetas de campos, nunca el contenido del PDF
ni importes reales (éstos se pseudonymizan).
