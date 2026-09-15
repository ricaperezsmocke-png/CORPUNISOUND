// Cada cambio conserva la versión anterior y enlaza la nueva con ella.
function mismaCombinacion(objetivo, { tipo, mes, sucursal_id, vendedor_id }) {
  return objetivo.tipo === tipo &&
    objetivo.mes === mes &&
    objetivo.sucursal_id === sucursal_id &&
    objetivo.vendedor_id === vendedor_id;
}

function objetivoVigente(DB, datos) {
  return DB.pos.objetivos.find((o) => o.vigente && mismaCombinacion(o, datos)) || null;
}

function historialObjetivo(DB, datos) {
  return DB.pos.objetivos
    .filter((o) => mismaCombinacion(o, datos))
    .sort((a, b) => a.version - b.version);
}

function fijarObjetivo(DB, { tipo, mes, sucursal_id, vendedor_id, monto, motivo }, usuario) {
  if (!Number.isFinite(monto) || monto < 0) {
    throw new Error("El monto debe ser un número finito mayor o igual a cero");
  }
  if (typeof mes !== "string" || mes.length !== 7 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    throw new Error("El mes debe tener formato AAAA-MM, con mes entre 01 y 12");
  }
  if (tipo !== "venta") {
    throw new Error("El tipo de objetivo debe ser venta");
  }
  if (!Number.isInteger(sucursal_id) || sucursal_id <= 0) {
    throw new Error("La sucursal debe tener un identificador válido");
  }
  if (vendedor_id !== null) {
    const vendedor = DB.pos.vendedores.find((v) => v.id === vendedor_id);
    if (!vendedor) throw new Error("El vendedor no existe");
    const estuvoEnSucursal = DB.pos.objetivo_plantilla.some((linea) =>
      linea.mes === mes && linea.vendedor_id === vendedor_id && linea.sucursal_id === sucursal_id
    );
    if (tienePlantillaEnMes(DB, mes, vendedor_id) ? !estuvoEnSucursal : vendedor.sucursal_id !== sucursal_id) {
      throw new Error("El vendedor no pertenece a esta sucursal");
    }
  }

  const anterior = objetivoVigente(DB, { tipo, mes, sucursal_id, vendedor_id });
  const nuevo = {
    id: DB.pos.objetivos.reduce((maximo, o) => Math.max(maximo, o.id), 0) + 1,
    tipo,
    mes,
    sucursal_id,
    vendedor_id,
    monto,
    version: anterior ? anterior.version + 1 : 1,
    vigente: true,
    creado_por: usuario?.nombre || "desconocido",
    creado_en: new Date().toISOString(),
    reemplaza_a: anterior ? anterior.id : null,
    motivo: motivo ?? null,
  };

  // Todas las validaciones y la construcción terminan antes de modificar DB.
  if (anterior) anterior.vigente = false;
  DB.pos.objetivos.push(nuevo);
  return nuevo;
}

function registrarEnPlantilla(DB, { mes, sucursal_id, vendedor_id, desde, hasta, motivo }) {
  if (typeof mes !== "string" || mes.length !== 7 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    throw new Error("El mes debe tener formato AAAA-MM, con mes entre 01 y 12");
  }

  const vendedor = DB.pos.vendedores.find((v) => v.id === vendedor_id);
  if (!vendedor) throw new Error("El vendedor no existe");
  if (vendedor.sucursal_id !== sucursal_id) {
    throw new Error("El vendedor no pertenece a esta sucursal");
  }


  // diasSinCapturar cuenta desde/hasta de este registro: una fecha fuera del mes
  // o mal escrita inventaria o esconderia dias pendientes.
  const desdeFinal = desde ?? `${mes}-01`;
  const hastaFinal = hasta ?? null;
  if (!fechaValida(desdeFinal) || !desdeFinal.startsWith(`${mes}-`)) {
    throw new Error("La fecha de alta debe ser válida y estar dentro del mes");
  }
  if (hastaFinal !== null && (!fechaValida(hastaFinal) || !hastaFinal.startsWith(`${mes}-`) || hastaFinal < desdeFinal)) {
    throw new Error("La fecha de baja debe ser válida, estar dentro del mes y no ser anterior al alta");
  }

  // Un dia de trabajo es de UNA sola tienda. Si la persona sigue (o se encima)
  // en la plantilla de otra tienda, el dia compartido saldria "sin capturar" en
  // una de las dos sin forma de llenarlo.
  const encimada = DB.pos.objetivo_plantilla.find((otra) =>
    otra.mes === mes &&
    otra.vendedor_id === vendedor_id &&
    (otra.hasta === null || otra.hasta >= desdeFinal) &&
    (hastaFinal === null || otra.desde <= hastaFinal)
  );
  if (encimada) {
    if (encimada.sucursal_id === sucursal_id) {
      throw new Error("Esta persona ya está en la plantilla de esta tienda en esas fechas");
    }
    throw new Error(
      "Esta persona sigue en la plantilla de otra tienda en esas fechas. " +
      "Primero hay que darla de baja allá con un último día anterior a su alta aquí."
    );
  }

  const linea = {
    id: DB.pos.objetivo_plantilla.reduce((maximo, item) => Math.max(maximo, item.id), 0) + 1,
    mes,
    sucursal_id,
    vendedor_id,
    desde: desdeFinal,
    hasta: hastaFinal,
    motivo: motivo ?? null,
  };

  DB.pos.objetivo_plantilla.push(linea);
  return linea;
}

function plantillaDelMes(DB, mes, sucursal_id) {
  return DB.pos.objetivo_plantilla.filter((linea) =>
    linea.mes === mes && linea.sucursal_id === sucursal_id
  );
}

function registroDelDia(DB, { mes, vendedor_id, fecha }) {
  return DB.pos.objetivo_plantilla.find((linea) =>
    linea.mes === mes && linea.vendedor_id === vendedor_id &&
    linea.desde <= fecha && (linea.hasta === null || linea.hasta >= fecha)
  ) || null;
}

function tienePlantillaEnMes(DB, mes, vendedor_id) {
  return DB.pos.objetivo_plantilla.some((linea) => linea.mes === mes && linea.vendedor_id === vendedor_id);
}

function vendedoresUnicosDePlantilla(DB, mes, sucursal_id) {
  return [...new Set(plantillaDelMes(DB, mes, sucursal_id).map((linea) => linea.vendedor_id))];
}

function fechaValida(fecha) {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const valor = new Date(Date.UTC(anio, mes - 1, dia));
  return valor.getUTCFullYear() === anio &&
    valor.getUTCMonth() === mes - 1 &&
    valor.getUTCDate() === dia;
}

function darDeBajaEnPlantilla(DB, plantillaId, { hasta, motivo }, usuario) {
  const linea = DB.pos.objetivo_plantilla.find((item) => item.id === plantillaId);
  if (!linea) throw new Error("El registro de plantilla no existe");
  if (linea.hasta) throw new Error("El registro de plantilla ya tiene una baja");
  if (!fechaValida(hasta) || !hasta.startsWith(`${linea.mes}-`)) {
    throw new Error("La fecha de baja debe ser válida y estar dentro del mes del registro");
  }
  if (hasta < linea.desde) {
    throw new Error("La fecha de baja no puede ser anterior a la fecha de alta");
  }
  if (typeof motivo !== "string" || motivo.trim() === "") {
    throw new Error("Dar de baja requiere un motivo; no puede estar vacío");
  }

  linea.hasta = hasta;
  // Campo propio: `motivo` es el del alta y no se sobrescribe.
  linea.motivo_baja = motivo.trim();
  linea.baja_por = usuario?.nombre || "desconocido";
  linea.baja_en = new Date().toISOString();
  return linea;
}

function repartoSugerido(DB, { mes, sucursal_id }) {
  const metaTienda = objetivoVigente(DB, {
    tipo: "venta",
    mes,
    sucursal_id,
    vendedor_id: null,
  });
  const vendedores = vendedoresUnicosDePlantilla(DB, mes, sucursal_id);

  if (!metaTienda || vendedores.length === 0) return [];

  const montoBase = Math.floor(metaTienda.monto / vendedores.length);
  return vendedores.map((vendedor_id, indice) => ({
    vendedor_id,
    monto: indice === vendedores.length - 1
      ? metaTienda.monto - (montoBase * (vendedores.length - 1))
      : montoBase,
  }));
}

function estadoDelReparto(DB, { mes, sucursal_id }) {
  const metaTienda = objetivoVigente(DB, {
    tipo: "venta",
    mes,
    sucursal_id,
    vendedor_id: null,
  });
  const lineas = vendedoresUnicosDePlantilla(DB, mes, sucursal_id).map((vendedor_id) => {
    const objetivo = objetivoVigente(DB, {
      tipo: "venta",
      mes,
      sucursal_id,
      vendedor_id,
    });
    return {
      vendedor_id,
      monto: objetivo ? objetivo.monto : 0,
    };
  });
  const meta_tienda = metaTienda ? metaTienda.monto : 0;
  const asignado = lineas.reduce((total, linea) => total + linea.monto, 0);

  return {
    meta_tienda,
    asignado,
    sin_asignar: meta_tienda - asignado,
    lineas,
  };
}

module.exports = {
  fijarObjetivo,
  objetivoVigente,
  historialObjetivo,
  registrarEnPlantilla,
  plantillaDelMes,
  darDeBajaEnPlantilla,
  repartoSugerido,
  estadoDelReparto,
  registroDelDia,
  tienePlantillaEnMes,
};
