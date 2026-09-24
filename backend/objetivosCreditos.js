const { validarFechaYPlantilla } = require("./objetivosFechas");

const FINANCIERAS = [
  { clave: "coppel_pay", etiqueta: "Coppel Pay" },
  { clave: "atrato", etiqueta: "Atrato" },
];

function normalizarId(valor, campo) {
  const id = typeof valor === "string" || typeof valor === "number" ? Number(valor) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${campo} debe tener un identificador válido`);
  return id;
}

function normalizarFolio(folio) {
  if (typeof folio !== "string") throw new Error("El folio de la financiera es obligatorio");
  const texto = folio.trim().replace(/\s+/g, "").toUpperCase();
  if (texto.length < 3 || texto.length > 40) throw new Error("El folio debe tener entre 3 y 40 caracteres");
  return texto;
}

function normalizarNota(nota) {
  if (nota === undefined || nota === null) return null;
  if (typeof nota !== "string") throw new Error("La nota debe ser texto");
  const texto = nota.trim();
  if (texto.length > 300) throw new Error("La nota no puede tener más de 300 caracteres");
  return texto || null;
}

// Como en actividades, las rutas validan identidad, alcance y mes abierto antes de escribir.
function registrarCredito(DB, { mes, fecha, sucursal_id, vendedor_id, financiera, folio, monto, nota }, usuario) {
  sucursal_id = normalizarId(sucursal_id, "La sucursal");
  vendedor_id = normalizarId(vendedor_id, "El vendedor");
  validarFechaYPlantilla(DB, { mes, fecha, sucursal_id, vendedor_id });
  if (!FINANCIERAS.some((item) => item.clave === financiera)) throw new Error("La financiera no es válida");
  folio = normalizarFolio(folio);
  if (!Number.isFinite(monto) || monto <= 0) throw new Error("El monto debe ser un número finito mayor que cero");
  nota = normalizarNota(nota);
  const registros = DB.pos.objetivo_creditos || [];
  const anterior = registros.find((item) => item.vigente && item.financiera === financiera && item.folio === folio);
  if (anterior) {
    if (anterior.sucursal_id !== sucursal_id) throw new Error("ya registrado en otra tienda");
    throw new Error(`Este folio ya lo registró ${anterior.registrado_por} el ${anterior.fecha}`);
  }
  const registro = {
    id: registros.reduce((maximo, item) => Math.max(maximo, item.id), 0) + 1,
    mes, fecha, sucursal_id, vendedor_id, financiera, folio, monto, nota,
    registrado_por: usuario?.nombre || "desconocido", registrado_en: new Date().toISOString(),
    vigente: true, anulado_por: null, anulado_en: null, motivo_anulacion: null,
  };
  registros.push(registro);
  DB.pos.objetivo_creditos = registros;
  return registro;
}

function anularCredito(DB, id, motivo, usuario) {
  const registro = (DB.pos.objetivo_creditos || []).find((item) => item.id === Number(id));
  if (!registro) throw new Error("El crédito no existe");
  if (!registro.vigente) throw new Error("El crédito ya está anulado");
  if (typeof motivo !== "string" || !motivo.trim()) throw new Error("Anular requiere un motivo; no puede estar vacío");
  registro.vigente = false;
  registro.anulado_por = usuario?.nombre || "desconocido";
  registro.anulado_en = new Date().toISOString();
  registro.motivo_anulacion = motivo.trim();
  return registro;
}

function creditosDelMes(DB, { mes, sucursal_id, vendedor_id }) {
  sucursal_id = normalizarId(sucursal_id, "La sucursal");
  const deTienda = vendedor_id === undefined || vendedor_id === null;
  if (!deTienda) vendedor_id = normalizarId(vendedor_id, "El vendedor");
  return (DB.pos.objetivo_creditos || []).filter((registro) =>
    registro.mes === mes && registro.sucursal_id === sucursal_id &&
    (deTienda || registro.vendedor_id === vendedor_id)
  ).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
}

function resumenCreditos(DB, filtros) {
  const vigentes = creditosDelMes(DB, filtros).filter((registro) => registro.vigente);
  return FINANCIERAS.map(({ clave, etiqueta }) => ({
    financiera: clave, etiqueta, registrados: vigentes.filter((registro) => registro.financiera === clave).length,
  }));
}

module.exports = { FINANCIERAS, registrarCredito, anularCredito, creditosDelMes, resumenCreditos };
