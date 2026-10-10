import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { ALERTA, Anulada, Barra, DialogoMotivo, ENLACE_ROJO, EXITO, Prueba, Semaforo, TARJETA, fechaCorta } from "./Comunes";

const SELECT = "block neu-campo rounded-lg px-3 py-2 mt-1";
const RENGLON = "w-full text-left grid grid-cols-[minmax(10rem,16rem)_1fr_4rem_9rem] gap-3 items-center py-1.5 text-sm";

// Tablero: un cuadro por OKR con sus metas. La jefatura abre una meta para ver quién capturó qué y anular ahí mismo.
export default function TableroMetas({ periodo, inicio, permisos, sucursales, vendedores }) {
  const puedeAnular = permisos.includes("anular_capturas_metas");
  const esAdmin = permisos.includes("administrar_metas_personalizadas");
  const [filtros, setFiltros] = useState({ sucursal_id: "", vendedor_id: "" });
  const [tablero, setTablero] = useState(null);
  const [capturas, setCapturas] = useState([]);
  const [abierta, setAbierta] = useState(null);
  const [anulando, setAnulando] = useState(null);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    const extra = Object.entries(filtros).filter(([, v]) => v).map(([k, v]) => `&${k}=${v}`).join("");
    try {
      const base = `periodo=${periodo}&inicio=${inicio}`;
      setTablero(await apiFetch(`/metas/tablero?${base}${extra}`).then((r) => leer(r, "No se pudo cargar el tablero")));
      if (puedeAnular) setCapturas(await apiFetch(`/metas/revision?${base}`).then((r) => leer(r, "No se pudieron cargar las capturas")));
    } catch (e) { setError(e.message); }
  }, [periodo, inicio, filtros, puedeAnular]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!tablero) return error ? <div role="alert" className={ALERTA}>{error}</div> : <p className="text-sm text-slate-500">Cargando…</p>;
  const grupos = [
    ...tablero.okrs.map((o) => ({ clave: `okr-${o.clave}`, titulo: o.titulo, descripcion: o.descripcion, porcentaje: o.porcentaje, metas: o.metas })),
    ...(tablero.sueltas.length ? [{ clave: "sueltas", titulo: "Otras metas", porcentaje: null, metas: tablero.sueltas }] : []),
  ];
  const conFiltros = vendedores.length > 0;

  return (
    <div className="space-y-4">
      {conFiltros && (
        <div className="flex flex-wrap gap-3">
          <label className="text-sm text-slate-600">
            Tienda
            <select value={filtros.sucursal_id} className={SELECT} onChange={(e) => setFiltros((f) => ({ ...f, sucursal_id: e.target.value }))}>
              <option value="">Todas</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-600">
            Persona
            <select value={filtros.vendedor_id} className={SELECT} onChange={(e) => setFiltros((f) => ({ ...f, vendedor_id: e.target.value }))}>
              <option value="">Todas</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </label>
        </div>
      )}
      {error && <div role="alert" className={ALERTA}>{error}</div>}
      {exito && <div className={EXITO}>{exito}</div>}
      {tablero.sellado && <p className="bg-slate-100 rounded-lg p-3 text-sm text-slate-700">🔒 Periodo sellado. Ya no se puede capturar ni quitar nada.</p>}
      {!grupos.length && (
        <p className="text-sm text-slate-500">
          No hay metas en este periodo.{esAdmin && " Créalas en Administración → Administrar metas extra."}
        </p>
      )}
      {grupos.map((grupo) => (
        <section key={grupo.clave} className={TARJETA}>
          <header className="flex gap-4 items-start">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-slate-800">{grupo.titulo}</h3>
              {grupo.descripcion && <p className="text-sm text-slate-500">{grupo.descripcion}</p>}
            </div>
            {grupo.clave !== "sueltas" && (
              <strong className="text-2xl text-slate-800">{grupo.porcentaje == null ? "—" : `${grupo.porcentaje}%`}</strong>
            )}
          </header>
          {grupo.clave !== "sueltas" && grupo.porcentaje != null && <Barra porcentaje={grupo.porcentaje} />}
          <div className="divide-y divide-slate-100">
            {grupo.metas.map((meta) => (
              <div key={meta.clave}>
                <button type="button" className={RENGLON} aria-expanded={abierta === meta.clave} disabled={!meta.por_persona}
                  onClick={() => setAbierta(abierta === meta.clave ? null : meta.clave)}>
                  <span className="truncate text-slate-700" title={meta.nombre}>{meta.nombre}</span>
                  <Barra porcentaje={meta.porcentaje} />
                  <strong className="text-right">{meta.porcentaje}%</strong>
                  <span className="text-slate-500">{meta.resultado} de {meta.valor_meta} {meta.unidad}</span>
                </button>
                <div className="pb-2"><Semaforo semaforo={meta.semaforo} /></div>
                {abierta === meta.clave && meta.por_persona && (
                  <Detalle meta={meta} capturas={capturas.filter((c) => c.meta_clave === meta.clave)}
                    puedeAnular={puedeAnular && !tablero.sellado} anular={setAnulando} />
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      {anulando && (
        <DialogoMotivo titulo={`Anular captura de ${anulando.vendedor_nombre}`} textoGuardar="Anular" ruta={`/metas/captura/${anulando.id}/anular`}
          explicacion="Deja de contar. Queda registrado con tu nombre y el motivo." cerrar={() => setAnulando(null)}
          alTerminar={async () => { setAnulando(null); setExito("Se anuló la captura."); await cargar(); }} />
      )}
    </div>
  );
}

function Detalle({ meta, capturas, puedeAnular, anular }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 mb-2 space-y-3 text-sm">
      <div>
        <h4 className="font-medium text-slate-700 mb-1">Por persona</h4>
        {meta.por_persona.length ? (
          <ul>{meta.por_persona.map((p) => <li key={p.vendedor_id}>{p.nombre}: <strong>{p.resultado}</strong> {meta.unidad}</li>)}</ul>
        ) : <p className="text-slate-500">Nadie ha capturado todavía.</p>}
      </div>
      {capturas.length > 0 && (
        <div>
          <h4 className="font-medium text-slate-700 mb-1">Lo que capturaron</h4>
          <ul className="space-y-1">
            {capturas.map((c) => (
              <li key={c.id}>
                <div className={`flex flex-wrap gap-3 items-center ${c.anulada ? "line-through text-slate-400" : ""}`}>
                  <span>{fechaCorta(c.fecha)}</span>
                  <span>{c.vendedor_nombre}</span>
                  <Prueba captura={c} />
                  {c.nota && <span className="text-slate-500">{c.nota}</span>}
                  {puedeAnular && !c.anulada && (
                    <button type="button" className={ENLACE_ROJO} onClick={() => anular(c)}>Anular</button>
                  )}
                </div>
                <Anulada anulada={c.anulada} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
