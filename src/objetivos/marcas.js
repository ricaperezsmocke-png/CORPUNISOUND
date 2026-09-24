export const ETIQUETAS_FINANCIERA = { coppel_pay: "Coppel Pay", atrato: "Atrato" };
const REFERENCIAS = ["marca_id", "producto_meta_id", "financiera"];
const GRUPOS = [
  { grupo: "marcas", clave: "marca_id" },
  { grupo: "productos", clave: "producto_meta_id" },
  { grupo: "creditos", clave: "financiera" },
];

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
  const enMarcas = capturasDelDia(capturas, fecha, "marca").reduce((s, c) => s + Number(c.monto), 0);
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
