/**
 * roles.js — Roles del sistema: cada uno es un nombre + una lista de
 * permisos (claves de permisosCatalogo.js) + una lista de módulos
 * habilitados (los "puntos verdes" en la pantalla de SICAR).
 */

const { PERMISOS, MODULOS_SISTEMA } = require("./permisosCatalogo");

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function listarRoles(DB) {
  return DB.admin.roles;
}

function obtenerRol(DB, id) {
  const rol = DB.admin.roles.find((r) => r.id === Number(id));
  if (!rol) throw new Error("Rol no encontrado");
  return rol;
}

function permisosDeRol(DB, rolId) {
  const rol = DB.admin.roles.find((r) => r.id === Number(rolId));
  return rol ? rol.permisos : [];
}

function crearRol(DB, datos) {
  if (!datos.nombre || !datos.nombre.trim()) throw new Error("El nombre del rol es obligatorio");
  const nuevo = {
    id: siguienteId(DB.admin.roles),
    nombre: datos.nombre.trim(),
    permisos: Array.isArray(datos.permisos) ? datos.permisos : [],
    modulos: Array.isArray(datos.modulos) ? datos.modulos : [],
  };
  DB.admin.roles.push(nuevo);
  return nuevo;
}

function actualizarRol(DB, id, datos) {
  const idx = DB.admin.roles.findIndex((r) => r.id === Number(id));
  if (idx === -1) throw new Error("Rol no encontrado");
  DB.admin.roles[idx] = {
    ...DB.admin.roles[idx],
    nombre: datos.nombre ?? DB.admin.roles[idx].nombre,
    permisos: Array.isArray(datos.permisos) ? datos.permisos : DB.admin.roles[idx].permisos,
    modulos: Array.isArray(datos.modulos) ? datos.modulos : DB.admin.roles[idx].modulos,
  };
  return DB.admin.roles[idx];
}

function eliminarRol(DB, id) {
  const enUso = DB.admin.usuarios.some((u) => u.rol_id === Number(id));
  if (enUso) throw new Error("No se puede eliminar: hay personal asignado a este rol");
  DB.admin.roles = DB.admin.roles.filter((r) => r.id !== Number(id));
}

function clonarRol(DB, id, nuevoNombre) {
  const original = obtenerRol(DB, id);
  return crearRol(DB, { nombre: nuevoNombre || `${original.nombre} (copia)`, permisos: original.permisos, modulos: original.modulos });
}

function sembrarRolesIniciales(DB) {
  if (DB.admin.roles.length > 0) return;
  const todasLasClaves = PERMISOS.map((p) => p.clave);
  const todosLosModulos = MODULOS_SISTEMA.map((m) => m.id);
  crearRol(DB, { nombre: "Administrador", permisos: todasLasClaves, modulos: todosLosModulos });
  crearRol(DB, {
    nombre: "Gerente de sucursal",
    permisos: todasLasClaves.filter((c) => c !== "eliminar_producto" && c !== "administrar_roles" && c !== "dar_alta_personal" && c !== "ver_todas_las_sucursales"),
    modulos: ["pos", "corte", "inventario", "crm"],
  });
  crearRol(DB, {
    nombre: "Cajero",
    permisos: [
      "buscar_articulos", "cambiar_cliente", "cambiar_vendedor", "cambiar_tipo_documento",
      "cerrar_venta", "cargar_cotizacion", "poner_ticket_en_espera", "imprimir_ultimo_documento",
      "crear_cliente", "cambiar_estado_cliente", "registrar_contacto_cliente",
      "ver_lista_ventas", "mostrar_detalle_venta", "usar_asistente_ia",
      "realizar_corte_caja",
    ],
    modulos: ["pos", "corte", "crm"],
  });
}

/**
 * Reconciliación del rol "Administrador" contra el catálogo actual.
 *
 * sembrarRolesIniciales solo corre cuando DB.admin.roles está vacío; en
 * cualquier instancia con datos ya persistidos en SQLite (como producción),
 * los roles restaurados son un snapshot congelado del catálogo de cuando se
 * sembraron. Al agregar un módulo nuevo (ej. "ml") o un permiso nuevo (ej.
 * realizar_traspasos, recibir_compra), ni siquiera el Administrador los
 * recibía, y los botones desaparecían para todos.
 *
 * Esta función se aplica siempre, después de la restauración, para garantizar
 * que el Administrador tenga TODOS los módulos y permisos del catálogo
 * (unión, sin duplicar, sin quitar nada). Los demás roles (Gerente, Cajero,
 * personalizados) NO se tocan: agregarles permisos nuevos automáticamente
 * sería una escalación de privilegio silenciosa — el admin los ajusta a mano
 * desde Roles y Personal. Es idempotente: correrla varias veces da lo mismo.
 */
function reconciliarRoles(DB) {
  const admin = DB.admin.roles.find((r) => r.nombre === "Administrador");
  if (!admin) return;
  admin.permisos = [...new Set([...admin.permisos, ...PERMISOS.map((p) => p.clave)])];
  admin.modulos = [...new Set([...admin.modulos, ...MODULOS_SISTEMA.map((m) => m.id)])];
}

module.exports = { listarRoles, obtenerRol, permisosDeRol, crearRol, actualizarRol, eliminarRol, clonarRol, sembrarRolesIniciales, reconciliarRoles };
