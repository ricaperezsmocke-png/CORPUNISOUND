import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { filasCategorias, reglasDesdeFilas } from "./tableroCincoCaminos.js";

const CAMPO = "neu-campo rounded-lg px-2 py-1 text-sm";
const CELDA = "border-b border-slate-200 px-3 py-2";
const ENCABEZADO = "border-b border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold";
const BOTON = "px-4 py-2 text-sm font-semibold rounded-lg bg-blue-700 text-white disabled:opacity-50";

export default function CategoriasCincoCaminos() {
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [a, b] = await Promise.all([apiFetch("/cinco-caminos/categorias"), apiFetch("/cinco-caminos/categorias/disponibles")]);
      const [reglas, disponibles] = [await a.json(), await b.json()];
      if (!a.ok) throw new Error(reglas.error || "No se pudieron cargar las categorías.");
      if (!b.ok) throw new Error(disponibles.error || "No se pudieron cargar las categorías de SICAR.");
      setFilas(filasCategorias(disponibles.disponibles || [], reglas.categorias || []));
    } catch (e) {
      setError(e.message || "No se pudieron cargar las categorías.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = (indice, tipo) => {
    setExito("");
    setFilas((actuales) => actuales.map((f, i) => (i === indice ? { ...f, tipo } : f)));
  };

  const guardar = async () => {
    setGuardando(true);
    setError("");
    setExito("");
    try {
      const respuesta = await apiFetch("/cinco-caminos/categorias", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categorias: reglasDesdeFilas(filas) }),
      });
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.error || "No se pudo guardar.");
      setExito("Guardado. El tablero usará estas categorías.");
    } catch (e) {
      setError(e.message || "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        Marca qué es instrumento y qué es accesorio. Una regla de categoría gana sobre la del departamento entero.
        Sin instrumentos y accesorios marcados, el número "Instrumento con accesorio" sale "sin configurar". Cada cambio queda con tu nombre y fecha.
      </p>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      {exito && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{exito}</p>}
      {cargando ? <p className="text-sm text-slate-500">Cargando…</p> : (
        <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr>
                <th className={ENCABEZADO}>Departamento</th>
                <th className={ENCABEZADO}>Categoría</th>
                <th className={ENCABEZADO}>Tipo</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={`${f.departamento}|${f.categoria}`}>
                  <td className={CELDA}>{f.departamento}</td>
                  <td className={CELDA}>{f.categoria ?? "Todo el departamento"}</td>
                  <td className={CELDA}>
                    <select className={CAMPO} value={f.tipo} onChange={(e) => cambiar(i, e.target.value)}
                      aria-label={`Tipo de ${f.departamento} ${f.categoria ?? "todo el departamento"}`}>
                      <option value="">Ninguno</option>
                      <option value="instrumento">Instrumento</option>
                      <option value="accesorio">Accesorio</option>
                    </select>
                  </td>
                </tr>
              ))}
              {filas.length === 0 && <tr><td className={CELDA} colSpan={3}>SICAR aún no manda departamentos ni categorías.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className={BOTON} onClick={guardar} disabled={guardando || cargando}>
        {guardando ? "Guardando…" : "Guardar categorías"}
      </button>
    </div>
  );
}
