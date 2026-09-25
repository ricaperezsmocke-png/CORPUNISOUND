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

// ---------------------------------------------------------------------------------------------
// Lo que la vendedora ve de su tienda (decisión de Victor 2026-09-25, opción A).
// Con el % entero de tienda se podía despejar lo de la compañera: en metas chicas cada unidad mueve
// el %, y corrigiendo su propia venta una y otra vez se despejaba la cifra al centavo. Por eso:
// 1) el % se calcula con lo que había al cierre de AYER (lo de hoy, y lo corregido o anulado hoy, no
//    cuenta todavía), y 2) en metas de piezas, créditos o actividades de menos de 100 no se muestra.
const MINIMO_UNIDADES = 100;

function inicioDeHoy(ahora) {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(ahora);
  return new Date(`${hoy}T00:00:00-06:00`).toISOString();
}

// Copia de la base como estaba al corte: sin lo registrado después, y con la vigencia de entonces.
function fotoAl(DB, corte) {
  const antes = (marca) => !marca || marca < corte;
  const capturas = DB.pos.objetivo_capturas || [];
  const corregidasAntes = new Set(capturas.filter((c) => c.corrige_a !== null && c.corrige_a !== undefined && antes(c.capturado_en))
    .map((c) => c.corrige_a));
  // Las metas también como estaban: una versión creada hoy no cuenta y la que reemplazó sigue vigente.
  const objetivos = DB.pos.objetivos || [];
  const reemplazadasAntes = new Set(objetivos.filter((o) => o.reemplaza_a !== null && o.reemplaza_a !== undefined && antes(o.creado_en))
    .map((o) => o.reemplaza_a));
  const anuladoAlCorte = (r) => ({ ...r, vigente: !(r.anulado_en && r.anulado_en < corte) && (r.vigente || Boolean(r.anulado_en)) });
  return {
    ...DB,
    pos: {
      ...DB.pos,
      objetivos: objetivos.filter((o) => antes(o.creado_en)).map((o) => ({ ...o, vigente: !reemplazadasAntes.has(o.id) })),
      objetivo_capturas: capturas.filter((c) => antes(c.capturado_en))
        .map((c) => ({ ...c, vigente: !corregidasAntes.has(c.id) })),
      objetivo_creditos: (DB.pos.objetivo_creditos || []).filter((r) => antes(r.registrado_en)).map(anuladoAlCorte),
      objetivo_actividades: (DB.pos.objetivo_actividades || []).filter((r) => antes(r.registrado_en)).map(anuladoAlCorte),
    },
  };
}

function porcentajesParaVendedora(DB, { mes, sucursal_id }, propio, ahora = new Date()) {
  const tienda = avanceTienda(fotoAl(DB, inicioDeHoy(ahora)), { mes, sucursal_id });
  const pct = soloPorcentajes(tienda);
  const suyo = (grupo, clave) => new Set((propio?.[grupo] || []).map((e) => String(e[clave])));
  const metaTienda = (grupo, clave, id) => Number(tienda[grupo].find((e) => String(e[clave]) === String(id))?.meta || 0);
  const recortar = (grupo, clave, porUnidades, visibles) => pct[grupo]
    .filter((e) => visibles.has(String(e[clave])))
    .map((e) => (porUnidades && metaTienda(grupo, clave, e[clave]) < MINIMO_UNIDADES ? { ...e, porcentaje: null } : e));
  const actividadesSuyas = new Set((propio?.actividades || [])
    .filter((a) => Number(a.meta) > 0 || Number(a.declaradas) > 0).map((a) => String(a.actividad)));
  // La venta de la tienda solo junto a una meta o venta propia: sin ellas, ese % sería puro avance ajeno.
  const ventaPropia = propio && (Number(propio.venta.meta) > 0 || Number(propio.venta.capturado) > 0);
  return {
    venta: ventaPropia ? pct.venta : null,
    marcas: recortar("marcas", "marca_id", false, suyo("marcas", "marca_id")),
    productos: recortar("productos", "producto_meta_id", true, suyo("productos", "producto_meta_id")),
    creditos: recortar("creditos", "financiera", true, suyo("creditos", "financiera")),
    actividades: recortar("actividades", "actividad", true, actividadesSuyas),
  };
}

module.exports = { porcentaje, avancePersona, avanceTienda, soloPorcentajes, avancePorPersona, porcentajesParaVendedora };
