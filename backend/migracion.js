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
 * Los alias de columna en TABLAS_ALIAS ya están confirmados contra archivos
 * reales de SICAR (Artículos, Clientes y Proveedores exportados desde una
 * instalación real, julio 2026) — ver spec 2026-07-12-migracion-datos-sicar-design.md
 * y el hallazgo de revisión que corrigió los mismatches encontrados. Siguen
 * concentrados en TABLAS_ALIAS para que ajustar un nombre siga siendo un
 * cambio de una línea si aparece una variante de export distinta.
 */

const XLSX = require("xlsx");
const { crearProducto, actualizarProducto, ajustarExistencia, crearCategoria, crearDepartamento, crearProveedor } = require("./productos");
const { crearCliente, actualizarCliente } = require("./clientes");

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
    // producto.iva es hoy un booleano simple, informativo — no se usa en
    // checkout/pricing (confirmado por grep). Victor mencionó querer una tasa
    // de IVA ajustable por sucursal (8%/16%) a futuro; eso es OTRA feature,
    // fuera de alcance aquí — se deja como breadcrumb para quien la tome.
    iva: ["IVA", "Impuesto", "Impuestos", "IMPUESTO (S/N)"],
    ubicacion: ["Ubicación", "Localización"],
  },
  clientes: {
    clave: ["Clave", "Código"],
    nombre: ["Nombre", "Cliente", "Razón Social"],
    rfc: ["RFC"],
    telefono: ["Teléfono"],
    celular: ["Celular"],
    email: ["eMail", "Correo", "Email", "Emails"],
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
  // El SICAR real de Victor NO tiene columna de Clave/Código para Clientes
  // (confirmado leyendo el archivo real). clave sigue en TABLAS_ALIAS.clientes
  // como campo opcional por si algún otro export sí la trae, pero ya no es
  // obligatoria — ver buscarClienteExistente para el efecto en matching.
  clientes: ["nombre"],
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

  // XLSX.sheet_to_json regresa una celda que "parece número" como Number de
  // JS, no como string (ej. una Clave "12345" sin formato de texto en la
  // hoja). El matching de más abajo (buscarArticuloExistente, etc.) usa
  // === contra sku/clave/rfc guardados como string, y crearProducto hace
  // .trim() sobre datos.clave — ambos truenan/fallan en silencio si esto
  // sigue siendo number. Se normaliza aquí, una sola vez, para que TODO lo
  // que consuma una fila (validación, matching, aplicación) siempre reciba
  // string. Ojo: solo se stringifica si hay un valor real — String(null) o
  // String(undefined) producirían el string literal "null"/"undefined".
  const CAMPOS_CLAVE = ["clave", "clave_alterna", "rfc"];
  const filas = filasCrudas.map((filaCruda, i) => {
    const fila = { numero_fila: i + 2 };
    for (const campo of Object.keys(tabla)) {
      const encabezado = mapa[campo];
      let valor = encabezado ? filaCruda[encabezado] : undefined;
      if (CAMPOS_CLAVE.includes(campo) && valor !== undefined && valor !== null && valor !== "") {
        valor = String(valor).trim();
      }
      fila[campo] = valor;
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
  // clave es opcional: el SICAR real de Victor no tiene columna de
  // Clave/Código para Clientes en absoluto. Sin clave, cada fila siempre se
  // da de alta como cliente nuevo (ver buscarClienteExistente) — Victor
  // acepta que reimportar el mismo archivo cree clientes duplicados, para
  // el uso ocasional/único que le va a dar a esta migración.
  if (!fila.nombre || !String(fila.nombre).trim()) errores.push("Falta el nombre");
  for (const campo of ["limite_credito", "dias_credito"]) {
    const v = fila[campo];
    if (v !== undefined && v !== "" && !Number.isFinite(Number(v))) errores.push(`"${campo}" no es un número válido`);
  }
  return errores;
}

function validarFilaProveedor(fila) {
  const errores = [];
  // RFC es opcional: 33 de 54 proveedores (61%) en un archivo real de SICAR
  // no traen RFC. nombre sigue siendo obligatorio, es el único dato con el
  // que se puede dar de alta o matchear al proveedor cuando falta el RFC
  // (ver buscarProveedorExistente).
  if (!fila.nombre || !String(fila.nombre).trim()) errores.push("Falta el nombre");
  return errores;
}

const VALIDADORES = { articulos: validarFilaArticulo, clientes: validarFilaCliente, proveedores: validarFilaProveedor };

// Los tres BUSCADORES comparten firma (DB, fila, sucursal_id) aunque solo
// clientes la use: cada instalación de SICAR es una sucursal independiente
// que numera sus propios clientes desde cero, así que una misma clave en
// dos sucursales distintas son DOS personas reales distintas — nunca deben
// matchear entre sí (decisión explícita de Victor, ver hallazgo crítico de
// revisión de rama completa). Artículos matchea por sku/clave_alterna sin
// sucursal (el sku es único en todo el catálogo); Proveedores son globales
// por diseño (decisión 2 del spec) — ninguno de los dos debe cambiar aquí.
function buscarArticuloExistente(DB, fila, sucursal_id) {
  return DB["catalogo-productos"].productos.find((p) => p.sku === fila.clave || (fila.clave && p.clave_alterna === fila.clave)) || null;
}
function buscarClienteExistente(DB, fila, sucursal_id) {
  // El SICAR real de Victor no trae clave para Clientes: fila.clave viene
  // vacío/undefined en (casi) todas las filas reales. Sin este guard, dos
  // clientes reales distintos importados en la misma sucursal con
  // clave === "" harían match entre sí (comparando "" === "") en una
  // segunda importación, mezclando/pisando a una persona con otra. "Sin
  // clave" debe significar SIEMPRE alta nueva, nunca actualización.
  if (!fila.clave || !String(fila.clave).trim()) return null;
  return DB.crm.clientes.find((c) => c.clave === fila.clave && c.sucursal_id === Number(sucursal_id)) || null;
}
function buscarProveedorExistente(DB, fila, sucursal_id) {
  // RFC sigue siendo la clave primaria/confiable de matching cuando viene en
  // el archivo. Cuando falta (61% de los proveedores reales de SICAR no
  // traen RFC), se hace fallback a nombre normalizado — igual que
  // resolverCategoriaPorNombre/resolverDepartamentoPorNombre más abajo.
  if (fila.rfc && String(fila.rfc).trim()) {
    return DB["catalogo-productos"].proveedores.find((p) => p.rfc === fila.rfc) || null;
  }
  return DB["catalogo-productos"].proveedores.find((p) => normalizarTexto(p.nombre) === normalizarTexto(fila.nombre)) || null;
}

const BUSCADORES = { articulos: buscarArticuloExistente, clientes: buscarClienteExistente, proveedores: buscarProveedorExistente };

function interpretarIva(valor) {
  const norm = normalizarTexto(valor);
  if (!norm) return false;
  // "n" es el valor real de SICAR para IMPUESTO (S/N)/IMP I.V.A.16(S/N)/IMP
  // IVA 8(S/N) cuando el artículo NO lleva IVA — normalizarTexto lo deja en
  // "n", que antes NO estaba en esta lista y por lo tanto caía en el
  // `return true` de abajo (bug real, confirmado con un archivo real de
  // SICAR: todo artículo con "N" se importaba con iva: true).
  if (["no", "n", "0", "false"].includes(norm)) return false;
  if (["si", "s", "1", "true"].includes(norm)) return true;
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
  let exist = null;
  if (existente) {
    const hayExistenciaEnArchivo = fila.existencia !== undefined && fila.existencia !== "";
    // Precondición chequeada ANTES de prepararDatosArticulo (y por lo tanto
    // antes de actualizarProducto): prepararDatosArticulo llama a
    // resolverCategoriaPorNombre/resolverDepartamentoPorNombre, que CREAN la
    // categoría/departamento en la DB si no existen todavía — igual que
    // crearProducto en el caso de alta (ver hallazgo de revisión). Si
    // dejáramos que prepararDatosArticulo corra primero y luego esta
    // precondición truena (p.ej. productos creados antes de que existiera la
    // sucursal — ver CEDIS en sucursales.js), la categoría/departamento
    // quedaría huérfana aunque la fila se reporte como error completo (viola
    // "revalidar todo ANTES de mutar nada" / "un fallo en una fila no
    // corrompe las demás").
    exist = hayExistenciaEnArchivo
      ? DB.inventario.existencias.find((e) => e.producto_id === existente.id && e.sucursal_id === Number(sucursal_id))
      : null;
    if (hayExistenciaEnArchivo && !exist) {
      throw new Error("Este producto no tiene registro de existencia en esta sucursal");
    }
  }

  const { datos, errores } = prepararDatosArticulo(DB, fila, existente, defaults);
  if (errores.length > 0) throw new Error(errores.join("; "));

  if (existente) {
    const actualizado = actualizarProducto(DB, existente.id, datos, sucursal_id);
    if (fila.existencia !== undefined && fila.existencia !== "") {
      const delta = Number(fila.existencia) - exist.cantidad_actual;
      if (delta !== 0) ajustarExistencia(DB, existente.id, { cantidad: delta, motivo: `Importación SICAR — ${nombreArchivo || "archivo"}`, sucursal_id });
    }
    return actualizado;
  }
  return crearProducto(DB, { ...datos, existencia_inicial: fila.existencia !== undefined && fila.existencia !== "" ? Number(fila.existencia) : 0 }, sucursal_id);
}

function aplicarFilaCliente(DB, fila, existente, sucursal_id) {
  const datosCrudos = {
    clave: fila.clave,
    nombre: fila.nombre,
    rfc: fila.rfc || undefined,
    telefono: fila.telefono || undefined,
    celular: fila.celular || undefined,
    email: fila.email || undefined,
    limite_credito: fila.limite_credito !== undefined && fila.limite_credito !== "" ? Number(fila.limite_credito) : undefined,
    dias_credito: fila.dias_credito !== undefined && fila.dias_credito !== "" ? Number(fila.dias_credito) : undefined,
  };
  if (existente) {
    // actualizarCliente hace un spread plano — NUNCA mandarle valores
    // undefined, o sobrescribiría campos existentes con undefined.
    const datosLimpios = Object.fromEntries(Object.entries(datosCrudos).filter(([, v]) => v !== undefined));
    return actualizarCliente(DB, existente.id, datosLimpios);
  }
  return crearCliente(DB, { ...datosCrudos, sucursal_id });
}

function aplicarFilaProveedor(DB, fila, existente) {
  if (existente) {
    if (fila.nombre) existente.nombre = fila.nombre;
    if (fila.contacto) existente.contacto = fila.contacto;
    return existente;
  }
  const nuevo = crearProveedor(DB, fila.nombre, fila.rfc);
  if (fila.contacto) nuevo.contacto = fila.contacto;
  return nuevo;
}

const APLICADORES = { articulos: aplicarFilaArticulo, clientes: aplicarFilaCliente, proveedores: aplicarFilaProveedor };

function aplicarImportacion(DB, tipo, filasConfirmadas, sucursal_id, defaults, nombreArchivo) {
  const validar = VALIDADORES[tipo];
  const buscar = BUSCADORES[tipo];
  const aplicar = APLICADORES[tipo];
  if (!validar || !buscar || !aplicar) throw new Error(`Tipo de importación desconocido: ${tipo}`);

  const preparadas = filasConfirmadas.map((fila) => ({
    fila,
    erroresValidacion: validar(fila),
    existente: buscar(DB, fila, sucursal_id),
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

function previsualizarImportacion(DB, tipo, filas, sucursal_id) {
  const validar = VALIDADORES[tipo];
  const buscar = BUSCADORES[tipo];
  if (!validar || !buscar) throw new Error(`Tipo de importación desconocido: ${tipo}`);

  const resultado = filas.map((fila) => {
    const errores = validar(fila);
    if (errores.length > 0) {
      return { numero_fila: fila.numero_fila, datos: fila, accion: null, id_existente: null, valida: false, errores };
    }
    const existente = buscar(DB, fila, sucursal_id);
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

function primerAlias(tipo, campo) {
  return TABLAS_ALIAS[tipo][campo][0];
}

function exportarFilasArticulos(DB, sucursal_id) {
  const T = (campo) => primerAlias("articulos", campo);
  return DB["catalogo-productos"].productos.map((p) => {
    const exist = DB.inventario.existencias.find((e) => e.producto_id === p.id && e.sucursal_id === Number(sucursal_id));
    const categoria = DB["catalogo-productos"].categorias.find((c) => c.id === p.categoria_id);
    const departamento = DB["catalogo-productos"].departamentos.find((d) => d.id === p.departamento_id);
    const precios = Array.isArray(p.precios) ? p.precios : [];
    return {
      [T("clave")]: p.sku,
      [T("clave_alterna")]: p.clave_alterna || "",
      [T("descripcion")]: p.nombre,
      [T("categoria")]: categoria ? categoria.nombre : "",
      [T("departamento")]: departamento ? departamento.nombre : "",
      [T("costo")]: p.costo || 0,
      [T("precio1")]: precios[0]?.precioVenta || 0,
      [T("precio2")]: precios[1]?.precioVenta || 0,
      [T("precio3")]: precios[2]?.precioVenta || 0,
      [T("precio4")]: precios[3]?.precioVenta || 0,
      [T("existencia")]: exist ? exist.cantidad_actual : 0,
      [T("unidad")]: p.unidad_venta || "",
      [T("iva")]: p.iva ? "SI" : "NO",
      [T("ubicacion")]: p.ubicacion || "",
    };
  });
}

function exportarFilasClientes(DB, sucursal_id) {
  const T = (campo) => primerAlias("clientes", campo);
  return DB.crm.clientes
    .filter((c) => c.id !== 0 && (sucursal_id == null || c.sucursal_id === Number(sucursal_id)))
    .map((c) => ({
      [T("clave")]: c.clave || "",
      [T("nombre")]: c.nombre,
      [T("rfc")]: c.rfc || "",
      [T("telefono")]: c.telefono || "",
      [T("celular")]: c.celular || "",
      [T("email")]: c.email || "",
      [T("limite_credito")]: c.limite_credito || 0,
      [T("dias_credito")]: c.dias_credito || 0,
    }));
}

function exportarFilasProveedores(DB) {
  const T = (campo) => primerAlias("proveedores", campo);
  return DB["catalogo-productos"].proveedores.map((p) => ({
    [T("rfc")]: p.rfc || "",
    [T("nombre")]: p.nombre,
    [T("contacto")]: p.contacto || "",
  }));
}

const CONSTRUCTORES_EXPORT = {
  articulos: exportarFilasArticulos,
  clientes: exportarFilasClientes,
  proveedores: (DB) => exportarFilasProveedores(DB),
};

function exportarRespaldo(DB, tipo, sucursal_id) {
  const construir = CONSTRUCTORES_EXPORT[tipo];
  if (!construir) throw new Error(`Tipo de exportación desconocido: ${tipo}`);
  const filas = construir(DB, sucursal_id);
  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Datos");
  return XLSX.write(libro, { type: "base64", bookType: "xlsx" });
}

module.exports = {
  parsearExcel, previsualizarImportacion, aplicarImportacion, exportarRespaldo,
  normalizarTexto, TABLAS_ALIAS, VALIDADORES, BUSCADORES,
};
