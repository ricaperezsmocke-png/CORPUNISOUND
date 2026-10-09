import { useState } from "react";
import { apiFetch } from "../api";
import { leer } from "../objetivos/datos";
import { Campo, Modal } from "../objetivos/DialogosObjetivos";
import { COLOR_SEMAFORO, TEXTO_SEMAFORO } from "./metas";

// Piezas compartidas por las pestañas de metas de Objetivos.
export const fechaHora = (iso) => new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
export const fechaCorta = (fecha) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
export const ALERTA = "bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 text-sm";
export const EXITO = "bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3 text-sm";
export const TARJETA = "bg-white rounded-xl border border-slate-200 p-4 space-y-3";
export const ENLACE = "text-blue-700 hover:underline";
export const ENLACE_ROJO = "text-red-700 hover:underline";

export function leerArchivoComoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1]);
    lector.onerror = reject;
    lector.readAsDataURL(archivo);
  });
}

export function Barra({ porcentaje }) {
  const ancho = Math.max(0, Math.min(100, porcentaje));
  return (
    <div className="h-3 rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuenow={ancho} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full ${ancho >= 100 ? "bg-emerald-500" : "bg-blue-600"}`} style={{ width: `${ancho}%` }} />
    </div>
  );
}

export function Semaforo({ semaforo }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${COLOR_SEMAFORO[semaforo]}`} aria-hidden="true" />
      {TEXTO_SEMAFORO[semaforo]}
    </span>
  );
}

// Lo que se presentó como prueba: la liga, la foto en Drive o la cantidad.
export function Prueba({ captura }) {
  const { evidencia } = captura;
  if (evidencia?.tipo === "link") {
    return <a href={evidencia.link} target="_blank" rel="noreferrer" className={`${ENLACE} break-all`}>{evidencia.link}</a>;
  }
  if (evidencia?.tipo === "foto") {
    return evidencia.drive_link
      ? <a href={evidencia.drive_link} target="_blank" rel="noreferrer" className={ENLACE}>Ver foto</a>
      : <span>Foto</span>;
  }
  return <span>{captura.cantidad}</span>;
}

export function Anulada({ anulada }) {
  if (!anulada) return null;
  return <p className="text-xs text-red-700">Quitada por {anulada.por_nombre} · {fechaHora(anulada.en)} · Motivo: {anulada.motivo}</p>;
}

// Pide un motivo obligatorio y manda la petición. Si el servidor dice que no, el mensaje se queda en el diálogo.
export function DialogoMotivo({ titulo, explicacion, ruta, textoGuardar, alTerminar, cerrar }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    if (enviando || !motivo.trim()) return;
    setEnviando(true);
    setError("");
    try {
      await apiFetch(ruta, { method: "POST", body: JSON.stringify({ motivo: motivo.trim() }) })
        .then((r) => leer(r, "No se pudo completar"));
      await alTerminar();
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };
  return (
    <Modal titulo={titulo} cerrar={cerrar} guardar={enviar} textoGuardar={textoGuardar} deshabilitado={enviando || !motivo.trim()}
      error={error} focoEnCerrar>
      {explicacion && <p className="text-sm text-slate-600">{explicacion}</p>}
      <Campo etiqueta="Motivo" valor={motivo} cambiar={setMotivo} area />
    </Modal>
  );
}
