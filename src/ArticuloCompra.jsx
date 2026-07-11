import React, { useState, useEffect, useMemo } from "react";
import { X, Search, Package } from "lucide-react";
import { apiFetch } from "./api";

const inputCls = "w-full border border-slate-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500";

function Campo({ label, children, className = "" }) {
  return (
    <div className={className}>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function calcularTiers(costoNeto, tiers) {
  return tiers.map((t) => ({
    utilidad: t.utilidad,
    precioVenta: Math.round(Number(costoNeto) * (1 + (Number(t.utilidad) || 0) / 100) * 100) / 100,
  }));
}

export default function ArticuloCompra({ producto, renglonExistente, onCancelar, onAceptar }) {
  const [historial, setHistorial] = useState({ ultimo: null, promedio: null });
  const [clave_sat, setClaveSat] = useState(renglonExistente?.clave_sat ?? producto.clave_sat ?? "");
  const [localizacion, setLocalizacion] = useState(renglonExistente?.localizacion ?? producto.localizacion ?? "");
  const [aplicaIva, setAplicaIva] = useState(renglonExistente?.aplicaIva ?? !!producto.iva);
  const [cantidad, setCantidad] = useState(renglonExistente?.cantidad ?? "1");
  const [costo, setCosto] = useState(String(renglonExistente?.costo ?? producto.costo ?? 0));
  const [neto, setNeto] = useState(renglonExistente?.neto ?? !!producto.neto);
  const [descuentoPesos, setDescuentoPesos] = useState(String(renglonExistente?.descuento_pesos ?? 0));
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState(String(renglonExistente?.descuento_porcentaje ?? 0));
  const [precios, setPrecios] = useState(
    renglonExistente?.precios ?? (Array.isArray(producto.precios) && producto.precios.length === 4
      ? producto.precios
      : [{ utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }, { utilidad: 0, precioVenta: 0 }])
  );

  const [modalSat, setModalSat] = useState(false);
  const [busquedaSat, setBusquedaSat] = useState("");
  const [resultadosSat, setResultadosSat] = useState([]);
  const [paginaSat, setPaginaSat] = useState(1);
  const [totalSat, setTotalSat] = useState(0);

  useEffect(() => {
    apiFetch(`/productos/${producto.id}/historial-costo`)
      .then((r) => r.json())
      .then(setHistorial)
      .catch(() => {});
  }, [producto.id]);

  useEffect(() => {
    if (!modalSat) return;
    apiFetch(`/sat/claves?q=${encodeURIComponent(busquedaSat)}&pagina=${paginaSat}`)
      .then((r) => r.json())
      .then((d) => { setResultadosSat(d.resultados || []); setTotalSat(d.total || 0); })
      .catch(() => {});
  }, [modalSat, busquedaSat, paginaSat]);

  const costoNumero = Number(costo) || 0;
  const descPesosNumero = Number(descuentoPesos) || 0;
  const descPorcentajeNumero = Number(descuentoPorcentaje) || 0;
  const costoFinal = useMemo(() => {
    return Math.round((costoNumero - descPesosNumero) * (1 - descPorcentajeNumero / 100) * 100) / 100;
  }, [costoNumero, descPesosNumero, descPorcentajeNumero]);
  const costoFinalConIva = Math.round(costoFinal * 1.16 * 100) / 100;
  const cantidadNumero = Number(cantidad) || 0;

  const actualizarTier = (idx, valor) => {
    setPrecios((prev) => {
      const copia = [...prev];
      copia[idx] = { utilidad: valor, precioVenta: Math.round(costoFinal * (1 + (Number(valor) || 0) / 100) * 100) / 100 };
      return copia;
    });
  };

  const actualizarPrecioVenta = (idx, valor) => {
    setPrecios((prev) => {
      const copia = [...prev];
      const precioVenta = Number(valor) || 0;
      const utilidad = costoFinal > 0 ? Math.round(((precioVenta / costoFinal) - 1) * 100 * 1000000) / 1000000 : 0;
      copia[idx] = { utilidad, precioVenta };
      return copia;
    });
  };

  const restaurarMargenesAnteriores = () => {
    const tiersAnteriores = Array.isArray(producto.precios) && producto.precios.length === 4 ? producto.precios : precios;
    setPrecios(calcularTiers(costoFinal, tiersAnteriores));
  };

  const restaurarPreciosAnteriores = () => {
    if (Array.isArray(producto.precios) && producto.precios.length === 4) {
      setPrecios(producto.precios.map((t) => ({ ...t })));
    }
  };

  const aceptar = () => {
    if (!cantidadNumero || cantidadNumero <= 0) return;
    onAceptar({
      producto_id: producto.id,
      cantidad: cantidadNumero,
      costo: costoNumero,
      descuento_pesos: descPesosNumero,
      descuento_porcentaje: descPorcentajeNumero,
      clave_sat,
      localizacion,
      aplicaIva,
      neto,
      precios,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="font-semibold text-sm text-slate-700 flex items-center gap-2"><Package size={16} /> Artículo</h3>
          <button onClick={onCancelar} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400"><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-2">Información del Artículo</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Campo label="Clave"><div className="text-sm font-medium">{producto.sku}</div></Campo>
              <Campo label="Clave SAT">
                <div className="flex gap-1.5">
                  <input className={inputCls} value={clave_sat} onChange={(e) => setClaveSat(e.target.value)} />
                  <button onClick={() => { setBusquedaSat(""); setPaginaSat(1); setModalSat(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2" title="Buscar en catálogo SAT">
                    <Search size={14} />
                  </button>
                </div>
              </Campo>
            </div>
            <Campo label="Descripción" className="mb-3"><div className="text-sm">{producto.nombre}</div></Campo>
            <div className="grid grid-cols-3 gap-3">
              <Campo label="Existencia"><div className="text-sm">{producto.existencia ?? 0}</div></Campo>
              <Campo label="Factor"><div className="text-sm">{producto.factor ?? 1}</div></Campo>
              <Campo label="Localización">
                <input className={inputCls} value={localizacion} onChange={(e) => setLocalizacion(e.target.value)} placeholder="ej: Pasillo 3, Anaquel B" />
              </Campo>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold text-slate-500 mb-2">Precios (antes de esta compra)</div>
            <div className="grid grid-cols-2 gap-3 text-sm mb-2">
              <div>Último precio de compra: <b>{historial.ultimo ? `$${historial.ultimo.neto.toFixed(2)}` : "—"}</b>
                {historial.ultimo && <span className="text-slate-400"> (${historial.ultimo.conIva.toFixed(2)} con IVA)</span>}
              </div>
              <div>Promedio de compra: <b>{historial.promedio ? `$${historial.promedio.neto.toFixed(2)}` : "—"}</b>
                {historial.promedio && <span className="text-slate-400"> (${historial.promedio.conIva.toFixed(2)} con IVA)</span>}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              {(Array.isArray(producto.precios) ? producto.precios : []).map((t, idx) => (
                <div key={idx} className="border border-slate-200 rounded p-2">
                  <div className="text-slate-400">Margen {idx + 1}: {Number(t.utilidad).toFixed(2)}%</div>
                  <div className="font-semibold">${Number(t.precioVenta).toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold text-slate-500 mb-2">Detalle de la Compra</div>
            <label className="flex items-center gap-2 text-sm mb-3">
              <input type="checkbox" checked={aplicaIva} onChange={(e) => setAplicaIva(e.target.checked)} /> Aplica IVA (16%)
            </label>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Campo label="Cantidad"><input type="number" className={inputCls} value={cantidad} onChange={(e) => setCantidad(e.target.value)} /></Campo>
              <Campo label="Costo (neto)"><input type="number" className={inputCls} value={costo} onChange={(e) => setCosto(e.target.value)} /></Campo>
              <Campo label=" ">
                <label className="flex items-center gap-2 text-sm mt-2">
                  <input type="checkbox" checked={neto} onChange={(e) => setNeto(e.target.checked)} /> Neto
                </label>
              </Campo>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Campo label="Desc $"><input type="number" className={inputCls} value={descuentoPesos} onChange={(e) => setDescuentoPesos(e.target.value)} /></Campo>
              <Campo label="Desc %"><input type="number" className={inputCls} value={descuentoPorcentaje} onChange={(e) => setDescuentoPorcentaje(e.target.value)} /></Campo>
            </div>
            <div className="text-xs text-slate-500 bg-slate-50 rounded p-2 flex justify-between">
              <span>Precio sin impuestos — unitario: <b>${costoFinal.toFixed(2)}</b> · total línea: <b>${(costoFinal * cantidadNumero).toFixed(2)}</b></span>
              {aplicaIva && <span>Con IVA (unitario): <b>${costoFinalConIva.toFixed(2)}</b></span>}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <div className="text-xs font-semibold text-slate-500 mb-2">Precios de Venta (después de esta compra)</div>
            <div className="grid grid-cols-4 gap-3">
              {precios.map((t, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg p-2.5">
                  <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Precio {idx + 1}</div>
                  <Campo label="% Utilidad"><input type="number" className={inputCls} value={t.utilidad} onChange={(e) => actualizarTier(idx, e.target.value)} /></Campo>
                  <Campo label="Precio venta" className="mt-2"><input type="number" className={inputCls} value={t.precioVenta} onChange={(e) => actualizarPrecioVenta(idx, e.target.value)} /></Campo>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={restaurarMargenesAnteriores} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded text-sm font-medium hover:bg-slate-50">−% Márgenes Anteriores</button>
            <button onClick={restaurarPreciosAnteriores} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded text-sm font-medium hover:bg-slate-50">$ Precios Anteriores</button>
          </div>
          <div className="flex gap-2">
            <button onClick={onCancelar} className="flex-1 border border-slate-300 text-slate-600 py-2 rounded font-medium hover:bg-slate-50">Cancelar</button>
            <button onClick={aceptar} className="flex-1 bg-blue-700 hover:bg-blue-800 text-white py-2 rounded font-semibold">Aceptar</button>
          </div>
        </div>

        {modalSat && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={() => setModalSat(false)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 bg-white">
                <h4 className="font-semibold text-sm text-slate-700">Buscar Clave SAT</h4>
                <button onClick={() => setModalSat(false)} className="hover:bg-slate-100 rounded-lg p-1.5 text-slate-400"><X size={16} /></button>
              </div>
              <div className="p-4">
                <input
                  autoFocus value={busquedaSat}
                  onChange={(e) => { setBusquedaSat(e.target.value); setPaginaSat(1); }}
                  placeholder="Escribe una palabra clave, ej: amplificador"
                  className="w-full border border-slate-300 rounded px-3 py-2 mb-3 focus:outline-none focus:border-blue-500"
                />
                <div className="max-h-80 overflow-y-auto border border-slate-200 rounded">
                  <table className="w-full text-sm">
                    <thead className="bg-[#1a7fe8] text-white sticky top-0">
                      <tr><th className="py-2 px-3 text-left font-medium w-28">Clave</th><th className="py-2 px-3 text-left font-medium">Descripción</th></tr>
                    </thead>
                    <tbody>
                      {resultadosSat.length === 0 && <tr><td colSpan={2} className="text-center text-slate-400 py-8">Sin resultados</td></tr>}
                      {resultadosSat.map((r) => (
                        <tr key={r.clave} onClick={() => { setClaveSat(r.clave); setModalSat(false); }} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                          <td className="py-2 px-3 font-mono text-xs">{r.clave}</td>
                          <td className="py-2 px-3">{r.descripcion}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-center text-xs text-slate-400 mt-2">{totalSat} resultado(s) — página {paginaSat}</div>
                <div className="flex items-center justify-center gap-3 mt-2">
                  <button disabled={paginaSat <= 1} onClick={() => setPaginaSat((p) => p - 1)} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-30 text-xs">Anterior</button>
                  <button disabled={resultadosSat.length < 20} onClick={() => setPaginaSat((p) => p + 1)} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-30 text-xs">Siguiente</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
