# Apartados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar apartados (layaway) al Punto de Venta: crear con anticipo, abonar, liquidar (automático al llegar a $0), cancelar, vencimiento automático a 60 días con reintegro a monedero — integrado con Corte de Caja, Reportes (Ventas/Utilidad/Movimientos de Caja/Estado de Cuenta) y un aviso en CRM.

**Architecture:** Un apartado es una fila más en `DB.pos.ventas` (`tipo_documento: "Apartado"`) con un ciclo de vida de `estatus`: `"apartado"` (vigente) → `"cerrada"` (liquidado) o `"cancelada"` (cancelado/vencido). Los pagos parciales viven en una colección nueva `DB.pos.apartado_abonos` — el Corte de Caja y Movimientos de Caja usan esos abonos (por su fecha real) en vez del total de la venta, para no duplicar dinero cuando el apartado se liquide después.

**Tech Stack:** Node.js/Express (backend ya existente), `node:test`, React 18 + Tailwind (frontend ya existente), sin dependencias nuevas.

## Global Constraints

- Un apartado exige `cliente_id` real (no puede ser `0`, Público en General).
- El anticipo y cada abono deben ser > $0; ningún abono puede exceder el saldo pendiente.
- La existencia se descuenta de inmediato al crear el apartado (igual que una venta), y se reintegra al cancelar o vencer.
- Límite fijo de 60 días desde la creación (`DIAS_LIMITE_APARTADO`), aviso fijo a 7 días de vencer (`DIAS_AVISO_POR_VENCER`) — ninguno es configurable en esta versión.
- Al vencer (60 días) o cancelar manualmente: la existencia regresa a inventario y lo ya pagado (suma de sus abonos) se acredita al campo `monedero` del cliente.
- Ningún reporte ni el Corte de Caja debe duplicar dinero: los abonos de un apartado cuentan el día real en que se pagan; el total de la venta-apartado NUNCA se suma en Corte de Caja ni en Movimientos de Caja (solo sus abonos).
- Mientras un apartado esté con `estatus: "apartado"` (pendiente), no debe aparecer en ningún lado de Reporte de Ventas/Utilidad — solo se ve en la pantalla de Apartados del POS. Al liquidarse (`estatus: "cerrada"`) aparece igual que cualquier venta cerrada, fechado el día que se apartó, con un campo `fecha_liquidacion` adicional.
- Un solo permiso `gestionar_apartados` (módulo `pos`) cubre crear/abonar/cancelar.
- El backend tenía 313 pruebas pasando en `master` antes de este plan — no deben romperse.

---

### Task 1: Modelo de datos, permiso y `backend/apartados.js`

**Files:**
- Modify: `backend/permisosCatalogo.js`
- Modify: `backend/server.js` (DB seed + imports + rutas)
- Modify: `backend/testHelpers.js`
- Create: `backend/apartados.js`
- Create: `backend/apartados.test.js`

**Interfaces:**
- Produces: `crearApartado(DB, datos, sucursalId, usuario)`, `registrarAbono(DB, ventaId, datos, usuario)`, `liquidarApartado(DB, ventaId)`, `cancelarApartado(DB, ventaId, motivo)`, `procesarVencimientos(DB)`, `listarApartados(DB, alcance)`, `obtenerApartadosProximosAVencer(DB, alcance)`, `saldoPendiente(DB, venta)` — todos exportados de `backend/apartados.js`.
- Consumes: `ajustarExistencia` de `./productos` (ya existente).

- [ ] **Step 1: Registrar el permiso `gestionar_apartados`**

En `backend/permisosCatalogo.js`, agregar dentro del arreglo `PERMISOS` (junto a los demás permisos de módulo `pos`, por ejemplo después del bloque `// ---- Punto de Venta ----`):

```js
  { clave: "gestionar_apartados", etiqueta: "Gestionar Apartados", modulo: "pos", implementado: true },
```

No hace falta tocar `MODULOS_SISTEMA` ni `validarPermisos.js` — el módulo `pos` ya existe y ya tiene permisos registrados.

- [ ] **Step 2: Agregar `apartado_abonos: []` al DB de `server.js` y `testHelpers.js`**

En `backend/server.js`, dentro del objeto `DB.pos` (junto a `cortes_caja: []`):

```js
    condiciones_pago: [],
    configuracion: null,
    cortes_caja: [],
    apartado_abonos: [],
```

En `backend/testHelpers.js`, dentro de `DB.pos` (mismo lugar, junto a `cortes_caja: []`):

```js
      condiciones_pago: [],
      configuracion: null,
      cortes_caja: [],
      apartado_abonos: [],
```

- [ ] **Step 3: Escribir las pruebas de `backend/apartados.js`**

Crear `backend/apartados.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const {
  crearApartado, registrarAbono, cancelarApartado, procesarVencimientos,
  listarApartados, obtenerApartadosProximosAVencer, saldoPendiente,
} = require("./apartados");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };

function lineasBase() {
  return [{ producto_id: 1, cantidad: 2, precio_unitario: 25, descuento_pct: 0 }];
}

test("crearApartado: rechaza cliente Público en General (id 0)", () => {
  const DB = construirDBPrueba();
  assert.throws(
    () => crearApartado(DB, { cliente_id: 0, lineas: lineasBase(), anticipo_monto: 10, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }),
    /cliente/i
  );
});

test("crearApartado: rechaza anticipo en $0", () => {
  const DB = construirDBPrueba();
  assert.throws(
    () => crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 0, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }),
    /anticipo/i
  );
});

test("crearApartado: rechaza apartar más de lo que hay en existencia", () => {
  const DB = construirDBPrueba();
  assert.throws(
    () => crearApartado(DB, { cliente_id: 1, lineas: [{ producto_id: 1, cantidad: 9999, precio_unitario: 25, descuento_pct: 0 }], anticipo_monto: 10, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" }),
    /existencia/i
  );
});

test("crearApartado: descuenta existencia de inmediato y crea el primer abono (el anticipo)", () => {
  const DB = construirDBPrueba();
  const existenciaAntes = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;

  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });

  assert.strictEqual(venta.tipo_documento, "Apartado");
  assert.strictEqual(venta.estatus, "apartado");
  assert.strictEqual(venta.cliente_id, 1);
  assert.strictEqual(venta.total, 50, "2 x $25");
  assert.ok(venta.fecha_limite > venta.fecha, "la fecha límite debe ser posterior a la de creación");

  const existenciaDespues = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;
  assert.strictEqual(existenciaDespues, existenciaAntes - 2);

  assert.strictEqual(DB.pos.apartado_abonos.length, 1);
  assert.strictEqual(DB.pos.apartado_abonos[0].monto, 20);
  assert.strictEqual(DB.pos.apartado_abonos[0].forma_pago, "EFECTIVO");
  assert.strictEqual(saldoPendiente(DB, venta), 30);
});

test("registrarAbono: rechaza un abono mayor al saldo pendiente", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  assert.throws(
    () => registrarAbono(DB, venta.id, { monto: 100, forma_pago: "TARJETA" }, { nombre: "Ana" }),
    /saldo/i
  );
});

test("registrarAbono: acumula el abono y liquida automáticamente cuando cubre el saldo restante", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });

  registrarAbono(DB, venta.id, { monto: 30, forma_pago: "TARJETA" }, { nombre: "Ana" });

  const actualizada = DB.pos.ventas.find((v) => v.id === venta.id);
  assert.strictEqual(actualizada.estatus, "cerrada");
  assert.ok(actualizada.fecha_liquidacion);
  assert.strictEqual(DB.pos.apartado_abonos.length, 2);
  assert.strictEqual(DB.pos.apartado_abonos[1].forma_pago, "TARJETA");
});

test("registrarAbono: rechaza abonar un apartado que ya no está vigente", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 50, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  assert.throws(
    () => registrarAbono(DB, venta.id, { monto: 10, forma_pago: "EFECTIVO" }, { nombre: "Ana" }),
    /vigente/i
  );
});

test("cancelarApartado: reintegra existencia y abona lo ya pagado al monedero del cliente", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  const existenciaAntes = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;

  cancelarApartado(DB, venta.id, "El cliente ya no lo quiere");

  const existenciaDespues = DB.inventario.existencias.find((e) => e.producto_id === 1 && e.sucursal_id === 1).cantidad_actual;
  assert.strictEqual(existenciaDespues, existenciaAntes + 2);

  const cliente = DB.crm.clientes.find((c) => c.id === 1);
  assert.strictEqual(cliente.monedero, 20);

  const actualizada = DB.pos.ventas.find((v) => v.id === venta.id);
  assert.strictEqual(actualizada.estatus, "cancelada");
  assert.strictEqual(actualizada.motivo_cancelacion, "El cliente ya no lo quiere");
});

test("procesarVencimientos: cancela automáticamente y abona al monedero un apartado pasados los 60 días", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  DB.pos.ventas.find((v) => v.id === venta.id).fecha_limite = "2000-01-01"; // fuerza que ya venció

  procesarVencimientos(DB);

  const actualizada = DB.pos.ventas.find((v) => v.id === venta.id);
  assert.strictEqual(actualizada.estatus, "cancelada");
  assert.strictEqual(actualizada.motivo_cancelacion, "Vencido — 60 días sin liquidar");
  const cliente = DB.crm.clientes.find((c) => c.id === 1);
  assert.strictEqual(cliente.monedero, 20);
});

test("procesarVencimientos: no toca apartados que todavía están dentro del límite", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });

  procesarVencimientos(DB);

  const actualizada = DB.pos.ventas.find((v) => v.id === venta.id);
  assert.strictEqual(actualizada.estatus, "apartado");
});

test("listarApartados: solo devuelve los vigentes (ya corrió el vencimiento automático primero)", () => {
  const DB = construirDBPrueba();
  const vigente = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  const vencido = crearApartado(DB, { cliente_id: 1, lineas: [{ producto_id: 2, cantidad: 1, precio_unitario: 16, descuento_pct: 0 }], anticipo_monto: 5, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  DB.pos.ventas.find((v) => v.id === vencido.id).fecha_limite = "2000-01-01";

  const lista = listarApartados(DB, ALCANCE_TODAS);

  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].id, vigente.id);
  assert.strictEqual(lista[0].saldo_pendiente, 30);
  assert.strictEqual(lista[0].cliente_nombre, "Abarrotes Mary");
  assert.strictEqual(lista[0].abonos.length, 1);
});

test("listarApartados: respeta el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  crearApartado(DB, { cliente_id: 2, lineas: [{ producto_id: 2, cantidad: 1, precio_unitario: 16, descuento_pct: 0 }], anticipo_monto: 5, anticipo_forma_pago: "EFECTIVO" }, 2, { nombre: "María" });

  const lista = listarApartados(DB, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(lista.length, 1);
});

test("obtenerApartadosProximosAVencer: respeta el umbral de 7 días y no repite si ya hay contacto registrado", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  const en5Dias = new Date();
  en5Dias.setDate(en5Dias.getDate() + 5);
  DB.pos.ventas.find((v) => v.id === venta.id).fecha_limite = en5Dias.toISOString().slice(0, 10);

  let lista = obtenerApartadosProximosAVencer(DB, ALCANCE_TODAS);
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].venta_id, venta.id);
  assert.strictEqual(lista[0].cliente_nombre, "Abarrotes Mary");

  DB.crm.contactos_cliente.push({ id: 1, cliente_id: 1, fecha: "2026-07-21", tipo: "apartado_por_vencer", resultado: null, venta_id: venta.id });
  lista = obtenerApartadosProximosAVencer(DB, ALCANCE_TODAS);
  assert.strictEqual(lista.length, 0, "ya no debe aparecer si ya se registró el contacto");
});

test("obtenerApartadosProximosAVencer: no incluye apartados con más de 7 días restantes", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, { cliente_id: 1, lineas: lineasBase(), anticipo_monto: 20, anticipo_forma_pago: "EFECTIVO" }, 1, { nombre: "Ana" });
  const lista = obtenerApartadosProximosAVencer(DB, ALCANCE_TODAS);
  assert.strictEqual(lista.length, 0, "recién creado, faltan 60 días");
});
```

- [ ] **Step 4: Correr las pruebas para verificar que fallan**

Run: `cd backend && npx node --test apartados.test.js`
Expected: FAIL — `Cannot find module './apartados'`.

- [ ] **Step 5: Implementar `backend/apartados.js`**

```js
/**
 * apartados.js — Apartados (layaway): el cliente paga un anticipo, el
 * producto se reserva (se descuenta existencia de inmediato) y viene
 * después a liquidar en uno o varios abonos, antes de 60 días.
 *
 * Un apartado es una fila más en DB.pos.ventas (tipo_documento: "Apartado"),
 * con un ciclo de vida propio de estatus: "apartado" (vigente, con saldo
 * pendiente) → "cerrada" (liquidado) o "cancelada" (cancelado o vencido).
 * Los pagos parciales (el anticipo cuenta como el primero) viven en
 * DB.pos.apartado_abonos — nunca se suma venta.total al Corte de Caja ni
 * a Movimientos de Caja para un apartado; se suman sus abonos por fecha
 * real de pago (ver reportes.js/cortes.js).
 */

const { ajustarExistencia } = require("./productos");

const DIAS_LIMITE_APARTADO = 60;
const DIAS_AVISO_POR_VENCER = 7;

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function sumaAbonos(DB, ventaId) {
  return DB.pos.apartado_abonos
    .filter((a) => a.venta_id === ventaId)
    .reduce((acc, a) => acc + a.monto, 0);
}

function saldoPendiente(DB, venta) {
  return Math.round((venta.total - sumaAbonos(DB, venta.id)) * 100) / 100;
}

function diasEntre(fechaA, fechaB) {
  return Math.floor((new Date(fechaB) - new Date(fechaA)) / 86400000);
}

function crearApartado(DB, datos, sucursalId, usuario) {
  const cliente_id = Number(datos.cliente_id);
  if (!cliente_id) throw new Error("Selecciona un cliente para el apartado — no puede ser Público en General");
  if (!Array.isArray(datos.lineas) || datos.lineas.length === 0) {
    throw new Error("El apartado no tiene productos");
  }
  const anticipoMonto = Number(datos.anticipo_monto);
  if (!anticipoMonto || anticipoMonto <= 0) throw new Error("El anticipo debe ser mayor a $0");
  if (!datos.anticipo_forma_pago) throw new Error("Selecciona la forma de pago del anticipo");

  const sucursal_id = Number(sucursalId) || 1;

  // Misma validación de existencia suficiente que crearVenta (ventas.js) —
  // no dejar apartar más de lo que hay, agrupando por producto por si el
  // mismo producto aparece en más de un renglón.
  const cantidadPedida = {};
  datos.lineas.forEach((l) => {
    if (!l.producto_id) return;
    cantidadPedida[l.producto_id] = (cantidadPedida[l.producto_id] || 0) + (Number(l.cantidad) || 0);
  });
  Object.entries(cantidadPedida).forEach(([productoId, cantidad]) => {
    const exist = DB.inventario.existencias.find((e) => e.producto_id === Number(productoId) && e.sucursal_id === sucursal_id);
    const disponible = exist ? exist.cantidad_actual : 0;
    if (cantidad > disponible) {
      const producto = DB["catalogo-productos"].productos.find((p) => p.id === Number(productoId));
      throw new Error(`No hay existencia suficiente de "${producto?.nombre || "producto"}" (disponible: ${disponible}, solicitado: ${cantidad})`);
    }
  });

  const nuevoId = siguienteId(DB.pos.ventas);
  const subtotal = datos.lineas.reduce((a, l) => a + Number(l.cantidad) * Number(l.precio_unitario), 0);
  const descuento = datos.lineas.reduce((a, l) => a + (Number(l.cantidad) * Number(l.precio_unitario) * (Number(l.descuento_pct) || 0)) / 100, 0);
  const total = Math.round((subtotal - descuento) * 100) / 100;
  const fechaHoy = hoy();
  const fechaLimiteObj = new Date();
  fechaLimiteObj.setDate(fechaLimiteObj.getDate() + DIAS_LIMITE_APARTADO);

  const venta = {
    id: nuevoId,
    fecha: fechaHoy,
    fecha_hora: new Date().toISOString(),
    sucursal_id,
    vendedor_id: datos.vendedor_id ? Number(datos.vendedor_id) : null,
    cliente_id,
    tipo_documento: "Apartado",
    metodo_pago: "MIXTO",
    subtotal: Math.round(subtotal * 100) / 100,
    descuento: Math.round(descuento * 100) / 100,
    total,
    estatus: "apartado",
    motivo_cancelacion: null,
    fecha_limite: fechaLimiteObj.toISOString().slice(0, 10),
    fecha_liquidacion: null,
  };
  DB.pos.ventas.push(venta);

  let siguienteDetalleId = siguienteId(DB.pos.venta_detalle);
  datos.lineas.forEach((l) => {
    const cantidad = Number(l.cantidad) || 0;
    const precio = Number(l.precio_unitario) || 0;
    const descPct = Number(l.descuento_pct) || 0;
    DB.pos.venta_detalle.push({
      id: siguienteDetalleId++,
      venta_id: nuevoId,
      producto_id: l.producto_id ?? null,
      descripcion: l.descripcion || null,
      cantidad,
      precio_unitario: precio,
      descuento: descPct,
      subtotal: Math.round(cantidad * precio * (1 - descPct / 100) * 100) / 100,
    });

    if (l.producto_id) {
      try {
        ajustarExistencia(DB, l.producto_id, { cantidad: -cantidad, motivo: `Apartado — folio ${nuevoId}`, sucursal_id });
      } catch (e) { /* si no existe registro de existencia en esta sucursal, no detiene el apartado */ }
    }
  });

  const nuevoAbonoId = siguienteId(DB.pos.apartado_abonos);
  DB.pos.apartado_abonos.push({
    id: nuevoAbonoId,
    venta_id: nuevoId,
    sucursal_id,
    fecha: fechaHoy,
    fecha_hora: new Date().toISOString(),
    monto: Math.round(anticipoMonto * 100) / 100,
    forma_pago: String(datos.anticipo_forma_pago).toUpperCase(),
    usuario_nombre: usuario?.nombre || "—",
  });

  return venta;
}

function registrarAbono(DB, ventaId, datos, usuario) {
  const venta = DB.pos.ventas.find((v) => v.id === Number(ventaId));
  if (!venta || venta.tipo_documento !== "Apartado") throw new Error("Apartado no encontrado");
  if (venta.estatus !== "apartado") throw new Error("Este apartado ya no está vigente");

  const monto = Number(datos.monto);
  if (!monto || monto <= 0) throw new Error("El monto del abono debe ser mayor a $0");
  if (!datos.forma_pago) throw new Error("Selecciona la forma de pago del abono");

  const saldo = saldoPendiente(DB, venta);
  if (monto > saldo) throw new Error(`El abono ($${monto.toFixed(2)}) no puede ser mayor al saldo pendiente ($${saldo.toFixed(2)})`);

  const nuevoAbonoId = siguienteId(DB.pos.apartado_abonos);
  DB.pos.apartado_abonos.push({
    id: nuevoAbonoId,
    venta_id: venta.id,
    sucursal_id: venta.sucursal_id,
    fecha: hoy(),
    fecha_hora: new Date().toISOString(),
    monto: Math.round(monto * 100) / 100,
    forma_pago: String(datos.forma_pago).toUpperCase(),
    usuario_nombre: usuario?.nombre || "—",
  });

  if (saldoPendiente(DB, venta) <= 0) {
    liquidarApartado(DB, venta.id);
  }

  return DB.pos.ventas.find((v) => v.id === venta.id);
}

function liquidarApartado(DB, ventaId) {
  const venta = DB.pos.ventas.find((v) => v.id === Number(ventaId));
  if (!venta || venta.tipo_documento !== "Apartado") throw new Error("Apartado no encontrado");
  if (venta.estatus !== "apartado") throw new Error("Este apartado ya no está vigente");
  venta.estatus = "cerrada";
  venta.fecha_liquidacion = hoy();
  return venta;
}

function cancelarApartado(DB, ventaId, motivo) {
  const venta = DB.pos.ventas.find((v) => v.id === Number(ventaId));
  if (!venta || venta.tipo_documento !== "Apartado") throw new Error("Apartado no encontrado");
  if (venta.estatus !== "apartado") throw new Error("Este apartado ya no está vigente");

  const yaAbonado = sumaAbonos(DB, venta.id);

  venta.estatus = "cancelada";
  venta.motivo_cancelacion = motivo || "Cancelado";

  DB.pos.venta_detalle
    .filter((d) => d.venta_id === venta.id)
    .forEach((l) => {
      if (l.producto_id) {
        try {
          ajustarExistencia(DB, l.producto_id, { cantidad: Number(l.cantidad), motivo: `Cancelación de apartado — folio ${venta.id}`, sucursal_id: venta.sucursal_id });
        } catch (e) { /* si no existe existencia, no detiene la cancelación */ }
      }
    });

  if (yaAbonado > 0) {
    const cliente = DB.crm.clientes.find((c) => c.id === venta.cliente_id);
    if (cliente) cliente.monedero = Math.round(((cliente.monedero || 0) + yaAbonado) * 100) / 100;
  }

  return venta;
}

function procesarVencimientos(DB) {
  const fechaHoy = hoy();
  DB.pos.ventas
    .filter((v) => v.tipo_documento === "Apartado" && v.estatus === "apartado" && v.fecha_limite < fechaHoy)
    .forEach((v) => cancelarApartado(DB, v.id, "Vencido — 60 días sin liquidar"));
}

function listarApartados(DB, alcance) {
  procesarVencimientos(DB);
  let lista = DB.pos.ventas.filter((v) => v.tipo_documento === "Apartado" && v.estatus === "apartado");
  if (alcance && !alcance.verTodas) lista = lista.filter((v) => v.sucursal_id === alcance.sucursalId);

  return lista
    .map((v) => {
      const cliente = DB.crm.clientes.find((c) => c.id === v.cliente_id);
      return {
        ...v,
        cliente_nombre: cliente ? cliente.nombre : "—",
        saldo_pendiente: saldoPendiente(DB, v),
        dias_restantes: diasEntre(hoy(), v.fecha_limite),
        abonos: DB.pos.apartado_abonos
          .filter((a) => a.venta_id === v.id)
          .sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora)),
      };
    })
    .sort((a, b) => a.dias_restantes - b.dias_restantes);
}

function obtenerApartadosProximosAVencer(DB, alcance) {
  procesarVencimientos(DB);
  let lista = DB.pos.ventas.filter((v) => v.tipo_documento === "Apartado" && v.estatus === "apartado");
  if (alcance && !alcance.verTodas) lista = lista.filter((v) => v.sucursal_id === alcance.sucursalId);

  return lista
    .map((v) => ({ ...v, dias_restantes: diasEntre(hoy(), v.fecha_limite) }))
    .filter((v) => v.dias_restantes <= DIAS_AVISO_POR_VENCER)
    .filter((v) => !DB.crm.contactos_cliente.some((c) => c.venta_id === v.id && c.tipo === "apartado_por_vencer"))
    .map((v) => {
      const cliente = DB.crm.clientes.find((c) => c.id === v.cliente_id);
      if (!cliente) return null;
      return {
        venta_id: v.id,
        cliente_id: cliente.id,
        cliente_nombre: cliente.nombre,
        telefono: cliente.telefono,
        dias_restantes: v.dias_restantes,
        saldo_pendiente: saldoPendiente(DB, v),
        total: v.total,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dias_restantes - b.dias_restantes);
}

module.exports = {
  crearApartado, registrarAbono, liquidarApartado, cancelarApartado,
  procesarVencimientos, listarApartados, obtenerApartadosProximosAVencer,
  saldoPendiente,
};
```

- [ ] **Step 6: Correr las pruebas para verificar que pasan**

Run: `cd backend && npx node --test apartados.test.js`
Expected: 13 pruebas, todas PASS.

- [ ] **Step 7: Exponer las rutas en `server.js` y el guard en cancelar venta**

Agregar el import (junto a los demás requires de módulos backend):

```js
const {
  crearApartado, registrarAbono, cancelarApartado, listarApartados, obtenerApartadosProximosAVencer,
} = require("./apartados");
```

Agregar las rutas nuevas (junto a las rutas de `/api/ventas`):

```js
// ---------- Apartados ----------
app.get("/api/apartados", requiereLogin, requierePermiso("gestionar_apartados", resolverPermisosDeRol), (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(listarApartados(DB, alcance));
});
app.post("/api/apartados", requiereLogin, requierePermiso("gestionar_apartados", resolverPermisosDeRol), (req, res) => {
  try {
    const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
    const sucursal_id = alcance.verTodas ? (Number(req.body.sucursal_id) || 1) : alcance.sucursalId;
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(crearApartado(DB, req.body, sucursal_id, usuario));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/apartados/:id/abonos", requiereLogin, requierePermiso("gestionar_apartados", resolverPermisosDeRol), (req, res) => {
  try {
    const usuario = { id: req.usuarioToken.id, nombre: req.usuarioToken.nombre };
    res.json(registrarAbono(DB, req.params.id, req.body, usuario));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put("/api/apartados/:id/cancelar", requiereLogin, requierePermiso("gestionar_apartados", resolverPermisosDeRol), (req, res) => {
  try {
    res.json(cancelarApartado(DB, req.params.id, req.body.motivo));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

Modificar la ruta existente `PUT /api/ventas/:id/cancelar` para delegar a `cancelarApartado` cuando el documento sea un Apartado (así el reintegro al monedero nunca se pierde, sin importar desde qué pantalla se cancele):

```js
app.put("/api/ventas/:id/cancelar", requiereLogin, requierePermiso("cancelar_ventas", resolverPermisosDeRol), (req, res) => {
  try {
    const venta = DB.pos.ventas.find((v) => v.id === Number(req.params.id));
    const alcance = resolverAlcance(req);
    if (venta && !dentroDeAlcance(venta.sucursal_id, alcance)) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }
    if (venta && venta.tipo_documento === "Apartado") {
      return res.json(cancelarApartado(DB, req.params.id, req.body.motivo));
    }
    res.json(cancelarVenta(DB, req.params.id, req.body.motivo));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
```

- [ ] **Step 8: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: 326/326 pruebas PASS (313 previas + 13 nuevas de `apartados.test.js`).

- [ ] **Step 9: Commit**

```bash
git add backend/permisosCatalogo.js backend/server.js backend/testHelpers.js backend/apartados.js backend/apartados.test.js
git commit -m "feat: add Apartados backend module (crear/abonar/liquidar/cancelar/vencimiento)"
```

---

### Task 2: Integración con Corte de Caja

**Files:**
- Modify: `backend/cortes.js`
- Create: `backend/apartadosCorteCaja.test.js`

**Interfaces:**
- Consumes: `DB.pos.apartado_abonos` (de Task 1).
- Produces: `calcularCorteEnCurso` ahora incluye los abonos de apartados del turno en `calculado`/`transferencias`/`credito`, y excluye por completo las ventas con `tipo_documento === "Apartado"` de su cálculo por `venta.total` (para no duplicar dinero cuando el apartado se liquide).

- [ ] **Step 1: Escribir las pruebas**

Crear `backend/apartadosCorteCaja.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { calcularCorteEnCurso } = require("./cortes");
const { crearApartado, registrarAbono } = require("./apartados");

test("calcularCorteEnCurso: los abonos de un apartado se suman al calculado por su propia forma de pago", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 20,
    anticipo_forma_pago: "EFECTIVO",
  }, 1, { nombre: "Ana" });

  const corte = calcularCorteEnCurso(DB, 1);
  assert.strictEqual(corte.calculado.EFECTIVO, 20);
});

test("calcularCorteEnCurso: NO duplica dinero cuando un apartado se liquida en el mismo turno", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 2, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 20,
    anticipo_forma_pago: "EFECTIVO",
  }, 1, { nombre: "Ana" });
  registrarAbono(DB, venta.id, { monto: 30, forma_pago: "TARJETA" }, { nombre: "Ana" }); // liquida (total $50)

  const corte = calcularCorteEnCurso(DB, 1);
  // Solo deben contarse los DOS abonos (20 + 30) — nunca el venta.total ($50) por separado.
  assert.strictEqual(corte.calculado.EFECTIVO, 20);
  assert.strictEqual(corte.calculado.TARJETA, 30);
  assert.strictEqual(corte.total_calculado, 50);
});

test("calcularCorteEnCurso: un abono en TRANSFERENCIA se suma a transferencias, no a calculado", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 15,
    anticipo_forma_pago: "TRANSFERENCIA",
  }, 1, { nombre: "Ana" });

  const corte = calcularCorteEnCurso(DB, 1);
  assert.strictEqual(corte.transferencias, 15);
  assert.strictEqual(corte.calculado.EFECTIVO, 0);
});

test("calcularCorteEnCurso: respeta la sucursal — no mezcla abonos de otra sucursal", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, {
    cliente_id: 2,
    lineas: [{ producto_id: 2, cantidad: 1, precio_unitario: 16, descuento_pct: 0 }],
    anticipo_monto: 10,
    anticipo_forma_pago: "EFECTIVO",
  }, 2, { nombre: "María" });

  const corte = calcularCorteEnCurso(DB, 1);
  assert.strictEqual(corte.calculado.EFECTIVO, 0);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `cd backend && npx node --test apartadosCorteCaja.test.js`
Expected: FAIL — el segundo test falla porque hoy `calcularCorteEnCurso` sumaría también el `venta.total` completo de la venta liquidada (metodo_pago `"MIXTO"` cae al `else` de efectivo), duplicando el dinero.

- [ ] **Step 3: Modificar `backend/cortes.js`**

Reemplazar `ventasDelTurno` (agregar la exclusión de Apartados):

```js
/** Ventas del turno en curso: cerradas, de la sucursal, posteriores al último corte.
 *  Excluye Apartados — su dinero se cuenta por abono real (ver abonosDelTurno),
 *  nunca por el total completo de la venta, para no duplicarlo al liquidarse. */
function ventasDelTurno(DB, sucursal_id) {
  const cortes = DB.pos.cortes_caja.filter((c) => c.sucursal_id === Number(sucursal_id));
  const ultimoCorte = cortes.length ? cortes.reduce((a, b) => (a.fecha_hora > b.fecha_hora ? a : b)) : null;
  const desde = ultimoCorte ? ultimoCorte.fecha_hora : null;

  return {
    desde,
    ventas: DB.pos.ventas.filter(
      (v) =>
        v.estatus === "cerrada" &&
        v.tipo_documento !== "Apartado" &&
        v.sucursal_id === Number(sucursal_id) &&
        (!desde || fechaHoraDeVenta(v) > desde)
    ),
  };
}

/** Abonos de apartados (incluye el anticipo) del turno en curso de esta sucursal. */
function abonosDelTurno(DB, sucursal_id, desde) {
  return DB.pos.apartado_abonos.filter(
    (a) => a.sucursal_id === Number(sucursal_id) && (!desde || a.fecha_hora > desde)
  );
}

/** Suma `monto` a `calculado[forma]` si es una de las 4 formas físicas del
 *  corte; si no, regresa el delta correspondiente a transferencias/crédito
 *  (o cae a EFECTIVO si la forma no se reconoce) — mismo criterio que ya
 *  usaba calcularCorteEnCurso para ventas, ahora compartido con abonos. */
function acumularPorFormaPago(calculado, forma, monto) {
  if (calculado[forma] !== undefined) {
    calculado[forma] += monto;
    return { transferencias: 0, credito: 0 };
  }
  if (forma === "TRANSFERENCIA") return { transferencias: monto, credito: 0 };
  if (forma === "CRÉDITO" || forma === "CREDITO") return { transferencias: 0, credito: monto };
  calculado.EFECTIVO += monto;
  return { transferencias: 0, credito: 0 };
}
```

Reemplazar `calcularCorteEnCurso` completo:

```js
/** Lo que el sistema calcula que debería haber en caja, por forma de pago */
function calcularCorteEnCurso(DB, sucursal_id) {
  const { desde, ventas } = ventasDelTurno(DB, sucursal_id);
  const abonos = abonosDelTurno(DB, sucursal_id, desde);

  const calculado = { EFECTIVO: 0, CHEQUE: 0, VALES: 0, TARJETA: 0 };
  let transferencias = 0;
  let credito = 0;

  ventas.forEach((v) => {
    const r = acumularPorFormaPago(calculado, (v.metodo_pago || "EFECTIVO").toUpperCase(), v.total);
    transferencias += r.transferencias;
    credito += r.credito;
  });
  abonos.forEach((a) => {
    const r = acumularPorFormaPago(calculado, (a.forma_pago || "EFECTIVO").toUpperCase(), a.monto);
    transferencias += r.transferencias;
    credito += r.credito;
  });

  const redondear = (n) => Math.round(n * 100) / 100;
  FORMAS_CORTE.forEach((f) => (calculado[f] = redondear(calculado[f])));

  return {
    desde,
    ventas_incluidas: ventas.length,
    abonos_incluidos: abonos.length,
    calculado,
    total_calculado: redondear(FORMAS_CORTE.reduce((a, f) => a + calculado[f], 0)),
    transferencias: redondear(transferencias),
    credito: redondear(credito),
  };
}
```

Actualizar `filtrarCorteEnCursoPorPermiso` para que también oculte `abonos_incluidos` cuando el usuario no tiene `ver_montos_corte`:

```js
function filtrarCorteEnCursoPorPermiso(resultado, permisos) {
  if (Array.isArray(permisos) && permisos.includes("ver_montos_corte")) return resultado;
  const calculadoEnCero = {};
  FORMAS_CORTE.forEach((f) => (calculadoEnCero[f] = 0));
  return {
    desde: resultado.desde,
    ventas_incluidas: 0,
    abonos_incluidos: 0,
    calculado: calculadoEnCero,
    total_calculado: 0,
    transferencias: 0,
    credito: 0,
  };
}
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `cd backend && npx node --test apartadosCorteCaja.test.js`
Expected: 4 pruebas, todas PASS.

- [ ] **Step 5: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: 330/330 pruebas PASS (326 previas + 4 nuevas).

- [ ] **Step 6: Commit**

```bash
git add backend/cortes.js backend/apartadosCorteCaja.test.js
git commit -m "feat: count apartado abonos (not the full sale total) toward Corte de Caja"
```

---

### Task 3: Integración con Reportes (backend)

**Files:**
- Modify: `backend/reportes.js`
- Modify: `backend/reportes.test.js`

**Interfaces:**
- Consumes: `DB.pos.apartado_abonos` (Task 1).
- Produces: `reporteVentas` ahora excluye ventas con `estatus: "apartado"` (pendientes) de todo el reporte, agrega `fecha_liquidacion` a cada fila de `general`, y agrega un arreglo nuevo `abonos` al objeto de retorno. `reporteUtilidad` excluye igual los apartados pendientes. `reporteMovimientosCaja` excluye el total de las ventas-Apartado de `entradas` y en su lugar suma los abonos del rango. `reporteEstadoCuentaClientes` agrega `monedero` a cada fila.

- [ ] **Step 1: Escribir las pruebas nuevas**

Agregar a `backend/reportes.test.js`:

```js
const { crearApartado, registrarAbono } = require("./apartados");

test("reporteVentas: un apartado pendiente (sin liquidar) no aparece en ningún lado del reporte", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 10,
    anticipo_forma_pago: "EFECTIVO",
  }, 1, { nombre: "Ana" });

  const r = reporteVentas(DB, { fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31" }, ALCANCE_TODAS);
  assert.ok(!r.general.some((f) => f.tipo_documento === "Apartado"), "no debe aparecer mientras está pendiente");
});

test("reporteVentas: un apartado liquidado aparece como venta cerrada, con fecha_liquidacion", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 10,
    anticipo_forma_pago: "EFECTIVO",
  }, 1, { nombre: "Ana" });
  registrarAbono(DB, venta.id, { monto: 15, forma_pago: "TARJETA" }, { nombre: "Ana" }); // liquida ($25)

  const r = reporteVentas(DB, { fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31" }, ALCANCE_TODAS);
  const fila = r.general.find((f) => f.id === venta.id);
  assert.ok(fila, "debe aparecer una vez liquidado");
  assert.strictEqual(fila.estatus, "cerrada");
  assert.strictEqual(fila.tipo_documento, "Apartado");
  assert.ok(fila.fecha_liquidacion);
  assert.ok(r.totales.total_vigente >= 25);
});

test("reporteVentas: filtro tipo_documento='Apartado' aísla solo los apartados ya liquidados", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 25,
    anticipo_forma_pago: "EFECTIVO",
  }, 1, { nombre: "Ana" }); // anticipo cubre el total → liquida de inmediato

  const r = reporteVentas(DB, { fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", tipo_documento: "Apartado" }, ALCANCE_TODAS);
  assert.strictEqual(r.general.length, 1);
  assert.strictEqual(r.general[0].id, venta.id);
});

test("reporteVentas: incluye un arreglo de abonos con el detalle de cada pago parcial", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 2, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 20,
    anticipo_forma_pago: "EFECTIVO",
  }, 1, { nombre: "Ana" });
  registrarAbono(DB, venta.id, { monto: 10, forma_pago: "TARJETA" }, { nombre: "Ana" });

  const r = reporteVentas(DB, { fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31" }, ALCANCE_TODAS);
  assert.strictEqual(r.abonos.length, 2);
  assert.strictEqual(r.abonos[0].monto, 20);
  assert.strictEqual(r.abonos[0].forma_pago, "EFECTIVO");
  assert.strictEqual(r.abonos[1].monto, 10);
  assert.strictEqual(r.abonos[1].forma_pago, "TARJETA");
  assert.strictEqual(r.abonos[0].cliente_nombre, "Abarrotes Mary");
});

test("reporteUtilidad: un apartado pendiente no cuenta como utilidad hasta liquidarse", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 10,
    anticipo_forma_pago: "EFECTIVO",
  }, 1, { nombre: "Ana" });

  const r = reporteUtilidad(DB, { fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31" }, ALCANCE_TODAS);
  assert.strictEqual(r.totales.venta, 0, "el apartado sigue pendiente, no debe sumar utilidad todavía");
});

test("reporteMovimientosCaja: los abonos de un apartado entran como entradas por su propia forma de pago", () => {
  const DB = construirDBPrueba();
  crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 12,
    anticipo_forma_pago: "TARJETA",
  }, 1, { nombre: "Ana" });

  const r = reporteMovimientosCaja(DB, { fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31" }, ALCANCE_TODAS);
  const tarjeta = r.entradas.find((f) => f.forma_pago === "TARJETA");
  assert.ok(tarjeta);
  assert.strictEqual(tarjeta.total, 12);
});

test("reporteMovimientosCaja: NO duplica el dinero cuando el apartado se liquida en el rango consultado", () => {
  const DB = construirDBPrueba();
  const venta = crearApartado(DB, {
    cliente_id: 1,
    lineas: [{ producto_id: 1, cantidad: 2, precio_unitario: 25, descuento_pct: 0 }],
    anticipo_monto: 20,
    anticipo_forma_pago: "EFECTIVO",
  }, 1, { nombre: "Ana" });
  registrarAbono(DB, venta.id, { monto: 30, forma_pago: "TARJETA" }, { nombre: "Ana" }); // liquida ($50)

  const r = reporteMovimientosCaja(DB, { fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31" }, ALCANCE_TODAS);
  assert.strictEqual(r.totales.total_entradas, 50, "solo los dos abonos (20+30), nunca también el total de la venta");
});

test("reporteEstadoCuentaClientes: incluye el saldo de monedero de cada cliente", () => {
  const DB = construirDBPrueba();
  DB.crm.clientes.find((c) => c.id === 1).monedero = 75;
  const r = reporteEstadoCuentaClientes(DB, {}, ALCANCE_TODAS);
  const fila = r.filas.find((f) => f.id === 1);
  assert.strictEqual(fila.monedero, 75);
});
```

- [ ] **Step 2: Correr las pruebas para verificar que fallan**

Run: `cd backend && npx node --test reportes.test.js`
Expected: FAIL en los 9 casos nuevos (los apartados pendientes hoy sí aparecerían como "vigentes" en Ventas/Utilidad, `r.abonos` no existe, `reporteMovimientosCaja` duplicaría el total de la venta liquidada, y `monedero` no está en `reporteEstadoCuentaClientes`).

- [ ] **Step 3: Modificar `backend/reportes.js`**

Al inicio del archivo, agregar el import de `filtrarPorSucursal` ya existe — no cambia. Agregar esta línea al filtro de `reporteVentas` (justo después del filtro de `enRango`, antes de los filtros opcionales de `vendedor_id`/`cliente_id`/`tipo_documento`):

```js
function reporteVentas(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, vendedor_id, cliente_id, tipo_documento } = filtros;
  let ventas = filtrarPorSucursal(DB.pos.ventas, alcance)
    .filter((v) => v.estatus !== "apartado")
    .filter((v) => enRango(v.fecha, fecha_inicio, fecha_fin));
```

(la única línea nueva es `.filter((v) => v.estatus !== "apartado")` — el resto de la función sigue exactamente igual).

En el `map` que arma `general`, agregar `fecha_liquidacion`:

```js
  const general = ventas.map((v) => ({
    id: v.id, fecha: v.fecha, sucursal_nombre: nombreSucursal(v.sucursal_id),
    cliente_nombre: nombreCliente(v.cliente_id), vendedor_nombre: nombreVendedor(v.vendedor_id),
    tipo_documento: v.tipo_documento || "Ticket", estatus: v.estatus, total: v.total,
    fecha_liquidacion: v.fecha_liquidacion || null,
  })).sort((a, b) => a.fecha.localeCompare(b.fecha));
```

Antes del `return` de `reporteVentas`, agregar el cálculo de `abonos`:

```js
  const abonos = filtrarPorSucursal(DB.pos.apartado_abonos, alcance)
    .filter((a) => enRango(a.fecha, fecha_inicio, fecha_fin))
    .map((a) => {
      const ventaDelAbono = DB.pos.ventas.find((v) => v.id === a.venta_id);
      return {
        id: a.id,
        fecha: a.fecha,
        venta_id: a.venta_id,
        cliente_nombre: ventaDelAbono ? nombreCliente(ventaDelAbono.cliente_id) : "—",
        monto: a.monto,
        forma_pago: a.forma_pago,
      };
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  return {
    general, canceladas, porArticulo, porVendedor, abonos,
    totales: {
      numero_ventas: vigentes.length,
      total_vigente: redondear(vigentes.reduce((a, f) => a + f.total, 0)),
      total_cancelado: redondear(canceladas.reduce((a, f) => a + f.total, 0)),
    },
  };
}
```

(reemplaza el `return` existente de `reporteVentas` — solo se agrega `abonos` al cálculo previo y al objeto de retorno).

En `reporteUtilidad`, cambiar el filtro de ventas de `!== "cancelada"` a `=== "cerrada"` (así excluye tanto canceladas como apartados pendientes con un solo cambio):

```js
function reporteUtilidad(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin, vendedor_id } = filtros;
  let ventas = filtrarPorSucursal(DB.pos.ventas, alcance)
    .filter((v) => v.estatus === "cerrada")
    .filter((v) => enRango(v.fecha, fecha_inicio, fecha_fin));
```

En `reporteMovimientosCaja`, cambiar el filtro de ventas y agregar la suma de abonos:

```js
function reporteMovimientosCaja(DB, filtros, alcance) {
  const { fecha_inicio, fecha_fin } = filtros;
  const ventas = filtrarPorSucursal(DB.pos.ventas, alcance)
    .filter((v) => v.estatus === "cerrada")
    .filter((v) => v.tipo_documento !== "Apartado")
    .filter((v) => enRango(v.fecha, fecha_inicio, fecha_fin));

  const entradasMapa = new Map();
  ventas.forEach((v) => {
    const forma = (v.metodo_pago || "EFECTIVO").toUpperCase();
    const actual = entradasMapa.get(forma) || { forma_pago: forma, total: 0 };
    actual.total += v.total;
    entradasMapa.set(forma, actual);
  });

  const abonosDelRango = filtrarPorSucursal(DB.pos.apartado_abonos, alcance)
    .filter((a) => enRango(a.fecha, fecha_inicio, fecha_fin));
  abonosDelRango.forEach((a) => {
    const forma = (a.forma_pago || "EFECTIVO").toUpperCase();
    const actual = entradasMapa.get(forma) || { forma_pago: forma, total: 0 };
    actual.total += a.monto;
    entradasMapa.set(forma, actual);
  });

  const entradas = [...entradasMapa.values()]
    .map((f) => ({ ...f, total: redondear(f.total) }))
    .sort((a, b) => b.total - a.total);
```

(el resto de `reporteMovimientosCaja` — cálculo de `salidas` y `totales` — no cambia).

En `reporteEstadoCuentaClientes`, agregar `monedero` a cada fila:

```js
  const filas = clientes.map((c) => ({
    id: c.id, clave: c.clave || "", nombre: c.nombre,
    limite_credito: Number(c.limite_credito) || 0, saldo: Number(c.saldo) || 0,
    credito_disponible: Math.max(0, (Number(c.limite_credito) || 0) - (Number(c.saldo) || 0)),
    monedero: Number(c.monedero) || 0,
  })).sort((a, b) => a.nombre.localeCompare(b.nombre));
```

- [ ] **Step 4: Correr las pruebas para verificar que pasan**

Run: `cd backend && npx node --test reportes.test.js`
Expected: todas las pruebas del archivo PASS (las previas + las 9 nuevas de este task).

- [ ] **Step 5: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: 339/339 pruebas PASS (330 previas + 9 nuevas).

- [ ] **Step 6: Commit**

```bash
git add backend/reportes.js backend/reportes.test.js
git commit -m "feat: integrate apartados into Reporte de Ventas/Utilidad/Movimientos de Caja and Estado de Cuenta"
```

---

### Task 4: Integración con Reportes (frontend)

**Files:**
- Modify: `src/reportes/ReporteVentas.jsx`
- Modify: `src/reportes/ReporteEstadoCuentaClientes.jsx`

**Interfaces:**
- Consumes: `abonos` y `fecha_liquidacion` de `reporteVentas` (Task 3); `monedero` de `reporteEstadoCuentaClientes` (Task 3).

- [ ] **Step 1: `ReporteVentas.jsx` — filtro de Documento**

Agregar la constante de tipos de documento (después de las constantes `hoyFmt`/`hace30`, antes de `TABS`):

```jsx
const TIPOS_DOCUMENTO = ["Todos", "Ticket", "Factura", "Nota de Venta", "Factura CFDI", "Remisión", "Apartado"];
```

Agregar `"Abonos"` al arreglo `TABS`:

```jsx
const TABS = [
  { id: "general", etiqueta: "General" },
  { id: "porArticulo", etiqueta: "Por Artículo" },
  { id: "porVendedor", etiqueta: "Por Vendedor" },
  { id: "canceladas", etiqueta: "Canceladas" },
  { id: "abonos", etiqueta: "Abonos" },
];
```

Agregar el estado `documentoFiltro` (junto a los demás `useState` del componente):

```jsx
  const [documentoFiltro, setDocumentoFiltro] = useState("Todos");
```

En `consultar`, incluir el filtro en la query (junto a los demás `params.set`):

```jsx
      if (documentoFiltro !== "Todos") params.set("tipo_documento", documentoFiltro);
```

Y agregar `documentoFiltro` al arreglo de dependencias de `useCallback` de `consultar`:

```jsx
  }, [fechaInicial, fechaFinal, sucursalId, vendedorId, documentoFiltro]);
```

Agregar el selector de Documento dentro del `hijos` de `FiltroReporte` (junto al selector de Vendedor existente):

```jsx
        hijos={
          <>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Documento</label>
              <select value={documentoFiltro} onChange={(e) => setDocumentoFiltro(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                {TIPOS_DOCUMENTO.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Vendedor</label>
              <select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
                <option value="">Todos</option>
                {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            </div>
          </>
        }
```

(nota: `hijos` ahora recibe dos `<div>` — hay que envolverlos en un fragmento `<>...</>` como se muestra, ya que `FiltroReporte` solo espera un nodo).

- [ ] **Step 2: `ReporteVentas.jsx` — columna Fecha Liquidación y pestaña Abonos**

En la tabla de `general`, agregar la columna "Fecha Liquidación" (después de la columna "Fecha", en el `<thead>` y en cada `<tr>` del `<tbody>`):

```jsx
              <tr>
                <th className="py-2 px-3 text-left font-medium">Fecha</th>
                <th className="py-2 px-3 text-left font-medium">Fecha Liquidación</th>
                <th className="py-2 px-3 text-left font-medium">Folio</th>
                <th className="py-2 px-3 text-left font-medium">Sucursal</th>
                <th className="py-2 px-3 text-left font-medium">Documento</th>
                <th className="py-2 px-3 text-left font-medium">Cliente</th>
                <th className="py-2 px-3 text-left font-medium">Vendedor</th>
                <th className="py-2 px-3 text-center font-medium">Estado</th>
                <th className="py-2 px-3 text-right font-medium">Total</th>
              </tr>
```

```jsx
              {datos.general.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-16">Sin resultados</td></tr>}
              {datos.general.map((f) => (
                <tr key={f.id} className={`border-b border-slate-100 ${f.estatus === "cancelada" ? "opacity-50" : ""}`}>
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 text-slate-400">{f.fecha_liquidacion || "—"}</td>
                  <td className="py-2 px-3 font-medium">{f.id}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.tipo_documento}</td>
                  <td className="py-2 px-3">{f.cliente_nombre}</td>
                  <td className="py-2 px-3">{f.vendedor_nombre}</td>
                  <td className="py-2 px-3 text-center">{f.estatus === "cancelada" ? "Cancelada" : "Cerrada"}</td>
                  <td className="py-2 px-3 text-right font-medium">${Number(f.total).toFixed(2)}</td>
                </tr>
              ))}
```

(`colSpan` sube de 8 a 9 por la columna nueva).

Agregar el render de la pestaña "abonos" — insertar un nuevo bloque `tab === "abonos" ? (...)` entre el de `"canceladas"` (el `else` final actual) y el cierre del ternario. El bloque final queda:

```jsx
        ) : tab === "canceladas" ? (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Fecha</th><th className="py-2 px-3 text-left font-medium">Folio</th><th className="py-2 px-3 text-left font-medium">Sucursal</th><th className="py-2 px-3 text-left font-medium">Cliente</th><th className="py-2 px-3 text-left font-medium">Vendedor</th><th className="py-2 px-3 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {datos.canceladas.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-16">Sin canceladas</td></tr>}
              {datos.canceladas.map((f) => (
                <tr key={f.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{f.fecha}</td>
                  <td className="py-2 px-3 font-medium">{f.id}</td>
                  <td className="py-2 px-3">{f.sucursal_nombre}</td>
                  <td className="py-2 px-3">{f.cliente_nombre}</td>
                  <td className="py-2 px-3">{f.vendedor_nombre}</td>
                  <td className="py-2 px-3 text-right font-medium">${Number(f.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#1a7fe8] text-white sticky top-0">
              <tr><th className="py-2 px-3 text-left font-medium">Fecha</th><th className="py-2 px-3 text-left font-medium">Folio Apartado</th><th className="py-2 px-3 text-left font-medium">Cliente</th><th className="py-2 px-3 text-left font-medium">Forma de Pago</th><th className="py-2 px-3 text-right font-medium">Monto</th></tr>
            </thead>
            <tbody>
              {datos.abonos.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-16">Sin abonos en el rango</td></tr>}
              {datos.abonos.map((a) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{a.fecha}</td>
                  <td className="py-2 px-3 font-medium">{a.venta_id}</td>
                  <td className="py-2 px-3">{a.cliente_nombre}</td>
                  <td className="py-2 px-3">{a.forma_pago}</td>
                  <td className="py-2 px-3 text-right font-medium">${Number(a.monto).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
```

(nota: cambia el `else` genérico anterior — que asumía que "no es general/porArticulo/porVendedor, entonces es canceladas" — por un `tab === "canceladas"` explícito seguido de un `else` nuevo para `"abonos"`, ya que ahora hay una cuarta variante).

- [ ] **Step 3: `ReporteVentas.jsx` — exportar Excel de la pestaña Abonos**

En `exportarExcel`, agregar el caso `abonos` (antes del `else` final que hoy cubre "canceladas" — convertirlo en un `else if` explícito y agregar el nuevo `else` para abonos):

```jsx
  const exportarExcel = () => {
    if (!datos) return;
    if (tab === "general") {
      descargarCSV(`ventas_general_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Fecha Liquidación", "Folio", "Sucursal", "Documento", "Cliente", "Vendedor", "Estado", "Total"],
        datos.general.map((f) => [f.fecha, f.fecha_liquidacion || "", f.id, f.sucursal_nombre, f.tipo_documento, f.cliente_nombre, f.vendedor_nombre, f.estatus, f.total]));
    } else if (tab === "porArticulo") {
      descargarCSV(`ventas_por_articulo_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Producto", "Cantidad", "Importe"], datos.porArticulo.map((f) => [f.producto, f.cantidad, f.importe]));
    } else if (tab === "porVendedor") {
      descargarCSV(`ventas_por_vendedor_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Vendedor", "No. Ventas", "Total"], datos.porVendedor.map((f) => [f.vendedor, f.numero_ventas, f.total]));
    } else if (tab === "canceladas") {
      descargarCSV(`ventas_canceladas_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Folio", "Sucursal", "Cliente", "Vendedor", "Total"],
        datos.canceladas.map((f) => [f.fecha, f.id, f.sucursal_nombre, f.cliente_nombre, f.vendedor_nombre, f.total]));
    } else {
      descargarCSV(`ventas_abonos_${fechaInicial}_a_${fechaFinal}.csv`,
        ["Fecha", "Folio Apartado", "Cliente", "Forma de Pago", "Monto"],
        datos.abonos.map((a) => [a.fecha, a.venta_id, a.cliente_nombre, a.forma_pago, a.monto]));
    }
  };
```

- [ ] **Step 4: `ReporteEstadoCuentaClientes.jsx` — columna Monedero**

Agregar la columna al `<thead>` (después de "Disponible"):

```jsx
              <tr>
                <th className="py-2 px-3 text-left font-medium">Clave</th>
                <th className="py-2 px-3 text-left font-medium">Nombre</th>
                <th className="py-2 px-3 text-right font-medium">Límite</th>
                <th className="py-2 px-3 text-right font-medium">Saldo</th>
                <th className="py-2 px-3 text-right font-medium">Disponible</th>
                <th className="py-2 px-3 text-right font-medium">Monedero</th>
              </tr>
```

Y en el `<tbody>`:

```jsx
              {cargando && <tr><td colSpan={6} className="text-center text-slate-400 py-16">Consultando...</td></tr>}
              {!cargando && datos && datos.filas.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-16">Sin clientes</td></tr>}
              {datos && datos.filas.map((f) => (
                <tr key={f.id} onClick={() => setClienteId(String(f.id))}
                  className={`border-b border-slate-100 cursor-pointer ${String(f.id) === clienteId ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                  <td className="py-2 px-3">{f.clave}</td>
                  <td className="py-2 px-3">{f.nombre}</td>
                  <td className="py-2 px-3 text-right">${f.limite_credito.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right">${f.saldo.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right font-medium">${f.credito_disponible.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-emerald-700">${f.monedero.toFixed(2)}</td>
                </tr>
              ))}
```

(`colSpan` sube de 5 a 6).

Actualizar `exportarExcel` para incluir la columna:

```jsx
  const exportarExcel = () => {
    if (!datos) return;
    descargarCSV("estado_de_cuenta_clientes.csv",
      ["Clave", "Nombre", "Límite de Crédito", "Saldo", "Crédito Disponible", "Monedero"],
      datos.filas.map((f) => [f.clave, f.nombre, f.limite_credito, f.saldo, f.credito_disponible, f.monedero]));
  };
```

- [ ] **Step 5: Verificar el build del frontend**

Run: `npm run build`
Expected: build exitoso, sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/reportes/ReporteVentas.jsx src/reportes/ReporteEstadoCuentaClientes.jsx
git commit -m "feat: show apartado document filter, abonos tab, liquidation date and monedero in Reportes"
```

---

### Task 5: Aviso de apartados por vencer en CRM

**Files:**
- Modify: `backend/server.js`
- Modify: `src/CRM.jsx`

**Interfaces:**
- Consumes: `obtenerApartadosProximosAVencer` de `backend/apartados.js` (Task 1).
- Produces: `GET /api/crm/apartados-por-vencer`; estado `apartadosPorVencer` en `CRM.jsx` con banner y botón "Ya contacté".

- [ ] **Step 1: Ruta en `server.js`**

Agregar (junto a la ruta existente `GET /api/crm/postventa-pendientes`):

```js
app.get("/api/crm/apartados-por-vencer", requiereLogin, (req, res) => {
  const alcance = alcanceSucursal(req, resolverPermisosDeRol(req.usuarioToken.rol_id));
  res.json(obtenerApartadosProximosAVencer(DB, alcance));
});
```

(`obtenerApartadosProximosAVencer` ya se importó de `./apartados` en el Task 1).

- [ ] **Step 2: Verificación manual de la ruta**

Run: `cd backend && node -e "
const { construirDBPrueba } = require('./testHelpers');
const { crearApartado } = require('./apartados');
const DB = construirDBPrueba();
const v = crearApartado(DB, { cliente_id: 1, lineas: [{ producto_id: 1, cantidad: 1, precio_unitario: 25, descuento_pct: 0 }], anticipo_monto: 10, anticipo_forma_pago: 'EFECTIVO' }, 1, { nombre: 'Ana' });
DB.pos.ventas.find(x => x.id === v.id).fecha_limite = new Date(Date.now() + 3*86400000).toISOString().slice(0,10);
const { obtenerApartadosProximosAVencer } = require('./apartados');
console.log(JSON.stringify(obtenerApartadosProximosAVencer(DB, { verTodas: true, sucursalId: null })));
"`
Expected: un JSON con un elemento (`venta_id`, `cliente_nombre: "Abarrotes Mary"`, `dias_restantes: 3`).

- [ ] **Step 3: `CRM.jsx` — estado y carga**

Agregar el estado (junto a `postventaPendientes`):

```jsx
  const [apartadosPorVencer, setApartadosPorVencer] = useState([]);
```

En `cargarTodo`, agregar la llamada (junto a las demás dentro de `Promise.all`):

```jsx
      const [rCli, rSuc, rVen, rPost, rApart] = await Promise.all([
        apiFetch("/crm/clientes"), apiFetch("/sucursales"), apiFetch("/vendedores"), apiFetch("/crm/postventa-pendientes"), apiFetch("/crm/apartados-por-vencer"),
      ]);
      if (!rCli.ok) throw new Error("No se pudo cargar el CRM");
      setClientes(await rCli.json());
      setSucursales(rSuc.ok ? await rSuc.json() : []);
      setVendedores(rVen.ok ? await rVen.json() : []);
      setPostventaPendientes(rPost.ok ? await rPost.json() : []);
      setApartadosPorVencer(rApart.ok ? await rApart.json() : []);
```

- [ ] **Step 4: `CRM.jsx` — registrar contacto y mensaje**

Agregar (junto a `registrarPostventa`/`mensajePostventa`):

```jsx
  const registrarApartadoPorVencer = async (item) => {
    try {
      const r = await apiFetch(`/crm/clientes/${item.cliente_id}/contactos`, {
        method: "POST",
        body: JSON.stringify({ tipo: "apartado_por_vencer", venta_id: item.venta_id }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setApartadosPorVencer((prev) => prev.filter((p) => p.venta_id !== item.venta_id));
      mostrarAviso("Contacto registrado");
    } catch (e) { mostrarAviso("❌ " + e.message); }
  };

  const mensajeApartado = (item) => {
    return `Hola ${item.cliente_nombre}! 👋\n\nTu apartado #${item.venta_id} en Unisound Imusa está por vencer en ${item.dias_restantes} día(s) — te queda un saldo pendiente de $${item.saldo_pendiente.toFixed(2)}.\n\n¡Te esperamos para completarlo y llevarte tu producto!\n\n— Unisound Imusa`;
  };
```

- [ ] **Step 5: `CRM.jsx` — badge en el encabezado**

Agregar junto al badge existente de `postventaPendientes` (mismo bloque del header):

```jsx
          {apartadosPorVencer.length > 0 && <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: "rgba(255,255,255,.2)", color: "#fff", fontWeight: 600 }}>⏰ {apartadosPorVencer.length} apartados</span>}
```

- [ ] **Step 6: `CRM.jsx` — banner en la pestaña "hoy"**

Agregar el banner justo antes del banner existente de `postventaPendientes` (mismo bloque `{tab === "hoy" && ...}`):

```jsx
          {apartadosPorVencer.length > 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "12px 16px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#b45309", fontWeight: 600, marginBottom: 8 }}>⏰ Apartados por vencer · {apartadosPorVencer.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {apartadosPorVencer.map((item) => {
                  const mensaje = mensajeApartado(item);
                  const link = `https://wa.me/52${(item.telefono || "").replace(/\D/g, "")}?text=${encodeURIComponent(mensaje)}`;
                  return (
                    <div key={item.venta_id} style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <Avatar nombre={item.cliente_nombre} size={28} />
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{item.cliente_nombre}</div>
                        <div style={{ fontSize: 11, color: T.sub }}>Apartado #{item.venta_id} · saldo ${item.saldo_pendiente.toFixed(2)} · vence en {item.dias_restantes} día(s)</div>
                      </div>
                      <a href={link} target="_blank" rel="noopener noreferrer" style={{ padding: "5px 12px", borderRadius: 6, background: T.blue, color: "#fff", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>💬 Enviar</a>
                      <button onClick={() => registrarApartadoPorVencer(item)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #86efac", background: "#f0fdf4", color: "#15803d", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✓ Ya contacté</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
```

- [ ] **Step 7: Verificar el build del frontend**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 8: Commit**

```bash
git add backend/server.js src/CRM.jsx
git commit -m "feat: warn in CRM when a client's apartado is close to expiring"
```

---

### Task 6: Punto de Venta — botón y modal de Apartados

**Files:**
- Create: `src/ModalApartados.jsx`
- Modify: `src/PuntoDeVenta.jsx`

**Interfaces:**
- Consumes: `POST /api/apartados`, `GET /api/apartados`, `POST /api/apartados/:id/abonos`, `PUT /api/apartados/:id/cancelar` (Task 1); `carrito`, `cliente`, `vendedor`, `condicionesPago`, `permisos` de `PuntoDeVenta.jsx`.
- Produces: `<ModalApartados onCerrar carrito cliente vendedor condicionesPago permisos onApartadoCreado />`.

- [ ] **Step 1: Crear `src/ModalApartados.jsx`**

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { X, DollarSign, Ban } from "lucide-react";
import { apiFetch } from "./api";

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";

export default function ModalApartados({ onCerrar, carrito, cliente, vendedor, condicionesPago, permisos, onApartadoCreado }) {
  const puede = (clave) => !permisos || permisos.includes(clave);
  const [tab, setTab] = useState("nuevo");
  const [apartados, setApartados] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const [anticipoMonto, setAnticipoMonto] = useState("");
  const [anticipoForma, setAnticipoForma] = useState("EFECTIVO");
  const [guardando, setGuardando] = useState(false);

  const [abonoActivoId, setAbonoActivoId] = useState(null);
  const [abonoMonto, setAbonoMonto] = useState("");
  const [abonoForma, setAbonoForma] = useState("EFECTIVO");

  const mostrarAviso = (t) => { setAviso(t); setTimeout(() => setAviso(null), 2500); };

  const total = carrito.reduce((acc, f) => acc + f.cantidad * f.precioUnitario * (1 - (f.descuentoPct || 0) / 100), 0);
  const formasPago = condicionesPago.filter((c) => c.nombre !== "CRÉDITO");

  const cargarApartados = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiFetch("/apartados");
      if (r.ok) setApartados(await r.json());
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { if (tab === "lista") cargarApartados(); }, [tab, cargarApartados]);

  const crearApartado = async () => {
    if (carrito.length === 0) return mostrarAviso("El ticket está vacío");
    if (cliente.id === 0) return mostrarAviso("Selecciona un cliente real (botón Cliente) antes de apartar");
    const monto = Number(anticipoMonto);
    if (!monto || monto <= 0) return mostrarAviso("Captura un anticipo mayor a $0");
    if (monto > total) return mostrarAviso("El anticipo no puede ser mayor al total");

    setGuardando(true);
    try {
      const r = await apiFetch("/apartados", {
        method: "POST",
        body: JSON.stringify({
          cliente_id: cliente.id,
          vendedor_id: vendedor?.id,
          anticipo_monto: monto,
          anticipo_forma_pago: anticipoForma,
          lineas: carrito.map((f) => ({
            producto_id: f.esRapido ? null : f.producto_id,
            descripcion: f.esRapido ? f.descripcion : undefined,
            cantidad: f.cantidad,
            precio_unitario: f.precioUnitario,
            descuento_pct: f.descuentoPct,
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo crear el apartado");
      mostrarAviso(`Apartado creado — Folio ${data.id}`);
      setAnticipoMonto("");
      onApartadoCreado();
      setTab("lista");
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    } finally {
      setGuardando(false);
    }
  };

  const abrirAbono = (apartado) => {
    setAbonoActivoId(apartado.id);
    setAbonoMonto("");
    setAbonoForma("EFECTIVO");
  };

  const confirmarAbono = async (apartado) => {
    const monto = Number(abonoMonto);
    if (!monto || monto <= 0) return mostrarAviso("Captura un monto mayor a $0");
    try {
      const r = await apiFetch(`/apartados/${apartado.id}/abonos`, {
        method: "POST",
        body: JSON.stringify({ monto, forma_pago: abonoForma }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo registrar el abono");
      mostrarAviso(data.estatus === "cerrada" ? "Abono registrado — apartado liquidado ✅" : "Abono registrado");
      setAbonoActivoId(null);
      cargarApartados();
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  const cancelar = async (apartado) => {
    if (!confirm(`¿Cancelar el apartado #${apartado.id}? El producto regresa a existencia y lo ya pagado se abona al monedero del cliente.`)) return;
    try {
      const r = await apiFetch(`/apartados/${apartado.id}/cancelar`, {
        method: "PUT",
        body: JSON.stringify({ motivo: "Cancelado desde el POS" }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      mostrarAviso("Apartado cancelado");
      cargarApartados();
    } catch (e) {
      mostrarAviso("❌ " + e.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-panel-in">
        <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-sm text-slate-700">Apartados</h3>
          <button onClick={onCerrar} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-slate-200 flex shrink-0">
          <button onClick={() => setTab("nuevo")} className={`px-4 py-2 text-sm border-b-2 ${tab === "nuevo" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>Nuevo Apartado</button>
          <button onClick={() => setTab("lista")} className={`px-4 py-2 text-sm border-b-2 ${tab === "lista" ? "border-[#1a7fe8] text-[#1a7fe8] font-medium" : "border-transparent text-slate-500"}`}>Lista de Apartados</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "nuevo" ? (
            <div className="flex flex-col gap-3 max-w-md">
              <div className="text-sm text-slate-600">
                <p><b>Cliente:</b> {cliente.nombre}</p>
                <p><b>Productos en el carrito:</b> {carrito.length}</p>
                <p><b>Total:</b> ${total.toFixed(2)}</p>
              </div>
              {cliente.id === 0 && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  Selecciona un cliente real (botón "Cliente" en el POS) antes de apartar — no puede ser Público en General.
                </p>
              )}
              {carrito.length === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  El ticket está vacío — agrega productos antes de apartar.
                </p>
              )}
              <div>
                <label className="text-xs text-slate-500 block mb-1">Anticipo</label>
                <input type="number" min="0" step="0.01" value={anticipoMonto} onChange={(e) => setAnticipoMonto(e.target.value)} className={inputCls} placeholder="0.00" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Forma de pago del anticipo</label>
                <select value={anticipoForma} onChange={(e) => setAnticipoForma(e.target.value)} className={inputCls}>
                  {formasPago.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                </select>
              </div>
              <p className="text-xs text-slate-500">El límite para liquidar es de 60 días. Si no se completa, el producto regresa a existencia y lo ya pagado se abona al monedero del cliente.</p>
              <button
                onClick={crearApartado}
                disabled={guardando || cliente.id === 0 || carrito.length === 0}
                className="bg-[#1a7fe8] hover:bg-[#1262b8] disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded font-semibold"
              >
                {guardando ? "Guardando..." : "Crear Apartado"}
              </button>
            </div>
          ) : cargando ? (
            <p className="text-center text-slate-400 py-16">Consultando...</p>
          ) : apartados.length === 0 ? (
            <p className="text-center text-slate-400 py-16">No hay apartados vigentes</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#1a7fe8] text-white sticky top-0">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">Folio</th>
                  <th className="py-2 px-3 text-left font-medium">Cliente</th>
                  <th className="py-2 px-3 text-right font-medium">Total</th>
                  <th className="py-2 px-3 text-right font-medium">Saldo</th>
                  <th className="py-2 px-3 text-center font-medium">Días Restantes</th>
                  {puede("gestionar_apartados") && <th className="py-2 px-3 text-center font-medium">Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {apartados.map((a) => (
                  <React.Fragment key={a.id}>
                    <tr className="border-b border-slate-100">
                      <td className="py-2 px-3 font-medium">{a.id}</td>
                      <td className="py-2 px-3">{a.cliente_nombre}</td>
                      <td className="py-2 px-3 text-right">${Number(a.total).toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-medium">${Number(a.saldo_pendiente).toFixed(2)}</td>
                      <td className={`py-2 px-3 text-center ${a.dias_restantes <= 7 ? "text-amber-600 font-semibold" : ""}`}>{a.dias_restantes}</td>
                      {puede("gestionar_apartados") && (
                        <td className="py-2 px-3 text-center">
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => abrirAbono(a)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Abonar"><DollarSign size={16} /></button>
                            <button onClick={() => cancelar(a)} className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Cancelar"><Ban size={16} /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {abonoActivoId === a.id && (
                      <tr className="bg-blue-50">
                        <td colSpan={6} className="p-3">
                          <div className="flex gap-2 items-end flex-wrap">
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Monto del abono</label>
                              <input type="number" min="0" max={a.saldo_pendiente} step="0.01" value={abonoMonto} onChange={(e) => setAbonoMonto(e.target.value)} className={inputCls + " w-32"} />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 block mb-1">Forma de pago</label>
                              <select value={abonoForma} onChange={(e) => setAbonoForma(e.target.value)} className={inputCls}>
                                {formasPago.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                              </select>
                            </div>
                            <button onClick={() => confirmarAbono(a)} className="bg-[#1a7fe8] hover:bg-[#1262b8] text-white px-4 py-1.5 rounded text-sm font-medium">Confirmar</button>
                            <button onClick={() => setAbonoActivoId(null)} className="text-slate-500 text-sm px-2">Cancelar</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {aviso && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-[60] animate-toast-in">{aviso}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Cablear el botón y el modal en `PuntoDeVenta.jsx`**

Agregar `Bookmark` a los imports de `lucide-react` (junto a los demás iconos, por ejemplo cerca de `FileMinus`):

```jsx
  Clock, RotateCcw, Layers, Cloud, Info, UserCircle2, ShoppingCart,
  Printer, Mail, X, Plus, Minus, Package, UserPlus, MapPin,
  ChevronLeft, ChevronRight, Sparkles, SlidersHorizontal, Bookmark
```

Agregar el import del nuevo componente (junto a `ConsultasVentas`/`Configuracion`):

```jsx
import ModalApartados from "./ModalApartados.jsx";
```

Agregar el botón lateral (en la barra lateral, entre el botón "Nota Cr." y el botón "Espera" existentes):

```jsx
          {puede("agregar_nota_credito_venta") && <BotonLateral icono={FileMinus} etiqueta="Nota Cr." atajo="Alt+N" color="text-red-500" onClick={() => mostrarAviso("Nota de crédito — requiere folio de venta previo")} />}
          {puede("gestionar_apartados") && <BotonLateral icono={Bookmark} etiqueta="Apartados" atajo="Alt+P" color="text-purple-600" onClick={() => setModal("apartados")} />}
          {puede("poner_ticket_en_espera") && <BotonLateral icono={Clock} etiqueta="Espera" atajo="Alt+E" color="text-slate-500" onClick={ponerEnEspera} />}
```

Agregar el atajo de teclado `Alt+P` en el manejador de teclas existente (junto al de `Alt+D`/`"d"` — buscar el bloque `if (k === "d" && puede("cambiar_tipo_documento"))` y agregar un `else if` para `"p"`):

```jsx
      else if (k === "p" && puede("gestionar_apartados")) { e.preventDefault(); setModal("apartados"); }
```

Agregar el render del modal (junto a los demás bloques `{modal === "..." && (...)}`, por ejemplo después del modal de "cliente"):

```jsx
      {modal === "apartados" && (
        <ModalApartados
          onCerrar={() => setModal(null)}
          carrito={carrito}
          cliente={cliente}
          vendedor={vendedor}
          condicionesPago={condicionesPago}
          permisos={permisos}
          onApartadoCreado={() => { limpiarTicket(); cargarProductos(); }}
        />
      )}
```

- [ ] **Step 3: Verificar el build del frontend**

Run: `npm run build`
Expected: build exitoso, sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/ModalApartados.jsx src/PuntoDeVenta.jsx
git commit -m "feat: add Apartados button and modal (Nuevo Apartado / Lista de Apartados) to Punto de Venta"
```

---

### Task 7: Verificación final y revisión manual

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Correr toda la suite de backend**

Run: `cd backend && npm test`
Expected: 339/339 pruebas PASS.

- [ ] **Step 2: Verificar el build de frontend**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Verificación manual en navegador (Playwright/Chrome)**

Iniciar sesión como Administrador. Verificar:
1. En Punto de Venta, agregar productos al carrito, seleccionar un cliente real, abrir "Apartados" (botón lateral o Alt+P).
2. Crear un apartado con un anticipo — confirmar que el carrito se vacía y la existencia del producto bajó (verificar en Inventario).
3. En la pestaña "Lista de Apartados", abonar una parte del saldo — confirmar que el saldo pendiente baja.
4. Abonar el resto hasta llegar a $0 — confirmar que desaparece de la lista de vigentes (se liquidó).
5. En Reportes → Ventas, filtrar por Documento "Apartado" — confirmar que el apartado liquidado aparece, con su "Fecha Liquidación".
6. En Reportes → Ventas → pestaña "Abonos" — confirmar que aparecen los pagos parciales registrados.
7. Crear un segundo apartado, cancelarlo manualmente desde la Lista de Apartados — confirmar que la existencia regresa y que en Reportes → Estado de Cuenta de Clientes el cliente ahora tiene saldo en "Monedero".
8. En Reportes → Movimientos de Caja y en Corte de Caja (Punto de Venta → Corte de Caja), confirmar que los abonos aparecen como entradas, sin que el total del apartado se sume por separado al liquidarse.
9. En CRM, con un apartado cuya fecha límite esté a 7 días o menos (ajustar a mano en los datos de prueba si hace falta), confirmar que aparece el aviso "⏰ Apartados por vencer" y que el botón "Ya contacté" lo quita de la lista.

- [ ] **Step 4: Reportar hallazgos a Victor**

Si todo pasa: confirmar que Apartados está listo, y recordar el comportamiento a 60 días (vencimiento automático + abono a monedero) como algo que empezará a aplicar desde ahora.
Si algo falla: documentar el hallazgo concreto antes de marcar el task como completo.

---

## Self-Review

**Cobertura de la spec:** Los 8 objetivos de `docs/superpowers/specs/2026-07-21-apartados-design.md` están cubiertos: modelo de datos y ciclo de vida (Task 1), vencimiento a 60 días + monedero (Task 1), integración con Corte de Caja (Task 2), aparición en Reportes de Ventas/Utilidad + pestaña Abonos + columna Fecha Liquidación (Tasks 3-4), columna Monedero en Estado de Cuenta (Tasks 3-4), pantalla en modal desde POS (Task 6), aviso en CRM con botón "Ya contacté" (Task 5), permiso único `gestionar_apartados` (Task 1).

**Placeholders:** ninguno — cada step tiene código completo y pruebas con aserciones concretas.

**Consistencia de tipos:** `alcance` siempre `{ verTodas, sucursalId }` (mismo shape ya usado en `reportes.js`/`cortes.js`). `venta.tipo_documento === "Apartado"` y `venta.estatus` (`"apartado"`/`"cerrada"`/`"cancelada"`) se usan de forma idéntica en `apartados.js`, `cortes.js` y `reportes.js`. `apartado_abonos` siempre tiene `{ id, venta_id, sucursal_id, fecha, fecha_hora, monto, forma_pago, usuario_nombre }` en los tres archivos que lo consumen.

**Decisión de diseño resuelta durante la planeación:** la spec original mencionaba una acción "Liquidar" separada en la Lista de Apartados; el diseño del backend (`registrarAbono` liquida automáticamente cuando el abono cubre el saldo) hace innecesario ese botón — se resolvió a favor de la automatización (menos pasos para el cajero), sin cambiar ningún compromiso que Victor haya aprobado explícitamente.
