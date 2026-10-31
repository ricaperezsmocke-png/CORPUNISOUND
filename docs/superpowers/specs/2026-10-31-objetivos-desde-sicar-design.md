# Objetivos alimentados por SICAR — diseño

Fecha: 2026-10-31. Rama `feature/objetivos-sicar` (worktree `.claude/worktrees/objetivos-sicar`), base `45e8f9c`.

## Por qué

Las tiendas cobran en SICAR, no en el punto de venta de CORPUNISOUND. Hoy el módulo de Objetivos (avance, venta,
marcas, productos, créditos) se alimenta solo de lo que cada vendedora **captura a mano**
(`DB.pos.objetivo_capturas`, `backend/objetivosCaptura.js:170`; `backend/objetivosAvance.js:74`) y, al cerrar el mes,
el gerente **teclea** el "real de SICAR" (`backend/objetivosCierre.js:191-232`). La venta real ya llega al servidor por
el agente SICAR (tablas `sicar_*`), pero Objetivos no la lee. Victor quiere que las metas se midan con lo que de verdad
se cobró.

Lo que está en juego es dinero y personal: el avance decide si una vendedora cumplió. Un número inflado le paga a quien
no vendió; uno incompleto le reprueba a quien sí. El sistema no debe inventarle ventas ni quitárselas a nadie.

## Hechos verificados (dos revisiones independientes, Claude y Codex, sobre 45e8f9c)

- Ninguna métrica de Objetivos lee SICAR. Lo único que lee SICAR es Cinco Caminos (por tienda y semana,
  `backend/cincoCaminos/tablero.js:42-58`).
- **Cinco Caminos suma como venta lo vendido a cuentas internas** (traspasos a tiendas propias): solo las excluye de
  "con cliente" (`tablero.js:47-50`). En Ocosingo el cliente "UNISOUND YAJALON" suma ~36% de lo SICAR del CRM.
- `sicar_ventas` (con cliente) y `sicar_ventas_mostrador` (público en general) traen tienda, `ven_id`, `fecha_local`
  (hora de la PC de SICAR, sin conversión), estado y `total_centavos` (total del ticket). Sus renglones traen artículo,
  cantidad, importe y descuento (`backend/sicarRepositorio.js:69-92`, `:143-154`).
- Mostrador viene **apagado** por defecto en el agente (`agente-sicar/corrida.js:19`).
- El agente **no manda**: vendedor por venta (`agente-sicar/mapeo.js:5` solo lee `ven_id, fecha, status, total,
  tic_id, not_id, rem_id`), marca del artículo, forma de pago por venta, créditos/abonos, devoluciones.
- La tienda la fija la llave del agente; el servidor ignora la tienda del lote (`backend/sicarRutas.js:101`).
- Ya existe un patrón para ligar un usuario de SICAR con un nombre (`sicar_cajeros` + historial,
  `sicarRepositorio.js:133-142`).

## Decisiones de Victor (2026-10-31, aprobadas las seis)

1. **Atribución:** la venta se cuenta a la vendedora que SICAR tenga anotada en la venta. Lo que no tenga vendedor (o
   tenga uno sin ligar) va a **"sin asignar"**, visible para el gerente. **Nunca** se atribuye a la cajera ni a quien
   registró la venta por default.
2. **Traspasos / cuentas internas:** nunca cuentan como venta, ni en Objetivos ni en Cinco Caminos.
3. **Importe:** total del ticket, **con IVA y ya con descuento** (`total_centavos`). Para marcas y productos, el importe
   del renglón ya con descuento.
4. **Convivencia:** la captura manual convive **un mes** con SICAR para comparar; después se quita. El "real de SICAR"
   del cierre se llena solo.
5. **Créditos:** se quedan como están (folio manual Coppel Pay / Atrato) hasta conocer cómo los guarda SICAR.
6. **Mostrador:** se prende en cada tienda que se mida. Sin mostrador, la venta de la tienda no se califica con SICAR.
7. **Devoluciones** (notas de crédito): restan a la vendedora de la nota, en el mes de la nota.
8. **Marcas:** salen del **departamento** de SICAR, solamente.

## Metas y anti-metas

**Metas:** que la venta, el avance, las marcas y los productos de cada vendedora y de cada tienda salgan de SICAR; que el
gerente vea qué parte no se pudo atribuir; que cada número se pueda explicar ticket por ticket.

**No metas (por ahora):** créditos desde SICAR (fase posterior), cobranza o cuentas por cobrar, comisiones, cambiar cómo
se ponen las metas.

**Anti-metas (si pasa esto, falló aunque "funcione"):**
- Una venta contada dos veces (con cliente y mostrador del mismo ticket, o POS + SICAR).
- Un traspaso a tienda propia contado como venta.
- Venta atribuida a alguien por adivinanza (cajera, vendedor asignado al cliente, nombre parecido).
- Una tienda sin mostrador o sin agente mostrada como "0% de avance" en vez de "sin datos de SICAR".
- Un mes ya sellado que cambia solo.

## Fases

Cada fase se entrega, se prueba en navegador y Victor la sube antes de la siguiente.

### F0 — Reconocimiento de SICAR (hecho en San Cristóbal 2026-10-31, solo lectura; confirmar en Ocosingo)

- **Vendedor: SÍ existe.** `venta.vnd_id` (int, índice) → tabla `vendedor` (`vnd_id` PK, `nombre`, `alias`, `status`;
  la tabla también trae datos personales, huella y foto: **el agente no los lee**). En 90 días, 664 de 664 ventas
  vigentes traen `vnd_id` (4 vendedores distintos). `venta` no tiene `usu_id`; quien capturó sale de `historial` y
  **no coincide** con `vnd_id` (solo 29 de 664): `vnd_id` es el vendedor que se elige al vender, no la cajera. F2 va.
- **Marca: NO existe** en `articulo` ni hay tabla de marca. Clasificación: `cat_id` → `categoria` → `dep_id` →
  `departamento`. Hay una tabla `linea` sin revisar (en curso). Ver F3.
- **Forma de pago:** `ventatipopago` (`ven_id`, `tpa_id`, `total`), varias por venta. Catálogo `tipopago`: Efectivo,
  Cheque, Crédito, Transferencia, Vales, Tarjeta, Anticipo, SICAR Pagos. **Coppel Pay y Atrato no existen** como forma de
  pago (probablemente van como Tarjeta o Transferencia). Crédito propio (`tpa_id` 3, `creditocliente`, `abonocliente`):
  0 ventas en 90 días. → Créditos se quedan manuales (decisión 5), sin F4 por ahora.
- **Devoluciones:** no hay tabla de devoluciones; van como **nota de crédito** (`notacredito`: `ncr_id`, `fecha`,
  `subtotal`, `descuento`, `total`, `devAplicada`, `status`, `cli_id`, `vnd_id`; `ventanotacredito` liga venta ↔ nota).
  90 días: 2 notas por $7,507.49, mismo importe que 2 ventas pagadas con "Anticipo" (nota aplicada a una venta nueva).
- **Importe:** `venta.total` = `subtotal` + impuesto (`ventaimp`); el `subtotal` **ya trae el descuento aplicado** y
  `descuento` solo informa. `total` es con IVA y con descuento: coincide con la decisión 3 y con `total_centavos`.

### F1 — Venta de la tienda desde SICAR (sin tocar el agente)

- Una sola función del servidor, **la única definición** de "venta SICAR de una tienda en un rango de fechas":
  `sicar_ventas` vigentes **menos** cuentas internas (`sicar_internas`) **más** `sicar_ventas_mostrador` vigentes, por
  `fecha_local`. Objetivos y Cinco Caminos la usan; nadie más arma esa suma por su lado (misma lógica que `esDeEstaCaja`).
- **Cinco Caminos** deja de sumar internas al dinero vendido (corrige `tablero.js:47-50`).
- **Objetivos, por tienda:** junto al avance de la tienda (captura manual) se muestra "Venta SICAR" del mes. La tienda
  sin agente, o con mostrador apagado, muestra **"sin datos de SICAR"**, nunca un número. Cómo se sabe que mostrador está
  prendido: lo decide el constructor con datos que ya existan en el servidor (por ejemplo, que la tienda haya mandado
  mostrador en los últimos días); si no hay forma confiable, se agrega una marca explícita.
- **Cierre de mes:** el `real_sicar` de la **tienda** se propone solo con ese número; el gerente lo ve y lo confirma al
  sellar (el campo deja de ser tecleo libre para la tienda). El de cada persona sigue manual hasta F2.

### F2 — Vendedora por venta (cambia el agente)

Confirmado en F0: `venta.vnd_id` → `vendedor`.
- **Agente:** manda el `vnd_id` de cada venta (con cliente y mostrador) y el catálogo de vendedores de SICAR (solo
  `vnd_id`, `nombre`, `alias`, `status`; nunca datos personales, huella ni foto: se agregan a la guardia SQL como hoy
  `huella|muestra|foto`). Sube la versión del contrato; un agente viejo sigue funcionando sin vendedor.
- **Servidor:** tabla que liga `(sucursal, vnd_id)` con una vendedora de CORPUNISOUND, con quién la ligó y cuándo, e
  historial de cambios (como `sicar_cajeros`). Se liga a mano, con permiso propio registrado en
  `backend/permisosCatalogo.js`; nunca por coincidencia de nombre automática.
- **Avance por persona:** suma las ventas SICAR de los vendedores ligados a ella. Ventas sin vendedor o con vendedor sin
  ligar van a **"sin asignar"**, que solo ve el gerente/admin, con el monto y la lista de tickets. Una vendedora nunca ve
  la venta de otra (se respeta la privacidad actual, `objetivosAvance.js:119`).
- **Convivencia (decisión 4):** durante el mes de comparación el avance oficial sigue siendo la captura manual y se muestra
  al lado el de SICAR con la diferencia. Al terminar el mes, un administrador cambia la **fuente oficial de esa tienda** a
  SICAR, con fecha de inicio y quién lo hizo; desde ese mes la captura de venta desaparece para esa tienda. Una tienda
  tiene **una sola fuente oficial por mes**: nunca se suman captura y SICAR.
- El `real_sicar` por persona del cierre se propone solo.

### F3 — Marcas y productos

- **Marcas = departamento de SICAR, solamente** (decisión de Victor 2026-10-31; SICAR no tiene campo de marca). Cada
  marca-meta de `objetivo_marcas` se liga a uno o varios departamentos de SICAR (`sicar_articulos.departamento`, ya
  llega; no cambia el agente). Se suma el importe de los renglones vigentes (con cliente sin internas + mostrador) de
  los artículos de esos departamentos. No se usan categoría, línea ni la descripción del artículo. *(Decisión del
  diseñador: el vínculo se hace por tienda, porque cada SICAR tiene su propio catálogo de departamentos; la pantalla puede
  ofrecer copiar el vínculo de otra tienda cuando el nombre del departamento coincide.)*
- **Productos:** cada producto-meta de `objetivo_productos` se liga a uno o varios artículos (o a una categoría) de SICAR;
  se suman piezas de los renglones vigentes.
- Lo que no esté ligado no suma a ninguna meta y se lista para que el gerente lo revise.
- Misma regla de una sola fuente oficial por tienda y mes que F2.

### F4 — Créditos (sin fecha)

F0 mostró que SICAR no distingue Coppel Pay ni Atrato. El registro manual de folios sigue igual; no hay F4 mientras eso
no cambie.

### Devoluciones (notas de crédito) — van con F2

Decisión de Victor 2026-10-31: **la devolución resta a la vendedora de la nota (`notacredito.vnd_id`) en el mes de la
nota** (`notacredito.fecha`). Así, una devolución que se cambia por otra mercancía (nota aplicada como anticipo a una venta
nueva) no cuenta como dos ventas.
- **Agente (con F2):** manda las notas de crédito vigentes: `ncr_id`, `fecha`, `total`, `status`, `vnd_id`, y sus
  renglones si existen; la relación venta ↔ nota (`ventanotacredito`) para poder mostrar de qué venta salió. Nada del
  cliente más allá de lo que ya se manda. Cancelada en SICAR = deja de restar.
- **Servidor:** la venta neta de una persona o tienda en un mes = ventas SICAR (regla de F1) − notas de crédito vigentes
  del mes. Las notas sin vendedor o con vendedor sin ligar restan de "sin asignar".
- **Marcas y productos:** la nota resta de la marca/producto solo si trae renglones con artículo; si no, resta solo de la
  venta total. *(Decisión del diseñador; confirmar con datos de `notacredito` en F2.)*
- **F1 (antes de que el agente mande notas):** el número de tienda se muestra con la leyenda "sin restar devoluciones".

## Reglas que aplican a todas las fases

- **Fechas:** se usa `fecha_local` de SICAR tal cual (hora de la tienda). Mes = `fecha_local` dentro del mes.
- **Cancelaciones:** una venta que SICAR cancela deja de sumar sola mientras el mes está abierto.
- **Mes sellado:** lo sellado no cambia solo. Si después del sello SICAR cambia el número (cancelación tardía, venta que
  llega tarde), el cierre muestra un **aviso de diferencia** y el gerente rectifica con motivo usando el flujo existente
  (`objetivosCierre.js:266-285`). *(Decisión del diseñador; Victor puede cambiarla.)*
- **Venta que pasa de con cliente a público:** queda `excluida` en `sicar_ventas` y entra por mostrador; no se cuenta dos
  veces ni se pierde (requiere mostrador prendido).
- **Doble fuente:** si una tienda llegara a cobrar también en el POS de CORPUNISOUND, esa venta **no** entra a estas
  sumas; la fuente oficial es SICAR.
- Toda suma se calcula en el servidor; la pantalla solo muestra.
- Cada número de SICAR en pantalla se puede abrir hasta los tickets que lo forman.

## Lo que decide el constructor

Nombres de funciones y tablas, forma exacta de las pantallas, cómo detectar mostrador prendido (con la condición de F1),
cómo se pagina la lista de tickets, cómo se migra.

## Prerrequisitos fuera del código

- Mostrador prendido en cada tienda que se mida (`"mostrador": true` en el agente).
- Cuentas internas (Yajalón y demás tiendas propias) marcadas en CRM → SICAR en cada tienda.
- Agente instalado y mandando en cada tienda (hoy: Ocosingo; San Cristóbal y CEDIS en instalación).

## Preguntas abiertas (Victor)

Ninguna por ahora: marcas (departamento) y devoluciones (restan en el mes de la nota) decididas el 2026-10-31.
