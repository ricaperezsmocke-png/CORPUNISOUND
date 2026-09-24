// "Hoy" siempre en hora de Chiapas: Render corre en UTC.
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

function validarFechaYPlantilla(DB, { mes, fecha, sucursal_id, vendedor_id }) {
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
  return vendedor;
}

module.exports = { mesValido, fechaValida, validarFechaYPlantilla };
