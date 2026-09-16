import React from "react";
import { Layers, AlertTriangle } from "lucide-react";

/**
 * Demanda agrupada por Familia → Tipo → Marca → Modelo.
 *
 * Todo lo que se ve aquí sale de reglas: nadie junta ni separa demandas a mano
 * y por eso no hay ningún botón de corregir. Si algo quedó mal agrupado, se
 * corrige la regla y se reagrupa parejo.
 *
 * Dos cifras que NO son lo mismo y por eso se rotulan siempre:
 *  - unidades: cuántas piezas pidieron (es la que suma hacia abajo).
 *  - solicitudes: cuántas personas lo pidieron.
 */

const numero = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

const TEXTO_UNIVERSO = {
  HISTORICA: "Todo lo que pidieron en el periodo, se haya vendido o no. Sirve para ver tendencia.",
  PENDIENTE: "Solo la demanda viva. Es la única que debe decidir una compra.",
};

const ETIQUETA_UNIVERSO = { HISTORICA: "Histórico", PENDIENTE: "Pendiente de surtir" };

function Cifras({ nodo }) {
  return <span className="whitespace-nowrap text-sm font-normal text-slate-600">
    {numero.format(nodo.unidades_conocidas)} {nodo.unidades_conocidas === 1 ? "unidad" : "unidades"}
    <span className="text-slate-400"> · </span>
    {numero.format(nodo.solicitudes)} {nodo.solicitudes === 1 ? "solicitud" : "solicitudes"}
    {nodo.articulos_cantidad_desconocida > 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
      +{numero.format(nodo.articulos_cantidad_desconocida)} sin cantidad
    </span>}
  </span>;
}

function Modelo({ modelo }) {
  return <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1">
    <span className="text-sm text-slate-700">{modelo.etiqueta}</span>
    <Cifras nodo={modelo} />
  </li>;
}

function Marca({ marca }) {
  const colores = {
    RECONOCIDA: "bg-emerald-50 text-emerald-800 border-emerald-200",
    NO_INFORMADA: "bg-slate-100 text-slate-600 border-slate-200",
    NO_IDENTIFICADA: "bg-amber-50 text-amber-800 border-amber-200",
  };
  const modelos = (marca.modelos || []).filter((modelo) => modelo.clave !== "no_informado" || (marca.modelos || []).length > 1);
  return <li className="rounded-xl border border-slate-200 p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-800">{marca.etiqueta}</span>
        {marca.estado !== "RECONOCIDA" && <span className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${colores[marca.estado] || colores.NO_INFORMADA}`}>
          {marca.estado === "NO_IDENTIFICADA" ? "no identificada" : "no informada"}
        </span>}
      </span>
      <Cifras nodo={marca} />
    </div>
    {marca.escrituras?.length > 1 && <p className="mt-1 text-xs text-slate-500">Escrita como: {marca.escrituras.join(" · ")}</p>}
    {marca.candidatos?.length > 0 && <p className="mt-1 text-xs text-amber-700">Texto sin identificar: {marca.candidatos.join(" · ")}</p>}
    {modelos.length > 0 && <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100 pt-1">
      {modelos.map((modelo) => <Modelo key={modelo.clave} modelo={modelo} />)}
    </ul>}
  </li>;
}

function Tipo({ tipo }) {
  return <details className="rounded-xl bg-slate-50 p-3">
    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="font-semibold text-slate-800">{tipo.etiqueta}</span>
      <Cifras nodo={tipo} />
    </summary>
    {tipo.caracteristicas?.length > 0 && <p className="mt-2 text-sm text-slate-600">
      De esas, {tipo.caracteristicas.map((caracteristica) =>
        `${numero.format(caracteristica.unidades_conocidas)} ${caracteristica.etiqueta}`).join(", ")}.
    </p>}
    <ul className="mt-3 space-y-2">
      {(tipo.marcas || []).map((marca) => <Marca key={marca.clave} marca={marca} />)}
    </ul>
  </details>;
}

function Evidencia({ registros = [] }) {
  if (!registros.length) return null;
  return <details className="mt-3 text-sm">
    <summary className="cursor-pointer font-semibold text-blue-700">
      Ver las {numero.format(registros.length)} {registros.length === 1 ? "demanda" : "demandas"} de origen
    </summary>
    <ul className="mt-2 space-y-2">
      {registros.map((registro, indice) => <li key={`${registro.demanda_id ?? "sin-id"}-${indice}`} className="rounded-lg border border-slate-200 p-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">#{registro.demanda_id ?? "?"}</span>
        {registro.fecha_local && <span> · {registro.fecha_local}</span>}
        <span> · {registro.estado}</span>
        {registro.cantidad_original != null && <span> · pidió {numero.format(registro.cantidad_original)}</span>}
        <ul className="mt-1 space-y-0.5">
          {(registro.articulos || []).map((articulo, posicion) => <li key={posicion} className="italic text-slate-500">
            “{articulo.evidencia?.texto_original || "sin texto"}”
          </li>)}
        </ul>
      </li>)}
    </ul>
  </details>;
}

function Familia({ familia }) {
  return <section className="min-w-0 rounded-2xl neu p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="text-lg font-extrabold text-slate-900">{familia.etiqueta}</h3>
      <Cifras nodo={familia} />
    </div>
    <ul className="mt-3 space-y-2">
      {(familia.tipos || []).map((tipo) => <li key={tipo.clave}><Tipo tipo={tipo} /></li>)}
    </ul>
    <Evidencia registros={familia.registros} />
  </section>;
}

function Diagnosticos({ diagnosticos = [] }) {
  if (!diagnosticos.length) return null;
  const porMotivo = new Map();
  for (const aviso of diagnosticos) {
    porMotivo.set(aviso.motivo, (porMotivo.get(aviso.motivo) || 0) + 1);
  }
  return <details className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
    <summary className="flex cursor-pointer items-center gap-2 font-semibold text-amber-900">
      <AlertTriangle size={18} />
      {numero.format(diagnosticos.length)} {diagnosticos.length === 1 ? "demanda" : "demandas"} que las reglas no pudieron leer del todo
    </summary>
    <p className="mt-2 text-sm text-amber-900">
      No se pierden ni se corrigen a mano: sirven para mejorar las reglas y volver a agrupar todo parejo.
    </p>
    <ul className="mt-2 space-y-1 text-sm text-amber-900">
      {[...porMotivo].map(([motivo, cuantas]) => <li key={motivo}>
        <span className="font-semibold">{numero.format(cuantas)}</span> · {motivo.toLowerCase().replace(/_/g, " ")}
      </li>)}
    </ul>
  </details>;
}

export default function FamiliasDemanda({ datos, periodo }) {
  if (!datos) return null;
  const familias = datos.familias || [];
  return <section className="min-w-0 space-y-4">
    <div className="rounded-2xl neu p-4">
      <h2 className="flex flex-wrap items-center gap-2 font-bold text-slate-800">
        <Layers size={18} />
        Demanda agrupada por familia
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {ETIQUETA_UNIVERSO[datos.universo] || datos.universo}
        </span>
      </h2>
      <p className="mt-2 text-sm text-slate-600">{TEXTO_UNIVERSO[datos.universo]}</p>
      {periodo && <p className="mt-1 text-xs text-slate-500">
        Periodo: {periodo.fecha_inicio || "desde el inicio"} a {periodo.fecha_fin}
      </p>}
      <p className="mt-3 text-sm font-semibold text-slate-800"><Cifras nodo={datos} /> en total</p>
    </div>

    {familias.length === 0
      ? <div className="rounded-2xl neu py-10 text-center text-sm text-slate-500">
          No hay demanda agrupable en este periodo.
        </div>
      : familias.map((familia) => <Familia key={familia.clave} familia={familia} />)}

    <Diagnosticos diagnosticos={datos.diagnosticos} />
  </section>;
}
