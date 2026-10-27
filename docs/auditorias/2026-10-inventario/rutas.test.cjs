/**
 * Las mismas fugas, pero por la PUERTA REAL: peticiones HTTP al servidor, con
 * el token de un gerente amarrado a Ocosingo (sucursal 1). Demuestra que no
 * hace falta llamar a funciones internas: basta con mandar la peticion.
 *
 * Igual que reproducciones.test.cjs: cada prueba pasa MIENTRAS el defecto exista.
 *
 *   cd backend && node --test ../docs/auditorias/2026-10-inventario/rutas.test.cjs
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "auditoria-inventario";
process.env.NODE_ENV = "test";
process.env.SENTRY_ENABLED = "false";
const B = path.join(__dirname, "..", "..", "..", "backend");
const app = require(path.join(B, "server"));
const { obtenerConexionSqlite } = require(path.join(B, "persistencia"));
const { firmarToken } = require(path.join(B, "auth"));

const PERMISOS = ["gestionar_garantias", "ajustar_existencia", "realizar_traspasos", "recibir_compra", "migrar_datos",
  "crear_producto", "editar_producto"];
const PRODUCTO = 9101;
let servidor, base, token;

before(async () => {
  const DB = app.DB;
  DB.admin.roles.push({ id: 9100, nombre: "Gerente auditoria", permisos: PERMISOS, modulos: ["inventario"] });
  DB.admin.usuarios.push({ id: 9100, usuario: "gerente9100", nombre: "Gerente Ocosingo", rol_id: 9100, sucursal_id: 1, activo: true });
  token = firmarToken({ id: "9100", rol_id: 9100, sucursal_id: 1 });
  DB["catalogo-productos"].productos.push({ id: PRODUCTO, sku: "AUD-1", nombre: "Bajo electrico", precio_venta: 9000, costo: 6000,
    precios: [{ utilidad: 50, precioVenta: 9000 }], activo: true });
  DB.inventario.existencias.push({ producto_id: PRODUCTO, sucursal_id: 1, cantidad_actual: 10, cantidad_minima: 0, cantidad_maxima: 0 });
  if (!DB["catalogo-productos"].proveedores.some((p) => p.id === 1)) DB["catalogo-productos"].proveedores.push({ id: 1, nombre: "Prov" });
  await new Promise((r) => { servidor = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(async () => {
  servidor?.closeAllConnections();
  if (servidor) await new Promise((r) => servidor.close(r));
  obtenerConexionSqlite()?.close();
});

async function pedir(metodo, ruta, cuerpo) {
  const res = await fetch(`${base}/api/${ruta}`, { method: metodo,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
  const texto = await res.text();
  return { status: res.status, datos: /^[[{]/.test(texto) ? JSON.parse(texto) : texto };
}
const existencia = (pid, suc) => app.DB.inventario.existencias
  .filter((e) => e.producto_id === pid && e.sucursal_id === suc).reduce((s, e) => s + e.cantidad_actual, 0);
const movs = (pid, suc) => app.DB.inventario.movimientos_inventario.filter((m) => m.producto_id === pid && m.sucursal_id === suc);

test("RUTA H2: garantia con cliente inventado; la pieza sale y la existencia de Ocosingo no se mueve", async () => {
  const antes = existencia(PRODUCTO, 1);
  const g = await pedir("POST", "garantias", { producto_id: PRODUCTO, cliente_id: 424242 });
  assert.equal(g.status, 200, JSON.stringify(g.datos));
  const id = g.datos.id;
  assert.equal((await pedir("PUT", `garantias/${id}/enviar`, { destino_nombre: "Proveedor" })).status, 200);
  assert.equal((await pedir("PUT", `garantias/${id}/resolucion`, { tipo_resolucion: "reemplazo" })).status, 200);
  assert.equal((await pedir("PUT", `garantias/${id}/recibir`)).status, 200);
  const fin = await pedir("PUT", `garantias/${id}/entregar-cliente`);
  assert.equal(fin.status, 200);
  assert.equal(fin.datos.estado, "cerrada");
  assert.equal(existencia(PRODUCTO, 1), antes);
});

test("RUTA H4: la misma recepcion (misma factura) se acepta dos veces", async () => {
  const antes = existencia(PRODUCTO, 1);
  const datos = { proveedor_id: 1, factura: "F-1", renglones: [{ producto_id: PRODUCTO, cantidad: 3, costo: 6000 }] };
  assert.equal((await pedir("POST", "compras", datos)).status, 200);
  assert.equal((await pedir("POST", "compras", datos)).status, 200);
  assert.equal(existencia(PRODUCTO, 1), antes + 6);
});

test("RUTA H10: un gerente amarrado manda un traspaso a la sucursal 99, que no existe", async () => {
  const antes = existencia(PRODUCTO, 1);
  const r = await pedir("POST", "traspasos", { producto_id: PRODUCTO, cantidad: 2, sucursal_destino_id: 99 });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(existencia(PRODUCTO, 1), antes - 2);
});

test("RUTA H11: ajuste a un producto que no existe responde 200 y deja existencia huerfana", async () => {
  const r = await pedir("POST", "productos/987654/ajustar", { cantidad: 50, motivo: "Compra #1 — factura s/n" });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(existencia(987654, 1), 50);
  assert.equal(movs(987654, 1)[0].referencia_documento, "Compra #1 — factura s/n");
});

test("RUTA H3: la migracion fija la existencia y el movimiento no dice quien", async () => {
  const r = await pedir("POST", "migracion/aplicar", { tipo: "articulos", nombre_archivo: "inventario-real.xlsx",
    filas: [{ numero_fila: 2, clave: "AUD-1", existencia: "1" }] });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(existencia(PRODUCTO, 1), 1);
  const m = movs(PRODUCTO, 1).at(-1);
  assert.equal(m.usuario, "Importación SICAR");
  assert.ok(!JSON.stringify(m).includes("Gerente Ocosingo"));
});
