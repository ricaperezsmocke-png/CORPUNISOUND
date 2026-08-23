import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * Pide un dato al usuario, dentro de la aplicación, para reemplazar a
 * `prompt()` del navegador.
 *
 * Los `prompt()` son peores que los `confirm()`: además de congelar la pestaña
 * —lo que vuelve el paso imposible de probar— el usuario escribe en una cajita
 * gris del sistema operativo, sin validación, sin poder ver la pantalla que hay
 * detrás, y sin forma de explicarle qué se espera. En `RecepcionCompras` eran
 * DOS seguidos para dar de alta un proveedor: nombre y luego RFC.
 *
 * Reglas, y todas tienen su motivo:
 *
 * - **Escape CANCELA.** Igual que en ModalConfirmar: la tecla de "sácame de
 *   aquí" nunca ejecuta la acción.
 * - **Enter acepta** solo si lo escrito es válido. Es lo que la gente espera de
 *   un campo de texto y hace la captura rápida en el mostrador.
 * - **El botón de aceptar se queda apagado mientras el valor no sirve**, para
 *   que el error se vea ANTES de intentar guardar, no después.
 * - `validar` recibe el texto y devuelve un mensaje de error, o nada si está
 *   bien. Así cada pantalla pone su propia regla (que sea número, que no esté
 *   vacío, lo que necesite) sin que este componente sepa de negocio.
 */
export default function ModalPedirTexto({
  titulo,
  etiqueta,
  ayuda,
  valorInicial = "",
  marcador = "",
  tipo = "text",
  textoConfirmar = "Guardar",
  validar,
  onAceptar,
  onCancelar,
}) {
  const [valor, setValor] = useState(valorInicial);
  const refCampo = useRef(null);

  const error = validar ? validar(valor) : null;
  const puedeAceptar = !error && String(valor).trim() !== "";

  useEffect(() => {
    if (refCampo.current) {
      refCampo.current.focus();
      refCampo.current.select();
    }
    const alTeclear = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onCancelar(); }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCancelar]);

  const aceptar = () => { if (puedeAceptar) onAceptar(String(valor).trim()); };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancelar(); }}
    >
      <div role="dialog" aria-modal="true" aria-label={titulo}
        className="bg-white rounded-xl shadow-2xl w-full max-w-md animate-panel-in">
        <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-slate-700">{titulo}</h3>
          <button onClick={onCancelar} aria-label="Cerrar"
            className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4">
          {etiqueta && <label className="text-xs text-slate-500 block mb-1">{etiqueta}</label>}
          <input
            ref={refCampo}
            type={tipo}
            value={valor}
            placeholder={marcador}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aceptar(); } }}
            className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          />
          {ayuda && !error && <p className="text-[11px] text-slate-400 mt-1">{ayuda}</p>}
          {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
        </div>

        <div className="px-4 pb-4 flex gap-2 justify-end">
          <button onClick={onCancelar}
            className="px-3 py-1.5 rounded text-sm border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors">
            Cancelar
          </button>
          <button onClick={aceptar} disabled={!puedeAceptar}
            className="px-3 py-1.5 rounded text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
