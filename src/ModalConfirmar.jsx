import React, { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";

/**
 * Confirmación dentro de la aplicación, para reemplazar a `confirm()` del
 * navegador.
 *
 * Los diálogos nativos tienen dos problemas que no se ven hasta que estorban:
 * se salen del diseño del sistema, y CONGELAN la pestaña entera hasta que
 * alguien responde. Eso último los vuelve un punto ciego: ninguna prueba
 * automática puede pasar por un paso que abre un `confirm()`. Se descubrió
 * probando Garantías en el navegador el 2026-08-23 — "Recibir en tienda" y
 * "Entregar al cliente" eran pasos que nadie podía verificar.
 *
 * Reglas de esta caja, y todas tienen su motivo:
 *
 * - **Escape CANCELA, nunca confirma.** La tecla universal de "sácame de aquí"
 *   no puede ejecutar la acción. En Recepción de Compras, ESC llegó a REGISTRAR
 *   la compra; ese error no se repite aquí.
 * - **Clic fuera cancela**, por lo mismo.
 * - En una acción peligrosa el foco arranca en **Cancelar**, para que un Enter
 *   de más no destruya nada. En una acción normal arranca en Confirmar.
 * - El botón de confirmar dice lo que va a hacer ("Sí, recibir"), no "Aceptar":
 *   quien lo lee con prisa tiene que entender qué está aprobando.
 */
export default function ModalConfirmar({
  titulo,
  mensaje,
  textoConfirmar = "Confirmar",
  textoCancelar = "Cancelar",
  peligro = false,
  onConfirmar,
  onCancelar,
}) {
  const refConfirmar = useRef(null);
  const refCancelar = useRef(null);

  useEffect(() => {
    // El foco arranca en Cancelar cuando la acción es destructiva: si alguien
    // venía tecleando y suelta un Enter, no se lleva nada por delante.
    const destino = peligro ? refCancelar.current : refConfirmar.current;
    if (destino) destino.focus();

    const alTeclear = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelar();
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [peligro, onCancelar]);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-overlay-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancelar(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={titulo}
        className="neu-panel rounded-2xl shadow-2xl w-full max-w-md animate-panel-in"
      >
        <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-slate-700 flex items-center gap-2">
            {peligro && <AlertTriangle size={16} className="text-red-500 shrink-0" />}
            {titulo}
          </h3>
          <button
            onClick={onCancelar}
            aria-label="Cerrar"
            className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 text-sm text-slate-600 whitespace-pre-line">{mensaje}</div>

        <div className="px-4 pb-4 flex gap-2 justify-end">
          <button
            ref={refCancelar}
            onClick={onCancelar}
            className="px-3 py-1.5 rounded text-sm border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            {textoCancelar}
          </button>
          <button
            ref={refConfirmar}
            onClick={onConfirmar}
            className={`px-3 py-1.5 rounded text-sm text-white transition-colors ${
              peligro ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
