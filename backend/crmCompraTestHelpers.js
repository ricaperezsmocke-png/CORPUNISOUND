const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('./sicarRepositorio');
const { crearConsultasCRM } = require('./crmFuentes');

const ctx = { alcance: { verTodas: true, sucursalId: null }, verSicar: true, hoyLocal: '2026-10-15' };
function preparar(t) {
  const sqlite = new Database(':memory:');
  t.after(() => sqlite.close());
  const repo = crearRepositorioSicar(sqlite);
  const DB = {
    admin: { usuarios: [{ id: 7, nombre: 'Victor' }] },
    crm: { clientes: [{ id: 10, nombre: 'Ana', sucursal_id: 1 }, { id: 20, nombre: 'Beto', sucursal_id: 2 }] },
    pos: { ventas: [], venta_detalle: [], sucursales: [{ id: 1, nombre: 'Ocosingo' }, { id: 2, nombre: 'Yajalón' }] },
    'catalogo-productos': { productos: [], categorias: [] },
  };
  sqlite.exec(`INSERT INTO sicar_tiendas(sucursal_id) VALUES (1),(2);
    INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre) VALUES (1,'9','Sicar Ana'),(2,'8','Sicar Beto');`);
  function pos(total, fecha = ctx.hoyLocal, estatus = 'cerrada', cliente_id = 10) {
    const id = DB.pos.ventas.length + 1;
    DB.pos.ventas.push({ id, cliente_id, sucursal_id: cliente_id === 10 ? 1 : 2, total, fecha, estatus });
    return id;
  }
  function sicar(total, fecha = ctx.hoyLocal, estado = 'vigente', sucursal = 1, cli = '9') {
    const id = String(sqlite.prepare('SELECT count(*) n FROM sicar_ventas').get().n + 1);
    sqlite.prepare(`INSERT INTO sicar_ventas(sucursal_id, ven_id, cli_id, fecha_local, estado, total_centavos, revision, hash)
      VALUES (?,?,?,?,?,?, '1','h')`).run(sucursal, id, cli, fecha, estado, total);
    return id;
  }
  function unir(sucursal = 1, cli = '9', cliente = 10) {
    sqlite.prepare(`INSERT INTO sicar_vinculos(sucursal_id, cli_id, cliente_id, estado, creada, actualizada)
      VALUES (?,?,?,'confirmado','hoy','hoy')`).run(sucursal, cli, cliente);
  }
  return { DB, sqlite, repo, pos, sicar, unir, consultas: crearConsultasCRM(DB, repo) };
}
module.exports = { preparar, ctx };
