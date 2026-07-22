const { test } = require("node:test");
const assert = require("node:assert");
const { construirDBPrueba } = require("./testHelpers");
const { obtenerConfiguracion } = require("./configuracion");
const {
  crearGarantia, marcarEnviada, actualizarUbicacion, registrarResolucion,
  recibirEnTienda, entregarACliente, listarGarantias,
} = require("./garantias");

const ALCANCE_TODAS = { verTodas: true, sucursalId: null };
const USUARIO = { id: 1, nombre: "Ana" };

// producto_id 1 / sucursal 1 tiene existencia 120 en el DB de prueba.
function existencia(DB, producto_id = 1, sucursal_id = 1) {
  const e = DB.inventario.existencias.find((x) => x.producto_id === producto_id && x.sucursal_id === sucursal_id);
  return e ? e.cantidad_actual : null;
}

test("crearGarantia: crea en estado 'registrada' con folio, ubicación en la sucursal y primer movimiento", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1, notas_defecto: "No enciende" }, 1, USUARIO);

  assert.strictEqual(g.estado, "registrada");
  assert.strictEqual(g.folio, "G-0001");
  assert.strictEqual(g.sucursal_origen_id, 1);
  assert.strictEqual(g.producto_id, 1);
  assert.strictEqual(g.cliente_id, null, "sin cliente => null");
  assert.strictEqual(g.venta_id, null);
  assert.strictEqual(g.proveedor_id, null);
  assert.strictEqual(g.ubicacion_actual, "Ocosingo", "arranca en la tienda de origen");
  assert.strictEqual(g.usuario_creacion, "Ana");

  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs.length, 1);
  assert.strictEqual(movs[0].tipo, "creacion");
});

test("crearGarantia: rechaza un producto inexistente", () => {
  const DB = construirDBPrueba();
  assert.throws(() => crearGarantia(DB, { producto_id: 9999 }, 1, USUARIO), /producto/i);
});

test("crearGarantia: guarda cliente_id, venta_id y proveedor_id cuando se pasan", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1, cliente_id: 1, venta_id: 7, proveedor_id: 2 }, 1, USUARIO);
  assert.strictEqual(g.cliente_id, 1);
  assert.strictEqual(g.venta_id, 7);
  assert.strictEqual(g.proveedor_id, 2);
});

test("marcarEnviada: solo desde 'registrada'; descuenta 1 de existencia, cambia ubicación y guarda proveedor", () => {
  const DB = construirDBPrueba();
  const antes = existencia(DB);
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);

  const enviada = marcarEnviada(DB, g.id, { destino_tipo: "cedis", destino_nombre: "CEDIS", proveedor_id: 3 }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(enviada.estado, "enviada");
  assert.strictEqual(enviada.ubicacion_actual, "CEDIS");
  assert.strictEqual(enviada.proveedor_id, 3);
  assert.strictEqual(existencia(DB), antes - 1, "descuenta 1 pieza de la sucursal de origen");

  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "envio");
});

test("marcarEnviada: rechaza si la garantía no está en 'registrada'", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);
  assert.throws(
    () => marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Otro" }, USUARIO, ALCANCE_TODAS),
    /registrada/i
  );
});

test("actualizarUbicacion: solo en 'enviada'; cambia ubicación y agrega movimiento sin cambiar de estado", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "cedis", destino_nombre: "CEDIS" }, USUARIO, ALCANCE_TODAS);

  const actualizada = actualizarUbicacion(DB, g.id, { ubicacion_actual: "Proveedor XYZ", notas: "CEDIS reenvía" }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(actualizada.estado, "enviada", "no cambia de estado");
  assert.strictEqual(actualizada.ubicacion_actual, "Proveedor XYZ");
  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "actualizacion_ubicacion");
});

test("registrarResolucion (reparado): pasa a 'resuelta' y guarda el costo", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);

  const r = registrarResolucion(DB, g.id, { tipo_resolucion: "reparado", costo_resolucion: 150, notas: "Cambió pastilla" }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(r.estado, "resuelta");
  assert.strictEqual(r.tipo_resolucion, "reparado");
  assert.strictEqual(r.costo_resolucion, 150);
  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "resolucion");
});

test("registrarResolucion (rechazada): cierra directo sin pasar por 'resuelta' y con costo null", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);

  const r = registrarResolucion(DB, g.id, { tipo_resolucion: "rechazada", costo_resolucion: 999, notas: "Mal uso" }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(r.estado, "cerrada");
  assert.strictEqual(r.costo_resolucion, null, "rechazada nunca lleva costo");
});

test("registrarResolucion (nota_credito): cierra directo", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);

  const r = registrarResolucion(DB, g.id, { tipo_resolucion: "nota_credito", notas: "Crédito $500" }, USUARIO, ALCANCE_TODAS);
  assert.strictEqual(r.estado, "cerrada");
});

test("registrarResolucion: rechaza un tipo de resolución inválido", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);
  assert.throws(
    () => registrarResolucion(DB, g.id, { tipo_resolucion: "explotó" }, USUARIO, ALCANCE_TODAS),
    /resoluci/i
  );
});

test("recibirEnTienda (con cliente): reintegra 1 a existencia y pasa a 'en_tienda_pendiente_entrega'", () => {
  const DB = construirDBPrueba();
  const antes = existencia(DB);
  const g = crearGarantia(DB, { producto_id: 1, cliente_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS); // -1
  registrarResolucion(DB, g.id, { tipo_resolucion: "reemplazo" }, USUARIO, ALCANCE_TODAS);

  const r = recibirEnTienda(DB, g.id, USUARIO, ALCANCE_TODAS); // +1

  assert.strictEqual(r.estado, "en_tienda_pendiente_entrega");
  assert.strictEqual(existencia(DB), antes, "neto 0: -1 al enviar, +1 al recibir");
  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "recepcion");
});

test("recibirEnTienda (sin cliente): reintegra a existencia y cierra directo", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO); // sin cliente
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);
  registrarResolucion(DB, g.id, { tipo_resolucion: "reparado" }, USUARIO, ALCANCE_TODAS);

  const r = recibirEnTienda(DB, g.id, USUARIO, ALCANCE_TODAS);
  assert.strictEqual(r.estado, "cerrada", "sin cliente reingresa a inventario y cierra");
});

test("recibirEnTienda: rechaza si la garantía no está en 'resuelta'", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  assert.throws(() => recibirEnTienda(DB, g.id, USUARIO, ALCANCE_TODAS), /resuelta/i);
});

test("entregarACliente: de 'en_tienda_pendiente_entrega' pasa a 'cerrada'", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1, cliente_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);
  registrarResolucion(DB, g.id, { tipo_resolucion: "reemplazo" }, USUARIO, ALCANCE_TODAS);
  recibirEnTienda(DB, g.id, USUARIO, ALCANCE_TODAS);

  const r = entregarACliente(DB, g.id, USUARIO, ALCANCE_TODAS);
  assert.strictEqual(r.estado, "cerrada");
  const movs = DB.inventario.garantia_movimientos.filter((m) => m.garantia_id === g.id);
  assert.strictEqual(movs[movs.length - 1].tipo, "entrega_cliente");
});

test("rechazada nunca reintegra existencia (queda descontada tras el envío)", () => {
  const DB = construirDBPrueba();
  const antes = existencia(DB);
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "Proveedor XYZ" }, USUARIO, ALCANCE_TODAS);
  registrarResolucion(DB, g.id, { tipo_resolucion: "rechazada" }, USUARIO, ALCANCE_TODAS);

  assert.strictEqual(existencia(DB), antes - 1, "el producto no volvió, la existencia sigue en -1");
});

test("guard de alcance: un usuario de otra sucursal no puede actuar sobre una garantía ajena", () => {
  const DB = construirDBPrueba();
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO); // sucursal 1
  const alcanceOtra = { verTodas: false, sucursalId: 2 };
  assert.throws(
    () => marcarEnviada(DB, g.id, { destino_tipo: "proveedor", destino_nombre: "X" }, USUARIO, alcanceOtra),
    /no encontrada/i
  );
});

test("listarGarantias: respeta el alcance de sucursal", () => {
  const DB = construirDBPrueba();
  crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  crearGarantia(DB, { producto_id: 1 }, 2, USUARIO);

  const lista = listarGarantias(DB, { verTodas: false, sucursalId: 1 });
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].sucursal_origen_id, 1);
});

test("listarGarantias: calcula dias_sin_movimiento y atrasada contra el umbral configurable", () => {
  const DB = construirDBPrueba();
  obtenerConfiguracion(DB);
  DB.pos.configuracion.dias_alerta_garantias = 15;
  const g = crearGarantia(DB, { producto_id: 1 }, 1, USUARIO);
  DB.inventario.garantias.find((x) => x.id === g.id).fecha_ultimo_movimiento = "2000-01-01"; // hace años

  const lista = listarGarantias(DB, ALCANCE_TODAS);
  const fila = lista.find((x) => x.id === g.id);
  assert.ok(fila.dias_sin_movimiento > 15);
  assert.strictEqual(fila.atrasada, true);
  assert.ok(Array.isArray(fila.movimientos));
  assert.strictEqual(fila.producto_nombre, "Arroz 1kg");
  assert.strictEqual(fila.sucursal_origen_nombre, "Ocosingo");
});
