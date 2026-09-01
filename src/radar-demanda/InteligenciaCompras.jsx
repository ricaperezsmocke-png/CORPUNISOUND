import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, BrainCircuit, HelpCircle, PackageSearch, RefreshCw, ShoppingCart, X } from "lucide-react";
import { hoyLocal } from "../fechas";
import { sucursalActiva } from "../api";
import { cargarSucursalesRadar, consultarInteligenciaCompras } from "./radarDemandaApi";

const numero = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });
const dinero = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

const CLASIFICACIONES = {
  REVISAR_TRASPASO: ["Revisar para traspaso", "Existe evidencia para revisar si conviene mover inventario entre sucursales."],
  REVISAR_COMPRA: ["Revisar para compra", "Existe evidencia para que Compras revise el abastecimiento."],
  OBSERVAR: ["Revisar situación", "Existe información que requiere revisión antes de tomar una decisión."],
  EVIDENCIA_INSUFICIENTE: ["Evidencia insuficiente", "No hay información suficiente para sostener una conclusión."],
  EVALUAR_INCORPORACION: ["Evaluar incorporación", "Clientes han solicitado un producto que actualmente no está catalogado."],
};

const MENSAJES = {
  STOCK_LOCAL_CERO: "La sucursal no tiene existencia registrada disponible.",
  STOCK_LOCAL_BAJO_MINIMO: "La existencia local está por debajo del mínimo configurado.",
  STOCK_SUFICIENTE: "La existencia local no está por debajo del mínimo configurado.",
  STOCK_SOBRE_MAXIMO: "La existencia registrada supera el máximo configurado.",
  DEMANDA_REPETIDA_30D: "El producto fue solicitado repetidamente por distintos contactos en los últimos 30 días.",
  DEMANDA_BAJA: "La demanda reciente todavía no alcanza el umbral inicial de revisión.",
  DEMANDA_CONCENTRADA_UN_CONTACTO: "Las solicitudes recientes se concentran en un solo contacto.",
  VENTAS_RECIENTES: "Existen ventas recientes del producto.",
  SIN_VENTAS_RECIENTES: "No hay ventas recientes suficientes para sostener una acción.",
  VENTAS_ANTIGUAS: "Hay ventas en la ventana de 90 días, pero no en los últimos 30 días.",
  STOCK_OTRA_SUCURSAL: "Otra sucursal autorizada tiene existencia registrada.",
  EXCEDENTE_OTRA_SUCURSAL: "Otra sucursal autorizada tiene existencias por encima de su mínimo configurado.",
  TRASPASO_ENTRANTE_EXISTENTE: "Ya existe mercancía en tránsito interno hacia la sucursal.",
  TRASPASO_ENTRANTE_CUBRE_MINIMO: "El tránsito interno registrado cubre al menos el mínimo configurado.",
  RADAR_SIN_EXISTENCIA_PERO_HAY_STOCK: "Radar registra falta de existencia, pero el sistema muestra stock local.",
  DEMANDA_CON_STOCK_PERO_SIN_VENTAS: "Hay solicitudes recientes y stock registrado, pero no ventas recientes.",
  PRODUCTO_INACTIVO_CON_DEMANDA: "El producto está inactivo y aun así tiene demanda reciente.",
  PRODUCTO_NO_CATALOGADO: "El producto solicitado no está vinculado al catálogo.",
  SIN_FILA_EXISTENCIA: "No existe una fila de inventario para este producto en la sucursal.",
  SIN_SENALES_COMERCIALES_RECIENTES: "No hay solicitudes ni ventas recientes suficientes para analizarlo.",
  MINIMO_NO_CONFIGURADO: "La existencia mínima no está configurada.",
  MINIMO_ORIGEN_NO_CONFIGURADO: "La otra sucursal tiene stock, pero su mínimo no está configurado.",
  MAXIMO_NO_CONFIGURADO: "La existencia máxima no está configurada.",
  STOCK_NEGATIVO: "El inventario registra una existencia negativa que requiere revisión.",
  SIN_HISTORIAL_VENTAS: "No hay historial de ventas del producto en la ventana analizada.",
  SIN_HISTORIAL_COMPRAS: "No hay recepciones históricas identificadas para el producto.",
  PROVEEDOR_NO_IDENTIFICADO: "No se pudo identificar un proveedor configurado ni uno de recepción.",
  PEDIDOS_PROVEEDOR_NO_DISPONIBLES: "El sistema todavía no puede saber si existe un pedido abierto con proveedor.",
};

const CONTRADICCIONES = new Set([
  "RADAR_SIN_EXISTENCIA_PERO_HAY_STOCK", "DEMANDA_CON_STOCK_PERO_SIN_VENTAS",
  "PRODUCTO_INACTIVO_CON_DEMANDA", "DEMANDA_CONCENTRADA_UN_CONTACTO",
  "STOCK_SOBRE_MAXIMO", "TRASPASO_ENTRANTE_CUBRE_MINIMO",
]);

function etiquetaClasificacion(clave) {
  return CLASIFICACIONES[clave]?.[0] || clave;
}

function Insignia({ tipo }) {
  const estilos = tipo === "REVISAR_TRASPASO" ? "bg-violet-100 text-violet-800" : tipo === "REVISAR_COMPRA" ? "bg-blue-100 text-blue-800" : tipo === "EVALUAR_INCORPORACION" ? "bg-amber-100 text-amber-800" : tipo === "EVIDENCIA_INSUFICIENTE" ? "bg-slate-200 text-slate-700" : "bg-orange-100 text-orange-800";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${estilos}`}>{etiquetaClasificacion(tipo)}</span>;
}

function Tarjeta({ titulo, valor, color }) {
  return <div className={`rounded-2xl border neu-panel p-4 shadow-sm ${color}`}><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{titulo}</p><p className="mt-2 text-3xl font-extrabold text-slate-900">{numero.format(valor || 0)}</p></div>;
}

function Seccion({ titulo, icono: Icono, descripcion, vacio, children, tieneDatos }) {
  return <section className="min-w-0 overflow-hidden rounded-2xl neu shadow-sm" style={{ contain: "paint" }}>
    <div className="border-b border-slate-100 p-4"><h2 className="flex items-center gap-2 font-extrabold text-slate-900"><Icono size={19} className="text-blue-700" />{titulo}</h2><p className="mt-1 text-xs text-slate-500">{descripcion}</p></div>
    {tieneDatos ? children : <p className="px-4 py-10 text-center text-sm text-slate-500">{vacio}</p>}
  </section>;
}

function Tabla({ columnas, filas, onExplicar, minWidth = "900px" }) {
  return <div className="w-full min-w-0 overflow-x-auto" style={{ contain: "inline-size" }}><table className="w-full text-left text-sm" style={{ minWidth }}><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{columnas.map((c) => <th key={c.titulo} className="whitespace-nowrap px-4 py-3">{c.titulo}</th>)}<th className="px-4 py-3"><span className="sr-only">Detalle</span></th></tr></thead><tbody>{filas.map((fila, i) => <tr key={`${fila.producto?.producto_id || fila.identidad_textual || "fila"}-${fila.sucursal?.sucursal_id || i}`} className="border-t border-slate-100 align-top">{columnas.map((c) => <td key={c.titulo} className="px-4 py-3 text-slate-700">{c.render(fila)}</td>)}<td className="px-4 py-3"><button onClick={() => onExplicar(fila)} className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 px-3 text-xs font-bold text-blue-700 hover:bg-blue-50"><HelpCircle size={14} />Ver por qué</button></td></tr>)}</tbody></table></div>;
}

function Explicacion({ fila, onCerrar }) {
  if (!fila) return null;
  const calidad = (fila.calidad_datos || []).filter((x) => !(fila.advertencias || []).includes(x));
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="titulo-explicacion">
    <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-2xl neu-panel p-5 shadow-xl sm:rounded-2xl">
      <div className="flex items-start justify-between gap-4"><div><Insignia tipo={fila.clasificacion} /><h2 id="titulo-explicacion" className="mt-3 text-xl font-extrabold text-slate-900">{fila.producto?.nombre || fila.producto_solicitado || "Detalle de evidencia"}</h2><p className="mt-1 text-sm text-slate-600">{CLASIFICACIONES[fila.clasificacion]?.[1]}</p></div><button onClick={onCerrar} aria-label="Cerrar explicación" className="flex min-h-10 min-w-10 items-center justify-center rounded-xl border text-slate-500"><X size={18} /></button></div>
      <BloqueDetalle titulo="Razones" codigos={fila.razones} tono="blue" />
      <BloqueDetalle titulo="Advertencias" codigos={fila.advertencias} tono="amber" />
      <BloqueDetalle titulo="Calidad de datos" codigos={calidad} tono="slate" />
      <DetalleFormas formas={fila.formas} />
    </div>
  </div>;
}

function DetalleFormas({ formas = [] }) {
  if (!formas.length) return null;
  return <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="text-sm font-extrabold text-slate-800">Formas escritas agrupadas</h3><ul className="mt-2 space-y-2 text-sm text-slate-700">{formas.map((forma) => <li key={forma.forma}><span className="font-semibold">{forma.forma}</span><span className="block text-xs text-slate-500">{numero.format(forma.apariciones)} {forma.apariciones === 1 ? "aparición" : "apariciones"} · {numero.format(forma.similitud * 100)}% similar al líder</span></li>)}</ul></section>;
}

function BloqueDetalle({ titulo, codigos = [], tono }) {
  if (!codigos.length) return null;
  const clase = tono === "amber" ? "border-amber-200 bg-amber-50" : tono === "blue" ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50";
  return <section className={`mt-4 rounded-xl border p-4 ${clase}`}><h3 className="text-sm font-extrabold text-slate-800">{titulo}</h3><ul className="mt-2 space-y-2 text-sm text-slate-700">{codigos.map((c) => <li key={c} className="flex gap-2"><span aria-hidden="true">•</span><span>{MENSAJES[c] || c.replaceAll("_", " ").toLocaleLowerCase("es")}</span></li>)}</ul></section>;
}

const valor = (v) => v == null ? "—" : numero.format(v);
const fecha = (v) => v || "—";

export default function InteligenciaCompras({ permisos = [] }) {
  const global = permisos.includes("ver_todas_las_sucursales");
  const [fechaFin, setFechaFin] = useState(hoyLocal());
  const [sucursal, setSucursal] = useState(sucursalActiva());
  const [sucursales, setSucursales] = useState([]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [explicacion, setExplicacion] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError("");
    try { setDatos(await consultarInteligenciaCompras({ fecha_fin: fechaFin, sucursal_id: global ? sucursal : undefined })); }
    catch { setError("No fue posible cargar inteligencia. Intenta nuevamente."); }
    finally { setCargando(false); }
  }, [fechaFin, global, sucursal]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!global) return;
    cargarSucursalesRadar().then(setSucursales).catch(() => setSucursales([]));
  }, [global]);

  const oportunidades = datos?.oportunidades || [];
  const prioritarias = useMemo(() => oportunidades.filter((x) => ["REVISAR_TRASPASO", "REVISAR_COMPRA"].includes(x.clasificacion)), [oportunidades]);
  const compras = useMemo(() => oportunidades.filter((x) => x.clasificacion === "REVISAR_COMPRA"), [oportunidades]);
  const traspasos = useMemo(() => oportunidades.filter((x) => x.clasificacion === "REVISAR_TRASPASO"), [oportunidades]);
  const observar = useMemo(() => oportunidades.filter((x) => x.clasificacion === "EVIDENCIA_INSUFICIENTE" || x.clasificacion === "OBSERVAR" && x.razones.some((r) => CONTRADICCIONES.has(r))), [oportunidades]);
  const libres = datos?.productos_no_manejados || [];
  const hayCostos = compras.some((x) => Object.hasOwn(x.compras_historicas || {}, "ultimo_costo") || Object.hasOwn(x.compras_historicas || {}, "costo_promedio_historico_ponderado"));

  const columnasPrioridad = [
    { titulo: "Producto", render: (x) => <span className="font-bold text-slate-900">{x.producto.nombre}</span> },
    { titulo: "Sucursal", render: (x) => x.sucursal.sucursal_nombre },
    { titulo: "Clasificación", render: (x) => <Insignia tipo={x.clasificacion} /> },
    { titulo: "Solicitudes 30d", render: (x) => valor(x.radar["30d"].solicitudes) },
    { titulo: "Contactos 30d", render: (x) => valor(x.radar["30d"].contactos_distintos) },
    { titulo: "Ventas 30d", render: (x) => valor(x.ventas.unidades_30d) },
    { titulo: "Stock", render: (x) => valor(x.inventario.cantidad_actual) },
    { titulo: "Mínimo", render: (x) => valor(x.inventario.cantidad_minima) },
    { titulo: "En tránsito", render: (x) => valor(x.traspasos.cantidad_entrante_en_transito) },
  ];
  const columnasCompra = [
    { titulo: "Producto / SKU", render: (x) => <><b className="text-slate-900">{x.producto.nombre}</b><span className="block text-xs text-slate-500">{x.producto.sku || "Sin SKU"}</span></> },
    { titulo: "Sucursal", render: (x) => x.sucursal.sucursal_nombre },
    { titulo: "Stock / mínimo", render: (x) => `${valor(x.inventario.cantidad_actual)} / ${valor(x.inventario.cantidad_minima)}` },
    { titulo: "Radar 30d", render: (x) => `${valor(x.radar["30d"].solicitudes)} sol. · ${valor(x.radar["30d"].contactos_distintos)} contactos` },
    { titulo: "Ventas 30d / 90d", render: (x) => `${valor(x.ventas.unidades_30d)} / ${valor(x.ventas.unidades_90d)}` },
    { titulo: "Tránsito", render: (x) => valor(x.traspasos.cantidad_entrante_en_transito) },
    { titulo: "Última recepción", render: (x) => fecha(x.compras_historicas.ultima_recepcion_fecha) },
    { titulo: "Proveedor", render: (x) => x.proveedores.ultimo_proveedor_recepcion_nombre || x.proveedores.proveedor_configurado_nombre || "—" },
    ...(hayCostos ? [
      { titulo: "Último costo", render: (x) => Object.hasOwn(x.compras_historicas, "ultimo_costo") && x.compras_historicas.ultimo_costo != null ? dinero.format(x.compras_historicas.ultimo_costo) : "—" },
      { titulo: "Costo promedio", render: (x) => Object.hasOwn(x.compras_historicas, "costo_promedio_historico_ponderado") && x.compras_historicas.costo_promedio_historico_ponderado != null ? dinero.format(x.compras_historicas.costo_promedio_historico_ponderado) : "—" },
    ] : []),
  ];
  const columnasTraspaso = [
    { titulo: "Producto", render: (x) => <b className="text-slate-900">{x.producto.nombre}</b> },
    { titulo: "Sucursal con demanda", render: (x) => x.sucursal.sucursal_nombre },
    { titulo: "Stock / mínimo", render: (x) => `${valor(x.inventario.cantidad_actual)} / ${valor(x.inventario.cantidad_minima)}` },
    { titulo: "Solicitudes 30d", render: (x) => valor(x.radar["30d"].solicitudes) },
    { titulo: "Ventas 30d", render: (x) => valor(x.ventas.unidades_30d) },
    ...(global ? [{ titulo: "Sucursales alternativas", render: (x) => <div className="space-y-1">{x.otras_sucursales.filter((s) => Number(s.excedente_matematico_sobre_minimo) > 0).map((s) => <div key={s.sucursal_id} className="whitespace-nowrap text-xs"><b>{s.sucursal_nombre}:</b> stock {valor(s.cantidad_actual)} · mínimo {valor(s.cantidad_minima)} · <span className="text-violet-700">excedente sobre mínimo {valor(s.excedente_matematico_sobre_minimo)}</span></div>)}</div> }] : []),
  ];
  const columnasLibres = [
    { titulo: "Formas", render: (x) => valor(x.formas_distintas) },
    { titulo: "Producto solicitado", render: (x) => <><b className="text-slate-900">{x.producto_solicitado || "Sin descripción"}</b><span className="mt-1 block"><Insignia tipo={x.clasificacion} /></span></> },
    { titulo: "Marca / modelo", render: (x) => [x.marca, x.modelo].filter(Boolean).join(" · ") || "—" },
    { titulo: "Variante / categoría", render: (x) => [x.variante, x.categoria].filter(Boolean).join(" · ") || "—" },
    { titulo: "Solicitudes 30d", render: (x) => valor(x.radar_30d?.solicitudes) },
    { titulo: "Cantidad 30d", render: (x) => valor(x.radar_30d?.cantidad_solicitada) },
    { titulo: "Contactos", render: (x) => valor(x.radar_30d?.contactos_distintos) },
    { titulo: "Sucursales", render: (x) => valor(x.sucursales) },
    { titulo: "Primera / última", render: (x) => `${fecha(x.primera_solicitud)} / ${fecha(x.ultima_solicitud)}` },
  ];
  const columnasObservar = [
    { titulo: "Producto", render: (x) => <b className="text-slate-900">{x.producto.nombre}</b> },
    { titulo: "Sucursal", render: (x) => x.sucursal.sucursal_nombre },
    { titulo: "Situación", render: (x) => <Insignia tipo={x.clasificacion} /> },
    { titulo: "Stock", render: (x) => valor(x.inventario.cantidad_actual) },
    { titulo: "Solicitudes 30d", render: (x) => valor(x.radar["30d"].solicitudes) },
    { titulo: "Razón principal", render: (x) => MENSAJES[x.razones[0]] || x.razones[0] },
  ];

  return <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden">
    <section className="neu rounded-2xl p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-end"><div className="flex-1"><div className="flex items-center gap-2"><BrainCircuit size={20} className="text-blue-700" /><h2 className="font-extrabold text-slate-900">Inteligencia para Compras</h2></div><p className="mt-1 max-w-2xl text-sm text-slate-500">Evidencia para revisar abastecimiento y movimiento interno. No genera compras ni traspasos.</p></div><label className="text-xs font-semibold text-slate-500">Fecha de corte<input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} className="mt-1 block min-h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800" /></label>{global && <label className="text-xs font-semibold text-slate-500">Sucursal<select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className="mt-1 block min-h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800"><option value="todas">Todas</option>{sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>}<button onClick={cargar} disabled={cargando} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-blue-200 px-4 text-sm font-bold text-blue-700 hover:bg-blue-50"><RefreshCw size={16} className={cargando ? "animate-spin" : ""} />Actualizar</button></div></section>

    {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertTriangle size={18} />{error}</div>}
    {cargando && !datos ? <div className="py-16 text-center text-sm text-slate-500">Cargando inteligencia...</div> : datos && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"><Tarjeta titulo="Revisar traspaso" valor={datos.resumen.revisar_traspaso} color="border-violet-200" /><Tarjeta titulo="Revisar compra" valor={datos.resumen.revisar_compra} color="border-blue-200" /><Tarjeta titulo="Observar" valor={datos.resumen.observar} color="border-orange-200" /><Tarjeta titulo="Evidencia insuficiente" valor={datos.resumen.evidencia_insuficiente} color="border-slate-300" /><Tarjeta titulo="Evaluar incorporación" valor={datos.resumen.evaluar_incorporacion} color="border-amber-200" /></div>
      <Seccion titulo="Atención prioritaria" icono={BrainCircuit} descripcion="Vista combinada de oportunidades para revisar por traspaso o compra." vacio="No hay oportunidades prioritarias en este momento." tieneDatos={prioritarias.length}><Tabla columnas={columnasPrioridad} filas={prioritarias} onExplicar={setExplicacion} minWidth="1100px" /></Seccion>
      <Seccion titulo="Revisar para compra" icono={ShoppingCart} descripcion={CLASIFICACIONES.REVISAR_COMPRA[1]} vacio="No hay productos para revisar por compra." tieneDatos={compras.length}><Tabla columnas={columnasCompra} filas={compras} onExplicar={setExplicacion} minWidth={hayCostos ? "1350px" : "1100px"} /></Seccion>
      <Seccion titulo="Revisar para traspaso" icono={ArrowRightLeft} descripcion={CLASIFICACIONES.REVISAR_TRASPASO[1]} vacio="No hay oportunidades de traspaso detectadas." tieneDatos={traspasos.length}><Tabla columnas={columnasTraspaso} filas={traspasos} onExplicar={setExplicacion} minWidth={global ? "1050px" : "760px"} /></Seccion>
      <Seccion titulo="Productos no manejados" icono={PackageSearch} descripcion={CLASIFICACIONES.EVALUAR_INCORPORACION[1]} vacio="No hay productos no manejados con suficiente evidencia." tieneDatos={libres.length}><Tabla columnas={columnasLibres} filas={libres} onExplicar={setExplicacion} minWidth="1150px" /></Seccion>
      <Seccion titulo="Contradicciones / observar" icono={AlertTriangle} descripcion="Situaciones que necesitan revisión antes de tomar una decisión." vacio="No se detectaron contradicciones en este momento." tieneDatos={observar.length}><Tabla columnas={columnasObservar} filas={observar} onExplicar={setExplicacion} minWidth="850px" /></Seccion>
    </>}
    {!cargando && !error && datos && !datos.oportunidades.length && !datos.productos_no_manejados.length && <p className="rounded-xl bg-slate-100 p-4 text-center text-sm text-slate-500">No hay datos de inteligencia para la fecha seleccionada.</p>}
    <Explicacion fila={explicacion} onCerrar={() => setExplicacion(null)} />
  </div>;
}
