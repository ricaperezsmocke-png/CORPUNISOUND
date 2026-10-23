import React from "react";
import { AlertTriangle, Truck } from "lucide-react";
import { textoDias } from "./proveedorRadar";

/**
 * Lo pendiente agrupado por el proveedor que puso el vendedor. Con esto Compras
 * arma el pedido de un jalón: qué pidieron, cuántas piezas, de qué tiendas y
 * hace cuánto. Solo demanda viva; las demandas viejas sin proveedor van al
 * final en "Sin proveedor".
 */

const numero = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });
const piezas = (n) => `${numero.format(n || 0)} ${n === 1 ? "pieza" : "piezas"}`;
const solicitudes = (n) => `${numero.format(n || 0)} ${n === 1 ? "solicitud" : "solicitudes"}`;
const ETIQUETA = "rounded border px-1.5 py-0.5 text-xs font-semibold";
const CELDA = "px-3 py-2 align-top";

function Proveedor({ grupo }) {
  return <details className="rounded-xl border border-slate-200 p-3">
    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-800">{grupo.nombre}</span>
        {grupo.por_revisar && <span className={`${ETIQUETA} border-amber-200 bg-amber-50 text-amber-800`}>
          otro proveedor, por revisar
        </span>}
        {grupo.sin_proveedor && <span className={`${ETIQUETA} border-slate-200 bg-slate-100 text-slate-600`}>registradas antes</span>}
      </span>
      <span className="whitespace-nowrap text-sm text-slate-600">
        {piezas(grupo.piezas)} · {solicitudes(grupo.solicitudes)} · la más vieja {textoDias(grupo.dias_mas_vieja)}
      </span>
    </summary>
    <p className="mt-1 text-xs text-slate-500">Tiendas: {grupo.sucursales.join(", ") || "—"}</p>
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr><th className={CELDA}>Artículo</th><th className={CELDA}>Marca / modelo</th><th className={CELDA}>Piezas</th>
            <th className={CELDA}>Tiendas</th><th className={CELDA}>Más vieja</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {grupo.articulos.map((a) => <tr key={`${a.producto_id ?? "t"}-${a.descripcion}-${a.marca}-${a.modelo}`}>
            <td className={`${CELDA} font-semibold text-slate-800`}>{a.descripcion}</td>
            <td className={CELDA}>{[a.marca, a.modelo].filter(Boolean).join(" · ") || "—"}</td>
            <td className={`${CELDA} whitespace-nowrap`}>{numero.format(a.piezas)}
              <span className="block text-xs text-slate-500">{solicitudes(a.solicitudes)}</span></td>
            <td className={CELDA}>{a.sucursales.join(", ")}</td>
            <td className={`${CELDA} whitespace-nowrap`}>{textoDias(a.dias_mas_vieja)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </details>;
}

export default function ProveedoresDemanda({ datos }) {
  if (!Array.isArray(datos)) return null;
  const porRevisar = datos.filter((g) => g.por_revisar).length;
  return <section className="min-w-0 overflow-hidden rounded-2xl neu shadow-sm">
    <div className="border-b border-slate-100 p-4">
      <h2 className="flex items-center gap-2 font-extrabold text-slate-900"><Truck size={19} className="text-blue-700" />Por proveedor</h2>
      <p className="mt-1 text-xs text-slate-500">
        Lo que los clientes pidieron y sigue pendiente, agrupado por el proveedor con el que se consigue. Para armar el pedido.
      </p>
      {porRevisar > 0 && <p className="mt-2 flex items-center gap-1 text-xs text-amber-700">
        <AlertTriangle size={14} /> {porRevisar} {porRevisar === 1 ? "proveedor escrito" : "proveedores escritos"} a mano: revisa
        que sea correcto antes de pedir.
      </p>}
    </div>
    {datos.length ? <div className="space-y-2 p-4">{datos.map((g) => <Proveedor key={g.clave ?? "sin-proveedor"} grupo={g} />)}</div>
      : <p className="px-4 py-10 text-center text-sm text-slate-500">No hay demanda pendiente en este periodo.</p>}
  </section>;
}
