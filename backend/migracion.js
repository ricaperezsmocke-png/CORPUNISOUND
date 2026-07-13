/**
 * migracion.js — Importar/exportar Artículos, Clientes y Proveedores desde
 * el Excel que exporta SICAR (Procesos > Exportar), y exportar un respaldo
 * propio de CORPUNISOUND releíble por este mismo importador.
 *
 * Cada instalación de SICAR corresponde a UNA sucursal — por eso Artículos
 * y Clientes piden sucursal al importar/exportar; Proveedores no, son
 * globales. El matching contra lo ya existente es SIEMPRE por clave/RFC,
 * nunca por nombre (ver spec 2026-07-12-migracion-datos-sicar-design.md).
 *
 * No hay todavía un archivo real de SICAR para confirmar los alias de
 * columna exactos — están concentrados en TABLAS_ALIAS para que ajustar
 * un nombre sea un cambio de una línea cuando llegue un archivo real.
 */

const XLSX = require("xlsx");

const TABLAS_ALIAS = {
  articulos: {
    clave: ["Clave", "Código", "Clave Artículo"],
    clave_alterna: ["Clave Alterna", "Código de Barras"],
    descripcion: ["Descripción", "Nombre", "Artículo"],
    categoria: ["Categoría"],
    departamento: ["Departamento"],
    costo: ["Costo", "Precio Compra", "Precio de Compra"],
    precio1: ["Precio 1", "Precio Público"],
    precio2: ["Precio 2"],
    precio3: ["Precio 3"],
    precio4: ["Precio 4"],
    existencia: ["Existencia", "Exist.", "Inventario"],
    unidad: ["Unidad", "Unidad Venta", "Unidad de Venta"],
    iva: ["IVA", "Impuesto", "Impuestos"],
    ubicacion: ["Ubicación", "Localización"],
  },
  clientes: {
    clave: ["Clave", "Código"],
    nombre: ["Nombre", "Cliente", "Razón Social"],
    rfc: ["RFC"],
    telefono: ["Teléfono"],
    celular: ["Celular"],
    email: ["eMail", "Correo", "Email"],
    limite_credito: ["Límite de Crédito", "Límite Crédito"],
    dias_credito: ["Días de Crédito"],
  },
  proveedores: {
    rfc: ["RFC"],
    nombre: ["Nombre", "Proveedor", "Razón Social"],
    contacto: ["Contacto", "Teléfono"],
  },
};

const COLUMNAS_MINIMAS = {
  articulos: ["clave", "descripcion"],
  clientes: ["clave", "nombre"],
  proveedores: ["rfc", "nombre"],
};

function normalizarTexto(texto) {
  return String(texto == null ? "" : texto)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase();
}

function mapearEncabezados(encabezados, tabla) {
  const mapa = {};
  const reconocidas = new Set();
  for (const [campo, alias] of Object.entries(tabla)) {
    const aliasNorm = alias.map(normalizarTexto);
    const encontrado = encabezados.find((e) => aliasNorm.includes(normalizarTexto(e)));
    if (encontrado) { mapa[campo] = encontrado; reconocidas.add(encontrado); }
  }
  return { mapa, reconocidas };
}

function parsearExcel(archivoBase64, tipo) {
  const tabla = TABLAS_ALIAS[tipo];
  if (!tabla) throw new Error(`Tipo de importación desconocido: ${tipo}`);

  let libro;
  let filasCrudas;
  try {
    libro = XLSX.read(archivoBase64, { type: "base64" });
    if (!libro.SheetNames.length) throw new Error("sin hojas");
    const hoja = libro.Sheets[libro.SheetNames[0]];
    filasCrudas = XLSX.utils.sheet_to_json(hoja, { defval: "" });
  } catch (e) {
    throw new Error("El archivo no se pudo leer como Excel (.xls/.xlsx válido)");
  }

  if (filasCrudas.length === 0) throw new Error("El archivo no tiene filas de datos");

  const encabezados = Object.keys(filasCrudas[0]);
  const { mapa, reconocidas } = mapearEncabezados(encabezados, tabla);

  const faltantes = COLUMNAS_MINIMAS[tipo].filter((campo) => !mapa[campo]);
  if (faltantes.length > 0) {
    throw new Error(
      `Faltan columnas obligatorias (${faltantes.join(", ")}). ` +
      `Columnas encontradas en el archivo: ${encabezados.join(", ")}`
    );
  }

  const columnas_no_reconocidas = encabezados.filter((e) => !reconocidas.has(e));

  const filas = filasCrudas.map((filaCruda, i) => {
    const fila = { numero_fila: i + 2 };
    for (const campo of Object.keys(tabla)) {
      const encabezado = mapa[campo];
      fila[campo] = encabezado ? filaCruda[encabezado] : undefined;
    }
    return fila;
  });

  return { filas, columnas_reconocidas: [...reconocidas], columnas_no_reconocidas };
}


function validarFilaArticulo(fila) {
  const errores = [];
  if (!fila.clave || !String(fila.clave).trim()) errores.push("Falta la clave");
  if (!fila.descripcion || !String(fila.descripcion).trim()) errores.push("Falta la descripcion");
  for (const campo of ["costo", "precio1", "precio2", "precio3", "precio4", "existencia"]) {
    const v = fila[campo];
    if (v !== undefined && v !== "" && !Number.isFinite(Number(v))) errores.push(`"${campo}" no es un numero valido`);
  }
  return errores;
}

function validarFilaCliente(fila) {
  const errores = [];
  if (!fila.clave || !String(fila.clave).trim()) errores.push("Falta la clave");
  if (!fila.nombre || !String(fila.nombre).trim()) errores.push("Falta el nombre");
  for (const campo of ["limite_credito", "dias_credito"]) {
    const v = fila[campo];
    if (v !== undefined && v !== "" && !Number.isFinite(Number(v))) errores.push(`"${campo}" no es un numero valido`);
  }
  return errores;
}

function validarFilaProveedor(fila) {
  const errores = [];
  if (!fila.rfc || !String(fila.rfc).trim()) errores.push("Falta el RFC");
  if (!fila.nombre || !String(fila.nombre).trim()) errores.push("Falta el nombre");
  return errores;
}

const VALIDADORES = { articulos: validarFilaArticulo, clientes: validarFilaCliente, proveedores: validarFilaProveedor };

function buscarArticuloExistente(DB, fila) {
  return DB["catalogo-productos"].productos.find((p) => p.sku === fila.clave || (fila.clave && p.clave_alterna === fila.clave)) || null;
}
function buscarClienteExistente(DB, fila) {
  return DB.crm.clientes.find((c) => c.clave === fila.clave) || null;
}
function buscarProveedorExistente(DB, fila) {
  return DB["catalogo-productos"].proveedores.find((p) => p.rfc === fila.rfc) || null;
}

const BUSCADORES = { articulos: buscarArticuloExistente, clientes: buscarClienteExistente, proveedores: buscarProveedorExistente };

function previsualizarImportacion(DB, tipo, filas) {
  const validar = VALIDADORES[tipo];
  const buscar = BUSCADORES[tipo];
  if (!validar || !buscar) throw new Error(`Tipo de importacion desconocido: ${tipo}`);

  const resultado = filas.map((fila) => {
    const errores = validar(fila);
    if (errores.length > 0) {
      return { numero_fila: fila.numero_fila, datos: fila, accion: null, id_existente: null, valida: false, errores };
    }
    const existente = buscar(DB, fila);
    return {
      numero_fila: fila.numero_fila,
      datos: fila,
      accion: existente ? "actualizacion" : "alta",
      id_existente: existente ? existente.id : null,
      valida: true,
      errores: [],
    };
  });

  const resumen = {
    total: resultado.length,
    altas: resultado.filter((r) => r.valida && r.accion === "alta").length,
    actualizaciones: resultado.filter((r) => r.valida && r.accion === "actualizacion").length,
    invalidas: resultado.filter((r) => !r.valida).length,
  };

  return { filas: resultado, resumen };
}


module.exports = { parsearExcel, previsualizarImportacion, normalizarTexto, TABLAS_ALIAS, VALIDADORES, BUSCADORES };
