/**
 * clientes.js — Alta y consulta de clientes, con los campos que usa el
 * formulario "Datos de Cliente" de SICAR (crédito, monedero, saldo...).
 *
 * Esta es la misma fuente de datos que usará el futuro módulo de CRM —
 * por eso vive en su propio archivo, siguiendo el mismo patrón que
 * productos.js.
 */

const { fechaLocal } = require("./fechas");

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function listarClientes(DB, alcance) {
  const conCredito = DB.crm.clientes.map((c) => ({
    ...c,
    credito_disponible: Math.max(0, (c.limite_credito || 0) - (c.saldo || 0)),
  }));
  if (!alcance || alcance.verTodas) return conCredito;
  // Público en General (id 0) es compartido: visible en toda sucursal.
  return conCredito.filter((c) => c.id === 0 || Number(c.sucursal_id) === alcance.sucursalId);
}

function obtenerCliente(DB, id) {
  const c = DB.crm.clientes.find((x) => x.id === Number(id));
  if (!c) throw new Error("Cliente no encontrado");
  return { ...c, credito_disponible: Math.max(0, (c.limite_credito || 0) - (c.saldo || 0)) };
}

function crearCliente(DB, datos) {
  if (!datos.nombre || !datos.nombre.trim()) {
    throw new Error("El nombre del cliente es obligatorio");
  }
  const nuevoId = siguienteId(DB.crm.clientes);
  const cliente = {
    id: nuevoId,
    clave: datos.clave || "",
    representante: datos.representante || datos.nombre.trim(),
    nombre: datos.nombre.trim(),
    tipo: datos.tipo || "menudeo",
    rfc: datos.rfc || "XAXX010101000",
    email: datos.email || "",
    telefono: datos.telefono || "",
    celular: datos.celular || "",
    sujeto_credito: !!datos.sujeto_credito,
    precio_lista: Number(datos.precio_lista) || 1,
    dias_credito: Number(datos.dias_credito) || 0,
    limite_credito: Number(datos.limite_credito) || 0,
    monedero: Number(datos.monedero) || 0,
    saldo: 0,
    saldo_vencido: 0,
    fecha_vencimiento: null,
    fecha_alta: fechaLocal(),
    vendedor_asignado_id: datos.vendedor_asignado_id ? Number(datos.vendedor_asignado_id) : null,
    sucursal_id: datos.sucursal_id ? Number(datos.sucursal_id) : 1,
    estado: datos.estado || "contactado",
    origen: datos.origen || "",
    ultimo_contacto: null,
    ubicacion: datos.ubicacion || "",
  };
  DB.crm.clientes.push(cliente);
  return cliente;
}

/**
 * Lo que una persona SI puede editar de un cliente desde una pantalla.
 *
 * Sale de la lista de campos de `crearCliente`, menos los de dinero y los que
 * lleva el sistema. Al agregar un campo nuevo al cliente hay que decidir
 * explicitamente si entra aqui: si no entra, deja de ser editable, que es el
 * lado seguro del error.
 *
 * FUERA a proposito, y esta es la razon del cambio: `saldo`, `saldo_vencido`,
 * `monedero`, `limite_credito` y `sujeto_credito`. Antes esta funcion copiaba el
 * cuerpo de la peticion ENTERO sobre el cliente, asi que quien tuviera
 * `editar_cliente` —el Gerente de sucursal lo tiene— podia fijarse por HTTP el
 * limite de credito, el monedero o el saldo de cualquier cliente. Era la puerta
 * trasera del credito, y sigue importando aunque el credito este apagado:
 * `monedero` y `saldo` son dinero.
 *
 * Tambien quedan fuera `fecha_alta` (es historia) y `id` (reasignarlo
 * convertiria a un cliente en otro y le llevaria su historial encima).
 */
const CAMPOS_EDITABLES = [
  "clave", "representante", "nombre", "tipo", "rfc",
  "email", "telefono", "celular",
  "precio_lista", "dias_credito",
  "vendedor_asignado_id", "sucursal_id",
  "estado", "origen", "ultimo_contacto", "ubicacion",
];

function actualizarCliente(DB, id, datos) {
  const idx = DB.crm.clientes.findIndex((c) => c.id === Number(id));
  if (idx === -1) throw new Error("Cliente no encontrado");
  const cambios = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (Object.prototype.hasOwnProperty.call(datos, campo)) cambios[campo] = datos[campo];
  }
  DB.crm.clientes[idx] = { ...DB.crm.clientes[idx], ...cambios, id: Number(id) };
  return DB.crm.clientes[idx];
}

module.exports = { listarClientes, obtenerCliente, crearCliente, actualizarCliente };
