import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";
import { contadorDePeticiones } from "../sicar/cortesSicar.js";
import {
  textoEspera, nombreEstado, motivoValido, puedeRegistrar, resumenFacturas, fechaCorta, archivoXmlValido,
  mensajeResultado, textoTotal, textoMonedaProhibida, resumenProhibidas,
} from "./facturasPorLlegar.js";
import {
  textoUnion, textoAutor, puedeConciliar, textoViejas, avisosRojos, motivoConciliacionValido, avisosOmitidas, cargarConciliacion,
} from "./conciliacion.js";

const PAGINA = "mx-auto max-w-7xl p-4 sm:p-6";
const CAJA = "rounded-lg border border-slate-300 bg-white";
const CAMPO = "w-full rounded-md border border-slate-400 px-3 py-2 text-sm";
const ETIQUETA = "block text-xs font-semibold text-slate-700";
const ENCABEZADO = "border-b border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold";
const CELDA = "border-b border-slate-200 px-3 py-2 align-top";
const DERECHA = "text-right tabular-nums";
const NOTA_ROJA = "mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800";
const NOTA_AMBAR = "mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900";
const NOTA_VERDE = "mt-3 rounded-md border border-green-300 bg-green-50 p-2 text-sm text-green-900";
const NOTA_GRIS = "text-xs text-slate-600";
const BTN = "rounded-md border border-slate-400 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50";
const BTN_PRIMARIO = "rounded-md bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50";
const BTN_PELIGRO = "rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50";
const FONDO = "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4";
const MODAL = "max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-4 shadow-xl";
const ESTADOS = [
  { id: "por_llegar", nombre: "Por llegar" }, { id: "llego", nombre: "Llegaron" },
  { id: "cancelada", nombre: "Canceladas" }, { id: "", nombre: "Todas" },
];

// Una sola ventana para las dos acciones: cancelar (pide motivo) y marcar que llegó (pide confirmar).
function Accion({ accion, onCerrar, onHecho }) {
  const { factura, tipo } = accion;
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const cancelar = tipo === "cancelar";
  const enviar = async (e) => {
    e.preventDefault();
    if (cancelar && !motivoValido(motivo)) return setError("Escribe el motivo (entre 3 y 200 caracteres).");
    setEnviando(true);
    setError("");
    try {
      const ruta = `/facturas-por-llegar/${factura.id}/${cancelar ? "cancelar" : "llego"}`;
      const r = await apiFetch(ruta, { method: "POST", body: JSON.stringify(cancelar ? { motivo: motivo.trim() } : {}) });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) setError(cuerpo.error || "No se pudo completar la operación.");
      else onHecho();
    } catch (err) {
      setError(err.message || "No se pudo completar la operación.");
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className={FONDO} role="dialog" aria-modal="true">
      <form className={MODAL} onSubmit={enviar}>
        <h2 className="mb-2 text-base font-semibold text-slate-900">{cancelar ? "Cancelar factura" : "Marcar que llegó"}</h2>
        <p className="mb-3 text-sm text-slate-700">
          {factura.nombre_emisor || factura.rfc_emisor} — {textoTotal(factura)}
        </p>
        {cancelar ? (
          <label className={ETIQUETA}>Motivo de la cancelación
            <textarea className={CAMPO} rows={3} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
        ) : (
          <p className="text-sm text-slate-700">
            Confirma que la mercancía de esta factura ya llegó. Después ya no se puede cambiar.
          </p>
        )}
        {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onCerrar}>Volver</button>
          <button type="submit" className={cancelar ? BTN_PELIGRO : BTN_PRIMARIO} disabled={enviando}>
            {enviando ? "Guardando…" : cancelar ? "Cancelar factura" : "Sí, ya llegó"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SubirXml({ onSubido }) {
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState(null);
  const entrada = useRef(null);
  const subir = async (e) => {
    e.preventDefault();
    const archivos = Array.from(entrada.current?.files || []);
    if (archivos.length === 0) return setResultado({ ok: 0, errores: ["Elige al menos un archivo XML."] });
    setSubiendo(true);
    const resultados = [];
    for (const archivo of archivos) {
      const problema = archivoXmlValido(archivo);
      if (problema) { resultados.push({ nombre: archivo.name, ok: false, error: problema }); continue; }
      try {
        const xml = await archivo.text();
        const r = await apiFetch("/facturas-por-llegar", { method: "POST", body: JSON.stringify({ xml }) });
        const cuerpo = await r.json().catch(() => ({}));
        resultados.push(r.ok ? { nombre: archivo.name, ok: true } : { nombre: archivo.name, ok: false, error: cuerpo.error || "No se pudo registrar." });
      } catch (err) {
        resultados.push({ nombre: archivo.name, ok: false, error: err.message || "No se pudo registrar." });
      }
    }
    setResultado(mensajeResultado(resultados));
    if (entrada.current) entrada.current.value = "";
    setSubiendo(false);
    onSubido();
  };
  return (
    <form onSubmit={subir} className={`${CAJA} mb-4 p-3`}>
      <label className={ETIQUETA}>Subir factura del proveedor (XML)
        <input ref={entrada} type="file" accept=".xml,text/xml,application/xml" multiple className={`${CAMPO} bg-white`} />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="submit" className={BTN_PRIMARIO} disabled={subiendo}>{subiendo ? "Subiendo…" : "Registrar factura"}</button>
        <p className={NOTA_GRIS}>El sistema no valida la factura ante el SAT: solo registra lo que trae el archivo.</p>
      </div>
      {resultado && resultado.ok > 0 && (
        <p role="status" className={NOTA_VERDE}>{resultado.ok === 1 ? "Se registró 1 factura." : `Se registraron ${resultado.ok} facturas.`}</p>
      )}
      {resultado && resultado.errores.map((m) => <p key={m} role="alert" className={NOTA_ROJA}>{m}</p>)}
    </form>
  );
}

function ElegirUnion({ accion, onCerrar, onHecho }) {
  const { factura, tipo, compra } = accion;
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const pendiente = useRef(false);
  const pideMotivo = tipo !== "confirmar";
  const titulo = tipo === "confirmar" ? "Es esta compra" : tipo === "ninguna" ? "Ninguna de estas" : "Desunir";
  const enviar = async (e) => {
    e.preventDefault();
    if (pendiente.current || (pideMotivo && !motivoConciliacionValido(motivo))) return;
    pendiente.current = true;
    setEnviando(true);
    setError("");
    try {
      const body = pideMotivo ? { motivo: motivo.trim() } : { sucursal_id: compra.sucursal_id, com_id: compra.com_id };
      const r = await apiFetch(`/facturas-por-llegar/${factura.id}/${tipo}`, { method: "POST", body: JSON.stringify(body) });
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(cuerpo.error || "No se pudo completar la operación.");
      onHecho();
    } catch (e) {
      setError(e.message || "No se pudo completar la operación.");
    } finally {
      pendiente.current = false;
      setEnviando(false);
    }
  };
  return (
    <div className={FONDO} role="dialog" aria-modal="true" aria-labelledby="titulo-union">
      <form className={MODAL} onSubmit={enviar}>
        <h2 id="titulo-union" className="mb-2 font-semibold">{titulo}</h2>
        <IdentidadFactura factura={factura} />
        {compra && <DetalleCompra compra={compra} />}
        {pideMotivo && (
          <label className={ETIQUETA}>Motivo
            <textarea className={CAMPO} rows={3} required value={motivo} onChange={e => setMotivo(e.target.value)} />
          </label>
        )}
        {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={BTN} disabled={enviando} onClick={onCerrar}>Volver</button>
          <button type="submit" className={BTN_PRIMARIO} disabled={enviando || (pideMotivo && !motivoConciliacionValido(motivo))}>
            {enviando ? "Guardando…" : titulo}
          </button>
        </div>
      </form>
    </div>
  );
}

function IdentidadFactura({ factura: f }) {
  return (
    <div className="mb-2 break-words text-sm">
      <p>{f.nombre_emisor || f.rfc_emisor || "Factura"} · {textoTotal(f)}</p>
      <p>Factura {f.serie || ""}{f.folio || "—"} · {fechaCorta(f.fecha_emision)}</p>
      <p className={NOTA_GRIS}>{f.uuid}</p>
    </div>
  );
}

function DetalleCompra({ compra: c }) {
  return (
    <div className="my-2 break-words text-sm">
      <p>Compra SICAR {c.folio || "—"} · {fechaCorta(c.fecha || c.fecha_compra)} · {textoTotal(c)}</p>
      <p>{c.proveedor}</p>
      <p>{c.comentario || "Sin comentario"}</p>
      <p className={NOTA_GRIS}>Sucursal {c.sucursal_id} · Compra {c.com_id}</p>
    </div>
  );
}

function ResumenConciliacion({ resumen, error, concilia, onAccion }) {
  if (error) return <p role="alert" className={`${NOTA_ROJA} my-4`}>{error}</p>;
  if (!resumen) return null;
  return (
    <div className="my-4 space-y-4">
      <section className={`${CAJA} p-3`}>
        <h2 className="mb-2 font-semibold">Por confirmar</h2>
        {resumen.por_confirmar.length === 0 && <p className={NOTA_GRIS}>No hay facturas por confirmar.</p>}
        {resumen.por_confirmar.map(f => (
          <article key={f.id} className="mb-3 border-b border-slate-200 pb-3">
            <IdentidadFactura factura={f} />
            {f.candidatas.map(c => (
              <div key={`${c.sucursal_id}:${c.com_id}`} className="mb-2 rounded border border-slate-200 p-2">
                <DetalleCompra compra={c} />
                {concilia && (
                  <button type="button" className={BTN} onClick={() => onAccion({ factura: f, tipo: "confirmar", compra: c })}>
                    Es esta compra
                  </button>
                )}
              </div>
            ))}
            {concilia && (
              <button type="button" className={BTN} onClick={() => onAccion({ factura: f, tipo: "ninguna" })}>Ninguna de estas</button>
            )}
          </article>
        ))}
      </section>
      <section aria-label="Avisos de conciliación">
        {avisosRojos(resumen).map(({ tipo, fila, texto }) => (
          <article key={`${tipo}:${fila.id ?? `${fila.sucursal_id}:${fila.com_id}`}`} className={NOTA_ROJA}>
            <p className="font-semibold">{texto}</p>
            {tipo === "factura" ? <IdentidadFactura factura={fila} /> : (
              <>
                <DetalleCompra compra={tipo === "cancelada" ? fila.detalle.compra : fila} />
                {fila.factura_id && <p>Factura #{fila.factura_id}{fila.uuid ? ` · ${fila.uuid}` : ""}</p>}
              </>
            )}
          </article>
        ))}
        {avisosOmitidas(resumen).map(({ clave, texto }) => (
          <article key={`omitida:${clave}`} className={NOTA_ROJA}><p className="font-semibold">{texto}</p></article>
        ))}
      </section>
      <p className={NOTA_GRIS}>{textoViejas(resumen.compras_viejas_sin_factura)}</p>
      <section className={`${CAJA} p-3`}>
        <h2 className="font-semibold">Proveedores sin RFC en SICAR</h2>
        <p className="my-2 text-sm">Llénalo en SICAR de CEDIS; aquí se actualiza solo.</p>
        {resumen.proveedores_sin_rfc.length === 0 && <p className={NOTA_GRIS}>No hay proveedores sin RFC.</p>}
        <ul className="space-y-1 text-sm">
          {resumen.proveedores_sin_rfc.map(p => (
            <li key={`${p.sucursal_id}:${p.prv_id}`}>{p.nombre} · {p.compras} compras</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function FacturasPorLlegar({ permisos = [] }) {
  const [estado, setEstado] = useState("por_llegar");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [accion, setAccion] = useState(null);
  const [union, setUnion] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [errorResumen, setErrorResumen] = useState("");
  const peticiones = useRef(contadorDePeticiones());
  const registra = puedeRegistrar(permisos);
  const concilia = puedeConciliar(permisos);

  const cargar = useCallback(async () => {
    const numero = peticiones.current.nueva();
    setCargando(true);
    setError("");
    setErrorResumen("");
    try {
      const r = await cargarConciliacion(apiFetch, estado);
      if (!peticiones.current.vigente(numero)) return;
      setDatos(r.datos);
      setResumen(r.resumen);
      setError(r.error);
      setErrorResumen(r.errorResumen);
    } finally {
      if (peticiones.current.vigente(numero)) setCargando(false);
    }
  }, [estado]);

  useEffect(() => { cargar(); }, [cargar]);

  const facturas = datos?.facturas || [];
  const aviso = resumenFacturas(datos);
  const prohibidas = resumenProhibidas(datos);
  const hecho = () => { setAccion(null); setUnion(null); cargar(); };
  return (
    <div className={PAGINA}>
      <h1 className="mb-1 text-xl font-bold text-slate-900">Facturas por Llegar</h1>
      <p className="mb-3 text-sm text-slate-700">
        Facturas que el proveedor ya emitió y cuya mercancía todavía no llega. Se marcan solas cuando se recibe la compra.
      </p>
      {registra && <SubirXml onSubido={cargar} />}
      <button type="button" className={BTN} disabled={cargando} onClick={cargar}>Actualizar</button>
      <div className="mb-3 max-w-xs">
        <label className={ETIQUETA}>Mostrar
          <select className={CAMPO} value={estado} onChange={(e) => setEstado(e.target.value)}>
            {ESTADOS.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
      </div>
      {prohibidas && <p role="alert" className={`${NOTA_ROJA} mt-0 mb-3 font-semibold`}>{prohibidas}</p>}
      {aviso && <p role="status" className={NOTA_AMBAR}>{aviso}</p>}
      {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
      {cargando && <p className="mb-2 text-sm text-slate-500">Cargando…</p>}
      <ResumenConciliacion resumen={resumen} error={errorResumen} concilia={concilia && !cargando} onAccion={setUnion} />
      <div className={`${CAJA} overflow-x-auto`}>
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr>
              <th className={ENCABEZADO}>Proveedor</th>
              <th className={ENCABEZADO}>Folio fiscal</th>
              <th className={ENCABEZADO}>Emitida</th>
              <th className={`${ENCABEZADO} text-right`}>Total</th>
              <th className={ENCABEZADO}>Estado</th>
              <th className={ENCABEZADO}>Espera</th>
              {(registra || concilia) && <th className={ENCABEZADO}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {facturas.map((f) => (
              <tr key={f.id}>
                <td className={CELDA}>{f.nombre_emisor || "—"}<span className="block text-xs text-slate-500">{f.rfc_emisor}</span></td>
                <td className={`${CELDA} break-all text-xs`}>{f.uuid}<p>{f.serie || ""}{f.folio || ""}</p></td>
                <td className={CELDA}>{fechaCorta(f.fecha_emision)}</td>
                <td className={`${CELDA} ${DERECHA}`}>
                  {textoTotal(f)}
                  {f.moneda_prohibida && <span role="alert" className="mt-1 block text-left text-xs font-semibold text-red-800">{textoMonedaProhibida(f)}</span>}
                </td>
                <td className={CELDA}>
                  {f.compra ? (
                    <>
                      <p>{textoUnion(f.compra)}</p>
                      <p className={NOTA_GRIS}>{textoAutor(f.compra)}</p>
                      <p className={NOTA_GRIS}>{f.compra.comentario || "Sin comentario"}</p>
                    </>
                  ) : nombreEstado(f.estado)}
                  {f.estado === "cancelada" && f.motivo && <span className="block text-xs text-slate-500">{f.motivo}</span>}
                </td>
                <td className={`${CELDA} ${f.aviso ? "font-semibold text-amber-800" : ""}`}>
                  {textoEspera(f)}
                  {f.aviso && <span className="block text-xs">Más de {datos.dias_aviso} días: preguntar al proveedor</span>}
                </td>
                {(registra || concilia) && (
                  <td className={CELDA}>
                    {concilia && f.compra && (
                      <button type="button" className={BTN} disabled={cargando} onClick={() => setUnion({ factura: f, tipo: "desunir" })}>Desunir</button>
                    )}
                    {registra && f.estado === "por_llegar" && (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={BTN} onClick={() => setAccion({ factura: f, tipo: "llego" })}>Ya llegó</button>
                        <button type="button" className={BTN} onClick={() => setAccion({ factura: f, tipo: "cancelar" })}>Cancelar</button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!cargando && !error && datos && facturas.length === 0 && <p className="mt-3 text-sm text-slate-700">No hay facturas con este filtro</p>}
      {accion && <Accion accion={accion} onCerrar={() => setAccion(null)} onHecho={hecho} />}
      {union && concilia && <ElegirUnion accion={union} onCerrar={() => setUnion(null)} onHecho={hecho} />}
    </div>
  );
}
