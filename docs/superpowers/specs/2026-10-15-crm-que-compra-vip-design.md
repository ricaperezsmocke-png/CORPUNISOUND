# Entrega 3 — CRM: qué compra, VIP y cuentas internas

Fecha: 2026-10-15. Decisiones de Victor tomadas en conversación con Claude. Base: master `c7e28bc`.
Rama `feature/crm-que-compra`, worktree `.claude/worktrees/crm-que-compra`.

## 1. Para qué

La vendedora abre la ficha de un cliente y necesita saber **qué le vende** (en qué categorías gasta, qué artículos
repite) y **si es de los importantes** para atenderlo primero. Hoy la ficha solo da totales, número de compras, última
compra, score y segmento por recencia.

Además, en SICAR hay cuentas que no son clientes (la tienda propia "UNISOUND YAJALON" suma $15.9 millones en
traspasos; posibles empleados o nombres de mostrador con cientos de compras). Inflan los totales del CRM y saldrían
VIP. Victor quiere marcarlas a mano, con constancia.

Éxito: una vendedora filtra "Solo VIP", ve 58 clientes de Ocosingo, abre uno y ve "VIP · $45,300 en 12 meses",
sus categorías y sus artículos más comprados. Victor marca "UNISOUND YAJALON" como cuenta interna con motivo; deja de
sumar a los totales y queda en el historial quién la marcó.

Medición en producción (2026-10-15, solo Ocosingo cargado): con $20,000 en 12 meses quedan 58 VIP. Ninguna de las
cuentas sospechosas compró en los últimos 12 meses.

## 2. Lo que ya existe y no se cambia

- Lista, ficha, compras y detalle combinados POS + SICAR en `backend/crmFuentes.js` (`personas`, `listar`, `ficha`,
  `compras`, `detalle`, `resumen`) y rutas `/api/crm/v2/*` en `backend/server.js:1888-1893`.
- Pantallas `src/CRMListaClientes.jsx`, `src/CRMFichaCliente.jsx`, `src/CRMComprasSicar.jsx`, `src/CRMSeguimiento.jsx`.
- Estados de seguimiento de la Entrega 1 (`sicar_estados`, `sicar_estados_historial`, permiso `cambiar_estado_cliente`).
- Score y segmento por recencia: se quedan como están.
- Unión CRM–SICAR (`sicar_vinculos`, `UNION_ACTIVA`): una persona unida suma sus identidades SICAR a su nativo.
- `esPublicoSicar` sigue excluyendo "público en general".

## 3. Decisiones tomadas (no reabrir)

1. **VIP = $20,000 o más en ventas vigentes en los últimos 365 días**, POS + SICAR sumados por persona (incluidas las
   identidades SICAR unidas). Ventana: `fecha >= hoy local − 365 días` (zona `America/Mexico_City`, `fechaLocal()` de
   `backend/fechas.js`); la venta del día 365 cuenta, la del 366 no. Canceladas y excluidas no cuentan. El umbral es
   una constante en el backend (`VIP_MINIMO_CENTAVOS = 2_000_000`), no configurable en pantalla.
2. VIP **se calcula al consultar**, no se guarda. No da descuentos ni toca dinero.
3. "Qué compra" = **categorías + artículos**, sobre **toda la historia** del cliente (ventas vigentes).
4. **Cuenta interna**: marca manual, con motivo obligatorio, reversible, con historial (quién, cuándo, anterior,
   nuevo, motivo). Permiso nuevo **`marcar_cuenta_interna`** (módulo `crm`). Una cuenta interna: sigue visible en la
   lista con etiqueta "Cuenta interna", **nunca es VIP**, y **no suma a ningún total del CRM** (clientes, compradores,
   montos de `listar` y de `resumen`, incluido el resumen por tienda).
5. Alcance (regla 5 de CLAUDE.md): quien no tiene `ver_todas_las_sucursales` solo marca/desmarca personas de su tienda;
   el alcance sale del token, nunca de `?sucursal_id=`.

## 4. Diseño

### 4.1 VIP

- En `personas()` se agregan por persona `monto_12m_centavos` (POS + SICAR vigentes dentro de la ventana) y
  `vip` (`!cuenta_interna && monto_12m_centavos >= VIP_MINIMO_CENTAVOS`). Para SICAR, la suma de 12 meses sale en la
  misma consulta de `identidadesSicar` (`SUM(CASE WHEN estado='vigente' AND fecha_local >= ? ...)`), no con una
  consulta por cliente.
- `listar` acepta el filtro `vip=1` (validado: solo `1` o ausente; cualquier otro valor → 400, igual que los filtros
  de la Entrega 1). Se combina con los demás filtros.
- Lista: etiqueta "VIP" junto al nombre y casilla/filtro "Solo VIP". Ficha: "VIP · $X en 12 meses"; si no es VIP,
  "$X en 12 meses" sin etiqueta.

### 4.2 Qué compra

Ruta nueva `GET /api/crm/v2/clientes/:ref/que-compra` (mismo `requiereLogin` + `rutaCRM` + mismo alcance que la ficha:
si la persona no es visible → 404). Respuesta:

```
{ categorias: [{ categoria_id|null, nombre, monto_centavos, piezas }],   // mayor a menor monto
  articulos:  [{ clave|null, descripcion, piezas, monto_centavos, ultima_fecha }],  // top 20 por monto
  ajustes_centavos,            // ver abajo; puede ser negativo
  total_centavos }             // = monto_centavos de la ficha
```

- **POS**: renglones de `DB.pos.venta_detalle` de ventas `cerrada` del cliente. Categoría = `producto.categoria_id` del
  catálogo; nombre de la categoría de `DB['catalogo-productos'].categorias`. Renglón sin producto (artículo rápido) o
  sin categoría → "Sin categoría". Importe del renglón = el mismo que usa hoy `detalle()`.
- **SICAR**: renglones de `sicar_detalles` de ventas `vigente` de sus identidades. Categoría: `clave` del renglón contra
  `sku` del catálogo (comparación exacta tras `trim`); si no hay coincidencia → "Sin categoría".
- **Artículos**: se agrupan por producto (POS) o por `clave` (SICAR); si un producto del catálogo coincide por `sku`
  con una clave SICAR, es el mismo artículo. Sin clave → agrupar por descripción normalizada. Descripción mostrada:
  nombre del catálogo si lo hay, si no la del renglón.
- **Cuadre obligatorio**: `ajustes_centavos = total_centavos − Σ categorias.monto_centavos`. Captura descuentos
  globales, redondeos o cualquier diferencia entre renglones y total de venta. La pantalla lo muestra como renglón
  "Ajustes y descuentos de la venta" **solo si es distinto de cero**. Así la suma de lo mostrado siempre es igual al
  total comprado: no aparece ni desaparece dinero.
- Cantidades: piezas enteras (regla de la casa); SICAR guarda `cantidad` como texto → `Number`, y si no es finita
  cuenta 0 piezas pero su importe sí suma.

### 4.3 Cuentas internas

- **Clientes SICAR** (no unidos): tablas SQLite nuevas en `backend/sicarRepositorio.js`:
  `sicar_internas(sucursal_id, cli_id, motivo, usuario_id, fecha_hora, PRIMARY KEY(sucursal_id, cli_id))` y
  `sicar_internas_historial(id, sucursal_id, cli_id, accion CHECK IN ('marcar','desmarcar'), motivo, usuario_id,
  fecha_hora)`. Marcar/desmarcar y su historial en **una transacción**.
- **Clientes CRM** (y personas unidas, que se representan por su nativo): campos en el cliente
  `cuenta_interna: { motivo, usuario_id, fecha_hora } | null` y colección nueva `DB.crm.cuentas_internas_historial`
  (agregarla a la semilla de `server.js`). Una identidad SICAR unida hereda la marca de su nativo; no se marca aparte.
- Ruta `PUT /api/crm/v2/clientes/:ref/cuenta-interna` con cuerpo `{ interna: true|false, motivo }`.
  `requierePermiso("marcar_cuenta_interna")`. `interna` debe ser booleano estricto (`true`/`false`, no texto);
  `motivo` obligatorio al marcar y al desmarcar, texto recortado de 3 a 200 caracteres. Alcance por persona (404 si no
  la ve). Marcar algo ya marcado o desmarcar algo no marcado → 409, sin escribir historial.
- La ficha devuelve `cuenta_interna: { motivo, fecha_hora, usuario_nombre } | null` y `historial_interna` (últimos 20).
- `listar.totales` y `resumen()` excluyen cuentas internas de **todo** conteo y monto; la lista sí las incluye como
  renglones con `cuenta_interna` no nulo. Un filtro `vip=1` nunca las devuelve.
- Permiso en `backend/permisosCatalogo.js` (módulo `crm`, `implementado: true`). El Administrador lo recibe por
  `reconciliarRoles`; nadie más automáticamente.
- **Respaldo**: las dos tablas nuevas entran en `TABLAS` de `backend/sicarRespaldo.js`. Debe seguir restaurando
  respaldos de las **dos generaciones anteriores** (10 tablas, y 12 con `sicar_estados*`); hoy existe
  `TABLAS_ANTIGUAS` para una sola. El campo de nativos y la colección viajan en el JSON de estado (ya respaldado).
- Pantalla: botón "Es cuenta interna" / "Ya no es cuenta interna" en la ficha, visible solo con el permiso; pide el
  motivo; muestra el historial.

## 5. Abuso y rastro

- Esconder a un cliente bueno marcándolo interno: requiere permiso propio, deja historial con usuario y motivo, y el
  cliente sigue visible con su etiqueta.
- Nada de esta entrega mueve dinero, inventario ni caja.
- Toda validación (VIP, filtros, permiso, alcance, motivo) en el servidor; la pantalla solo refleja.

## 6. Pruebas (TDD; cada una se ve ROJA antes de implementar)

- VIP: exactamente $20,000 es VIP y $19,999.99 no; venta del día 365 cuenta y la del 366 no; cancelada no cuenta;
  POS + SICAR unido suman; cuenta interna con $1M no es VIP; `vip=1` filtra; `vip=si` → 400.
- Qué compra: categorías POS por catálogo; SICAR por clave→sku; sin coincidencia → "Sin categoría";
  Σ categorías + ajustes = total de la ficha en casos con descuento global; top de artículos une POS y SICAR por sku;
  persona de otra tienda → 404.
- Cuenta interna: sin permiso → 403; con permisos vecinos del módulo `crm` pero sin este → 403; otra tienda → 404;
  `interna: "true"` → 400; motivo vacío o de 201 → 400; doble marcado → 409 sin historial; marcar y desmarcar dejan
  dos renglones de historial con usuario; totales de `listar` y `resumen` excluyen la cuenta; sigue en la lista.
- Respaldo: respaldo con las tablas nuevas restaura; respaldos de 10 y 12 tablas siguen restaurando.
- Suite completa del backend y `npx eslint src backend`: 0 fallas y 0 errores.
- Navegador (Claude): filtro "Solo VIP", ficha con VIP, categorías, artículos y ajustes; marcar y desmarcar con
  motivo y ver historial tras recargar; botón oculto sin permiso; totales bajan al marcar.

## 7. Fuera de alcance

Recompra de consumibles (Entrega 4); familias del Radar; umbral VIP configurable en pantalla; VIP con descuentos;
convertir clientes SICAR en clientes del CRM.
