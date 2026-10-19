const Database = require("better-sqlite3");
const { inicializarPersistenciaCentroLeads } = require("./centroLeads/persistencia");
const { crearRepositorioSicar } = require("./sicarRepositorio");
const { crearContextoBandeja } = require("./bandeja/mensajes");

// Base de prueba de la bandeja: SQLite en memoria con tablas de leads y SICAR, y un estado JSON mínimo.
function prepararBandeja(t, { clientes = [], vendedores = [] } = {}) {
  const sqlite = new Database(":memory:");
  t.after(() => sqlite.close());
  inicializarPersistenciaCentroLeads(sqlite);
  const repo = crearRepositorioSicar(sqlite);
  const DB = {
    crm: { clientes: [{ id: 0, nombre: "Público en General", sucursal_id: 1 }, ...clientes], contactos_cliente: [], estados_historial: [] },
    pos: { ventas: [], vendedores: [{ id: 1, nombre: "Vero", sucursal_id: 1, activo: true },
      { id: 2, nombre: "Luis", sucursal_id: 1, activo: true }, { id: 3, nombre: "Ruth", sucursal_id: 2, activo: true },
      ...vendedores] },
    radar_demanda: { registros: [] },
    admin: { usuarios: [] },
  };
  const guardados = [];
  const ctx = crearContextoBandeja({ sqlite, DB, repo, guardar: db => guardados.push(structuredClone(db.crm)) });
  return { sqlite, DB, repo, ctx, guardados };
}

function canalWhatsApp(ctx, sucursal_id = 1, numero = "529190000001") {
  return ctx.registrarCanal({ canal: "whatsapp", proveedor: "simulado", identificador_externo: numero,
    nombre: `WhatsApp tienda ${sucursal_id}`, sucursal_id });
}

let contador = 0;
function entrante(canal, remitente, texto = "Hola, ¿tienen guitarras?", extra = {}) {
  contador += 1;
  return { fuente_id: canal.id, id_evento: `ev-${contador}`, remitente, texto, ocurrido_en: "2026-10-18T18:00:00.000Z", ...extra };
}

module.exports = { prepararBandeja, canalWhatsApp, entrante };
