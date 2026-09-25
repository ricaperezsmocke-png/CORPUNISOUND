const { objetivoVigente, plantillaDelMes } = require("./objetivos");
const { capturadoDelMesPor } = require("./objetivosCaptura");
const { FINANCIERAS, resumenCreditos } = require("./objetivosCreditos");
const { resumenActividades } = require("./objetivosActividades");
const { CLASES_ACTIVIDAD } = require("./objetivosActividadesCatalogo");
const { listarElementos } = require("./objetivosCatalogos");

const centavos = (monto) => Math.round(Number(monto) * 100);

function porcentaje(capturado, meta) {
  if (meta === undefined || meta === null || centavos(meta) === 0) return null;
  return Math.floor(centavos(capturado) * 100 / centavos(meta));
}

function serieDiaria(capturas) {
  const porFecha = new Map();
  for (const captura of capturas) {
    if (captura.tipo !== "venta") continue;
    porFecha.set(captura.fecha, (porFecha.get(captura.fecha) || 0) + centavos(captura.monto));
  }
  return [...porFecha].sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, monto]) => ({ fecha, monto: monto / 100 }));
}

function totalCapturado(DB, filtros, capturas) {
  const vendedores = filtros.vendedor_id === null
    ? [...new Set(capturas.map((captura) => captura.vendedor_id))]
    : [filtros.vendedor_id];
  // El helper existente suma decimales. Recuperar los centavos de cada persona
  // antes de acumularlos evita trasladar residuos binarios al avance de tienda.
  const total = vendedores.reduce((suma, vendedor_id) =>
    suma + centavos(capturadoDelMesPor(DB, { ...filtros, vendedor_id })), 0);
  return total / 100;
}

function elementosCapturados(DB, filtros, metas, capturas, { lista, tipo, referencia }) {
  const referencias = new Set([
    ...metas.filter((meta) => meta.tipo === tipo),
    ...capturas.filter((captura) => captura.tipo === tipo),
  ].map((registro) => registro[referencia]));
  const catalogo = listarElementos(DB, lista, { incluirInactivos: true });
  return [...referencias].map((id) => {
    const llave = { ...filtros, tipo, [referencia]: id };
    const meta = objetivoVigente(DB, llave)?.monto ?? 0;
    const capturado = totalCapturado(DB, llave, capturas);
    return {
      [referencia]: id,
      nombre: catalogo.find((elemento) => elemento.id === id)?.nombre || "desconocido",
      meta, capturado, porcentaje: porcentaje(capturado, meta),
    };
  });
}

function avanceCreditos(DB, filtros) {
  const resumen = resumenCreditos(DB, filtros);
  return FINANCIERAS.flatMap(({ clave, etiqueta }) => {
    const objetivo = objetivoVigente(DB, { ...filtros, tipo: "credito", financiera: clave });
    const registrados = resumen.find((fila) => fila.financiera === clave).registrados;
    if (!objetivo && registrados === 0) return [];
    const meta = objetivo?.monto ?? 0;
    return [{ financiera: clave, etiqueta, meta, registrados, porcentaje: porcentaje(registrados, meta) }];
  });
}

function avanceActividades(DB, filtros) {
  const resumen = resumenActividades(DB, filtros);
  return CLASES_ACTIVIDAD.map(({ clave, etiqueta }) => {
    const meta = objetivoVigente(DB, { ...filtros, tipo: "actividad", actividad: clave })?.monto ?? 0;
    const declaradas = resumen.find((fila) => fila.actividad === clave).declaradas;
    return { actividad: clave, etiqueta, meta, declaradas, porcentaje: porcentaje(declaradas, meta) };
  });
}

function calcularAvance(DB, filtros) {
  const { mes, sucursal_id, vendedor_id } = filtros;
  const delPeriodo = (registro) => registro.vigente && registro.mes === mes && registro.sucursal_id === sucursal_id;
  const metas = DB.pos.objetivos.filter((registro) => delPeriodo(registro) && registro.vendedor_id === vendedor_id);
  const capturas = DB.pos.objetivo_capturas.filter((registro) =>
    delPeriodo(registro) && (vendedor_id === null || registro.vendedor_id === vendedor_id));
  const meta = objetivoVigente(DB, { ...filtros, tipo: "venta" })?.monto ?? 0;
  const capturado = totalCapturado(DB, { ...filtros, tipo: "venta" }, capturas);
  return {
    venta: { meta, capturado, porcentaje: porcentaje(capturado, meta) },
    serie: serieDiaria(capturas),
    marcas: elementosCapturados(DB, filtros, metas, capturas, { lista: "marcas", tipo: "marca", referencia: "marca_id" }),
    productos: elementosCapturados(DB, filtros, metas, capturas, { lista: "productos", tipo: "producto", referencia: "producto_meta_id" }),
    creditos: avanceCreditos(DB, filtros),
    actividades: avanceActividades(DB, filtros),
  };
}

function avancePersona(DB, { mes, sucursal_id, vendedor_id }) {
  return calcularAvance(DB, { mes, sucursal_id: Number(sucursal_id), vendedor_id: Number(vendedor_id) });
}

function avanceTienda(DB, { mes, sucursal_id }) {
  return calcularAvance(DB, { mes, sucursal_id: Number(sucursal_id), vendedor_id: null });
}

function soloPorcentajes(avance) {
  return {
    venta: avance.venta.porcentaje,
    marcas: avance.marcas.map(({ marca_id, nombre, porcentaje }) => ({ marca_id, nombre, porcentaje })),
    productos: avance.productos.map(({ producto_meta_id, nombre, porcentaje }) => ({ producto_meta_id, nombre, porcentaje })),
    creditos: avance.creditos.map(({ financiera, etiqueta, porcentaje }) => ({ financiera, etiqueta, porcentaje })),
    actividades: avance.actividades.map(({ actividad, etiqueta, porcentaje }) => ({ actividad, etiqueta, porcentaje })),
  };
}

function avancePorPersona(DB, { mes, sucursal_id }) {
  sucursal_id = Number(sucursal_id);
  const vendedores = new Set(plantillaDelMes(DB, mes, sucursal_id).map((linea) => linea.vendedor_id));
  return [...vendedores].map((vendedor_id) => {
    const { venta, marcas, productos, creditos, actividades } = avancePersona(DB, { mes, sucursal_id, vendedor_id });
    return { vendedor_id, venta, marcas, productos, creditos, actividades };
  });
}

module.exports = { porcentaje, avancePersona, avanceTienda, soloPorcentajes, avancePorPersona };
