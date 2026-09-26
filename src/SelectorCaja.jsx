import { useEffect, useState } from "react";
import { apiFetch, cajaActiva, sinSucursalElegida } from "./api";
import { pedirLista } from "./cargaSegura";
import { puedeCambiarCaja } from "./cajaPantalla.js";

/** Caja fija de la sesión. La lista siempre se valida antes de llegar al estado. */
export default function SelectorCaja() {
  const sinSucursal = sinSucursalElegida();
  const [cajas, setCajas] = useState([]);
  const [valor, setValor] = useState(sinSucursal ? "" : (cajaActiva() || ""));
  const [error, setError] = useState(null);
  const [avisoCambio, setAvisoCambio] = useState("");

  useEffect(() => {
    if (sinSucursal) {
      localStorage.removeItem("caja_activa");
      setCajas([]);
      setValor("");
      setError(null);
      return;
    }

    let vigente = true;
    pedirLista(() => apiFetch("/cajas"), "las cajas").then(({ datos, error: errorCarga }) => {
      if (!vigente) return;
      setCajas(datos);
      setError(errorCarga);
      const guardada = datos.find((caja) => String(caja.id) === String(cajaActiva()));
      const elegida = guardada || datos.find((caja) => caja.predeterminada);
      const nuevoValor = elegida ? String(elegida.id) : "";
      setValor(nuevoValor);
      if (nuevoValor) localStorage.setItem("caja_activa", nuevoValor);
      else localStorage.removeItem("caja_activa");
      window.dispatchEvent(new Event("caja-activa-cargada"));
    });
    return () => { vigente = false; };
  }, [sinSucursal]);

  function cambiar(e) {
    if (!puedeCambiarCaja(sessionStorage.getItem("ticket_en_curso"))) {
      e.target.value = valor;
      setAvisoCambio("Termina o cancela el ticket antes de cambiar de caja.");
      return;
    }
    const nueva = e.target.value;
    setValor(nueva);
    localStorage.setItem("caja_activa", nueva);
    window.location.reload();
  }

  return (
    <span className="flex items-center gap-1.5">
      <select
        aria-label="Caja activa"
        value={valor}
        onChange={cambiar}
        disabled={sinSucursal || Boolean(error) || cajas.length === 0}
        className="text-sm border rounded px-2 py-1 disabled:opacity-60"
      >
        <option value="">{sinSucursal ? "Sin caja" : "Cargando caja..."}</option>
        {cajas.map((caja) => (
          <option key={caja.id} value={caja.id}>{caja.nombre}</option>
        ))}
      </select>
      {avisoCambio && <span role="status" className="text-xs text-amber-800">{avisoCambio}</span>}
      {error && (
        <span
          title={error}
          className="text-[11px] bg-red-100 text-red-700 border border-red-300 rounded px-1.5 py-0.5 whitespace-nowrap"
        >
          ⚠ no se pudo cargar la caja
        </span>
      )}
    </span>
  );
}
