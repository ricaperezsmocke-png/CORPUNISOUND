import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import { haceCuanto, claseExistencia, formatoExistencia, avisoTienda, textoSinConfirmar } from "./existenciasSicar.js";

const FILTROS = [
  { id: "con", nombre: "Con existencia" },
  { id: "negativas", nombre: "Negativas" },
  { id: "todas", nombre: "Todas" },
];
const PAGINA = "mx-auto max-w-7xl p-4 sm:p-6";
const CAJA = "rounded-lg border border-slate-300 bg-white p-3 text-sm";
const AVISO_AMBAR = "mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900";
const CAMPO = "w-full rounded-md border border-slate-400 px-3 py-2 text-sm sm:w-80";
const BTN_FILTRO = "rounded-md border px-3 py-2 text-sm";
const FILTRO_ON = "border-blue-700 bg-blue-700 text-white";
const FILTRO_OFF = "border-slate-400 bg-white text-slate-700";
const BTN_PAG = "rounded-md border border-slate-400 px-3 py-2 text-sm disabled:opacity-50";
const ENCABEZADO = "border-b border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold";
const CELDA = "border-b border-slate-200 px-3 py-2";
const NOTA_ROJA = "mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800";
const NOTA_VENCIDA = "block text-xs font-normal text-slate-500";

export default function ExistenciasSicar() {
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [solo, setSolo] = useState("con");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setQ(texto.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [texto]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const params = new URLSearchParams({ q, solo, pagina: String(pagina) });
      const respuesta = await apiFetch(`/sicar/existencias?${params}`);
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.error || "No se pudieron cargar las existencias.");
      setDatos(cuerpo);
    } catch (e) {
      setError(e.message || "No se pudieron cargar las existencias.");
    } finally {
      setCargando(false);
    }
  }, [q, solo, pagina]);

  useEffect(() => { cargar(); }, [cargar]);

  const ahora = new Date();
  const tiendas = datos?.tiendas || [];
  const renglones = datos?.renglones || [];
  const hayNegativas = renglones.some((r) => Object.values(r.por_tienda).some((c) => Number(c.existencia) < 0));

  return (
    <div className={PAGINA}>
      <h1 className="mb-3 text-xl font-bold text-slate-900">Existencias SICAR</h1>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiendas.map((t) => (
          <div key={t.id} className={CAJA}>
            <p className="font-semibold text-slate-900">{t.nombre}</p>
            <p className="text-slate-700">Último contacto del agente: {haceCuanto(t.ultimo_contacto, ahora)}</p>
            <p className="text-slate-700">Último cambio de existencias: {haceCuanto(t.ultimo_cambio, ahora)}</p>
            {avisoTienda(t, ahora) && <p role="alert" className={AVISO_AMBAR}>{avisoTienda(t, ahora)}</p>}
          </div>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          className={CAMPO}
          placeholder="Buscar por clave o descripción"
          aria-label="Buscar por clave o descripción"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={solo === f.id}
            className={`${BTN_FILTRO} ${solo === f.id ? FILTRO_ON : FILTRO_OFF}`}
            onClick={() => { setSolo(f.id); setPagina(1); }}
          >
            {f.nombre}
          </button>
        ))}
      </div>
      {error && <p role="alert" className={NOTA_ROJA}>{error}</p>}
      {hayNegativas && <p className={NOTA_ROJA}>SICAR registra existencia negativa: se vendió sin existencia.</p>}
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-300 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr>
              <th className={ENCABEZADO}>Clave</th>
              <th className={ENCABEZADO}>Descripción</th>
              <th className={ENCABEZADO}>Departamento / Categoría</th>
              {tiendas.map((t) => <th key={t.id} className={`${ENCABEZADO} text-right`}>{t.nombre}</th>)}
              <th className={`${ENCABEZADO} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {renglones.map((r, i) => (
              <tr key={`${r.clave ?? "sin"}-${i}`}>
                <td className={CELDA}>{r.clave || "—"}</td>
                <td className={CELDA}>{r.descripcion}</td>
                <td className={CELDA}>{[r.departamento, r.categoria].filter(Boolean).join(" / ") || "—"}</td>
                {tiendas.map((t) => {
                  const c = r.por_tienda[t.id];
                  const vencida = c ? textoSinConfirmar(c.sin_confirmar_desde) : null;
                  return (
                    <td
                      key={t.id}
                      className={`${CELDA} text-right ${c ? claseExistencia(c.existencia, c.sin_confirmar_desde) : "text-slate-400"}`}
                      title={vencida || undefined}
                    >
                      {c ? formatoExistencia(c.existencia) : "—"}
                      {vencida && <span className={NOTA_VENCIDA}>{vencida}</span>}
                    </td>
                  );
                })}
                <td className={`${CELDA} text-right font-semibold ${claseExistencia(r.total, null)}`}>{formatoExistencia(r.total)}</td>
              </tr>
            ))}
            {!cargando && renglones.length === 0 && (
              <tr><td className={CELDA} colSpan={4 + tiendas.length}>No hay artículos con ese filtro.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <button type="button" className={BTN_PAG} disabled={pagina <= 1 || cargando} onClick={() => setPagina(pagina - 1)}>Anterior</button>
        <span>Página {datos?.pagina ?? pagina} de {datos?.paginas ?? 1}</span>
        <button type="button" className={BTN_PAG} disabled={pagina >= (datos?.paginas ?? 1) || cargando} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
        {cargando && <span className="text-slate-500">Cargando…</span>}
      </div>
    </div>
  );
}
