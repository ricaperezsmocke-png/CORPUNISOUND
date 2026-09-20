// "Hoy" siempre en hora de Chiapas: Render corre en UTC y un hoy con la hora del
// proceso adelanta el dia desde las 18:00, justo cuando se captura.
const { fechaLocal } = require("./fechas");
const { registroDelDia, tienePlantillaEnMes } = require("./objetivos");

function mesValido(mes) {
  return typeof mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);
}

function fechaValida(fecha) {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;

  const [anio, mes, dia] = fecha.split("-").map(Number);
  const fechaUTC = new Date(Date.UTC(anio, mes - 1, dia));
  return fechaUTC.getUTCFullYear() === anio &&
    fechaUTC.getUTCMonth() === mes - 1 &&
    fechaUTC.getUTCDate() === dia;
}

function siguienteId(capturas) {
  return capturas.reduce((maximo, captura) => Math.max(maximo, captura.id), 0) + 1;
}

function validarMonto(monto) {
  if (!Number.isFinite(monto) || monto < 0) {
    throw new Error("El monto debe ser un número finito mayor o igual a cero");
  }
}

function validarDatosCaptura(DB, { mes, fecha, sucursal_id, vendedor_id, tipo, monto }) {
  validarMonto(monto);
  if (!mesValido(mes)) {
    throw new Error("El mes debe tener formato AAAA-MM, con mes entre 01 y 12");
  }
  if (!fechaValida(fecha)) {
    throw new Error("La fecha debe tener formato AAAA-MM-DD y ser válida");
  }
  if (!fecha.startsWith(`${mes}-`)) {
    throw new Error("La fecha debe caer dentro del mes indicado");
  }
  if (fecha > fechaLocal(new Date())) {
    throw new Error("No se puede capturar una fecha futura o adelantada");
  }
  if (tipo !== "venta") {
    throw new Error("El tipo de captura debe ser venta");
  }
  if (!Number.isInteger(sucursal_id) || sucursal_id <= 0) {
    throw new Error("La sucursal debe tener un identificador válido");
  }

  const vendedor = DB.pos.vendedores.find((item) => item.id === vendedor_id);
  if (!vendedor) throw new Error("El vendedor no existe");
  const registro = registroDelDia(DB, { mes, vendedor_id, fecha });
  if (tienePlantillaEnMes(DB, mes, vendedor_id)) {
    if (!registro || registro.sucursal_id !== sucursal_id) {
      throw new Error("Ese día no estás en la plantilla de esta tienda");
    }
  } else if (vendedor.sucursal_id !== sucursal_id) {
    throw new Error("El vendedor no pertenece a esta sucursal");
  }
}

function capturarDia(DB, datos, usuario) {
  validarDatosCaptura(DB, datos);

  // Sin sucursal a proposito: si trasladan a la persona a mitad de mes, el mismo
  // dia no puede quedar capturado en dos tiendas.
  const yaCapturado = DB.pos.objetivo_capturas.some((captura) =>
    captura.vigente &&
    captura.vendedor_id === datos.vendedor_id &&
    captura.tipo === datos.tipo &&
    captura.fecha === datos.fecha
  );
  if (yaCapturado) {
    throw new Error("Ya hay una captura de ese día; si el monto está mal, usa Corregir");
  }

  const nueva = {
    id: siguienteId(DB.pos.objetivo_capturas),
    mes: datos.mes,
    fecha: datos.fecha,
    sucursal_id: datos.sucursal_id,
    vendedor_id: datos.vendedor_id,
    tipo: datos.tipo,
    monto: datos.monto,
    capturado_por: usuario?.nombre || "desconocido",
    capturado_en: new Date().toISOString(),
    corrige_a: null,
    vigente: true,
  };

  DB.pos.objetivo_capturas.push(nueva);
  return nueva;
}

function corregirCaptura(DB, capturaId, monto, motivo, usuario) {
  validarMonto(monto);
  if (typeof motivo !== "string" || motivo.trim() === "") {
    throw new Error("Corregir una captura requiere un motivo; no puede estar vacío");
  }

  const anterior = DB.pos.objetivo_capturas.find((captura) => captura.id === capturaId);
  if (!anterior) throw new Error("La captura que se quiere corregir no existe");
  if (!anterior.vigente) {
    throw new Error("La captura ya fue corregida y dejó de estar vigente");
  }

  const nueva = {
    id: siguienteId(DB.pos.objetivo_capturas),
    mes: anterior.mes,
    fecha: anterior.fecha,
    sucursal_id: anterior.sucursal_id,
    vendedor_id: anterior.vendedor_id,
    tipo: anterior.tipo,
    monto,
    capturado_por: usuario?.nombre || "desconocido",
    capturado_en: new Date().toISOString(),
    corrige_a: anterior.id,
    motivo: motivo.trim(),
    vigente: true,
  };

  anterior.vigente = false;
  DB.pos.objetivo_capturas.push(nueva);
  return nueva;
}

function capturadoDelMes(DB, { mes, sucursal_id, vendedor_id }) {
  return DB.pos.objetivo_capturas
    .filter((captura) => captura.vigente &&
      captura.mes === mes &&
      captura.sucursal_id === sucursal_id &&
      captura.vendedor_id === vendedor_id)
    .reduce((total, captura) => total + captura.monto, 0);
}

function diasSinCapturar(DB, { mes, sucursal_id, vendedor_id, hasta }) {
  if (!mesValido(mes)) {
    throw new Error("El mes debe tener formato AAAA-MM, con mes entre 01 y 12");
  }
  if (!fechaValida(hasta) || !hasta.startsWith(`${mes}-`)) {
    throw new Error("La fecha hasta debe caer dentro del mes indicado");
  }

  const fechasCapturadas = new Set(DB.pos.objetivo_capturas
    .filter((captura) => captura.vigente &&
      captura.mes === mes &&
      captura.sucursal_id === sucursal_id &&
      captura.vendedor_id === vendedor_id)
    .map((captura) => captura.fecha));
  const registros = DB.pos.objetivo_plantilla.filter((linea) =>
    linea.mes === mes && linea.sucursal_id === sucursal_id && linea.vendedor_id === vendedor_id
  );
  const faltantes = [];
  const intervalos = registros.length ? registros : [{ desde: `${mes}-01`, hasta: null }];
  for (const registro of intervalos) {
    const limite = registro.hasta && registro.hasta < hasta ? registro.hasta : hasta;
    for (let dia = Number(registro.desde.slice(8, 10)); dia <= Number(limite.slice(8, 10)); dia += 1) {
      const fecha = `${mes}-${String(dia).padStart(2, "0")}`;
      if (!fechasCapturadas.has(fecha)) faltantes.push(fecha);
    }
  }
  return [...new Set(faltantes)].sort();
}

module.exports = {
  capturarDia,
  corregirCaptura,
  capturadoDelMes,
  diasSinCapturar,
};
