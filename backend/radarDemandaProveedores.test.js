/**
 * Proveedor obligatorio en el Radar de Demanda (Victor, 2026-10-23), por la API real:
 * la lista sale de SICAR, el servidor valida lo que manda el navegador y Compras
 * ve lo pendiente agrupado por proveedor.
 */
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE_DESECHABLE = path.join(os.tmpdir(), `corpunisound-radar-proveedores-${process.pid}.sqlite`);
process.env.DB_PATH = BASE_DESECHABLE;
process.env.JWT_SECRET = "secreto-radar-proveedores";
process.env.NODE_ENV = "test";

const app = require("./server");
const { firmarToken } = require("./auth");
const { obtenerConexionSqlite } = require("./persistencia");

let servidor, base, tokenRegistro, tokenConsulta, tokenAnalisis, tokenVecino, tokenAdmin;

function agregarSiFalta(lista, item) {
  if (!lista.some((existente) => existente.id === item.id)) lista.push(item);
}

before(async () => {
  const roles = [
    [931, ["registrar_demanda"]],
    [932, ["ver_radar_demanda"]],
    [933, ["ver_resumen_demanda"]],
    // Permisos vecinos del mismo módulo, sin ninguno de los dos que abren la lista.
    [934, ["dar_seguimiento_demanda", "cerrar_demanda", "marcar_pedido_proveedor"]],
  ];
  for (const [id, permisos] of roles) {
    agregarSiFalta(app.DB.admin.roles, { id, nombre: `Radar proveedores ${id}`, permisos, modulos: ["radar_demanda"] });
    agregarSiFalta(app.DB.admin.usuarios, { id, nombre: `Usuario ${id}`, usuario: `radar.prv.${id}`, rol_id: id,
      sucursal_id: 1, vendedor_id: null, activo: true });
  }
  agregarSiFalta(app.DB.admin.usuarios, { id: 1, nombre: "Administrador", usuario: "admin.prv", rol_id: 1, sucursal_id: 1, activo: true });
  const token = (id) => firmarToken({ id, nombre: `Usuario ${id}`, rol_id: id, sucursal_id: 1 });
  [tokenRegistro, tokenConsulta, tokenAnalisis, tokenVecino] = [931, 932, 933, 934].map(token);
  tokenAdmin = firmarToken({ id: 1, nombre: "Administrador", rol_id: 1, sucursal_id: 1 });
  await new Promise((resolve) => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

const sqlite = () => obtenerConexionSqlite();
function sembrarProveedores() {
  sqlite().exec(`DELETE FROM sicar_proveedores;
    INSERT OR IGNORE INTO sicar_tiendas(sucursal_id) VALUES (1), (2);
    INSERT INTO sicar_proveedores(sucursal_id, prv_id, nombre, actualizado_en) VALUES
      (1, '7', 'Casa Veerkamp', 'hoy'), (2, '40', 'CASA  VEERKAMP', 'hoy'), (2, '41', 'Yamaha de México', 'hoy')`);
}

beforeEach(() => {
  app.DB.radar_demanda = { registros: [], seguimientos: [], ultimo_id: 0, ultimo_seguimiento_id: 0 };
  sembrarProveedores();
});

after(async () => {
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
  for (const sufijo of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(BASE_DESECHABLE + sufijo); } catch { /* no existe */ }
  }
});

async function pedir(ruta, { token, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const respuesta = await fetch(base + ruta, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: respuesta.status, cuerpo: await respuesta.json() };
}

const demanda = (extra = {}) => ({ producto_buscado: "Cuerdas 010", marca_solicitada: "Ernie Ball", cantidad: 2,
  motivo_no_venta: "SIN_EXISTENCIA", ...extra });

test("la lista junta las tiendas por nombre y la ven quien registra o consulta, nadie más", async () => {
  const esperado = [{ clave: "casa veerkamp", nombre: "Casa Veerkamp" }, { clave: "yamaha de mexico", nombre: "Yamaha de México" }];
  assert.equal((await pedir("/api/radar-demanda/proveedores")).status, 401);
  for (const token of [tokenRegistro, tokenConsulta, tokenAdmin]) {
    const r = await pedir("/api/radar-demanda/proveedores", { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.cuerpo, esperado);
  }
  for (const token of [tokenAnalisis, tokenVecino]) {
    assert.equal((await pedir("/api/radar-demanda/proveedores", { token })).status, 403);
  }
  // El filtro de sucursal del encabezado no recorta la lista: los proveedores son los mismos para todas las tiendas.
  assert.deepEqual((await pedir("/api/radar-demanda/proveedores?sucursal_id=2", { token: tokenRegistro })).cuerpo, esperado);
});

test("sin proveedores de SICAR todavía la lista es vacía y se puede registrar con otro proveedor", async () => {
  sqlite().exec("DELETE FROM sicar_proveedores");
  const r = await pedir("/api/radar-demanda/proveedores", { token: tokenRegistro });
  assert.equal(r.status, 200);
  assert.deepEqual(r.cuerpo, []);
  const creada = await pedir("/api/radar-demanda", { token: tokenRegistro, method: "POST", body: demanda({ proveedor_texto: "Casa Veerkamp" }) });
  assert.equal(creada.status, 200, JSON.stringify(creada.cuerpo));
  assert.equal(creada.cuerpo.proveedor_por_revisar, true);
});

test("registrar exige proveedor y valida en el servidor lo que manda el navegador", async () => {
  const casos = [
    [{}, /proveedor/],
    [{ proveedor_clave: "inventado" }, /lista de SICAR/],
    [{ proveedor_clave: 7 }, /no es válido/],
    [{ proveedor_texto: "x" }, /entre 2 y 120/],
    [{ proveedor_texto: "a".repeat(121) }, /entre 2 y 120/],
    [{ proveedor_clave: "casa veerkamp", proveedor_texto: "Otro" }, /no los dos/],
  ];
  for (const [extra, mensaje] of casos) {
    const r = await pedir("/api/radar-demanda", { token: tokenRegistro, method: "POST", body: demanda(extra) });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.match(r.cuerpo.error, mensaje);
  }
  assert.equal(app.DB.radar_demanda.registros.length, 0);
});

test("un proveedor de la lista guarda la copia del nombre; uno escrito a mano queda por revisar", async () => {
  const deLista = await pedir("/api/radar-demanda", { token: tokenRegistro, method: "POST",
    body: demanda({ proveedor_clave: "casa veerkamp", proveedor_nombre: "Nombre inventado", proveedor_por_revisar: true }) });
  assert.equal(deLista.status, 200, JSON.stringify(deLista.cuerpo));
  assert.equal(deLista.cuerpo.proveedor_clave, "casa veerkamp");
  assert.equal(deLista.cuerpo.proveedor_nombre, "Casa Veerkamp", "el nombre sale de la lista, no del navegador");
  assert.equal(deLista.cuerpo.proveedor_por_revisar, false);
  const otro = await pedir("/api/radar-demanda", { token: tokenRegistro, method: "POST",
    body: demanda({ proveedor_texto: "  Distribuidora   del Sur " }) });
  assert.equal(otro.status, 200, JSON.stringify(otro.cuerpo));
  assert.equal(otro.cuerpo.proveedor_nombre, "Distribuidora del Sur");
  assert.equal(otro.cuerpo.proveedor_por_revisar, true);
  // La copia sigue aunque el proveedor desaparezca de SICAR.
  sqlite().exec("DELETE FROM sicar_proveedores");
  const detalle = await pedir(`/api/radar-demanda/${deLista.cuerpo.id}`, { token: tokenConsulta });
  assert.equal(detalle.cuerpo.proveedor_nombre, "Casa Veerkamp");
  // Y no se cambia por PATCH.
  const cambio = await pedir(`/api/radar-demanda/${deLista.cuerpo.id}`, { token: tokenAdmin, method: "PATCH",
    body: { proveedor_nombre: "Otro" } });
  assert.equal(cambio.status, 400);
});

test("con intención de compra, un proveedor inválido no deja un prospecto creado en el CRM", async () => {
  const clientesAntes = app.DB.crm.clientes.length;
  const r = await pedir("/api/radar-demanda?sucursal_id=1", { token: tokenAdmin, method: "POST", body: demanda({
    intencion_compra: true, consentimiento_aviso: true, nombre_contacto: "Pedro Prueba", telefono_contacto: "9191230000",
    proveedor_clave: "inventado" }) });
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /lista de SICAR/);
  assert.equal(app.DB.crm.clientes.length, clientesAntes);
  assert.equal(app.DB.radar_demanda.registros.length, 0);
});

test("Inteligencia agrupa lo pendiente por proveedor y deja las viejas en Sin proveedor", async () => {
  for (const extra of [{ proveedor_clave: "casa veerkamp" }, { proveedor_clave: "casa veerkamp", cantidad: 3 },
    { proveedor_texto: "Distribuidora del Sur", producto_buscado: "Púas", cantidad: 1 }]) {
    assert.equal((await pedir("/api/radar-demanda", { token: tokenRegistro, method: "POST", body: demanda(extra) })).status, 200);
  }
  const hoy = new Date().toISOString();
  app.DB.radar_demanda.registros.push({ id: 99, sucursal_id: 1, producto_id: null, producto_buscado: "Atril", cantidad: 4,
    motivo_no_venta: "SIN_EXISTENCIA", estado: "REGISTRADA", fecha_registro: hoy },
  { id: 100, sucursal_id: 1, producto_id: null, producto_buscado: "Cuerdas 010", cantidad: 50, motivo_no_venta: "SIN_EXISTENCIA",
    estado: "CANCELADA", fecha_registro: hoy, proveedor_clave: "casa veerkamp", proveedor_nombre: "Casa Veerkamp" });
  const r = await pedir("/api/radar-demanda/inteligencia", { token: tokenAdmin });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
  assert.deepEqual(r.cuerpo.por_proveedor.map((g) => [g.nombre, g.piezas, g.por_revisar]), [
    ["Casa Veerkamp", 5, false], ["Distribuidora del Sur", 1, true], ["Sin proveedor", 4, false],
  ]);
  const [casa] = r.cuerpo.por_proveedor;
  assert.deepEqual(casa.articulos.map((a) => [a.descripcion, a.marca, a.piezas]), [["Cuerdas 010", "Ernie Ball", 5]]);
  assert.deepEqual(casa.sucursales, ["Ocosingo"]);
  assert.equal(casa.dias_mas_vieja, 0);
});
