import { leer, pesos } from "./datos";
import { apiFetch } from "../api";

import { useEffect, useId, useRef, useState } from "react";

export function EliminarMeta({ llave, titulo, alTerminar, cerrar }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const eliminar = async () => {
    if (enCurso.current || !motivo.trim()) return;
    enCurso.current = true;
    setEnviando(true);
    setError("");
    try {
      await apiFetch("/objetivos/retirar", {
        method: "POST", body: JSON.stringify({ ...llave, motivo: motivo.trim() }),
      }).then((r) => leer(r, "No se pudo eliminar la meta"));
      await alTerminar();
    } catch (e) { setError(e.message); }
    finally { enCurso.current = false; setEnviando(false); }
  };
  return (
    <Modal titulo={`Eliminar meta: ${titulo}`} cerrar={cerrar} guardar={eliminar} textoGuardar="Eliminar"
      deshabilitado={enviando || !motivo.trim()} error={error} focoEnCerrar>
      <p className="text-sm text-slate-600 mb-2">La meta deja de contar en el avance y en el cierre. Queda en el
        historial con tu nombre y el motivo. Lo que ya se capturó no se borra.</p>
      <Campo etiqueta="Motivo" valor={motivo} cambiar={setMotivo} area />
    </Modal>
  );
}

export function BotonEliminarMeta({ llave, titulo, cerrado, revision, abrir }) {
  const [estado, setEstado] = useState(null);
  const { mes, sucursal_id, vendedor_id, ...referencia } = llave;
  const consulta = `/objetivos/${mes}/${sucursal_id}/historial/${vendedor_id ?? "tienda"}?${new URLSearchParams(referencia)}`;
  useEffect(() => {
    if (cerrado) return;
    let activo = true;
    // El reparto devuelve 0 también cuando no existe meta: solo el historial distingue su vigencia.
    apiFetch(consulta).then((r) => leer(r, "No se pudo comprobar si la meta está vigente"))
      .then((versiones) => {
        if (activo) setEstado({ consulta, revision, vigente: versiones.some((v) => v.vigente), error: "" });
      })
      .catch((e) => { if (activo) setEstado({ consulta, revision, vigente: false, error: e.message }); });
    return () => { activo = false; };
  }, [consulta, revision, cerrado]);
  if (cerrado || estado?.consulta !== consulta || estado?.revision !== revision) return null;
  if (estado.error) return <span role="alert" className="text-sm text-red-700">{estado.error}</span>;
  if (!estado.vigente) return null;
  return (
    <button type="button" className="text-red-700 hover:underline" onClick={() => abrir({ llave, titulo })}>Eliminar</button>
  );
}

export function RetiradaMeta({ retirada }) {
  return retirada ? (
    <p className="text-red-700">
      Eliminada por {retirada.por_nombre}
      {" · "}{new Date(retirada.en).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })} · Motivo: {retirada.motivo}
    </p>
  ) : null;
}

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

export function HistorialMetas({ historial, nombre, cerrar, formato = pesos }) {
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
                <strong>Versión {h.version}: {formato(h.monto)}</strong>
                <p className="text-slate-500">{h.creado_por} · {new Date(h.creado_en).toLocaleString("es-MX")}</p>
                {h.motivo && <p>Motivo: {h.motivo}</p>}
                <RetiradaMeta retirada={h.retirada} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">Todavía no hay versiones.</p>}
        <button type="button" onClick={cerrar} className="mt-4 border rounded-lg px-4 py-2">Cerrar</button>
      </div>
    </div>
  );
}
