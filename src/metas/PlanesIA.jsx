import { useState } from "react";
import { ENLACE, fechaHora } from "./Comunes";
import { etiquetaPeriodo } from "./metas";

const ESTADO = { pendiente: "En proceso", borrador: "Borrador", validado: "Validado", descartado: "Descartado", fallido: "Falló" };
const texto = (d) => (d.decision === "aceptar" ? "Aceptada" : "Rechazada")
  + (Object.keys(d.cambios || {}).length ? ` · cambios: ${Object.entries(d.cambios).map(([c, [a, b]]) => `${c} ${a} → ${b}`).join(", ")}` : "");

// Registro de planes con IA: lo propuesto contra lo aprobado, con quién y cuándo.
export default function PlanesIA({ planes, sucursales, cerrar }) {
  const [abierto, setAbierto] = useState(null);
  const tienda = (id) => (id === null ? "Toda la empresa" : sucursales.find((s) => s.id === id)?.nombre || "Tienda");
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Planes con IA" className="bg-white rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-3">
        <h3 className="font-semibold">Planes con IA</h3>
        {!planes.length && <p className="text-sm text-slate-500">Todavía no hay planes.</p>}
        <ul className="space-y-2 text-sm">
          {planes.map((p) => (
            <li key={p.id} className="border rounded-lg p-3">
              <button type="button" className={`${ENLACE} text-left`} aria-expanded={abierto === p.id} onClick={() => setAbierto(abierto === p.id ? null : p.id)}>
                {fechaHora(p.creado_en)} · {p.creado_por_nombre} · {tienda(p.entrada?.sucursal_id ?? null)}
                {p.entrada ? ` · ${etiquetaPeriodo(p.entrada.periodo, p.entrada.inicio)}` : ""} · {ESTADO[p.estado]}
              </button>
              {abierto === p.id && (
                <div className="mt-2 space-y-1">
                  <p className="text-slate-600">Objetivo: {p.entrada?.objetivo_texto}</p>
                  {p.error && <p className="text-red-700">Motivo: {p.error}</p>}
                  {p.validado_por_nombre && <p>Validado por {p.validado_por_nombre} · {fechaHora(p.validado_en)}</p>}
                  {p.descartado_por_nombre && <p>Descartado por {p.descartado_por_nombre} · {fechaHora(p.descartado_en)}</p>}
                  {p.propuesta && (
                    <ul className="list-disc pl-5">
                      <li>OKR: {p.propuesta.okr.titulo}{p.decisiones[0] ? ` — ${texto(p.decisiones[0])}` : ""}</li>
                      {p.propuesta.metas.map((m) => {
                        const d = p.decisiones.find((x) => x.punto === m.indice);
                        return <li key={m.indice}>{m.nombre}: {m.valor_meta} {m.unidad}{d ? ` — ${texto(d)}` : ""}</li>;
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="flex justify-end"><button type="button" className="border border-slate-300 rounded-lg px-4 py-2 text-sm" onClick={cerrar}>Cerrar</button></div>
      </div>
    </div>
  );
}
