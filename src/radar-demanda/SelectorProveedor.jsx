import React, { useMemo, useState } from "react";
import { Check, Search, Truck } from "lucide-react";
import { MAXIMO_OTRO, filtrarProveedores } from "./proveedorRadar";

const CAMPO = "w-full rounded-xl neu-campo px-3 py-2.5 text-sm outline-none transition";
const OPCION = "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm";
const OPCION_ELEGIDA = "bg-blue-50 font-semibold text-blue-700";
const OPCION_LIBRE = "text-slate-700 hover:bg-slate-50";
const BOTON_OTRO = "min-h-11 rounded-xl border-2 border-dashed px-4 text-sm font-semibold";

/**
 * Con qué proveedor se consigue lo que pidió el cliente. Obligatorio: de la
 * lista de SICAR, o escrito a mano en "Otro proveedor" (queda por revisar).
 */
export default function SelectorProveedor({ proveedores = [], cargando = false, errorLista = "", valor, onChange }) {
  const [busqueda, setBusqueda] = useState("");
  const sinLista = !cargando && !proveedores.length;
  const otro = valor.modo === "otro" || sinLista;
  const coincidencias = useMemo(() => filtrarProveedores(proveedores, busqueda), [proveedores, busqueda]);
  const elegido = proveedores.find((p) => p.clave === valor.clave);

  const elegir = (proveedor) => onChange({ modo: "lista", clave: proveedor.clave, texto: "" });
  const abrirOtro = () => onChange({ modo: "otro", clave: "", texto: valor.texto || busqueda });
  const volverALista = () => onChange({ modo: "lista", clave: "", texto: "" });

  return <div className="mt-4 rounded-xl border border-slate-200 p-3 sm:p-4">
    <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
      <Truck size={17} className="text-blue-600" /> ¿Con qué proveedor se consigue? *
    </p>
    {cargando && <p className="text-xs text-slate-500">Cargando proveedores de SICAR…</p>}
    {errorLista && <p className="mb-2 text-xs text-amber-700">{errorLista}</p>}
    {sinLista && <p className="mb-2 text-xs text-amber-700">
      La lista de proveedores de SICAR todavía no llega. Escribe el proveedor; quedará marcado para revisar.
    </p>}
    {!otro && !cargando && <>
      <div className="relative">
        <Search className="absolute left-3 top-3 text-slate-400" size={17} />
        <input aria-label="Buscar proveedor" className={`${CAMPO} pl-9`} value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)} placeholder={elegido ? elegido.nombre : "Buscar proveedor…"} />
      </div>
      <div className="mt-2 max-h-56 overflow-y-auto" role="listbox" aria-label="Proveedores">
        {coincidencias.map((p) => <button type="button" role="option" aria-selected={p.clave === valor.clave} key={p.clave}
          onClick={() => elegir(p)} className={`${OPCION} ${p.clave === valor.clave ? OPCION_ELEGIDA : OPCION_LIBRE}`}>
          {p.clave === valor.clave ? <Check size={16} /> : <span className="w-4" />}{p.nombre}
        </button>)}
        {!coincidencias.length && <p className="px-3 py-3 text-sm text-slate-500">Ningún proveedor coincide.</p>}
      </div>
      {elegido && <p className="mt-2 text-xs text-emerald-700">Elegido: <b>{elegido.nombre}</b></p>}
      <button type="button" onClick={abrirOtro} className={`${BOTON_OTRO} mt-3 border-blue-300 text-blue-700 hover:bg-blue-50`}>
        No está en la lista: otro proveedor
      </button>
    </>}
    {otro && <div className="space-y-2">
      <input aria-label="Otro proveedor" className={CAMPO} value={valor.texto} maxLength={MAXIMO_OTRO}
        onChange={(e) => onChange({ modo: "otro", clave: "", texto: e.target.value })} placeholder="Nombre del proveedor *" />
      <p className="text-xs text-slate-500">Compras revisará este proveedor antes de pedir.</p>
      {!sinLista && <button type="button" onClick={volverALista} className="text-xs font-semibold text-blue-700">
        Elegir de la lista de SICAR
      </button>}
    </div>}
  </div>;
}
