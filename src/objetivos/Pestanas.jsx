const BASE = "neu-boton flex flex-col items-center gap-1 rounded-xl px-4 py-2 text-sm min-w-[7.5rem] max-w-full whitespace-normal break-words";
const ACTIVA = "bg-blue-50 border-2 border-blue-500 text-blue-800 font-semibold";
const INACTIVA = "border-2 border-transparent text-slate-600";
const GRUPO = "rounded-lg px-4 py-2 text-sm max-w-full whitespace-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";

export function GruposPestanas({ grupos, activo, elegir }) {
  if (grupos.length < 2) return null;
  return (
    <div role="toolbar" aria-label="Grupos de Objetivos" className="flex flex-wrap gap-1 w-fit max-w-full rounded-xl bg-slate-100 p-1">
      {grupos.map(({ clave, etiqueta }) => (
        <button key={clave} type="button" aria-pressed={clave === activo} onClick={() => elegir(clave)}
          className={`${GRUPO} ${clave === activo ? ACTIVA : INACTIVA}`}>
          {etiqueta}
        </button>
      ))}
    </div>
  );
}

// Barra de botones grandes con el icono arriba, al estilo de SICAR. Solo decide
// qué sección se ve; cada sección conserva su propia lógica y sus peticiones.
export default function Pestanas({ pestanas, activa, elegir }) {
  return (
    <div role="toolbar" aria-label="Secciones de Objetivos" className="flex flex-wrap gap-2">
      {pestanas.map(({ clave, etiqueta, Icono }) => (
        <button key={clave} type="button" aria-pressed={clave === activa} onClick={() => elegir(clave)}
          className={`${BASE} ${clave === activa ? ACTIVA : INACTIVA}`}>
          <Icono size={22} aria-hidden="true" />
          {etiqueta}
        </button>
      ))}
    </div>
  );
}
