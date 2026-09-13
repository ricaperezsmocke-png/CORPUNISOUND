const { objetivoVigente, plantillaDelMes } = require("./objetivos");
const { capturadoDelMes } = require("./objetivosCaptura");

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
  return plantillaDelMes(DB, mes, sucursal_id).map(({ vendedor_id }) => {
    const vendedor = DB.pos.vendedores.find((v) => v.id === vendedor_id);
    const objetivo = objetivoVigente(DB, { tipo: "venta", mes, sucursal_id, vendedor_id });
    return {
      vendedor_id,
      nombre: vendedor?.nombre || "desconocido",
      meta: objetivo ? objetivo.monto : 0,
      capturado: capturadoDelMes(DB, { mes, sucursal_id, vendedor_id }),
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
    realesPorPersona.set(real.vendedor_id, real.real_sicar);
  }
  if (previo.some((linea) => !realesPorPersona.has(linea.vendedor_id))) {
    throw new Error("Falta el real de SICAR de alguien de la plantilla");
  }

  const lineas = previo.map(({ vendedor_id, meta, capturado }) => {
    const real_sicar = realesPorPersona.get(vendedor_id);
    return { vendedor_id, meta, capturado, real_sicar, diferencia: capturado - real_sicar };
  });
  const delPeriodo = (registro) => registro.mes === mes && registro.sucursal_id === sucursal_id;
  // Copia profunda: versionar metas o corregir capturas cambia su vigente original,
  // pero nunca los objetos ni las listas de esta fotografía (incluida la plantilla).
  const foto = structuredClone({
    objetivos: DB.pos.objetivos.filter((objetivo) => objetivo.vigente && delPeriodo(objetivo)),
    capturas: DB.pos.objetivo_capturas.filter((captura) => captura.vigente && delPeriodo(captura)),
    plantilla: plantillaDelMes(DB, mes, sucursal_id),
  });
  const cierre = {
    id: DB.pos.objetivo_cierres.reduce((maximo, item) => Math.max(maximo, item.id), 0) + 1,
    mes,
    sucursal_id,
    cerrado_por: usuario?.nombre || "desconocido",
    cerrado_en: new Date().toISOString(),
    lineas,
    foto,
    rectificaciones: [],
  };

  // Como crearCorte: cálculo y fotografía completos, sin await antes del alta.
  // Esta es la única escritura; cualquier validación fallida deja DB intacta.
  DB.pos.objetivo_cierres.push(cierre);
  return cierre;
}

module.exports = { previoCierre, cerrarMes, estaCerrado };
