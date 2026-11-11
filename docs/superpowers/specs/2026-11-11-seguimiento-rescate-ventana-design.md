# Seguimiento por factura — Rescate de la mercancía enviada antes de incorporar una tienda

Fecha: 2026-11-11. Rama `feature/seguimiento-rescate` (worktree `.claude/worktrees/seguimiento-rescate`), base `ff2eed6`.
Prioridad aprobada por Victor el 2026-11-11.

## Por qué

El seguimiento arrancó con la foto de CEDIS del **2026-11-06 00:05** (hora local). Cada tienda se incorporó después, con
su propia foto: Ocosingo 2026-11-06 10:53, San Cristóbal 2026-11-06 13:19, Palenque 2026-11-07 14:23, Yajalón
2026-11-11 12:40 (ver `seguimiento_tiendas.corte`).

Lo que CEDIS mandó a una tienda **entre la foto de CEDIS y la foto de esa tienda** hoy queda en **gris** ("enviado a
tienda sin seguimiento") para siempre: la foto de la tienda ya contó esas piezas como "mercancía de antes" (anterior),
sin factura. Ejemplo real: la factura **C 32194** (compra CEDIS 1409, 2026-11-06) se mandó a Yajalón el mismo día; Yajalón
se incorporó el 11-11; no se ve cuánto de esa factura se vende en Yajalón.

## Decisión de Victor

Rescatar **solo desde la fecha en que empezó el sistema de seguimiento** (la foto de CEDIS, 2026-11-06 00:05). Nada
anterior a esa fecha.

## Idea (cómo se rescata sin inventar mercancía)

Para cada tienda T incorporada después del inicio del sistema existe una **ventana** = (inicio del sistema, corte de T].
En la ventana el CRM SÍ tiene los movimientos de T que vienen de SICAR: recepciones de traspasos, salidas de traspasos,
ventas a clientes y ventas de mostrador (el agente los cargó completos con el histórico).

Se calcula, por clave, una **foto reconstruida al inicio del sistema**:

`foto_inicio(T, clave) = foto_real(T, clave) − recepciones_en_ventana + salidas_en_ventana + ventas_en_ventana`

y el cálculo de T **arranca en el inicio del sistema** con esa foto como "anterior", reproduciendo los movimientos de la
ventana con las reglas de siempre (FIFO: primero lo anterior, luego la factura más vieja). Así lo que llegó de una factura
en la ventana queda como piezas **de esa factura** en T, y sus ventas en la ventana se le descuentan.

No se modifica nada guardado: la foto real y el corte real de T se conservan. El rescate es una forma distinta de LEER
(se calcula al recalcular).

## Metas

- Las facturas de CEDIS con fecha posterior al inicio del sistema muestran, en cada tienda que se incorporó después, lo
  que queda y lo que se vendió, en lugar de gris.
- Ninguna pieza se cuenta dos veces: al terminar la ventana, lo calculado en T debe dar exactamente la foto real de T.

## No metas

- Nada anterior al 2026-11-06 00:05 (facturas viejas: proyecto aparte, "rescate de facturas viejas").
- No cambia el agente ni pide datos nuevos a SICAR.
- No cambia la pantalla salvo una marca de "reconstruido" (abajo).

## Anti-metas (falla aunque "funcione")

- Que el rescate invente piezas: que una factura aparezca con más piezas en T de las que T recibió, o que la suma de
  factura + anterior en T al corte no dé la foto real.
- Que una tienda con datos incompletos en la ventana se presente como cierta.
- Que cambie el resultado de tiendas o facturas sin ventana (CEDIS y lo posterior a cada corte se calculan igual).

## Reglas (decisiones tomadas)

1. **Inicio del sistema** = corte de CEDIS (`seguimiento_tiendas` de la sucursal 6). Sin CEDIS incorporado no hay rescate.
2. **Qué tiendas:** todas las incorporadas con corte posterior al inicio del sistema (hoy: Ocosingo, San Cristóbal,
   Palenque, Yajalón). Tiendas futuras igual. *Recomendación de Claude, pendiente de confirmar por Victor.*
3. **Movimientos de la ventana** que entran a la cuenta: recepciones y salidas de traspasos de T con fecha en la ventana,
   ventas vigentes de cliente y de mostrador de T con fecha en la ventana. Mismas reglas de fechas que hoy (día del corte,
   foto de madrugada) aplicadas al inicio del sistema y al corte de T.
4. **Datos incompletos → no se rescata esa tienda/clave, se queda como hoy (gris):**
   - Si la foto reconstruida de una clave sale **negativa** (hubo movimientos que el CRM no ve: ajustes de inventario,
     compras locales, devoluciones): esa clave en T queda sin rescate y se anota el motivo `rescate_inconsistente`.
   - Si las ventas de **mostrador** de T todavía no cubren la ventana (la carga de mostrador desde 2025 va atrasada; hoy
     pasa en Yajalón): T queda sin rescate hasta que cubran. Criterio: T tiene ventas de mostrador guardadas con fecha
     posterior a su corte (la carga va en orden, así que ya pasó la ventana).
   - Si hay traspasos de la ventana `sin_mapa`, `mapa_contradictorio` o `folio_ambiguo`: esa clave en T sin rescate.
5. **Comprobación obligatoria por clave:** al reproducir la ventana, lo calculado en T al corte debe ser igual a la foto
   real. Si no da (por redondeo de fracciones o datos raros), esa clave en T queda sin rescate (`rescate_inconsistente`).
6. **Marca en pantalla:** en el detalle de la factura, las tiendas con rescate muestran "reconstruido desde el
   2026-11-06" para que se sepa que es un cálculo con las ventas de SICAR y no una foto tomada ese día.

## Restricciones

- Sin dependencias nuevas, sin cambios de esquema, sin tocar `agente-sicar/`.
- Líneas ≤ 200 caracteres, `node --test`, suite 0 fallas, eslint 0 errores.
- Rendimiento: el recálculo por clave hoy toma milisegundos; el rescate no debe multiplicarlo por más de 2 (medir con la
  prueba de integración de 30k ventas existente).

## Verificación

- Pruebas con una tienda incorporada después: factura recibida en la ventana con ventas en la ventana → al corte, factura
  en T = recibido − vendido en ventana, anterior en T = foto − factura en T; después del corte, las ventas de T consumen
  según FIFO normal.
- Foto reconstruida negativa → `rescate_inconsistente`, la factura en T queda en gris como hoy.
- Mostrador sin cubrir la ventana → sin rescate; al cubrir, con rescate.
- Tienda sin ventana (corte = inicio) y CEDIS: resultados idénticos a hoy (pruebas existentes sin cambio).
- Caso real C 32194 → Yajalón con datos de producción (lectura): Claude compara contra el SICAR de Yajalón.
- Navegador: detalle de una factura con tienda reconstruida muestra la marca.

## Lo que queda al implementador

Dónde vive el cálculo (probable `backend/seguimientoFactura/lector.js` + `motor.js`), nombres, estructura de pruebas.

## Decisiones del diseñador tras la revisión de constructor (2026-11-11)

La revisión encontró que "reproducir con las reglas de siempre" no basta. Decisiones de Claude (técnicas, sin cambiar lo
que Victor pidió):

1. **Corte efectivo en todos lados.** Para una tienda rescatada, TODAS las comparaciones contra su corte en `lector.js`
   (ventas `:107`, observaciones `:171`, `gris`/`usarEntrada` `:189-191`, `origen_no_incorporado`/`salida_anterior_corte`
   `:213-215`, `diaDudoso`) usan el inicio del sistema como corte efectivo; la foto efectiva es la reconstruida.
2. **La fórmula usa exactamente los movimientos que el motor aplicará**, no los crudos de SICAR. Si en la ventana una
   clave tiene en T cualquier movimiento marcado por aclarar (`recepcion_mayor`, `recepcion_sin_salida`,
   `recepcion_menor`, `dia_del_corte`, `sin_mapa`, `mapa_contradictorio`, `folio_ambiguo`, `estados_contradictorios`,
   etc.), esa clave no se rescata en ninguna tienda (`rescate_inconsistente`).
3. **Mercancía enviada antes del inicio del sistema y recibida en la ventana** entra a T como "anterior" (igual que hoy
   `origen_no_incorporado`): no es de ninguna factura seguida. La fórmula la trata como recepción de anterior.
4. **Ventas a cuenta interna** de T en la ventana sí entran a la fórmula (sacan mercancía), y en el motor siguen como hoy
   (por aclarar, no vendidas).
5. **Todo o nada por clave.** Si una clave falla el rescate en cualquier tienda (foto negativa, comprobación, motivo del
   punto 2), esa clave no se rescata en NINGUNA tienda y queda exactamente como hoy. Evita traspasos entre dos tiendas
   rescatadas a medias.
6. **Comprobaciones:** (a) total de T al corte = foto real; (b) por factura, piezas de la factura en T al corte ≤ piezas
   de esa factura que T recibió en la ventana; (c) suma de todas las tiendas + CEDIS + tránsito por factura = comprado
   menos vendido. Si cualquiera falla, la clave sin rescate.
7. **Fechas con hora.** Para los movimientos de T en la ventana se usa la fecha y hora completas cuando existen
   (recepción `fecha_aplicado`, ventas); solo un movimiento con fecha sin hora el mismo día del corte de T (tienda
   abierta) es dudoso → la clave sin rescate.
8. **Qué cambia y qué no (reemplaza la tercera anti-meta):** cambian solo las claves rescatadas: lo que CEDIS mandó a T en
   la ventana deja de ser gris y pasa a tránsito/queda/vendido en T; una devolución de T a CEDIS en la ventana devuelve
   piezas de factura en vez de "anterior". Las claves sin rescate, y todo lo que no toca una ventana, dan resultados
   idénticos a hoy (las pruebas existentes no cambian).
9. **Datos completos:** basta el criterio de mostrador (ventas de mostrador de T con fecha posterior a su corte). Las
   ventas a clientes y los traspasos se cargaron completos con el histórico antes de incorporar cada tienda.
