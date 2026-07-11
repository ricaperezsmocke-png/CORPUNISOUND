const { test } = require("node:test");
const assert = require("node:assert");
const { PERMISOS, MODULOS_SISTEMA } = require("./permisosCatalogo");
const { reconciliarRoles } = require("./roles");

// Simula un DB.admin.roles persistido en SQLite ANTES de que existieran
// el módulo "ml" y los permisos realizar_traspasos / recibir_compra:
// el Administrador quedó congelado con un snapshot viejo del catálogo.
function rolesLegacyPersistidos() {
  const clavesViejas = PERMISOS.map((p) => p.clave).filter(
    (c) => c !== "realizar_traspasos" && c !== "recibir_compra" &&
      c !== "gestionar_publicaciones_ml" && c !== "importar_ordenes_ml" && c !== "conectar_cuenta_ml"
  );
  return {
    admin: {
      roles: [
        { id: 1, nombre: "Administrador", permisos: clavesViejas, modulos: ["pos", "corte", "inventario", "crm", "admin"] },
        { id: 2, nombre: "Cajero", permisos: ["buscar_articulos", "cerrar_venta"], modulos: ["pos"] },
      ],
    },
  };
}

test("el Administrador persistido recupera TODOS los módulos y permisos actuales del catálogo", () => {
  const DB = rolesLegacyPersistidos();
  reconciliarRoles(DB);
  const admin = DB.admin.roles.find((r) => r.nombre === "Administrador");
  for (const m of MODULOS_SISTEMA) {
    assert.ok(admin.modulos.includes(m.id), `al Administrador le falta el módulo ${m.id}`);
  }
  for (const p of PERMISOS) {
    assert.ok(admin.permisos.includes(p.clave), `al Administrador le falta el permiso ${p.clave}`);
  }
});

test("no duplica claves que el Administrador ya tenía", () => {
  const DB = rolesLegacyPersistidos();
  reconciliarRoles(DB);
  const admin = DB.admin.roles.find((r) => r.nombre === "Administrador");
  assert.strictEqual(new Set(admin.permisos).size, admin.permisos.length, "permisos sin duplicados");
  assert.strictEqual(new Set(admin.modulos).size, admin.modulos.length, "módulos sin duplicados");
});

test("un rol NO-Administrador con permisos recortados NO recibe permisos/módulos nuevos (sin escalación silenciosa)", () => {
  const DB = rolesLegacyPersistidos();
  const cajeroAntes = JSON.parse(JSON.stringify(DB.admin.roles.find((r) => r.nombre === "Cajero")));
  reconciliarRoles(DB);
  const cajeroDespues = DB.admin.roles.find((r) => r.nombre === "Cajero");
  assert.deepStrictEqual(cajeroDespues, cajeroAntes, "los roles que no son Administrador no deben cambiar");
});

test("es idempotente: correrla dos veces deja el mismo resultado", () => {
  const DB = rolesLegacyPersistidos();
  reconciliarRoles(DB);
  const unaVez = JSON.parse(JSON.stringify(DB.admin.roles));
  reconciliarRoles(DB);
  assert.deepStrictEqual(DB.admin.roles, unaVez);
});

test("si no existe un rol llamado Administrador, no truena y no toca nada", () => {
  const DB = { admin: { roles: [{ id: 2, nombre: "Cajero", permisos: ["cerrar_venta"], modulos: ["pos"] }] } };
  const antes = JSON.parse(JSON.stringify(DB.admin.roles));
  assert.doesNotThrow(() => reconciliarRoles(DB));
  assert.deepStrictEqual(DB.admin.roles, antes);
});
