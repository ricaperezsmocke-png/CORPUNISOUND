const { objetivoVigente, plantillaDelMes } = require("./objetivos");
const { capturadoDelMes, capturadoDelMesPor } = require("./objetivosCaptura");
const { actividadesDelMes, resumenActividades } = require("./objetivosActividades");
const { creditosDelMes, resumenCreditos } = require("./objetivosCreditos");
const { listarElementos } = require("./objetivosCatalogos");

const FAMILIAS = [
  { lista: "marcas", tipo: "marca", referencia: "marca_id" },
  { lista: "productos", tipo: "producto", referencia: "producto_meta_id" },
  { lista: "creditos", tipo: "credito", referencia: "financiera" },
];

function elementoValidado(DB, datos, referencia) {
  // objetivoVigente valida con llaveDeMeta, que es interna de objetivos.js.
  // Una referencia válida puede no tener meta: basta con una captura en el previo.
  const objetivo = objetivoVigente(DB, datos);
  const id = referencia === "financiera" ? datos[referencia] : Number(datos[referencia]);
  return { id, meta: objetivo?.monto ?? 0 };
}

function elementosDelPrevio(DB, periodo) {
  const delVendedor = (r) => r.vigente && r.mes === periodo.mes &&
    r.sucursal_id === periodo.sucursal_id && r.vendedor_id === periodo.vendedor_id;
  const metas = DB.pos.objetivos.filter(delVendedor);
  const capturas = DB.pos.objetivo_capturas.filter(delVendedor);
  const resumen = resumenCreditos(DB, periodo);
  const resultado = {};
  for (const { lista, tipo, referencia } of FAMILIAS) {
    const registros = tipo === "credito"
      ? creditosDelMes(DB, periodo).filter((r) => r.vigente)
      : capturas.filter((r) => r.tipo === tipo);
    const referencias = new Set([...metas.filter((r) => r.tipo === tipo), ...registros].map((r) => r[referencia]));
    const catalogo = tipo === "credito" ? [] : listarElementos(DB, lista, { incluirInactivos: true });
    resultado[lista] = [...referencias].map((id) => {
      const llave = { ...periodo, tipo, [referencia]: id };
      const { id: normalizado, meta } = elementoValidado(DB, llave, referencia);
      if (tipo === "credito") {
        return { financiera: id, meta, registrados: resumen.find((r) => r.financiera === id).registrados };
      }
      return {
        [referencia]: normalizado, nombre: catalogo.find((e) => e.id === normalizado)?.nombre || "desconocido",
        meta, capturado: capturadoDelMesPor(DB, llave),
      };
    });
  }
  return resultado;
}

function validarValorElemento(valor, tipo) {
  if (!Number.isFinite(valor) || valor < 0 || (tipo !== "marca" && !Number.isInteger(valor))) {
    const unidad = tipo === "marca" ? "un número finito" : "un entero";
    throw new Error(`El valor del elemento debe ser ${unidad} mayor o igual a cero`);
  }
}

function cruzarElementos(DB, linea, real, periodo) {
  const resultado = {};
  for (const { lista, tipo, referencia } of FAMILIAS) {
    const recibidos = real[lista] === undefined ? [] : real[lista];
    if (!Array.isArray(recibidos)) throw new Error(`Se requiere una lista de reales de ${lista}`);
    const porReferencia = new Map();
    for (const elemento of recibidos) {
      if (!elemento || typeof elemento !== "object" || Array.isArray(elemento)) throw new Error(`Real de ${lista} inválido`);
      const llave = { ...elemento, ...periodo, tipo, vendedor_id: linea.vendedor_id };
      const { id } = elementoValidado(DB, llave, referencia);
      if (!linea[lista].some((e) => e[referencia] === id)) throw new Error(`El elemento de ${lista} no aparece en el previo`);
      if (porReferencia.has(id)) throw new Error(`El real del elemento de ${lista} está repetido`);
      validarValorElemento(elemento.real, tipo);
      porReferencia.set(id, elemento.real);
    }
    resultado[lista] = linea[lista].map((elemento) => {
      if (!porReferencia.has(elemento[referencia])) throw new Error(`Falta el real de un elemento de ${lista}`);
      const valor = porReferencia.get(elemento[referencia]);
      return { ...elemento, real: valor, diferencia: (elemento.capturado ?? elemento.registrados) - valor };
    });
  }
  return resultado;
}

function listasParaFoto(DB, delPeriodo) {
  const usados = [...DB.pos.objetivos, ...DB.pos.objetivo_capturas].filter(delPeriodo);
  const resultado = {};
  for (const { lista, tipo, referencia } of FAMILIAS.filter((f) => f.tipo !== "credito")) {
    const ids = new Set(usados.filter((r) => r.tipo === tipo).map((r) => r[referencia]));
    resultado[lista] = listarElementos(DB, lista, { incluirInactivos: true })
      .filter((e) => ids.has(e.id)).map(({ id, nombre }) => ({ id, nombre }));
  }
  return resultado;
}

function validarPeriodo(mes, sucursal_id) {
  if (typeof mes !== "string" || mes.length !== 7 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    throw new Error("El mes debe tener formato AAAA-MM, con mes entre 01 y 12");
  }
  if (!Number.isInteger(sucursal_id) || sucursal_id <= 0) {
    throw new Error("La sucursal debe tener un identificador válido");
  }
}

function previoCierre(DB, { mes, sucursal_id }) {
  validarPeriodo(mes, sucursal_id);
  const participantes = new Set(plantillaDelMes(DB, mes, sucursal_id).map(({ vendedor_id }) => vendedor_id));
  for (const objetivo of DB.pos.objetivos) {
    if (objetivo.vigente && ["venta", "actividad", "marca", "producto", "credito"].includes(objetivo.tipo) && objetivo.mes === mes &&
        objetivo.sucursal_id === sucursal_id && objetivo.vendedor_id !== null) {
      participantes.add(objetivo.vendedor_id);
    }
  }
  for (const captura of DB.pos.objetivo_capturas) {
    if (captura.vigente && captura.mes === mes && captura.sucursal_id === sucursal_id) {
      participantes.add(captura.vendedor_id);
    }
  }
  for (const registro of actividadesDelMes(DB, { mes, sucursal_id })) {
    if (registro.vigente) participantes.add(registro.vendedor_id);
  }
  for (const registro of creditosDelMes(DB, { mes, sucursal_id })) {
    if (registro.vigente) participantes.add(registro.vendedor_id);
  }

  return [...participantes].sort((a, b) => a - b).map((vendedor_id) => {
    const vendedor = DB.pos.vendedores.find((v) => v.id === vendedor_id);
    const objetivo = objetivoVigente(DB, { tipo: "venta", mes, sucursal_id, vendedor_id });
    const actividades = resumenActividades(DB, { mes, sucursal_id, vendedor_id }).map(({ actividad, declaradas, conjuntas }) => {
      const meta = objetivoVigente(DB, { tipo: "actividad", actividad, mes, sucursal_id, vendedor_id });
      return { actividad, meta: meta ? meta.monto : 0, declaradas, conjuntas };
    });
    return {
      vendedor_id,
      nombre: vendedor?.nombre || "desconocido",
      meta: objetivo ? objetivo.monto : 0,
      capturado: capturadoDelMes(DB, { mes, sucursal_id, vendedor_id }),
      actividades,
      ...elementosDelPrevio(DB, { mes, sucursal_id, vendedor_id }),
    };
  });
}

function estaCerrado(DB, mes, sucursal_id) {
  return DB.pos.objetivo_cierres.some((cierre) =>
    cierre.mes === mes && cierre.sucursal_id === sucursal_id
  );
}

function cerrarMes(DB, { mes, sucursal_id, reales }, usuario) {
  validarPeriodo(mes, sucursal_id);
  if (estaCerrado(DB, mes, sucursal_id)) {
    throw new Error("El mes ya está cerrado para esta sucursal");
  }
  if (!Array.isArray(reales)) {
    throw new Error("Se requiere la lista de reales de SICAR de toda la plantilla");
  }

  const previo = previoCierre(DB, { mes, sucursal_id });
  const personas = new Set(previo.map((linea) => linea.vendedor_id));
  const realesPorPersona = new Map();
  for (const real of reales) {
    if (!real || !personas.has(real.vendedor_id)) {
      throw new Error("Cada real de SICAR debe pertenecer a una persona de la plantilla del mes y sucursal");
    }
    if (realesPorPersona.has(real.vendedor_id)) {
      throw new Error("El real de SICAR de una persona no puede estar repetido");
    }
    if (!Number.isFinite(real.real_sicar) || real.real_sicar < 0) {
      throw new Error("El real de SICAR debe ser un número finito mayor o igual a cero");
    }
    realesPorPersona.set(real.vendedor_id, real);
  }
  if (previo.some((linea) => !realesPorPersona.has(linea.vendedor_id))) {
    throw new Error("Falta el real de SICAR de alguien de la plantilla");
  }

  const lineas = previo.map((linea) => {
    const { vendedor_id, meta, capturado, actividades } = linea;
    const real = realesPorPersona.get(vendedor_id);
    const real_sicar = real.real_sicar;
    return {
      vendedor_id, meta, capturado, real_sicar, diferencia: capturado - real_sicar, actividades,
      ...cruzarElementos(DB, linea, real, { mes, sucursal_id }),
    };
  });
  const delPeriodo = (registro) => registro.mes === mes && registro.sucursal_id === sucursal_id;
  // Copia profunda: versionar metas o corregir capturas cambia su vigente original,
  // pero nunca los objetos ni las listas de esta fotografía (incluida la plantilla).
  const foto = structuredClone({
    objetivos: DB.pos.objetivos.filter((objetivo) => objetivo.vigente && delPeriodo(objetivo)),
    capturas: DB.pos.objetivo_capturas.filter((captura) => captura.vigente && delPeriodo(captura)),
    plantilla: plantillaDelMes(DB, mes, sucursal_id),
    actividades: actividadesDelMes(DB, { mes, sucursal_id }),
    creditos: creditosDelMes(DB, { mes, sucursal_id }),
    ...listasParaFoto(DB, delPeriodo),
  });
  const cierre = {
    id: DB.pos.objetivo_cierres.reduce((maximo, item) => Math.max(maximo, item.id), 0) + 1,
    mes,
    sucursal_id,
    cerrado_por: usuario?.nombre || "desconocido",
    cerrado_en: new Date().toISOString(),
    lineas,
    foto,
    resumen_actividades_tienda: resumenActividades(DB, { mes, sucursal_id }),
    rectificaciones: [],
  };

  // Como crearCorte: cálculo y fotografía completos, sin await antes del alta.
  // Esta es la única escritura; cualquier validación fallida deja DB intacta.
  DB.pos.objetivo_cierres.push(cierre);
  return cierre;
}


/**
 * Rectifica un cierre YA SELLADO, sin reabrirlo.
 *
 * El caso real: el mes esta cerrado, Victor ya pago la comision, y una semana
 * despues el cliente devuelve el teclado de $12,000. La venta se cancela en
 * SICAR. Esa comision se pago sobre una venta que ya no existe.
 *
 * La tentacion es entrar al cierre y corregir el numero. Eso DESTRUYE el sello:
 * si el cierre de septiembre puede cambiar en octubre, la cifra con la que
 * Victor pago deja de ser demostrable, y el trabajo del sello no sirvio de nada.
 *
 * Por eso `lineas` y `foto` NO se tocan jamas. El efecto tardio se apila en
 * `rectificaciones`, con valor anterior, nuevo, motivo, quien y cuando, y
 * aparece en la siguiente decision de comision. Es como este sistema trata los
 * movimientos que llegan tarde a un corte de caja ya cerrado.
 *
 * El motivo es OBLIGATORIO: una rectificacion sin explicacion es exactamente el
 * numero cambiado a oscuras que estamos evitando.
 */
const CAMPOS_RECTIFICABLES = ["meta", "capturado", "real_sicar"];

function rectificarCierre(DB, cierreId, datos, usuario) {
  const { vendedor_id, campo, valor_nuevo, motivo } = datos;
  const cierre = (DB.pos.objetivo_cierres || []).find((c) => c.id === Number(cierreId));
  if (!cierre) throw new Error("Ese cierre no existe");

  const familia = FAMILIAS.find((f) => datos[f.referencia] !== undefined && datos[f.referencia] !== null);
  const campos = familia ? ["real", "meta", "capturado"] : CAMPOS_RECTIFICABLES;
  if (!campos.includes(campo)) {
    throw new Error(`Solo se puede rectificar: ${campos.join(", ")}`);
  }

  const linea = cierre.lineas.find((l) => l.vendedor_id === Number(vendedor_id));
  if (!linea) throw new Error("Esa persona no esta en el cierre");

  let origen = linea;
  let referencia = {};
  if (familia) {
    const { lista, tipo, referencia: clave } = familia;
    const llave = { ...datos, mes: cierre.mes, sucursal_id: cierre.sucursal_id, tipo };
    const { id } = elementoValidado(DB, llave, clave);
    origen = (linea[lista] || []).find((e) => e[clave] === id);
    if (!origen) throw new Error("Ese elemento no existe en la línea del cierre");
    referencia = { [clave]: id };
    validarValorElemento(valor_nuevo, tipo);
  }

  if (typeof motivo !== "string" || motivo.trim() === "") {
    throw new Error("La rectificación necesita un motivo: sin él, es un número cambiado sin explicación");
  }

  if (!Number.isFinite(valor_nuevo) || valor_nuevo < 0) {
    throw new Error("El valor nuevo debe ser un número finito mayor o igual a cero");
  }

  // El valor anterior se LEE del cierre; no se acepta de fuera, para que nadie
  // pueda declarar un punto de partida que no fue el real.
  const rectificacion = {
    id: (cierre.rectificaciones.length
      ? Math.max(...cierre.rectificaciones.map((r) => r.id)) : 0) + 1,
    vendedor_id: Number(vendedor_id),
    campo,
    ...referencia,
    valor_anterior: familia?.tipo === "credito" && campo === "capturado" ? origen.registrados : origen[campo],
    valor_nuevo,
    motivo: motivo.trim(),
    rectificado_por: (usuario && usuario.nombre) || "desconocido",
    rectificado_en: new Date().toISOString(),
  };
  cierre.rectificaciones.push(rectificacion);
  return rectificacion;
}

module.exports = { previoCierre, cerrarMes, estaCerrado, rectificarCierre };
