const BASE = "neu-boton flex flex-col items-center gap-1 rounded-xl px-4 py-2 text-sm min-w-[7.5rem]";
const ACTIVA = "bg-blue-50 border-2 border-blue-500 text-blue-800 font-semibold";
const INACTIVA = "border-2 border-transparent text-slate-600";

// Barra de botones grandes con el icono arriba, al estilo de SICAR. Solo decide
// qué sección se ve; cada sección conserva su propia lógica y sus peticiones.
export default function Pestanas({ pestanas, activa, elegir }) {
  return (
    <div role="toolbar" aria-label="Secciones de Mi Objetivo de Venta" className="flex flex-wrap gap-2">
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
