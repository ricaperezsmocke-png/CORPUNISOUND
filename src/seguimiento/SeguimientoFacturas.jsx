import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import ModalConfirmar from "../ModalConfirmar.jsx";
import { contadorDePeticiones, fechaRelativa } from "../sicar/cortesSicar.js";
import {
  TEXTOS, piezasTexto, tramosDeFactura, etiquetaEtapa, siguienteAccion, puedeGestionar, parametrosLista,
  textoTraslado, validarMotivo, validarPosponer, botonIncorporar, textoMotivo, fechaHoraLocal, textoComparacion, textoPorArticulo,
  totalFacturaTexto, valorConIvaTexto, notaRescate,
} from "./seguimiento.js";

const PAGINA = "mx-auto max-w-7xl p-4 sm:p-6";
const CAMPO = "w-full rounded-md border border-slate-400 px-3 py-2 text-sm";
const ETIQUETA = "block text-xs font-semibold text-slate-700";
const ENCABEZADO = "border-b border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold";
const CELDA = "border-b border-slate-200 px-3 py-2 align-top";
const DERECHA = "text-right tabular-nums";
const NOTA_ROJA = "mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800";
const NOTA_AMBAR = "mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900";
const NOTA_GRIS = "text-xs text-slate-600";
const SECUNDARIO = "text-[11px] text-slate-500";
const PESTANA = "rounded-md border px-3 py-2 text-sm";
const PESTANA_ON = "border-blue-700 bg-blue-700 text-white";
const PESTANA_OFF = "border-slate-400 bg-white text-slate-700";
const BTN = "rounded-md border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50";
const BTN_PRIMARIO = "rounded-md bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50";
const CAJA = "rounded-lg border border-slate-300 bg-white p-3";
const BARRA = "flex h-3 w-48 overflow-hidden rounded bg-slate-100";
const ETAPAS = [["", "Todas"], ["traslado", "Traslado"], ["margen_75", "Margen 75 %"], ["margen_50", "Margen 50 %"], ["liquidar", "Liquidar"]];
const CONFIG = [
  ["dias_traslado", "Días para aviso de traslado"], ["dias_margen_75", "Días para bajar precio (75 %)"],
  ["dias_margen_50", "Días para bajar precio (50 %)"], ["dias_liquidacion", "Días para liquidar a costo"],
  ["ganancia_75_porcentaje", "Ganancia conservada 1 (%)"], ["ganancia_50_porcentaje", "Ganancia conservada 2 (%)"],
  ["ganancia_liquidacion_porcentaje", "Ganancia al liquidar (%)"], ["semanas_ventas", "Semanas de ventas"],
  ["semanas_informativas", "Semanas informativas"], ["multiplicador_destino", "Destino vende al menos (veces)"],
  ["semanas_con_ventas", "Semanas distintas con venta"], ["semanas_cobertura_destino", "Cobertura máxima del destino (semanas)"],
  ["semanas_reserva_origen", "Reserva del origen (semanas)"], ["dias_datos_atrasados", "Datos atrasados después de (días)"],
  ["horas_foto_vieja", "Foto vieja después de (horas)"],
];

async function pedir(ruta, opciones) {
  const r = await apiFetch(ruta, opciones);
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(cuerpo?.error || "No se pudo completar la operación.");
  return cuerpo;
}

const montoTexto = (t) => (t.secundario ? `${t.principal} con IVA (${t.secundario})` : t.principal);

function Barra({ factura }) {
  const tramos = tramosDeFactura(factura);
  const titulo = tramos.map((t) => `${t.etiqueta}: ${montoTexto(t)} · ${t.piezas} pzas`).join("\n");
  return (
    <div title={titulo}>
      <p className="text-xs font-semibold text-slate-800">{totalFacturaTexto(factura)}</p>
      <div className={BARRA} role="img" aria-label={titulo}>
        {tramos.map((t) => t.porcentaje > 0 && <div key={t.id} className={t.color} style={{ width: `${t.porcentaje}%` }} />)}
      </div>
      <p className={NOTA_GRIS}>
        Queda {tramos[1].principal}
        {tramos[1].secundario && <span className={SECUNDARIO}> ({tramos[1].secundario})</span>} · {tramos[1].piezas} pzas
      </p>
    </div>
  );
}

function Leyenda({ factura }) {
  return (
    <table className="text-sm">
      <tbody>
        {tramosDeFactura(factura).map((t) => (
          <tr key={t.id}>
            <td className="pr-2"><span className={`inline-block h-3 w-3 rounded ${t.color}`} /></td>
            <td className="pr-4">{t.etiqueta}</td>
            <td className={`pr-4 ${DERECHA}`}>
              {t.principal}
              {t.secundario && <span className={`block ${SECUNDARIO}`}>{t.secundario}</span>}
            </td>
            <td className={`pr-4 ${DERECHA}`}>{t.piezas} pzas</td>
            <td className={DERECHA}>{t.porcentaje} %</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GestionAviso({ aviso, onHecho }) {
  const [modo, setModo] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    const mal = modo === "pospuesto" ? validarPosponer({ motivo, fecha }, fechaRelativa(0)) : validarMotivo(motivo);
    if (mal) { setError(mal); return; }
    setEnviando(true);
    try {
      const cuerpo = { estado: modo, motivo, ...(modo === "pospuesto" ? { pospuesto_hasta: fecha } : {}) };
      await pedir(`/seguimiento-facturas/avisos/${aviso.id}`, { method: "POST", body: JSON.stringify(cuerpo) });
      setModo(null); setMotivo(""); setFecha(""); setError("");
      onHecho();
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };
  if (!modo) {
    return (
      <div className="flex gap-2">
        <button type="button" className={BTN} onClick={() => setModo("revisado")}>Revisado</button>
        <button type="button" className={BTN} onClick={() => setModo("pospuesto")}>Posponer</button>
      </div>
    );
  }
  return (
    <div className="mt-2 grid max-w-xl gap-2">
      <label className={ETIQUETA}>Motivo (obligatorio)
        <input className={CAMPO} value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      {modo === "pospuesto" && (
        <label className={ETIQUETA}>Posponer hasta
          <input type="date" className={CAMPO} value={fecha} min={fechaRelativa(-1)} onChange={(e) => setFecha(e.target.value)} />
        </label>
      )}
      {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={BTN_PRIMARIO} disabled={enviando} onClick={enviar}>
          {modo === "pospuesto" ? "Posponer aviso" : "Marcar revisado"}
        </button>
        <button type="button" className={BTN} onClick={() => { setModo(null); setError(""); }}>Cancelar</button>
      </div>
    </div>
  );
}

function Estrategias({ e, renglon, nombres }) {
  if (!e) return null;
  return (
    <div className="mt-2 space-y-1 text-sm">
      {textoPorArticulo(e.facturas_en_aviso) && <p className="text-slate-600">{textoPorArticulo(e.facturas_en_aviso)}</p>}
      {e.traslados.length === 0 && <p className="text-slate-600">{TEXTOS.sin_traslado}</p>}
      {e.traslados.map((s, i) => <p key={i}>{textoTraslado(s, nombres, renglon.clave, renglon.descripcion)}</p>)}
      {e.margen && <p>{e.margen.texto}</p>}
      {e.articulo_compartido && <p className="font-semibold text-amber-800">{e.articulo_compartido}</p>}
    </div>
  );
}

function Renglon({ r, nombres }) {
  const tiendas = Object.entries(r.por_sucursal);
  const motivos = [...new Set([...(r.motivos || []), ...(r.incierto || [])])];
  return (
    <div className={CAJA}>
      <p className="font-semibold">{r.clave} {r.descripcion || ""}</p>
      <p className={NOTA_GRIS}>Datos al {fechaHoraLocal(r.calidad?.datos_al)}</p>
      <table className="mt-2 text-sm">
        <tbody>
          <tr><td className="pr-4">Comprado</td><td className={DERECHA}>{piezasTexto(r.comprado)} pzas · {valorConIvaTexto(r.valor_centavos, r.valor_con_iva_centavos)}</td></tr>
          <tr><td className="pr-4">Vendido</td><td className={DERECHA}>{piezasTexto(r.vendido)}</td></tr>
          {tiendas.map(([s, v]) => (
            <tr key={s}><td className="pr-4">Queda en {nombres[s] || `Tienda ${s}`}</td><td className={DERECHA}>{piezasTexto(v.queda)}</td></tr>
          ))}
          <tr><td className="pr-4">En tránsito</td><td className={DERECHA}>{piezasTexto(r.transito)}</td></tr>
          <tr><td className="pr-4">{TEXTOS.gris}</td><td className={DERECHA}>{piezasTexto(r.sin_agente)}</td></tr>
          <tr><td className="pr-4">{TEXTOS.por_aclarar}</td><td className={DERECHA}>{piezasTexto(r.por_aclarar)}</td></tr>
        </tbody>
      </table>
      {motivos.length > 0 && <p className="mt-2 text-sm text-amber-800">Por aclarar: {motivos.map(textoMotivo).join(" · ")}</p>}
      {r.comparacion?.length > 0 && (
        <div className="mt-2 text-sm">
          <p className="font-semibold">Existencia SICAR contra lo calculado (todas las facturas y la mercancía anterior)</p>
          {r.comparacion.map((c) => (
            <p key={c.sucursal_id} className={c.diferencia && c.diferencia !== "0" ? "text-amber-800" : ""}>{textoComparacion(c, nombres)}</p>
          ))}
        </div>
      )}
      <Estrategias e={r.estrategias} renglon={r} nombres={nombres} />
    </div>
  );
}

function Detalle({ comId, nombres, permisos, onCerrar, onCambio }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const cargar = useCallback(async () => {
    try { setDatos(await pedir(`/seguimiento-facturas/6/${comId}`)); setError(""); }
    catch (e) { setError(e.message); }
  }, [comId]);
  useEffect(() => { cargar(); }, [cargar]);
  if (error) return <p role="alert" className={NOTA_ROJA}>{error}</p>;
  if (!datos) return <p className="text-sm text-slate-500">Cargando…</p>;
  const { factura, renglones, avisos } = datos;
  const activo = avisos.find((a) => a.estado !== "retirado");
  const rescate = notaRescate(renglones, nombres);
  return (
    <div className="mb-6 space-y-3 rounded-lg border-2 border-blue-300 bg-blue-50/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Factura {factura.folio || factura.com_id} · {factura.proveedor || "Proveedor sin nombre"}</h2>
          <p className="text-sm">Compra del {factura.fecha_compra} · {factura.dias} días · {siguienteAccion(factura)}</p>
          {factura.comentario && <p className={NOTA_GRIS}>Comentario: “{factura.comentario}”. {TEXTOS.comentario}</p>}
        </div>
        <button type="button" className={BTN} onClick={onCerrar}>Cerrar</button>
      </div>
      <p className="text-base font-semibold">{totalFacturaTexto(factura)}</p>
      <p className="text-sm font-semibold text-slate-700">{TEXTOS.fifo}</p>
      {rescate && <p className={NOTA_AMBAR}>{rescate}</p>}
      <Leyenda factura={factura} />
      {activo && (
        <div className={CAJA}>
          <p className="font-semibold">Aviso: {etiquetaEtapa(activo.etapa)} ({activo.estado}
            {activo.pospuesto_hasta ? ` hasta ${activo.pospuesto_hasta}` : ""})</p>
          {puedeGestionar(permisos) && <GestionAviso aviso={activo} onHecho={() => { cargar(); onCambio(); }} />}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">{renglones.map((r) => <Renglon key={r.renglon} r={r} nombres={nombres} />)}</div>
      {avisos.length > 0 && (
        <div className={CAJA}>
          <p className="mb-1 font-semibold">Historial de avisos</p>
          {avisos.flatMap((a) => a.historial.map((h, i) => (
            <p key={`${a.id}-${i}`} className="text-sm">
              {fechaHoraLocal(h.fecha)} · {etiquetaEtapa(a.etapa)} · {h.estado}
              {h.motivo ? ` · ${h.motivo}` : ""} · {h.actor === "sistema" ? "Sistema" : `Usuario #${h.actor}`}
            </p>
          )))}
        </div>
      )}
    </div>
  );
}

function Facturas({ nombres, permisos }) {
  const [filtros, setFiltros] = useState({ proveedor: "", folio: "", clave: "", desde: "", hasta: "", tienda: "", etapa: "",
    solo_aviso: false, ocultar_agotadas: true, pagina: 1 });
  const [consulta, setConsulta] = useState(filtros);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [abierta, setAbierta] = useState(null);
  const peticiones = useRef(contadorDePeticiones());
  const cambiar = (campo) => (e) => setFiltros((f) => ({ ...f, pagina: 1,
    [campo]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  useEffect(() => { const t = setTimeout(() => setConsulta(filtros), 300); return () => clearTimeout(t); }, [filtros]);
  const cargar = useCallback(async () => {
    const numero = peticiones.current.nueva();
    setCargando(true);
    try {
      const cuerpo = await pedir(`/seguimiento-facturas?${parametrosLista(consulta)}`);
      if (!peticiones.current.vigente(numero)) return;
      setDatos(cuerpo); setError("");
    } catch (e) {
      if (peticiones.current.vigente(numero)) { setDatos(null); setError(e.message); }
    } finally { if (peticiones.current.vigente(numero)) setCargando(false); }
  }, [consulta]);
  useEffect(() => { cargar(); }, [cargar]);
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.por_pagina)) : 1;
  return (
    <>
      {abierta && <Detalle comId={abierta} nombres={nombres} permisos={permisos} onCerrar={() => setAbierta(null)} onCambio={cargar} />}
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={ETIQUETA}>Proveedor<input className={CAMPO} value={filtros.proveedor} onChange={cambiar("proveedor")} /></label>
        <label className={ETIQUETA}>Folio<input className={CAMPO} value={filtros.folio} onChange={cambiar("folio")} /></label>
        <label className={ETIQUETA}>Clave<input className={CAMPO} value={filtros.clave} onChange={cambiar("clave")} /></label>
        <label className={ETIQUETA}>Etapa
          <select className={CAMPO} value={filtros.etapa} onChange={cambiar("etapa")}>
            {ETAPAS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </label>
        <label className={ETIQUETA}>Compra desde<input type="date" className={CAMPO} value={filtros.desde} onChange={cambiar("desde")} /></label>
        <label className={ETIQUETA}>Compra hasta<input type="date" className={CAMPO} value={filtros.hasta} onChange={cambiar("hasta")} /></label>
        <label className={ETIQUETA}>Tienda con mercancía
          <select className={CAMPO} value={filtros.tienda} onChange={cambiar("tienda")}>
            <option value="">Todas</option>
            {Object.entries(nombres).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </label>
        <div className="flex flex-col justify-end gap-1 text-sm">
          <label><input type="checkbox" checked={filtros.solo_aviso} onChange={cambiar("solo_aviso")} /> Solo con aviso</label>
          <label><input type="checkbox" checked={filtros.ocultar_agotadas} onChange={cambiar("ocultar_agotadas")} /> Ocultar agotadas</label>
        </div>
      </div>
      {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
      {cargando && <p className="mb-2 text-sm text-slate-500">Cargando…</p>}
      {datos && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {["Proveedor", "Folio", "Compra", "Días", "Barra", "Siguiente acción", "Datos al", ""].map((h) => (
                  <th key={h} className={ENCABEZADO}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {datos.facturas.map((f) => (
                <tr key={f.com_id}>
                  <td className={CELDA}>{f.proveedor || "—"}</td>
                  <td className={CELDA}>{f.folio || f.com_id}</td>
                  <td className={CELDA}>{f.fecha_compra}</td>
                  <td className={`${CELDA} ${DERECHA}`}>{f.dias}</td>
                  <td className={CELDA}><Barra factura={f} /></td>
                  <td className={CELDA}>{siguienteAccion(f)}</td>
                  <td className={CELDA}>{f.datos_al ? fechaHoraLocal(f.datos_al, { soloFecha: true }) : TEXTOS.insuficiente}</td>
                  <td className={CELDA}><button type="button" className={BTN} onClick={() => setAbierta(f.com_id)}>Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {datos.facturas.length === 0 && <p className="mt-3 text-sm text-slate-700">No hay facturas con estos filtros.</p>}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <button type="button" className={BTN} disabled={filtros.pagina <= 1}
              onClick={() => setFiltros((f) => ({ ...f, pagina: f.pagina - 1 }))}>Anterior</button>
            <span>Página {datos.pagina} de {paginas} · {datos.total} facturas</span>
            <button type="button" className={BTN} disabled={filtros.pagina >= paginas}
              onClick={() => setFiltros((f) => ({ ...f, pagina: f.pagina + 1 }))}>Siguiente</button>
          </div>
        </div>
      )}
    </>
  );
}

function Tiendas({ nombres, permisos }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [confirmar, setConfirmar] = useState(null);
  const cargar = useCallback(async () => {
    try { setDatos(await pedir("/seguimiento-facturas/tiendas")); setError(""); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const incorporar = async () => {
    const tienda = confirmar;
    setConfirmar(null);
    try { await pedir(`/seguimiento-facturas/tiendas/${tienda.sucursal_id}/incorporar`, { method: "POST", body: "{}" }); cargar(); }
    catch (e) { setError(e.message); }
  };
  const nombre = (id) => nombres[id] || `Tienda ${id}`;
  return (
    <div className="space-y-4">
      {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
      <div className={CAJA}>
        <p className="mb-2 font-semibold">Tiendas en el seguimiento</p>
        {datos?.incorporadas.length === 0 && <p className="text-sm">Todavía no hay tiendas incorporadas.</p>}
        {datos?.incorporadas.map((t) => (
          <p key={t.sucursal_id} className="text-sm">
            {nombre(t.sucursal_id)} · foto del {fechaHoraLocal(t.corte)} · {t.claves} claves · {t.problemas} con problema
          </p>
        ))}
      </div>
      <div className={CAJA}>
        <p className="mb-2 font-semibold">Tiendas con agente sin incorporar</p>
        {datos?.pendientes.map((t) => {
          const boton = botonIncorporar(t, permisos);
          const problemas = Object.entries(t.problemas).map(([m, n]) => `${n} ${m.replaceAll("_", " ")}`).join(" · ");
          return (
            <div key={t.sucursal_id} className="mb-2 flex flex-wrap items-center gap-3 text-sm">
              <span>{nombre(t.sucursal_id)} · foto {t.corte ? `del ${fechaHoraLocal(t.corte)}` : "sin datos"}
                {` · ${t.claves} claves`}{problemas ? ` · Problemas: ${problemas}` : ""}</span>
              {boton.visible && (
                <button type="button" className={BTN} disabled={boton.deshabilitado} title={boton.razon} onClick={() => setConfirmar(t)}>
                  Incorporar
                </button>
              )}
              {boton.razon && <span className="text-amber-800">{boton.razon}</span>}
            </div>
          );
        })}
      </div>
      {confirmar && (
        <ModalConfirmar titulo={`Incorporar ${nombre(confirmar.sucursal_id)}`}
          mensaje={`Se guardará la foto de existencias de ${nombre(confirmar.sucursal_id)} como "mercancía anterior". `
            + "Desde ahora sus ventas y traspasos se cuentan contra las facturas de CEDIS. No se puede deshacer."}
          textoConfirmar="Sí, incorporar" textoCancelar="Volver" peligro onConfirmar={incorporar} onCancelar={() => setConfirmar(null)} />
      )}
    </div>
  );
}

function Configuracion() {
  const [datos, setDatos] = useState(null);
  const [valores, setValores] = useState({});
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const cargar = useCallback(async () => {
    try { const d = await pedir("/seguimiento-facturas/config"); setDatos(d); setValores(d.valores); setError(""); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const guardar = async () => {
    const cambios = Object.fromEntries(Object.entries(valores).filter(([k, v]) => Number(v) !== datos.valores[k])
      .map(([k, v]) => [k, Number(v)]));
    if (!Object.keys(cambios).length) { setAviso("No hay cambios."); return; }
    try {
      const d = await pedir("/seguimiento-facturas/config", { method: "PUT", body: JSON.stringify(cambios) });
      setDatos(d); setValores(d.valores); setError(""); setAviso("Guardado. Las facturas se recalculan en los próximos minutos.");
    } catch (e) { setError(e.message); setAviso(""); }
  };
  if (!datos) return error ? <p role="alert" className={NOTA_ROJA}>{error}</p> : <p className="text-sm text-slate-500">Cargando…</p>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CONFIG.map(([clave, texto]) => (
          <label key={clave} className={ETIQUETA}>{texto} <span className="font-normal">(inicial {datos.iniciales[clave]})</span>
            <input type="number" step="1" className={CAMPO} value={valores[clave] ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [clave]: e.target.value }))} />
          </label>
        ))}
      </div>
      {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
      {aviso && <p className="text-sm text-emerald-800">{aviso}</p>}
      <button type="button" className={BTN_PRIMARIO} onClick={guardar}>Guardar cambios</button>
      <div className={CAJA}>
        <p className="mb-1 font-semibold">Historial de cambios</p>
        {datos.historial.length === 0 && <p className="text-sm">Sin cambios: se usan los valores iniciales.</p>}
        {datos.historial.map((h) => (
          <p key={h.id} className="text-sm">{fechaHoraLocal(h.fecha)} · {h.clave}: {h.anterior} → {h.nuevo} · Usuario #{h.actor}</p>
        ))}
      </div>
    </div>
  );
}

export default function SeguimientoFacturas({ permisos = [] }) {
  const [pestana, setPestana] = useState("facturas");
  const [nombres, setNombres] = useState({});
  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch("/sucursales?sucursal_id=");
        const lista = await r.json();
        if (r.ok && Array.isArray(lista)) setNombres(Object.fromEntries(lista.map((t) => [t.id, t.nombre])));
      } catch { /* sin nombres se muestran como "Tienda N" */ }
    })();
  }, []);
  const gestiona = puedeGestionar(permisos);
  const estilo = (id) => `${PESTANA} ${pestana === id ? PESTANA_ON : PESTANA_OFF}`;
  return (
    <div className={PAGINA}>
      <h1 className="mb-1 text-xl font-bold text-slate-900">Seguimiento de facturas CEDIS</h1>
      <p className={NOTA_AMBAR}>{TEXTOS.fifo} Sirve para decidir traslados y precios, no para cobrar faltantes a nadie.</p>
      <div className="mb-4 flex gap-2">
        <button type="button" aria-pressed={pestana === "facturas"} className={estilo("facturas")} onClick={() => setPestana("facturas")}>Facturas</button>
        <button type="button" aria-pressed={pestana === "tiendas"} className={estilo("tiendas")} onClick={() => setPestana("tiendas")}>Tiendas</button>
        {gestiona && (
          <button type="button" aria-pressed={pestana === "config"} className={estilo("config")} onClick={() => setPestana("config")}>
            Configuración
          </button>
        )}
      </div>
      {pestana === "facturas" && <Facturas nombres={nombres} permisos={permisos} />}
      {pestana === "tiendas" && <Tiendas nombres={nombres} permisos={permisos} />}
      {pestana === "config" && gestiona && <Configuracion />}
    </div>
  );
}
