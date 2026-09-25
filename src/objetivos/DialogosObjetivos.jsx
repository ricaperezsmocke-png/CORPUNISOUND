import { pesos } from "./datos";

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

export function Modal({ titulo, cerrar, guardar, deshabilitado, children, textoGuardar = "Guardar", textoCerrar = "Cancelar" }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3">
        <h3 className="font-semibold">{titulo}</h3>
        {children}
        <div className="flex justify-end gap-2">
          <button onClick={cerrar}>{textoCerrar}</button>
          <button disabled={deshabilitado} onClick={guardar}
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
