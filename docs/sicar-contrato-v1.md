# Contrato SICAR v1 — agente de tienda → CORPUNISOUND

Para quien mantiene el agente `unisound-sicar-sync` en la PC de cada tienda. Todo lo que dice este
documento lo comprueba `backend/sicarContrato.test.js`; si cambias uno, cambia el otro.

## 1. A dónde y con qué

- `POST https://punto-de-venta-backend.onrender.com/api/integraciones/sicar/v1/lotes`
- `Authorization: Bearer <llave de la tienda>`. La llave la genera un Administrador en CRM → SICAR, se
  muestra **una sola vez** y es de **una sola tienda**. Guárdala en la configuración local del servicio,
  con permisos solo para el usuario del servicio. Nunca en el repositorio ni en los registros.
- `Content-Type: application/json`, UTF-8 estricto. Si SICAR guarda en latin1, conviértelo antes de
  armar el JSON. El servidor rechaza texto con caracteres de sustitución (`�`).

## 2. El sobre

```json
{
  "schema_version": 1,
  "mapping_version": "ocosingo-f0-v1",
  "batch_id": "6f1c2a90-0000-4000-8000-000000000001",
  "sequence": "1",
  "captured_at": "2026-10-14T03:00:00Z",
  "mode": "incremental",
  "window": { "from": "2026-10-12T00:00:00-06:00", "to": "2026-10-14T00:00:00-06:00" },
  "clientes": [
    { "cli_id": "4501", "nombre": "José Peña", "telefono": "919 111 2233" },
    { "cli_id": "4502", "nombre": "Lucía Gómez", "celular": "9192223344" }
  ],
  "ventas": [
    { "ven_id": "88001", "cli_id": "4501", "fecha_local": "2026-10-13T11:30:00", "timezone": "America/Mexico_City",
      "estado": "vigente", "moneda": "MXN", "total": "1500.00",
      "detalle": [
        { "art_id": "10", "clave": null, "descripcion": "Guitarra clásica", "cantidad": "1.0000",
          "precio_con": "1350.0000", "precio_sin": "0.0000", "importe_con": "1350.00", "descuento_total": "0.00" },
        { "art_id": "11", "clave": null, "descripcion": "Funda", "cantidad": "1.0000",
          "precio_con": "150.0000", "precio_sin": "0.0000", "importe_con": "150.00", "descuento_total": "0.00" }
      ] }
  ]
}
```

- **Ids siempre como texto** (`"4501"`, no `4501`): enteros positivos sin ceros a la izquierda.
- **Importes como texto con decimales exactos**: `total`, `importe_con` y `descuento_total` con 2; `cantidad`,
  `precio_con` y `precio_sin` con 4. `"1500"` o `1500.0` se rechazan.
- `fecha_local` es la hora de la tienda **sin zona** (`AAAA-MM-DDTHH:MM:SS`). `captured_at` y `window` llevan zona.
- `mode`: `incremental` (cada ciclo), `historico` (carga inicial) o `conciliacion` (relectura).
- Campos de cliente permitidos: `cli_id`, `nombre`, `telefono`, `celular`, `email`, `rfc`. **Nunca** `huella`,
  `muestra` ni `foto` (son biométricos; ni siquiera se leen).
- `batch_id` es un UUID nuevo por lote. `sequence` empieza en `"1"` y sube de uno en uno por tienda.
- Un mismo `art_id` puede repetirse en `detalle`: cada posición identifica un renglón independiente.
  El orden del arreglo es el orden del ticket (por la PK de `detallev`); no se agrupan ni descartan renglones.
- `articulos` es una colección opcional independiente: puede ser el único contenido del lote y no cambia
  `schema_version`. Cada fila es `{ "art_id": "10", "clave": "JLX215P", "descripcion": "BAFLE JLX ...",
  "categoria": "Bafles", "departamento": "Audio" }`. `descripcion` es texto; `clave`, `categoria` y
  `departamento` pueden ser texto o `null`. El servidor recorta los textos y convierte los opcionales vacíos en
  `null`; rechaza U+FFFD y valores mayores a 60, 300, 100 y 100 caracteres respectivamente.
- El mismo `art_id` no puede aparecer dos veces en `articulos`. La tienda no va en la fila: el servidor la toma
  exclusivamente de la llave autenticada. El recibo incluye `aceptados.articulos` cuando el lote trae esta colección.

## 3. Qué venta mandar y con qué estado

- Cliente de la venta: `COALESCE(ticket.cli_id, nota.cli_id, remision.cli_id)` (sección 14 del plan).
- `vigente`: venta con `venta.status = 1`. Suma en el CRM.
- `cancelada`: venta con `venta.status = -1`. Se manda con todos sus campos; el CRM la muestra con su importe
  original y **no la suma**. Las cancelaciones se detectan en `historial` (tabla `Venta`, movimiento 2) por
  `his_id > cursor` en cada ciclo, y además se releen las últimas 48 h.
- `excluida`: una venta que ya habías mandado y ahora es de público en general o ya no debe verse. Solo
  `{ "ven_id": "88003", "estado": "excluida" }`. Borra su detalle y su referencia personal.
- **Público en general** (`cli_id` 1 y en Ocosingo 2, 3, 13, 21, 33, 4566, 4567, 4572, o nombre
  que coincida con `^P.BLICO EN GENERAL`): el agente NO debe mandar público en general; si llega, el servidor lo descarta.
  No guarda esos clientes, sus ventas ni sus renglones. Acepta el lote y avanza la secuencia; el recibo incluye
  `descartados: { clientes, ventas, renglones }` cuando hubo descartes. `aceptados` cuenta solo los registros
  admitidos y `rechazados` sigue en cero. No se borran filas históricas mediante esta regla.
- Si una venta cambia de cliente, mándala otra vez con el `cli_id` nuevo: se mueve una sola vez.

## 4. Límites

| Límite | Valor | Si se pasa |
|---|---|---|
| Clientes por lote | 100 | 422 `LIMITE_ENTIDADES` |
| Ventas por lote | 100 | 422 `LIMITE_ENTIDADES` |
| Artículos por lote | 500 | 422 `LIMITE_ENTIDADES` |
| Renglones de detalle por lote | 1,000 (500 por venta) | 422 `LIMITE_ENTIDADES` |
| Tamaño del cuerpo | 1 MiB | 413 `CUERPO_EXCESIVO` |
| Envíos por minuto con la misma llave | 12 | 429 `RITMO_EXCEDIDO` |
| Lotes simultáneos por tienda | 1 | esperar la respuesta antes de mandar el siguiente |

La carga histórica (`historico`) va **solo de 20:00 a 07:00**, para no alentar el cobro en la tienda.

## 5. Respuestas y qué hacer con cada una

| Código | Significa | Qué hace el agente |
|---|---|---|
| 200 | Lote aplicado. Trae `next_sequence` y `aceptados`. | **Solo aquí** avanza su cursor y su secuencia. |
| 200 al reenviar | Ya se había aplicado ese mismo lote, byte por byte. Devuelve el recibo original. | Igual que 200. |
| 409 `SECUENCIA_INCORRECTA` | La secuencia no es la que sigue. Trae `siguiente_secuencia`. | Rearmar desde esa secuencia. |
| 409 `CONFLICTO_BATCH` | Mismo `batch_id` con contenido distinto. | Error del agente: detenerse y avisar. |
| 400 / 422 | No cumple el contrato. Trae `codigo` y, si aplica, `referencia` (ej. `ventas[0].detalle[1]`). | No reintentar igual. Detenerse y avisar. |
| 401 `LLAVE_INVALIDA` | Llave incorrecta o revocada. | Detenerse. Pedir llave nueva al Administrador. |
| 429 `RITMO_EXCEDIDO` | Más de 12 envíos en un minuto. | Esperar un minuto y reenviar **los mismos bytes**. |
| 503 `MANTENIMIENTO` | Se está restaurando un respaldo. | Esperar y reenviar los mismos bytes. |
| Sin respuesta / red caída | No se sabe si se aplicó. | Reenviar **exactamente los mismos bytes**: si ya entró, devuelve el recibo original. |

Regla de oro: el cursor de `his_id` y la secuencia **solo avanzan con un 200**. Si el agente se reinicia,
retoma desde lo último confirmado.

## 6. Seguridad en la PC de la tienda (obligatorio antes del piloto)

- Lo ideal es un usuario MySQL exclusivo, **solo `SELECT`**, limitado a `localhost`, sin `FILE`, `GRANT OPTION`,
  DDL ni escritura.
- **Decisión de Victor (2026-10-15):** SICAR no entrega la contraseña root, así que en Ocosingo se usa el usuario
  `consultas`, que tiene `FILE ... WITH GRANT OPTION` y con MySQL escuchando en todas las interfaces. Ese riesgo ya
  existía antes del agente; el agente no lo agrega, pero tampoco lo corrige.
- Por eso la protección vive en el agente (`agente-sicar/seguridad.js`): solo acepta `SELECT`/`SHOW` sin `INTO`,
  `OUTFILE`, `DUMPFILE`, `LOAD_FILE`, `UPDATE`, `LOCK`, variables ni sentencias múltiples; cada sesión es
  `READ ONLY` y cada página va en `START TRANSACTION READ ONLY`; solo se conecta a `localhost`/`127.0.0.1`; nunca
  nombra `huella`, `muestra` ni `foto`. `--verificar` registra `PRIVILEGIOS_AMPLIOS` mientras siga así.
- Pendiente cuando haya root: crear el usuario de solo lectura, quitar `FILE`/`GRANT OPTION` a `consultas` y
  limitar MySQL a `127.0.0.1`.
- No abrir el puerto 3306 hacia afuera. No usar la cuenta root en el agente.

## 7. Piloto en Ocosingo

1. Muestra pequeña fuera de horario; conciliar a mano 20 compras con nombre contra el ticket de SICAR.
2. Carga histórica por páginas, de 20:00 a 07:00.
3. Incremental en cada ciclo.
4. Antes de habilitar otra tienda: revisar exclusión de público, respaldo restaurable, disco, tiempos y
   cancelaciones. Cada tienda nueva repite el reconocimiento F0, la prueba y su propia llave.

Detenerse ante cualquier diferencia de centavos sin explicar, detalle faltante, duplicado o cualquier
efecto en caja.
