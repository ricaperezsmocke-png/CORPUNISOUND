import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { apiFetch } from "../api";
import { hoyLocal, leer } from "./datos";
import { estadoMeta } from "./avance";
import { pesosConCentavos } from "./marcas";
import { Anillo, BarrasMetas, LineaMes } from "./GraficasAvance";

// "Mi avance": la vendedora ve lo suyo en pesos y de su tienda solo porcentajes enteros
// (decisión de Victor 2026-09-24). El servidor ya recorta lo que le toca ver.
export default function AvanceVendedor({ mes, sucursalId }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    setDatos(null);
    setError("");
    apiFetch(`/objetivos/${mes}/${sucursalId}/avance`).then((r) => leer(r, "No se pudo cargar tu avance"))
      .then((d) => { if (vigente) setDatos(d); })
      .catch((e) => { if (vigente) setError(e.message); });
    return () => { vigente = false; };
  }, [mes, sucursalId]);

  if (error) return <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm">{error}</div>;
  if (!datos) return <p className="text-sm text-slate-500">Cargando tu avance…</p>;
  const propio = datos.propio;
  if (!propio) return <p className="neu rounded-xl p-4 text-sm text-slate-600">No estás en la plantilla de esta tienda este mes.</p>;
  const { venta } = propio;
  const estado = estadoMeta(venta.meta, venta.capturado);
  const tiendaVenta = datos.tienda_porcentajes?.venta;

  return (
    <section className="neu rounded-xl p-4 space-y-6">
      <h2 className="font-semibold text-slate-700 flex gap-2 items-center">
        <Gauge size={18} className="text-blue-600" aria-hidden="true" />
        Mi avance del mes
      </h2>
      <div className="grid lg:grid-cols-[16rem_1fr] gap-6 items-start">
        <div className="space-y-2">
          <Anillo titulo="Mi meta de venta" porcentaje={venta.porcentaje} estado={estado}
            detalle={estado === "sin-meta" ? "" : `${pesosConCentavos(venta.capturado)} de ${pesosConCentavos(venta.meta)}`} />
          <p className="text-center text-sm text-slate-500">
            Al cierre de ayer la tienda iba al{" "}
            <strong>{tiendaVenta === null || tiendaVenta === undefined ? "—" : `${tiendaVenta} %`}</strong> de su meta
          </p>
        </div>
        <LineaMes serie={propio.serie} meta={venta.meta} capturado={venta.capturado} mes={mes} hoy={hoyLocal()}
          porcentaje={venta.porcentaje} />
      </div>
      <BarrasMetas avance={propio} porcentajesTienda={datos.tienda_porcentajes} />
      <p className="text-xs text-slate-500">
        La barra gris de la tienda muestra su avance al cierre de ayer; en metas chicas de piezas, créditos o actividades no se muestra.
      </p>
    </section>
  );
}
