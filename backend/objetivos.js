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
    if (vendedor.sucursal_id !== sucursal_id) {
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

  const yaRegistrado = DB.pos.objetivo_plantilla.some((linea) =>
    linea.mes === mes &&
    linea.sucursal_id === sucursal_id &&
    linea.vendedor_id === vendedor_id
  );
  if (yaRegistrado) {
    throw new Error("El vendedor ya está registrado en la plantilla de este mes y sucursal");
  }

  const linea = {
    id: DB.pos.objetivo_plantilla.reduce((maximo, item) => Math.max(maximo, item.id), 0) + 1,
    mes,
    sucursal_id,
    vendedor_id,
    desde: desde ?? `${mes}-01`,
    hasta: hasta ?? null,
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

module.exports = {
  fijarObjetivo,
  objetivoVigente,
  historialObjetivo,
  registrarEnPlantilla,
  plantillaDelMes,
};
