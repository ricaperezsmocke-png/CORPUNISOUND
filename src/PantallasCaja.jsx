import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";

/**
 * PantallasCaja.jsx — Interruptores de las pantallas de caja (spec 2026-10-15-pantallas-caja).
 *
 * Solo dibuja y pide: las reglas (corte con dinero pendiente, pantallas que dependen del corte,
 * MercadoLibre) viven en backend/pantallasCaja.js. Si el servidor rechaza, se muestra su motivo tal cual.
 */
const ORDEN = ["punto_venta", "corte_caja", "gastos_caja", "dinero_garantias_caja", "depositos"];
const FILA = "flex items-center justify-between gap-3 px-4 py-3";
const BOTON = "rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50";
const fechaHora = (iso) => new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

export default function PantallasCaja() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [ocupada, setOcupada] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch("/configuracion/pantallas");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudieron leer las pantallas.");
      setDatos(d);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function cambiar(pantalla, activa) {
    if (ocupada) return;
    setOcupada(pantalla);
    setError("");
    try {
      const r = await apiFetch("/configuracion/pantallas", { method: "PUT", body: JSON.stringify({ pantalla, activa }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo cambiar la pantalla.");
      setDatos(d);
    } catch (e) { setError(e.message); }
    finally { setOcupada(null); }
  }

  if (!datos) return error ? <p role="alert" className="text-red-700">{error}</p> : <p>Cargando…</p>;
  return (
    <div className="max-w-3xl space-y-4" aria-label="Pantallas de caja">
      <p className="text-slate-600">
        Apagar una pantalla la quita del menú para todos y el sistema rechaza sus cobros y movimientos. No borra nada:
        ventas, cortes y reportes se siguen consultando, y se puede volver a encender. El corte de MercadoLibre sigue
        funcionando siempre.
      </p>
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-800">{error}</p>}
      <div className="neu rounded-xl divide-y divide-slate-100">
        {ORDEN.map((clave) => {
          const activa = datos.pantallas[clave];
          return (
            <div key={clave} className={FILA}>
              <span className="font-medium">{datos.nombres?.[clave] || clave}</span>
              <span className="flex items-center gap-3">
                <span className={activa ? "text-emerald-700" : "text-slate-500"}>{activa ? "Encendida" : "Apagada"}</span>
                <button type="button" disabled={ocupada !== null} onClick={() => cambiar(clave, !activa)}
                  className={`${BOTON} ${activa ? "bg-slate-200 text-slate-800" : "bg-[#1a7fe8] text-white"}`}>
                  {ocupada === clave ? "Guardando…" : activa ? "Apagar" : "Encender"}
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Historial de cambios</h3>
      {!(datos.historial || []).length && <p className="text-slate-500">Todavía no hay cambios.</p>}
      <ul className="space-y-1">
        {[...(datos.historial || [])].reverse().map((h, i) => (
          <li key={`${h.fecha_hora}-${i}`} className="text-xs text-slate-600">
            {fechaHora(h.fecha_hora)} · {h.usuario_nombre} {h.a ? "encendió" : "apagó"} {datos.nombres?.[h.pantalla] || h.pantalla}
          </li>
        ))}
      </ul>
    </div>
  );
}
