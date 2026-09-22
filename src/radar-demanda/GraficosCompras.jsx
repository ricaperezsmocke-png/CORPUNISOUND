import React, { useMemo } from "react";
import { BarChart3, Coins } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/**
 * Los gráficos de la pantalla de Compras.
 *
 * Solo hay dos, y cada uno existe para cambiar una decisión concreta. Un
 * gráfico que no cambia ninguna decisión es adorno, y aquí estorba: esta
 * pantalla se abre para saber qué comprar.
 *
 * No se dibuja nada que el sistema no sepa de verdad. Un producto sin mínimo
 * configurado o sin costo conocido no aparece con una barra en cero —cero es
 * un dato, y "no lo sé" no es cero—: aparece en el conteo de lo que no se
 * pudo calcular, debajo del gráfico.
 */

const dinero = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const numero = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

const MAXIMO_BARRAS = 12;
const COLOR_AGOTADO = "#dc2626";
const COLOR_BAJO = "#f59e0b";
const COLOR_DINERO = "#2563eb";

const TITULO_SECCION = "mb-1 flex items-center gap-2 font-extrabold text-slate-900";
const PIE_NOTA = "mt-3 text-xs text-slate-500";

function etiquetaFila(fila) {
  const nombre = fila.producto?.nombre || fila.producto?.sku || "Sin nombre";
  const corto = nombre.length > 28 ? `${nombre.slice(0, 27)}…` : nombre;
  return `${corto} · ${fila.sucursal?.sucursal_nombre || ""}`.trim();
}

function Vacio({ texto }) {
  return <p className="py-10 text-center text-sm text-slate-500">{texto}</p>;
}

/**
 * Cuánto falta para volver al mínimo, de mayor a menor. Se mira para decidir
 * QUÉ ATENDER PRIMERO cuando no se puede comprar todo de una vez.
 */
function GraficoFaltante({ filas }) {
  const datos = useMemo(() => filas
    .filter((f) => typeof f.reposicion?.piezas === "number" && f.reposicion.piezas > 0)
    .sort((a, b) => b.reposicion.piezas - a.reposicion.piezas)
    .slice(0, MAXIMO_BARRAS)
    .map((f) => ({
      nombre: etiquetaFila(f),
      faltan: f.reposicion.piezas,
      agotado: Number(f.inventario?.cantidad_actual) <= 0,
    })), [filas]);

  if (!datos.length) return <Vacio texto="No hay faltantes que se puedan calcular todavía." />;

  return (
    <div style={{ height: Math.max(240, datos.length * 34 + 60) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" allowDecimals={false} fontSize={11} />
          <YAxis type="category" dataKey="nombre" width={190} fontSize={11} interval={0} />
          <Tooltip formatter={(v) => [`${numero.format(v)} piezas`, "Faltan"]} />
          <Bar dataKey="faltan" radius={[0, 6, 6, 0]} name="Piezas que faltan">
            {datos.map((d) => (
              <Cell key={d.nombre} fill={d.agotado ? COLOR_AGOTADO : COLOR_BAJO} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Cuánto dinero cuesta cubrir cada faltante, al último costo conocido. Se mira
 * para decidir EN QUÉ GASTAR PRIMERO cuando el presupuesto no alcanza para
 * todo.
 */
function GraficoDinero({ filas }) {
  const datos = useMemo(() => filas
    .filter((f) => typeof f.reposicion?.importe_estimado === "number" && f.reposicion.importe_estimado > 0)
    .sort((a, b) => b.reposicion.importe_estimado - a.reposicion.importe_estimado)
    .slice(0, MAXIMO_BARRAS)
    .map((f) => ({
      nombre: etiquetaFila(f),
      importe: f.reposicion.importe_estimado,
      piezas: f.reposicion.piezas,
    })), [filas]);

  if (!datos.length) {
    return <Vacio texto="Todavía no hay costos conocidos para estimar cuánto cuesta reponer." />;
  }

  return (
    <div style={{ height: Math.max(240, datos.length * 34 + 60) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" fontSize={11} tickFormatter={(v) => dinero.format(v)} />
          <YAxis type="category" dataKey="nombre" width={190} fontSize={11} interval={0} />
          <Tooltip
            formatter={(v, _n, item) => [
              `${dinero.format(v)} · ${numero.format(item.payload.piezas)} piezas`, "Costo estimado",
            ]}
          />
          <Bar dataKey="importe" fill={COLOR_DINERO} radius={[0, 6, 6, 0]} name="Costo estimado" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function GraficosCompras({ filas, hayCostos }) {
  const sinCalcular = useMemo(
    () => filas.filter((f) => f.reposicion && f.reposicion.piezas == null),
    [filas]
  );
  const totalPiezas = useMemo(
    () => filas.reduce((s, f) => s + (Number(f.reposicion?.piezas) || 0), 0),
    [filas]
  );
  const totalDinero = useMemo(
    () => filas.reduce((s, f) => s + (Number(f.reposicion?.importe_estimado) || 0), 0),
    [filas]
  );

  if (!filas.length) return null;

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <section className="min-w-0 rounded-2xl border neu-panel p-4 shadow-sm">
        <h2 className={TITULO_SECCION}>
          <BarChart3 size={18} className="text-blue-700" />
          Lo que más falta
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Esto se mira para decidir qué atender primero. En rojo, lo que ya está agotado.
        </p>
        <GraficoFaltante filas={filas} />
        <p className={PIE_NOTA}>
          {numero.format(totalPiezas)} piezas en total para volver a los mínimos.
          {sinCalcular.length > 0 && (
            <> {numero.format(sinCalcular.length)} producto(s) sin cantidad calculable: falta su mínimo,
              su existencia no es confiable, o ya se marcaron como pedidos.</>
          )}
        </p>
      </section>

      {hayCostos && (
        <section className="min-w-0 rounded-2xl border neu-panel p-4 shadow-sm">
          <h2 className={TITULO_SECCION}>
            <Coins size={18} className="text-blue-700" />
            Lo que costaría reponer
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Esto se mira para decidir en qué gastar primero. Es el último costo pagado, no una
            cotización de hoy.
          </p>
          <GraficoDinero filas={filas} />
          <p className={PIE_NOTA}>
            {dinero.format(totalDinero)} en total, solo de los productos con costo conocido.
          </p>
        </section>
      )}
    </div>
  );
}
