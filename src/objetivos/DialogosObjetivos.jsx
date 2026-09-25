import { pesos } from "./datos";

import { useEffect, useId, useRef } from "react";

export function Campo({ etiqueta, tipo = "text", valor, cambiar, area, min, max }) {
  const props = {
    value: valor,
    onChange: (e) => cambiar(e.target.value),
    className: "neu-campo rounded-lg px-3 py-2 w-full mt-1",
  };
  return (
    <label className="text-sm block">
      {etiqueta}
      {area ? <textarea {...props} /> : (
        <input type={tipo} min={min ?? (tipo === "number" ? "0" : undefined)} max={max} {...props} />
      )}
    </label>
  );
}

export function Modal({ titulo, cerrar, guardar, deshabilitado, children, textoGuardar = "Guardar", textoCerrar = "Cancelar", error, focoEnCerrar = false }) {
  const tituloId = useId();
  const ventana = useRef(null);
  const principal = useRef(null);
  const secundario = useRef(null);
  useEffect(() => {
    const anterior = document.activeElement;
    const selector = "input:not([disabled]):not([readonly]):not([type=hidden]), textarea:not([disabled]):not([readonly]), select:not([disabled])";
    // En una confirmación irreversible el foco va a "Volver": un Enter de más no debe ejecutarla.
    (focoEnCerrar ? secundario.current : ventana.current?.querySelector(selector) || principal.current)?.focus();
    return () => anterior?.focus();
  }, []);
  useEffect(() => {
    const alPulsar = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); cerrar(); }
    };
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [cerrar]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div ref={ventana} role="dialog" aria-modal="true" aria-labelledby={tituloId}
        className="bg-white rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-3">
        <h3 id={tituloId} className="font-semibold">{titulo}</h3>
        {children}
        {error && <p role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button ref={secundario} type="button" onClick={cerrar}>{textoCerrar}</button>
          <button ref={principal} type="button" disabled={deshabilitado} onClick={guardar}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 disabled:opacity-40">
            {textoGuardar}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HistorialMetas({ historial, nombre, cerrar }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-lg max-h-[80vh] overflow-auto">
        <h3 className="font-semibold mb-3">
          Historial: {historial.vendedor_id == null ? "Tienda" : nombre(historial.vendedor_id)}
        </h3>
        {historial.datos.length ? (
          <ul className="space-y-2 text-sm">
            {historial.datos.map((h) => (
              <li key={h.id} className="border rounded-lg p-3">
                <strong>Versión {h.version}: {pesos(h.monto)}</strong>
                <p className="text-slate-500">{h.creado_por} · {new Date(h.creado_en).toLocaleString("es-MX")}</p>
                {h.motivo && <p>Motivo: {h.motivo}</p>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">Todavía no hay versiones.</p>}
        <button onClick={cerrar} className="mt-4 border rounded-lg px-4 py-2">Cerrar</button>
      </div>
    </div>
  );
}
