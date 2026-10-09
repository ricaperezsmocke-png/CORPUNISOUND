import { ChevronLeft, ChevronRight } from "lucide-react";
import { TEXTO_PERIODO, etiquetaPeriodo, inicioDePeriodo, inicioAlCambiarPeriodo, moverPeriodo } from "./metas";

const SEGMENTO = "px-3 py-1.5 text-sm rounded-lg border";
const SEGMENTO_ACTIVO = `${SEGMENTO} bg-blue-600 border-blue-600 text-white`;
const SEGMENTO_INACTIVO = `${SEGMENTO} border-slate-300 text-slate-700 bg-white`;
const FLECHA = "p-1.5 rounded-lg border border-slate-300 bg-white text-slate-700";

export default function SelectorPeriodo({ periodo, inicio, hoy, setPeriodo, setInicio }) {
  const cambiarTipo = (nuevo) => {
    setInicio(inicioAlCambiarPeriodo(periodo, inicio, nuevo, hoy));
    setPeriodo(nuevo);
  };

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <div className="flex gap-1" role="group" aria-label="Tipo de periodo">
        {Object.entries(TEXTO_PERIODO).map(([clave, texto]) => (
          <button key={clave} type="button" aria-pressed={periodo === clave} onClick={() => cambiarTipo(clave)}
            className={periodo === clave ? SEGMENTO_ACTIVO : SEGMENTO_INACTIVO}>{texto}</button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Periodo anterior" className={FLECHA} onClick={() => setInicio(moverPeriodo(periodo, inicio, -1))}>
          <ChevronLeft size={18} />
        </button>
        <strong className="text-slate-800 min-w-[16rem] text-center">{etiquetaPeriodo(periodo, inicio)}</strong>
        <button type="button" aria-label="Periodo siguiente" className={FLECHA} onClick={() => setInicio(moverPeriodo(periodo, inicio, 1))}>
          <ChevronRight size={18} />
        </button>
        <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => setInicio(inicioDePeriodo(periodo, hoy))}>
          Hoy
        </button>
      </div>
    </div>
  );
}
