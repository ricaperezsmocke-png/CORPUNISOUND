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
  const participantes = new Set(plantillaDelMes(DB, mes, sucursal_id).map(({ vendedor_id }) => vendedor_id));
  for (const objetivo of DB.pos.objetivos) {
    if (objetivo.vigente && objetivo.tipo === "venta" && objetivo.mes === mes &&
        objetivo.sucursal_id === sucursal_id && objetivo.vendedor_id !== null) {
      participantes.add(objetivo.vendedor_id);
    }
  }
  for (const captura of DB.pos.objetivo_capturas) {
    if (captura.vigente && captura.mes === mes && captura.sucursal_id === sucursal_id) {
      participantes.add(captura.vendedor_id);
    }
  }

  return [...participantes].sort((a, b) => a - b).map((vendedor_id) => {
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

function rectificarCierre(DB, cierreId, { vendedor_id, campo, valor_nuevo, motivo }, usuario) {
  const cierre = (DB.pos.objetivo_cierres || []).find((c) => c.id === Number(cierreId));
  if (!cierre) throw new Error("Ese cierre no existe");

  if (!CAMPOS_RECTIFICABLES.includes(campo)) {
    throw new Error(`Solo se puede rectificar: ${CAMPOS_RECTIFICABLES.join(", ")}`);
  }

  const linea = cierre.lineas.find((l) => l.vendedor_id === Number(vendedor_id));
  if (!linea) throw new Error("Esa persona no esta en el cierre");

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
    valor_anterior: linea[campo],
    valor_nuevo,
    motivo: motivo.trim(),
    rectificado_por: (usuario && usuario.nombre) || "desconocido",
    rectificado_en: new Date().toISOString(),
  };
  cierre.rectificaciones.push(rectificacion);
  return rectificacion;
}

module.exports = { previoCierre, cerrarMes, estaCerrado, rectificarCierre };
