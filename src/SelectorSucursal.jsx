import { useEffect, useState } from "react";
import { apiFetch } from "./api";

/**
 * Selector de sucursal para usuarios con vista global (ver_todas).
 * Para usuarios amarrados, muestra una etiqueta fija con su sucursal.
 *
 * Props:
 *  - usuario: objeto de sesión ({ ver_todas, sucursal_id, sucursal_nombre }).
 *  - onCambio: callback(sucursalId | "todas") cuando cambia la selección.
 */
export default function SelectorSucursal({ usuario, onCambio }) {
  const [sucursales, setSucursales] = useState([]);
  const [valor, setValor] = useState(localStorage.getItem("sucursal_activa") || "todas");

  useEffect(() => {
    if (!usuario?.ver_todas) return;
    apiFetch("/sucursales")
      .then((r) => r.json())
      .then(setSucursales)
      .catch(() => setSucursales([]));
  }, [usuario]);

  if (!usuario?.ver_todas) {
    return (
      <span className="text-sm text-gray-600 px-3 py-1 rounded bg-gray-100">
        Sucursal: <strong>{usuario?.sucursal_nombre || "—"}</strong>
      </span>
    );
  }

  function cambiar(e) {
    const v = e.target.value;
    setValor(v);
    localStorage.setItem("sucursal_activa", v);
    onCambio?.(v);
  }

  return (
    <select value={valor} onChange={cambiar} className="text-sm border rounded px-2 py-1">
      <option value="todas">Todas las sucursales</option>
      {sucursales.map((s) => (
        <option key={s.id} value={s.id}>{s.nombre}</option>
      ))}
    </select>
  );
}
