import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

export function franjaCerrada(storage, clave) {
  try {
    return storage.getItem(`ayuda_objetivos_${clave}`) === "cerrada";
  } catch {
    return false;
  }
}

export function cerrarFranja(storage, clave) {
  try {
    storage.setItem(`ayuda_objetivos_${clave}`, "cerrada");
    return true;
  } catch {
    return false;
  }
}

export function abrirFranja(storage, clave) {
  try {
    storage.removeItem(`ayuda_objetivos_${clave}`);
  } catch {
    // La ayuda permanece visible aunque el navegador bloquee el almacenamiento.
  }
  return false;
}

function conStorage(operacion, clave) {
  try {
    return operacion(window.localStorage, clave);
  } catch {
    return false;
  }
}

export function FranjaAyuda({ clave, titulo = "¿Qué hago aquí?", children }) {
  const [cerrada, setCerrada] = useState(() => conStorage(franjaCerrada, clave));
  if (cerrada) {
    return (
      <button type="button" className="text-sm text-blue-700 underline"
        onClick={() => setCerrada(conStorage(abrirFranja, clave))}>
        ¿Qué hago aquí?
      </button>
    );
  }
  return (
    <aside className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-950">
      <div className="flex items-start gap-2">
        <Info size={18} aria-hidden="true" className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-2">
          <h2 className="font-semibold">{titulo}</h2>
          {children}
        </div>
        <button type="button" aria-label="Cerrar instrucciones" className="shrink-0 rounded px-2 py-1 hover:bg-blue-100"
          onClick={() => setCerrada(conStorage(cerrarFranja, clave))}>✕</button>
      </div>
    </aside>
  );
}

const boton = "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-300 " +
  "bg-white text-sm font-semibold text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";
const burbuja = "fixed z-[100] rounded-lg bg-slate-900 p-3 text-left text-sm font-normal leading-relaxed text-white shadow-lg";

export function AyudaBoton({ texto }) {
  const id = useId();
  const referencia = useRef(null);
  const [posicion, setPosicion] = useState(null);
  const visible = posicion !== null;

  useEffect(() => {
    if (!visible) return;
    const escapar = (evento) => {
      if (evento.key === "Escape") {
        evento.stopPropagation();
        setPosicion(null);
      }
    };
    document.addEventListener("keydown", escapar, true);
    return () => document.removeEventListener("keydown", escapar, true);
  }, [visible]);

  const mostrar = () => {
    const rect = referencia.current.getBoundingClientRect();
    const ancho = Math.min(288, window.innerWidth - 16);
    setPosicion({
      width: ancho,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - ancho - 8)),
      ...(rect.bottom + 150 < window.innerHeight ? { top: rect.bottom } : { bottom: window.innerHeight - rect.top }),
    });
  };

  return (
    <span className="inline-flex align-middle ml-1" onMouseEnter={mostrar} onMouseLeave={() => setPosicion(null)}>
      <button ref={referencia} type="button" aria-label="Ayuda" aria-describedby={visible ? id : undefined}
        className={boton} onFocus={mostrar} onBlur={() => setPosicion(null)}>?</button>
      {visible && createPortal(<span id={id} role="tooltip" className={burbuja} style={posicion}>{texto}</span>, document.body)}
    </span>
  );
}
