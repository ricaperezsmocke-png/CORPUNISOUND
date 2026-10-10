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

function idVendedorAsignado(valor) {
  return valor === null || valor === undefined || valor === "" || Number(valor) === 0
    ? null
    : Number(valor);
}

function validarVendedorDelCliente(DB, vendedorId, sucursalId) {
  if (vendedorId === null) return;
  const vendedor = DB.pos.vendedores.find((item) => item.id === vendedorId);
  if (!vendedor) throw new Error("El vendedor asignado no existe");
  if (Number(vendedor.sucursal_id) !== Number(sucursalId)) {
    throw new Error("El vendedor asignado debe pertenecer a la misma sucursal del cliente");
  }
}

function crearCliente(DB, datos) {
  if (!datos.nombre || !datos.nombre.trim()) {
    throw new Error("El nombre del cliente es obligatorio");
  }
  const nuevoId = siguienteId(DB.crm.clientes);
  const vendedor_asignado_id = idVendedorAsignado(datos.vendedor_asignado_id);
  const sucursal_id = datos.sucursal_id ? Number(datos.sucursal_id) : 1;
  validarVendedorDelCliente(DB, vendedor_asignado_id, sucursal_id);
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
    sujeto_credito: false,
    precio_lista: Number(datos.precio_lista) || 1,
    dias_credito: Number(datos.dias_credito) || 0,
    limite_credito: 0,
    monedero: 0,
    saldo: 0,
    saldo_vencido: 0,
    fecha_vencimiento: null,
    fecha_alta: fechaLocal(),
    vendedor_asignado_id,
    sucursal_id,
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
  const tocaVendedor = Object.prototype.hasOwnProperty.call(datos, "vendedor_asignado_id");
  const tocaSucursal = Object.prototype.hasOwnProperty.call(datos, "sucursal_id");
  if (tocaVendedor || tocaSucursal) {
    const vendedorFinal = tocaVendedor
      ? idVendedorAsignado(datos.vendedor_asignado_id)
      : idVendedorAsignado(DB.crm.clientes[idx].vendedor_asignado_id);
    const sucursalFinal = tocaSucursal
      ? Number(datos.sucursal_id)
      : Number(DB.crm.clientes[idx].sucursal_id);
    validarVendedorDelCliente(DB, vendedorFinal, sucursalFinal);
    cambios.vendedor_asignado_id = vendedorFinal;
    cambios.sucursal_id = sucursalFinal;
  }
  DB.crm.clientes[idx] = { ...DB.crm.clientes[idx], ...cambios, id: Number(id) };
  return DB.crm.clientes[idx];
}

/**
 * Teléfono para COMPARAR (lo guardado queda como lo escribió la persona):
 * solo dígitos y, si sobran, los últimos 10 — así "+52 961 123 4567",
 * "961-123-4567" y "9611234567" son el mismo número. Misma regla que
 * `telefonoNormalizado` del Radar de Demanda.
 */
function normalizarTelefono(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos.length > 10 ? digitos.slice(-10) : digitos;
}

function normalizarCorreo(valor) {
  return String(valor ?? "").trim().toLowerCase();
}

function errorConStatus(mensaje, status, extra = {}) {
  const error = new Error(mensaje);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

const MENSAJE_TELEFONO_OBLIGATORIO = "El teléfono del cliente es obligatorio (10 dígitos)";

/**
 * Reglas de contacto de las pantallas de clientes (CRM y Punto de Venta):
 * teléfono obligatorio y nada de dar de alta dos veces a la misma persona.
 *
 * Un cliente duplicado no es inocente: dos vendedoras con la misma persona
 * en fichas distintas se pisan el seguimiento, parten el historial de compras
 * y, el día que haya comisión por cliente, se pelean el crédito. Por eso el
 * teléfono y el correo se buscan en TODAS las tiendas, no solo en la propia.
 *
 * Vive fuera de crearCliente/actualizarCliente a propósito: la importación de
 * SICAR (migracion.js) trae clientes sin teléfono y tiene su propio
 * emparejamiento, y el Radar busca por teléfono en su tienda antes de crear.
 * Esos dos caminos no cambian.
 *
 * - `modo: "alta"`: exige teléfono o celular de 10 dígitos.
 * - `modo: "edicion"`: solo mira los campos que la petición trae; no exige
 *   formato (hay clientes viejos con teléfonos cortos) pero no deja vaciar
 *   ambos números ni ponerle a uno el número o correo de otro.
 *
 * `fueraDeAlcance(clienteExistente)` dice si quien captura no puede ver a ese
 * cliente; entonces se le indica que pida el cambio a su gerente.
 */
function validarContactoCliente(DB, datos, { modo, clienteId = null, fueraDeAlcance = () => false }) {
  const trae = (campo) => Object.prototype.hasOwnProperty.call(datos, campo);
  const actual = clienteId === null ? {} : (DB.crm.clientes.find((c) => c.id === Number(clienteId)) || {});
  const tocaTelefonos = modo === "alta" || trae("telefono") || trae("celular");
  const tocaCorreo = modo === "alta" || trae("email");
  if (!tocaTelefonos && !tocaCorreo) return;

  // Solo texto (o vacío). Un arreglo u objeto pasaba la validación convertido
  // a texto pero se guardaba tal cual, y la ficha del CRM truena al leerlo.
  for (const campo of ["telefono", "celular", "email"]) {
    if (trae(campo) && datos[campo] !== null && datos[campo] !== undefined && typeof datos[campo] !== "string") {
      throw errorConStatus("El teléfono, el celular y el correo deben escribirse como texto", 400);
    }
  }

  const numeros = ["telefono", "celular"].map((campo) => (trae(campo) ? datos[campo] : actual[campo]));

  if (tocaTelefonos) {
    if (modo === "alta") {
      for (const valor of numeros) {
        const normal = normalizarTelefono(valor);
        if (String(valor ?? "").trim() && normal.length !== 10) {
          throw errorConStatus("El teléfono debe tener 10 dígitos", 400);
        }
      }
      if (!numeros.some((valor) => normalizarTelefono(valor).length === 10)) {
        throw errorConStatus(MENSAJE_TELEFONO_OBLIGATORIO, 400);
      }
    } else if (!numeros.some((valor) => String(valor ?? "").trim())) {
      throw errorConStatus(MENSAJE_TELEFONO_OBLIGATORIO, 400);
    }
  }

  const otros = DB.crm.clientes.filter((c) => c.id !== 0 && (clienteId === null || c.id !== Number(clienteId)));
  const rechazar = (existente, queCoincide) => {
    const sucursal = DB.pos.sucursales.find((s) => Number(s.id) === Number(existente.sucursal_id));
    const nombreSucursal = sucursal ? sucursal.nombre : `sucursal ${existente.sucursal_id}`;
    let mensaje = `Este cliente ya está registrado: ${queCoincide} es de ${existente.nombre} (${nombreSucursal}).`;
    if (fueraDeAlcance(existente)) mensaje += " Pídele a tu gerente que lo cambie a tu tienda.";
    throw errorConStatus(mensaje, 409, {
      cliente_existente: { id: existente.id, nombre: existente.nombre, sucursal: nombreSucursal },
    });
  };

  if (tocaTelefonos) {
    // Alta: los dos números. Edición: solo los que trae la petición (un
    // duplicado viejo en el campo que no se tocó no debe trabar el cambio), y
    // de cualquier largo: en edición se aceptan números cortos históricos,
    // así que también hay que evitar que se repitan.
    const aRevisar = modo === "alta"
      ? numeros
      : ["telefono", "celular"].filter(trae).map((campo) => datos[campo]);
    const propios = aRevisar.map(normalizarTelefono).filter((n) => (modo === "alta" ? n.length === 10 : n.length > 0));
    for (const numero of propios) {
      const existente = otros.find((c) => [c.telefono, c.celular].some((v) => normalizarTelefono(v) === numero));
      if (existente) rechazar(existente, `el teléfono ${numero}`);
    }
  }

  if (tocaCorreo) {
    const correo = normalizarCorreo(trae("email") ? datos.email : actual.email);
    if (correo) {
      const existente = otros.find((c) => normalizarCorreo(c.email) === correo);
      if (existente) rechazar(existente, `el correo ${correo}`);
    }
  }
}

module.exports = {
  listarClientes, obtenerCliente, crearCliente, actualizarCliente,
  validarContactoCliente, normalizarTelefono,
};
