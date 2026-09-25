import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { diasRestantes, estadoMeta, faltantePorDia, serieConRitmo } from "./avance";
import { formatoUnidad, pesosConCentavos } from "./marcas";

const AZUL = "#2563eb";
const VERDE = "#059669";
const GRIS = "#e2e8f0";
const textoPorcentaje = (p) => (p === null || p === undefined ? "—" : `${p} %`);

// Anillo con el porcentaje al centro. Más de 100 %: anillo lleno y el número real.
export function Anillo({ porcentaje, estado, detalle, titulo }) {
  const lleno = estado === "sin-meta" ? 0 : Math.min(100, Math.max(0, porcentaje || 0));
  const color = estado === "lograda" ? VERDE : AZUL;
  return (
    <div className="flex flex-col items-center">
      <h3 className="font-medium text-slate-700 mb-1">{titulo}</h3>
      <div className="relative" style={{ width: 200, height: 200 }}>
        <PieChart width={200} height={200}>
          <Pie data={[{ v: lleno }, { v: 100 - lleno }]} dataKey="v" innerRadius={70} outerRadius={95}
            startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
            <Cell fill={color} />
            <Cell fill={GRIS} />
          </Pie>
        </PieChart>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {estado === "sin-meta" ? (
            <span className="text-sm text-slate-500 px-6">Sin meta asignada este mes</span>
          ) : (
            <span className="text-4xl font-bold" style={{ color }}>{textoPorcentaje(porcentaje)}</span>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-600 mt-1">{detalle}</p>
    </div>
  );
}

// Venta acumulada del mes contra la recta del ritmo para llegar a la meta el último día.
export function LineaMes({ serie, meta, capturado, mes, hoy, porcentaje, quien = "Te" }) {
  const puntos = serieConRitmo(serie, meta, mes, hoy);
  const dias = diasRestantes(mes, hoy);
  const estado = estadoMeta(meta, capturado);
  const falta = faltantePorDia(meta, capturado, dias);
  let texto = "";
  if (estado === "sin-meta") texto = "Sin meta asignada: no hay ritmo que seguir.";
  else if (estado === "lograda") texto = "¡Meta alcanzada!";
  else if (dias === 0) texto = `Terminó el mes con ${textoPorcentaje(porcentaje)}.`;
  else if (falta) {
    texto = `${quien} faltan ${pesosConCentavos(falta.faltante)}; son ${pesosConCentavos(falta.porDia)} por día ` +
      `en ${dias === 1 ? "el día que queda" : `los ${dias} días que quedan`}.`;
  }
  return (
    <div>
      <h3 className="font-medium text-slate-700 mb-2">Venta del mes, día por día</h3>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={puntos} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${Number(v).toLocaleString("es-MX")}`} width={80} />
            <Tooltip formatter={(v) => (v === null ? "—" : pesosConCentavos(v))} labelFormatter={(d) => `Día ${d}`} />
            <Legend />
            <Line type="monotone" dataKey="acumulado" name="Llevas" stroke={AZUL} strokeWidth={3} dot={false}
              connectNulls={false} isAnimationActive={false} />
            <Line type="linear" dataKey="ritmo" name="Ritmo para llegar" stroke="#94a3b8" strokeDasharray="6 4"
              dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {texto && <p className="text-sm text-slate-700 mt-2">{texto}</p>}
    </div>
  );
}

function Barra({ porcentaje, color }) {
  const ancho = Math.min(100, Math.max(0, porcentaje || 0));
  return (
    <div className="h-3 bg-slate-200 rounded-full overflow-hidden flex-1">
      <div className="h-full rounded-full" style={{ width: `${ancho}%`, background: color }} />
    </div>
  );
}

// Una fila por meta: barra propia con su cifra y, si se da, la barra gris con el % de la tienda.
export function BarraMeta({ titulo, porcentaje, detalle, tienda }) {
  return (
    <div className="grid grid-cols-[12rem_1fr_4rem_12rem] items-center gap-3 text-sm py-1">
      <span className="text-slate-700 truncate" title={titulo}>{titulo}</span>
      <Barra porcentaje={porcentaje} color={porcentaje >= 100 ? VERDE : AZUL} />
      <strong className="text-right">{textoPorcentaje(porcentaje)}</strong>
      <span className="text-slate-500">{detalle}</span>
      {tienda !== undefined && (
        <>
          <span className="text-slate-400 text-xs pl-3">Tienda</span>
          <Barra porcentaje={tienda} color="#94a3b8" />
          <span className="text-right text-slate-500 text-xs">{textoPorcentaje(tienda)}</span>
          <span />
        </>
      )}
    </div>
  );
}

const GRUPOS = [
  { grupo: "marcas", clave: "marca_id", titulo: "Marcas", unidad: "pesos", valor: "capturado" },
  { grupo: "productos", clave: "producto_meta_id", titulo: "Productos", unidad: "piezas", valor: "capturado" },
  { grupo: "creditos", clave: "financiera", titulo: "Créditos", unidad: "creditos", valor: "registrados" },
  { grupo: "actividades", clave: "actividad", titulo: "Actividades", unidad: "declaradas", valor: "declaradas" },
];

function detalleDe(unidad, valor, meta) {
  if (unidad === "declaradas") return `${valor} de ${meta} declaradas`;
  return `${formatoUnidad(unidad, valor)} de ${formatoUnidad(unidad, meta)}`;
}

// Barras de marcas, productos, créditos y actividades. `porcentajesTienda` (opcional) agrega la
// barra gris de la tienda por la misma referencia; nunca trae cifras.
export function BarrasMetas({ avance, porcentajesTienda }) {
  const grupos = GRUPOS.map((g) => ({
    ...g,
    filas: (avance[g.grupo] || []).filter((e) => g.grupo !== "actividades" || Number(e.meta) > 0 || Number(e.declaradas) > 0),
  })).filter((g) => g.filas.length > 0);
  if (grupos.length === 0) return <p className="text-sm text-slate-500">No hay metas de marca, producto, crédito o actividad este mes.</p>;
  return (
    <div className="space-y-4">
      {grupos.map((g) => (
        <div key={g.grupo}>
          <h3 className="font-medium text-slate-700 mb-1">{g.titulo}</h3>
          {g.grupo === "actividades" && <p className="text-xs text-amber-800 mb-1">Declaradas, no verificadas</p>}
          {g.filas.map((e) => {
            const tienda = porcentajesTienda
              ? ((porcentajesTienda[g.grupo] || []).find((t) => t[g.clave] === e[g.clave])?.porcentaje ?? null)
              : undefined;
            return (
              <BarraMeta key={e[g.clave]} titulo={e.nombre || e.etiqueta} porcentaje={e.porcentaje}
                detalle={detalleDe(g.unidad, e[g.valor], e.meta)} tienda={tienda} />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export { textoPorcentaje };
