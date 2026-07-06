/**
 * clientes.js — Alta y consulta de clientes, con los campos que usa el
 * formulario "Datos de Cliente" de SICAR (crédito, monedero, saldo...).
 *
 * Esta es la misma fuente de datos que usará el futuro módulo de CRM —
 * por eso vive en su propio archivo, siguiendo el mismo patrón que
 * productos.js.
 */

function siguienteId(lista) {
  return lista.length ? Math.max(...lista.map((x) => x.id)) + 1 : 1;
}

function listarClientes(DB) {
  return DB.crm.clientes.map((c) => ({
    ...c,
    credito_disponible: Math.max(0, (c.limite_credito || 0) - (c.saldo || 0)),
  }));
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
    fecha_alta: new Date().toISOString().slice(0, 10),
    vendedor_asignado_id: datos.vendedor_asignado_id ? Number(datos.vendedor_asignado_id) : null,
    sucursal_id: datos.sucursal_id ? Number(datos.sucursal_id) : 1,
    estado: datos.estado || "contactado",
    ultimo_contacto: null,
    ubicacion: datos.ubicacion || "",
  };
  DB.crm.clientes.push(cliente);
  return cliente;
}

function actualizarCliente(DB, id, datos) {
  const idx = DB.crm.clientes.findIndex((c) => c.id === Number(id));
  if (idx === -1) throw new Error("Cliente no encontrado");
  DB.crm.clientes[idx] = { ...DB.crm.clientes[idx], ...datos, id: Number(id) };
  return DB.crm.clientes[idx];
}

module.exports = { listarClientes, obtenerCliente, crearCliente, actualizarCliente };
