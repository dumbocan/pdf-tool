# 📄 pdf-tool

[![Version](https://img.shields.io/badge/version-0.2.0-blue)](https://github.com/dumbocan/pdf-tool/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-109%2F109%20green-brightgreen)](https://github.com/dumbocan/pdf-tool/actions)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![OS](https://img.shields.io/badge/Windows%20%7C%20Linux%20%7C%20macOS%20%7C%20Docker-brightgreen)](install.sh)

**Tu facturas en PDF → datos ordenados en un archivo, sin saber nada de informática.**

¿Tenés una carpeta llena de facturas con nombres raros (`scan_20260730_145823.pdf`)? pdf-tool lee cada una, saca el número, la fecha, el proveedor, los totales **y cada artículo**, y te deja un `facturas.csv` ordenado. Incluso te **renombra los PDF** con tu formato (fecha primero, para que se ordenen solos).

---

## ⚡ Instalación — UNA SOLA LÍNEA

**Windows** — abrí PowerShell y pegá esto:
```powershell
iex (Invoke-WebRequest https://raw.githubusercontent.com/dumbocan/pdf-tool/main/install.ps1).Content
```

**Linux o macOS** — abrí la terminal y pegá esto:
```bash
curl -fsSL https://raw.githubusercontent.com/dumbocan/pdf-tool/main/install.sh | bash
```

**O con Docker** (funciona en los tres):
```bash
docker run -v /ruta/a/tus/facturas:/facturas pdf-tool node bin/pdf-tool.mjs facturas /facturas --ocr
```

Eso es todo: el instalador se encarga de instalar Node, el lector de escaneados (OCR) y el comando `pdf-tool`. Solo te pedirá la contraseña una vez. Después seguí con el uso paso a paso abajo.

---

## 🚀 Para empezar (no necesitás saber nada técnico)

### Uso — paso a paso

```bash
pdf-tool facturas
```

1. **Arrastrá la carpeta** con tus facturas a la ventana y presioná Enter (la ruta se pega sola).
2. Elegí dónde guardar el resultado (Enter = misma carpeta).
3. Decidí si querés renombrar los PDF con tu formato.
4. ✅ Listo: te muestra un resumen y guarda `facturas.csv`.

```
✅ Listo. Resumen de la carpeta: C:\Mis Documentos\Facturas
  Facturas procesadas: 12
  Con datos extraídos: 10
  Proveedores detectados: supermercado, suministros-marinos, alquiler-trastos
📄 Resultado guardado en: facturas.csv
```

### Nombrar tus PDF como a vos te gusta

```bash
pdf-tool config
```
Te pregunta el formato (por defecto `{fecha}_{proveedor}_{palabra}`) y, con la IA configurada, la palabra clave sale sola leyendo la factura:

```
scan_20260730_145823.pdf  →  2026-08-01_suministros-marinos_ancla-cadena.pdf
IMG_8456.pdf              →  2026-08-01_alquiler-trastos_box-mensual.pdf
```

La fecha primero → se ordenan solos por fecha. 🗂️

### ¿Facturas escaneadas (fotos o escaneos de papel)?

Agregá `--ocr` y el programa las lee igual:
```bash
pdf-tool facturas C:\Mis Documentos\Facturas --ocr
```

---

## ✨ Lo que hace

| Capacidad | Detalle |
|---|---|
| 📊 **Extrae los datos** | Número, fecha, subtotal, impuesto, total e impuesto (IGIC/IVA) |
| 🛒 **Extrae cada artículo** | Descripción, cantidad, precio unitario e importe — listo para una base de datos de inventario |
| 🏷️ **Parsea CUALQUIER factura** | Trae parsers para varios formatos (supermercado, suministros, alquileres...) y un **generador** que crea el parser de una factura nueva con un solo comando |
| 📁 **Renombra los PDF** | Con tu formato: fecha, proveedor y palabra clave |
| 🔍 **Lee escaneados** | OCR integrado (español + inglés) |
| 🤖 **IA opcional** | Si configurás una clave, lee facturas desconocidas y resume la palabra clave |
| 🔒 **100% local por defecto** | Tus PDFs no salen de tu máquina (solo con `--llm` se envía el *texto* a la IA) |

---

## 🔒 Seguridad

- **Sin `--llm`**: todo queda en tu máquina. Cero tráfico de red, cero telemetría, cero subidas.
- Los PDFs no ejecutan nada: el lector está endurecido (sin JavaScript del documento, sin imágenes, sin persistencia).
- El CSV protege contra fórmulas maliciosas de Excel (un PDF malintencionado no puede inyectar código en tu hoja de cálculo).
- Con `--llm`, solo el **texto ya extraído** se envía a la API de MiniMax — nunca los bytes del PDF.

---

## 🧠 Para desarrolladores (si te interesa)

### Instalación manual
```bash
git clone https://github.com/dumbocan/pdf-tool.git
cd pdf-tool
corepack enable && pnpm install
```

### Uso como servicio (para que otros programas le manden PDFs)
```bash
node src/server.js   # HTTP en :3000
curl -X POST http://127.0.0.1:3000/extract \
  -H "Content-Type: application/json" \
  -d '{"data":"<base64 del PDF>"}'
```

### Cómo aprende un proveedor nuevo
```bash
node scripts/generate-vendor-parser.mjs factura-nueva.pdf
```
MiniMax analiza la factura, identifica las etiquetas (número, fecha, totales, artículos) y **genera el parser** con su test. Así, cualquier factura nueva — de supermercado, suministros, alquileres, lo que sea — se incorpora con un solo comando. El resultado se revisa y se commitea — nunca se auto-commitea código desde un PDF.

### Endpoints HTTP
| Ruta | Qué hace |
|---|---|
| `POST /extract` | Extrae texto + campos + artículos (determinístico) |
| `POST /extract-with-llm` | Igual + estructura con MiniMax (opcional, requiere clave) |
| `GET /healthz` | Estado |
| `GET /version` | Versión |
| `POST /mcp` | Interfaz MCP (para agentes como Laia) |

### Autenticación
Configurá `AUTH_TOKEN` en el `.env` (o como variable de entorno) y todos los endpoints menos `healthz`/`version` exigirán `Authorization: Bearer <token>`.

---

## 📁 Estructura del proyecto

```
src/extract.js            — lector de PDF (pdfjs) + campos comunes de factura
src/vendor-parsers.js     — parsers por formato de factura (varios incluidos, se amplían con el generador)
src/folder-scan.js        — escaneo de carpetas + OCR + IA
src/server.js             — servicio HTTP
src/mcp-facade.js         — interfaz MCP
bin/pdf-tool.mjs          — el comando amigable
scripts/                  — generador de parsers + extractor por carpeta
install.sh / install.ps1  — instaladores
test/                     — 109 tests
```

## 🧪 Tests

```bash
pnpm install
node --test test/*.test.js   # 109/109
```

## 📜 Licencia

MIT
