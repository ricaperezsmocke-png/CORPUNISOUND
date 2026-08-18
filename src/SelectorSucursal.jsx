import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { pedirLista } from "./cargaSegura";

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
  // Este selector está en el encabezado de TODAS las pantallas. Si la lista no
  // carga, el desplegable se quedaba con solo "Todas las sucursales" y sin
  // decir nada: parecía que la cadena tuviera una sola tienda, y desde "Todas"
  // no se puede capturar nada. Peor todavía, el `.then(setSucursales)` sin
  // revisar `r.ok` metía el objeto `{error}` de un 403 en el estado y el
  // `.map` de abajo tumbaba la pantalla entera con página en blanco.
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!usuario?.ver_todas) return;
    let vigente = true;
    pedirLista(() => apiFetch("/sucursales"), "las sucursales").then(({ datos, error }) => {
      if (!vigente) return;
      setSucursales(datos);
      setError(error);
    });
    return () => { vigente = false; };
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
    <span className="flex items-center gap-1.5">
      <select value={valor} onChange={cambiar} className="text-sm border rounded px-2 py-1">
        <option value="todas">Todas las sucursales</option>
        {sucursales.map((s) => (
          <option key={s.id} value={s.id}>{s.nombre}</option>
        ))}
      </select>
      {error && (
        // Va junto al selector, no en un aviso que se va solo: mientras la
        // lista esté incompleta la persona tiene que poder verlo.
        <span
          title={error}
          className="text-[11px] bg-red-100 text-red-700 border border-red-300 rounded px-1.5 py-0.5 whitespace-nowrap"
        >
          ⚠ no se pudo cargar la lista de sucursales
        </span>
      )}
    </span>
  );
}
