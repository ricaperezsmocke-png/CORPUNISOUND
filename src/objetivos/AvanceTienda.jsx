import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { apiFetch } from "../api";
import { hoyLocal, leer } from "./datos";
import { estadoMeta } from "./avance";
import { formatoUnidad, pesosConCentavos } from "./marcas";
import { Anillo, BarrasMetas, LineaMes, textoPorcentaje } from "./GraficasAvance";

const COLUMNAS = [
  { grupo: "marcas", clave: "marca_id", unidad: "pesos", valor: "capturado" },
  { grupo: "productos", clave: "producto_meta_id", unidad: "piezas", valor: "capturado" },
  { grupo: "creditos", clave: "financiera", unidad: "creditos", valor: "registrados" },
];

function Celda({ porcentaje, detalle }) {
  const ancho = Math.min(100, Math.max(0, porcentaje || 0));
  return (
    <td className="py-2 pr-3 align-top min-w-[8rem]">
      <strong>{textoPorcentaje(porcentaje)}</strong>
      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden my-1">
        <div className="h-full bg-blue-500" style={{ width: `${ancho}%` }} />
      </div>
      <span className="text-xs text-slate-500">{detalle}</span>
    </td>
  );
}

// "Avance de la tienda": para jefatura con alcance, en cifras y por persona.
export default function AvanceTienda({ mes, sucursalId, nombre }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    setDatos(null);
    setError("");
    apiFetch(`/objetivos/${mes}/${sucursalId}/avance`).then((r) => leer(r, "No se pudo cargar el avance de la tienda"))
      .then((d) => { if (vigente) setDatos(d); })
      .catch((e) => { if (vigente) setError(e.message); });
    return () => { vigente = false; };
  }, [mes, sucursalId]);

  if (error) return <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm">{error}</div>;
  if (!datos) return <p className="text-sm text-slate-500">Cargando el avance de la tienda…</p>;
  if (!datos.tienda) return <p className="neu rounded-xl p-4 text-sm text-slate-600">No tienes acceso al avance de esta tienda.</p>;
  const { tienda, por_persona: personas = [] } = datos;
  const { venta } = tienda;
  const estado = estadoMeta(venta.meta, venta.capturado);
  // Columnas: cada elemento que existe en la tienda (meta o captura), en el orden de la tienda.
  const columnas = COLUMNAS.flatMap((c) => (tienda[c.grupo] || []).map((e) => ({ ...c, id: e[c.clave], titulo: e.nombre || e.etiqueta })));

  return (
    <section className="neu rounded-xl p-4 space-y-6">
      <h2 className="font-semibold text-slate-700 flex gap-2 items-center">
        <BarChart3 size={18} className="text-blue-600" aria-hidden="true" />
        Avance de la tienda
      </h2>
      <div className="grid lg:grid-cols-[16rem_1fr] gap-6 items-start">
        <Anillo titulo="Meta de venta de la tienda" porcentaje={venta.porcentaje} estado={estado}
          detalle={estado === "sin-meta" ? "" : `${pesosConCentavos(venta.capturado)} de ${pesosConCentavos(venta.meta)}`} />
        <LineaMes serie={tienda.serie} meta={venta.meta} capturado={venta.capturado} mes={mes} hoy={hoyLocal()}
          porcentaje={venta.porcentaje} quien="A la tienda le" />
      </div>
      <BarrasMetas avance={tienda} />
      <div className="overflow-x-auto">
        <h3 className="font-medium text-slate-700 mb-2">Por persona</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-slate-500 text-left">
              <th className="py-2 pr-3">Persona</th>
              <th className="pr-3">Venta</th>
              {columnas.map((c) => <th key={`${c.grupo}|${c.id}`} className="pr-3">{c.titulo}</th>)}
            </tr>
          </thead>
          <tbody>
            {personas.length === 0 && (
              <tr><td colSpan={2 + columnas.length} className="py-3 text-slate-500">No hay personas en la plantilla del mes.</td></tr>
            )}
            {personas.map((p) => (
              <tr key={p.vendedor_id} className="border-b border-slate-100">
                <td className="py-2 pr-3 align-top">{nombre(p.vendedor_id)}</td>
                <Celda porcentaje={p.venta.porcentaje}
                  detalle={`${pesosConCentavos(p.venta.capturado)} de ${pesosConCentavos(p.venta.meta)}`} />
                {columnas.map((c) => {
                  const e = (p[c.grupo] || []).find((x) => x[c.clave] === c.id);
                  return e ? (
                    <Celda key={`${c.grupo}|${c.id}`} porcentaje={e.porcentaje}
                      detalle={`${formatoUnidad(c.unidad, e[c.valor])} de ${formatoUnidad(c.unidad, e.meta)}`} />
                  ) : <td key={`${c.grupo}|${c.id}`} className="py-2 pr-3 text-slate-400">—</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
