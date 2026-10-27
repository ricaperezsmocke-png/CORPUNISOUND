// AUDITORIA 2026-10 (hallazgo B1). FALLA en master a proposito: describe lo que deberia pasar. No arregla nada.
// Correr desde backend/: node --preserve-symlinks --preserve-symlinks-main --test auditoria/crmInternaOtraTienda.auditoria.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { crearRepositorioSicar } = require('../sicarRepositorio');
const { crearConsultasCRM } = require('../crmFuentes');

const HOY = '2026-10-14';

function prepararDB() {
  return {
    admin: { usuarios: [{ id: 77, nombre: 'Gerente Yajalon' }] },
    crm: { clientes: [
      { id: 0, nombre: 'Público en General', sucursal_id: 1 },
      // Cliente nativo de Yajalon (tienda 2) marcado como cuenta interna por alguien de Yajalon.
      { id: 20, nombre: 'Beto Yajalón', telefono: '9197654321', sucursal_id: 2,
        cuenta_interna: { motivo: 'Cuenta personal del gerente de Yajalon', usuario_id: 77, fecha_hora: '2026-10-01T10:00:00Z' } },
    ] },
    pos: { ventas: [], venta_detalle: [], sucursales: [{ id: 1, nombre: 'Ocosingo' }, { id: 2, nombre: 'Yajalón' }] },
    'catalogo-productos': { productos: [] },
  };
}

test('B1: la ficha de un cliente SICAR de Ocosingo no debe mostrar la marca interna de un cliente de Yajalon', () => {
  const sqlite = new Database(':memory:');
  const repo = crearRepositorioSicar(sqlite);
  const DB = prepararDB();
  // Cliente SICAR de Ocosingo con el mismo telefono: el agente lo une SOLO, en estado "pendiente" (sin que nadie confirme).
  sqlite.prepare('INSERT INTO sicar_tiendas(sucursal_id) VALUES (1)').run();
  sqlite.prepare("INSERT INTO sicar_clientes(sucursal_id, cli_id, nombre, telefono) VALUES (1, '800', 'Roberto', '9197654321')").run();
  sqlite.prepare(`INSERT INTO sicar_vinculos(sucursal_id, cli_id, cliente_id, estado, creada, actualizada)
    VALUES (1, '800', 20, 'pendiente', '2026-10-01', '2026-10-01')`).run();
  const vendedorOcosingo = { alcance: { verTodas: false, sucursalId: 1 }, verSicar: true, hoyLocal: HOY };
  const ficha = crearConsultasCRM(DB, repo).ficha(vendedorOcosingo, 'sicar:1:800');
  // Hoy: la ficha trae motivo, fecha y nombre de quien marco al cliente de OTRA tienda.
  assert.equal(ficha.cuenta_interna, null,
    `Ocosingo ve la marca de Yajalon: ${JSON.stringify(ficha.cuenta_interna)}`);
});
