export const ETIQUETAS_FINANCIERA = { coppel_pay: "Coppel Pay", atrato: "Atrato" };
const REFERENCIAS = ["marca_id", "producto_meta_id", "financiera"];
const GRUPOS = [
  { grupo: "marcas", clave: "marca_id" },
  { grupo: "productos", clave: "producto_meta_id" },
  { grupo: "creditos", clave: "financiera" },
];

// Pesos en centavos enteros: en binario 1.40 + 70.20 da 71.60000000000001, y una diferencia
// de cero con residuo dejaría de "cuadrar" o dispararía avisos falsos.
const centavos = (n) => Math.round(Number(n || 0) * 100);
export const restarEnCentavos = (a, b) => (centavos(a) - centavos(b)) / 100;
export const sumarEnCentavos = (montos) => montos.reduce((s, n) => s + centavos(n), 0) / 100;

export const esCapturaDeVenta = (captura) => captura.tipo === undefined || captura.tipo === null || captura.tipo === "venta";

export const pesosConCentavos = (n) => Number(n || 0).toLocaleString("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function cantidad(n, unidad) {
  if (unidad === "pesos") return pesosConCentavos(n);
  if (unidad === "piezas") return `${n} ${n === 1 ? "pieza" : "piezas"}`;
  return `${n} ${n === 1 ? "crédito" : "créditos"}`;
}

export function textoPendiente(sinAsignar, unidad) {
  const n = Number(sinAsignar) || 0;
  if (n === 0) return "Reparto completo";
  if (n < 0) return `Asignaste ${cantidad(-n, unidad)} de más`;
  return `${n === 1 && unidad !== "pesos" ? "Falta" : "Faltan"} ${cantidad(n, unidad)} por repartir`;
}

const tipoDe = (c) => (esCapturaDeVenta(c) ? "venta" : c.tipo);

export const capturasDelDia = (capturas, fecha, tipo) =>
  capturas.filter((c) => c.vigente && c.fecha === fecha && tipoDe(c) === tipo);

export function resumenMarcasDelDia(capturas, fecha) {
  const venta = capturasDelDia(capturas, fecha, "venta")[0];
  const enMarcas = sumarEnCentavos(capturasDelDia(capturas, fecha, "marca").map((c) => c.monto));
  return { venta: venta ? Number(venta.monto) : null, enMarcas };
}

export const esRectificacionDeElemento = (r) => REFERENCIAS.some((clave) => r[clave] !== undefined && r[clave] !== null);

export function vigenteDeElemento(elemento, rectificaciones, clave) {
  const vigente = { meta: elemento.meta, capturado: elemento.capturado ?? elemento.registrados, real: elemento.real };
  for (const r of rectificaciones) {
    if (r[clave] !== undefined && r[clave] === elemento[clave]) vigente[r.campo] = r.valor_nuevo;
  }
  return vigente;
}

export const llaveCampo = (vendedorId, grupo, id) => `${vendedorId}|${grupo}|${id}`;

export function armarRealesCierre(previo, valores) {
  return previo.map((linea) => {
    const real = { vendedor_id: linea.vendedor_id, real_sicar: Number(valores[llaveCampo(linea.vendedor_id, "sicar", "")]) };
    for (const { grupo, clave } of GRUPOS) {
      real[grupo] = (linea[grupo] || []).map((e) => ({
        [clave]: e[clave], real: Number(valores[llaveCampo(linea.vendedor_id, grupo, e[clave])]),
      }));
    }
    return real;
  });
}

export function camposFaltantesCierre(previo, valores) {
  const vacio = (llave) => valores[llave] === undefined || String(valores[llave]).trim() === "";
  const faltan = [];
  for (const linea of previo) {
    const llaves = [llaveCampo(linea.vendedor_id, "sicar", "")];
    for (const { grupo, clave } of GRUPOS) {
      for (const e of linea[grupo] || []) llaves.push(llaveCampo(linea.vendedor_id, grupo, e[clave]));
    }
    faltan.push(...llaves.filter(vacio));
  }
  return faltan;
}

// Renglones de "¿De qué marcas fue?" / "Piezas por producto" para un día: primero las metas
// propias, luego lo ya capturado ese día y al final lo agregado con "+ otra", sin repetir.
export function renglonesDelDia({ clave, tipo, fecha, vendedorId, extras, elementosMeta, catalogo, capturas, totales }) {
  const delDia = capturasDelDia(capturas, fecha, tipo);
  const metaPropia = (e) => (e.lineas || []).find((l) => Number(l.vendedor_id) === Number(vendedorId));
  const ids = [
    ...elementosMeta.filter(metaPropia).map((e) => e[clave]),
    ...delDia.map((c) => c[clave]),
    ...extras,
  ].map(Number);
  return [...new Set(ids)].map((id) => {
    const conMeta = elementosMeta.find((e) => Number(e[clave]) === id);
    const linea = conMeta && metaPropia(conMeta);
    const nombre = catalogo.find((e) => Number(e.id) === id)?.nombre || conMeta?.nombre || `Elemento #${id}`;
    const total = totales.find((t) => Number(t[clave]) === id);
    return {
      id, nombre, meta: linea ? Number(linea.monto) : null, totalMes: total ? Number(total.total_capturado) : 0,
      captura: delDia.find((c) => Number(c[clave]) === id) || null,
    };
  });
}

// El servidor valida todo de nuevo; esto solo decide si el botón "Registrar crédito" se habilita.
export const creditoCompleto = ({ financiera, fecha, monto, folio }) =>
  Boolean(financiera) && Boolean(fecha) && String(folio || "").trim() !== "" && Number(monto) > 0;

export const formatoUnidad = (unidad, n) => cantidad(Number(n) || 0, unidad);

const FAMILIAS_META = [
  { lista: "marcas", tipo: "marca", clave: "marca_id", unidad: "pesos", titulo: "Marca" },
  { lista: "productos", tipo: "producto", clave: "producto_meta_id", unidad: "piezas", titulo: "Producto" },
  { lista: "creditos", tipo: "credito", clave: "financiera", unidad: "creditos", titulo: "Crédito" },
];

// Filas de la tabla del gerente: una por elemento con meta vigente, en el orden marcas, productos, créditos.
export function filasMetasTienda(objetivos) {
  return FAMILIAS_META.flatMap(({ lista, tipo, clave, unidad, titulo }) => (objetivos[lista] || []).map((e) => {
    const id = tipo === "credito" ? e[clave] : Number(e[clave]);
    return {
      ...e, llave: `${tipo}|${id}`, tipo, clave, id, unidad, titulo, nombre: e.nombre || e.etiqueta || ETIQUETAS_FINANCIERA[id] || String(id),
    };
  }));
}

export const consultaElemento = ({ tipo, clave, id }) => `tipo=${tipo}&${clave}=${encodeURIComponent(id)}`;

// Cuántas personas tienen alguna diferencia (capturado contra real) en cada grupo, para la
// confirmación antes de sellar. No exige que sean cero: solo informa lo que se va a sellar.
export function resumenAntesDeSellar(previo, valores) {
  const conDiferencia = { venta: 0, marcas: 0, productos: 0, creditos: 0 };
  for (const linea of previo) {
    if (restarEnCentavos(linea.capturado, valores[llaveCampo(linea.vendedor_id, "sicar", "")]) !== 0) conDiferencia.venta += 1;
    for (const { grupo, clave } of GRUPOS) {
      const difiere = (linea[grupo] || []).some((e) =>
        restarEnCentavos(e.capturado ?? e.registrados, valores[llaveCampo(linea.vendedor_id, grupo, e[clave])]) !== 0);
      if (difiere) conDiferencia[grupo] += 1;
    }
  }
  return { personas: previo.length, conDiferencia };
}
