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
const { crearProducto, actualizarProducto, ajustarExistencia, crearCategoria, crearDepartamento } = require("./productos");

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
  // Descripción no es validada aquí: es obligatoria solo al crear (crearProducto la valida),
  // pero en importaciones de actualización puede no estar presente
  for (const campo of ["costo", "precio1", "precio2", "precio3", "precio4", "existencia"]) {
    const v = fila[campo];
    if (v !== undefined && v !== "" && !Number.isFinite(Number(v))) errores.push(`"${campo}" no es un número válido`);
  }
  return errores;
}

function validarFilaCliente(fila) {
  const errores = [];
  if (!fila.clave || !String(fila.clave).trim()) errores.push("Falta la clave");
  if (!fila.nombre || !String(fila.nombre).trim()) errores.push("Falta el nombre");
  for (const campo of ["limite_credito", "dias_credito"]) {
    const v = fila[campo];
    if (v !== undefined && v !== "" && !Number.isFinite(Number(v))) errores.push(`"${campo}" no es un número válido`);
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

function interpretarIva(valor) {
  const norm = normalizarTexto(valor);
  if (!norm) return false;
  if (["no", "0", "false"].includes(norm)) return false;
  return true;
}

function resolverCategoriaPorNombre(DB, nombre) {
  if (!nombre || !String(nombre).trim()) return undefined;
  const norm = normalizarTexto(nombre);
  const existente = DB["catalogo-productos"].categorias.find((c) => normalizarTexto(c.nombre) === norm);
  return existente ? existente.id : crearCategoria(DB, String(nombre).trim()).id;
}

function resolverDepartamentoPorNombre(DB, nombre) {
  if (!nombre || !String(nombre).trim()) return undefined;
  const norm = normalizarTexto(nombre);
  const existente = DB["catalogo-productos"].departamentos.find((d) => normalizarTexto(d.nombre) === norm);
  return existente ? existente.id : crearDepartamento(DB, String(nombre).trim()).id;
}

function construirPrecios(fila, existente, costoNuevo) {
  const niveles = [fila.precio1, fila.precio2, fila.precio3, fila.precio4];
  const algunoTraePrecio = niveles.some((v) => v !== undefined && v !== "" && Number.isFinite(Number(v)));
  if (!algunoTraePrecio) return undefined;
  const preciosActuales = Array.isArray(existente?.precios)
    ? existente.precios
    : [{ utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }];
  return niveles.map((v, i) => {
    if (v === undefined || v === "" || !Number.isFinite(Number(v))) return preciosActuales[i];
    const precioVenta = Math.round(Number(v) * 100) / 100;
    const utilidad = costoNuevo > 0 ? Math.round(((precioVenta / costoNuevo) - 1) * 10000) / 100 : 0;
    return { utilidad, precioVenta };
  });
}

function prepararDatosArticulo(DB, fila, existente, defaults) {
  const errores = [];
  // defaults solo aplica a altas: en una actualización, que la fila omita
  // categoria/departamento/unidad/iva significa "no tocar ese campo", no
  // "usar el default del lote" — si no, un lote con defaults pisaría en
  // silencio esos campos de artículos ya existentes que el archivo de SICAR
  // no traiga completos (ver hallazgo de revisión).
  const categoriaNombre = fila.categoria || (!existente ? defaults?.categoria : undefined);
  const departamentoNombre = fila.departamento || (!existente ? defaults?.departamento : undefined);
  const unidad = fila.unidad || (!existente ? defaults?.unidad : undefined);

  if (!existente) {
    // Estas validaciones deben correr ANTES de resolverCategoriaPorNombre/
    // resolverDepartamentoPorNombre más abajo: esas funciones CREAN la
    // categoría/departamento en la DB si no existen todavía. Si dejamos
    // pasar una alta a la que le falta la descripción, crearProducto la
    // rechaza después, pero la categoría/departamento ya se habría creado
    // como huérfana (ver hallazgo de revisión — "revalidar todo ANTES de
    // mutar nada").
    if (!fila.descripcion || !String(fila.descripcion).trim()) errores.push("Falta descripción (obligatoria para dar de alta un artículo nuevo)");
    if (!categoriaNombre) errores.push("Falta categoría (ni en el archivo ni en los datos por defecto)");
    if (!departamentoNombre) errores.push("Falta departamento (ni en el archivo ni en los datos por defecto)");
    if (!unidad) errores.push("Falta unidad (ni en el archivo ni en los datos por defecto)");
  }
  if (errores.length > 0) return { errores };

  const costoNuevo = fila.costo !== undefined && fila.costo !== "" ? Number(fila.costo) : (existente ? existente.costo : 0);
  const datos = {
    descripcion: fila.descripcion,
    clave: fila.clave,
    clave_alterna: fila.clave_alterna || undefined,
    categoria_id: resolverCategoriaPorNombre(DB, categoriaNombre),
    departamento_id: resolverDepartamentoPorNombre(DB, departamentoNombre),
    unidad_venta: unidad,
    unidad_compra: unidad,
    precio_compra: fila.costo !== undefined && fila.costo !== "" ? costoNuevo : undefined,
    iva: fila.iva !== undefined && fila.iva !== "" ? interpretarIva(fila.iva) : (!existente && defaults?.iva !== undefined ? !!defaults.iva : undefined),
    ubicacion: fila.ubicacion || undefined,
  };
  const precios = construirPrecios(fila, existente, costoNuevo);
  if (precios) datos.precios = precios;

  return { datos, errores: [] };
}

function aplicarFilaArticulo(DB, fila, existente, sucursal_id, defaults, nombreArchivo) {
  const { datos, errores } = prepararDatosArticulo(DB, fila, existente, defaults);
  if (errores.length > 0) throw new Error(errores.join("; "));

  if (existente) {
    const hayExistenciaEnArchivo = fila.existencia !== undefined && fila.existencia !== "";
    // Precondición chequeada ANTES de actualizarProducto: ajustarExistencia
    // truena si no hay fila de existencia para este producto+sucursal (p.ej.
    // productos creados antes de que existiera la sucursal — ver CEDIS en
    // sucursales.js). Si no chequeamos esto primero, actualizarProducto ya
    // habría mutado costo/categoría/etc. y el error de existencia dejaría
    // al producto en un estado a medias, aunque la fila se reporte como
    // error completo (viola "un fallo en una fila no corrompe las demás").
    const exist = hayExistenciaEnArchivo
      ? DB.inventario.existencias.find((e) => e.producto_id === existente.id && e.sucursal_id === Number(sucursal_id))
      : null;
    if (hayExistenciaEnArchivo && !exist) {
      throw new Error("Este producto no tiene registro de existencia en esta sucursal");
    }
    const actualizado = actualizarProducto(DB, existente.id, datos, sucursal_id);
    if (hayExistenciaEnArchivo) {
      const delta = Number(fila.existencia) - exist.cantidad_actual;
      if (delta !== 0) ajustarExistencia(DB, existente.id, { cantidad: delta, motivo: `Importación SICAR — ${nombreArchivo || "archivo"}`, sucursal_id });
    }
    return actualizado;
  }
  return crearProducto(DB, { ...datos, existencia_inicial: fila.existencia !== undefined && fila.existencia !== "" ? Number(fila.existencia) : 0 }, sucursal_id);
}

const APLICADORES = { articulos: aplicarFilaArticulo };

function aplicarImportacion(DB, tipo, filasConfirmadas, sucursal_id, defaults, nombreArchivo) {
  const validar = VALIDADORES[tipo];
  const buscar = BUSCADORES[tipo];
  const aplicar = APLICADORES[tipo];
  if (!validar || !buscar || !aplicar) throw new Error(`Tipo de importación desconocido: ${tipo}`);

  const preparadas = filasConfirmadas.map((fila) => ({
    fila,
    erroresValidacion: validar(fila),
    existente: buscar(DB, fila),
  }));

  let actualizados = 0;
  let nuevos = 0;
  const errores = [];

  for (const { fila, erroresValidacion, existente } of preparadas) {
    if (erroresValidacion.length > 0) {
      errores.push({ numero_fila: fila.numero_fila, clave: fila.clave || fila.rfc, motivo: erroresValidacion.join("; ") });
      continue;
    }
    try {
      aplicar(DB, fila, existente, sucursal_id, defaults, nombreArchivo);
      if (existente) actualizados++; else nuevos++;
    } catch (e) {
      errores.push({ numero_fila: fila.numero_fila, clave: fila.clave || fila.rfc, motivo: e.message });
    }
  }

  return { actualizados, nuevos, errores };
}

function previsualizarImportacion(DB, tipo, filas) {
  const validar = VALIDADORES[tipo];
  const buscar = BUSCADORES[tipo];
  if (!validar || !buscar) throw new Error(`Tipo de importación desconocido: ${tipo}`);

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

module.exports = {
  parsearExcel, previsualizarImportacion, aplicarImportacion,
  normalizarTexto, TABLAS_ALIAS, VALIDADORES, BUSCADORES,
};
