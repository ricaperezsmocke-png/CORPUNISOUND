// Visita mensual del supervisor a cada tienda (spec 2026-10-22 F2). Checklist de imagen, sistemas y funcionamiento;
// cada falla lleva nota, foto, responsable de la tienda y un paso a paso, y se cierra con foto en 7 días.
// La ubicación se comprueba en el servidor: una visita que no se puede comprobar no cuenta para la meta.
const { distanciaMetros, RADIO_TOLERANCIA_METROS } = require("./auth");
const { fechaLocal } = require("./fechas");
const { motivoObligatorio } = require("./metasPersonalizadas");

const DIAS_FALLA = 7;
const SECCIONES = ["imagen", "sistemas", "funcionamiento"];
const RESULTADOS = ["bien", "falla", "no_aplica"];
const CHECKLIST_INICIAL = [
  ["imagen", "Aparador"], ["imagen", "Limpieza"], ["imagen", "Exhibición"], ["imagen", "Precios visibles"], ["imagen", "Letrero"],
  ["sistemas", "Cajas"], ["sistemas", "Impresoras"], ["sistemas", "Internet"], ["sistemas", "SICAR"], ["sistemas", "Cámaras"],
  ["sistemas", "Terminal"],
  ["funcionamiento", "Apertura a tiempo"], ["funcionamiento", "Uniformes"], ["funcionamiento", "Personal completo"],
  ["funcionamiento", "Atención al cliente"],
];

const siguienteId = (lista) => lista.reduce((maximo, r) => Math.max(maximo, r.id), 0) + 1;
const noEncontrado = (mensaje) => Object.assign(new Error(mensaje), { status: 404 });
const quien = (usuario) => ({ por_id: usuario?.id ?? null, por_nombre: usuario?.nombre || "desconocido" });

function texto(valor, campo, maximo) {
  if (typeof valor !== "string" || !valor.trim()) throw new Error(`Falta la ${campo}`);
  const limpio = valor.trim();
  if (limpio.length > maximo) throw new Error(`La ${campo} no puede tener más de ${maximo} caracteres`);
  return limpio;
}

function asegurarChecklistInicial(DB) {
  DB.supervision ??= { checklist: [], visitas: [], fallas: [], encargado_sugerido: {} };
  for (const clave of ["checklist", "visitas", "fallas"]) DB.supervision[clave] ??= [];
  DB.supervision.encargado_sugerido ??= {};
  if (DB.supervision.checklist.length) return;
  DB.supervision.checklist = CHECKLIST_INICIAL.map(([seccion, textoPunto], i) => ({
    id: i + 1, seccion, texto: textoPunto, activo: true, orden: i + 1, historial: [],
  }));
}

function editarChecklist(DB, { accion, id, seccion, texto: textoPunto, motivo }, usuario) {
  const limpio = motivoObligatorio(motivo, "Cambiar el checklist");
  const lista = DB.supervision.checklist;
  const marca = { ...quien(usuario), en: new Date().toISOString(), motivo: limpio };
  if (accion === "agregar") {
    if (!SECCIONES.includes(seccion)) throw new Error("La sección debe ser imagen, sistemas o funcionamiento");
    const punto = { id: siguienteId(lista), seccion, texto: texto(textoPunto, "descripción del punto", 120), activo: true,
      orden: siguienteId(lista), historial: [{ accion: "agregado", ...marca }] };
    lista.push(punto);
    return punto;
  }
  const punto = lista.find((p) => p.id === Number(id));
  if (!punto) throw noEncontrado("El punto del checklist no existe");
  if (accion !== "desactivar" && accion !== "reactivar") throw new Error("La acción debe ser agregar, desactivar o reactivar");
  punto.activo = accion === "reactivar";
  punto.historial = [...(punto.historial || []), { accion, ...marca }];
  return punto;
}

function sucursalDe(DB, sucursalId) {
  const sucursal = DB.pos.sucursales.find((s) => s.id === Number(sucursalId));
  if (!sucursal) throw new Error("La tienda no existe");
  return sucursal;
}

const coordenada = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

function ubicacionDe(sucursal, lat, lng) {
  if (!coordenada(lat) || !coordenada(lng)) throw new Error("La ubicación no es válida; activa el GPS e inténtalo de nuevo");
  const ubicacion = { lat: Number(lat), lng: Number(lng), distancia_m: null, comprobada: false };
  if (!coordenada(sucursal.lat) || !coordenada(sucursal.lng)) return ubicacion;
  ubicacion.distancia_m = Math.round(distanciaMetros(ubicacion.lat, ubicacion.lng, Number(sucursal.lat), Number(sucursal.lng)));
  ubicacion.comprobada = ubicacion.distancia_m <= RADIO_TOLERANCIA_METROS;
  return ubicacion;
}

function iniciarVisita(DB, { sucursal_id, lat, lng }, usuario, ahora = new Date().toISOString()) {
  const sucursal = sucursalDe(DB, sucursal_id);
  const ubicacion = ubicacionDe(sucursal, lat, lng);
  if (DB.supervision.visitas.some((v) => v.estado === "en_curso" && v.sucursal_id === sucursal.id && v.supervisor_id === usuario.id)) {
    throw new Error("Ya tienes una visita en curso en esta tienda; termínala primero");
  }
  const visita = { id: siguienteId(DB.supervision.visitas), sucursal_id: sucursal.id, mes: fechaLocal(new Date(ahora)).slice(0, 7),
    supervisor_id: usuario.id, supervisor_nombre: usuario.nombre || "desconocido", iniciada_en: ahora, terminada_en: null,
    ubicacion, puntos: [], estado: "en_curso" };
  DB.supervision.visitas.push(visita);
  return visita;
}

function visitaPropiaEnCurso(DB, visitaId, usuario) {
  const visita = DB.supervision.visitas.find((v) => v.id === Number(visitaId));
  if (!visita || visita.supervisor_id !== usuario?.id) throw noEncontrado("La visita no existe");
  if (visita.estado !== "en_curso") throw new Error("La visita ya está terminada; no se puede cambiar");
  return visita;
}

function responsableDeTienda(DB, responsableId, sucursalId) {
  const cuenta = (DB.admin?.usuarios || []).find((u) => u.id === Number(responsableId));
  if (!cuenta || cuenta.activo === false || Number(cuenta.sucursal_id) !== sucursalId) {
    throw new Error("El responsable debe ser una cuenta activa de esta tienda");
  }
  return cuenta;
}

function pasosDe(pasos) {
  if (!Array.isArray(pasos) || !pasos.length || pasos.length > 10) throw new Error("Escribe de 1 a 10 pasos para resolver la falla");
  return pasos.map((p) => texto(p, "descripción del paso", 200));
}

function marcarPunto(DB, visitaId, { checklist_id, resultado, nota, responsable_id, pasos }, usuario, foto = null) {
  const visita = visitaPropiaEnCurso(DB, visitaId, usuario);
  const punto = DB.supervision.checklist.find((p) => p.id === Number(checklist_id) && p.activo);
  if (!punto) throw new Error("Ese punto no está en el checklist");
  if (!RESULTADOS.includes(resultado)) throw new Error("El resultado debe ser bien, falla o no aplica");
  const marcado = { checklist_id: punto.id, texto: punto.texto, seccion: punto.seccion, resultado, nota: null, foto: null,
    responsable_id: null, responsable_nombre: null, pasos: [] };
  if (resultado === "falla") {
    marcado.nota = texto(nota, "nota de la falla", 300);
    if (!foto?.drive_id) throw new Error("Una falla necesita su foto");
    const responsable = responsableDeTienda(DB, responsable_id, visita.sucursal_id);
    marcado.pasos = pasosDe(pasos);
    Object.assign(marcado, { foto, responsable_id: responsable.id, responsable_nombre: responsable.nombre });
    DB.supervision.encargado_sugerido[visita.sucursal_id] = responsable.id;
  }
  visita.puntos = [...visita.puntos.filter((p) => p.checklist_id !== punto.id), marcado];
  return visita;
}

function terminarVisita(DB, visitaId, usuario, ahora = new Date().toISOString()) {
  const visita = visitaPropiaEnCurso(DB, visitaId, usuario);
  const marcados = new Set(visita.puntos.map((p) => p.checklist_id));
  const faltan = DB.supervision.checklist.filter((p) => p.activo && !marcados.has(p.id)).length;
  if (faltan) throw new Error(`Faltan ${faltan} puntos por revisar`);
  const limite = fechaLocal(new Date(Date.parse(ahora) + DIAS_FALLA * 86400000));
  const fallas = visita.puntos.filter((p) => p.resultado === "falla").map((p) => {
    const nueva = { id: siguienteId(DB.supervision.fallas), visita_id: visita.id, sucursal_id: visita.sucursal_id, punto_texto: p.texto,
      seccion: p.seccion, nota: p.nota, foto: p.foto, responsable_id: p.responsable_id, responsable_nombre: p.responsable_nombre,
      pasos: p.pasos.map((t) => ({ texto: t, hecho_en: null, hecho_por_id: null })), creada_en: ahora, limite, estado: "abierta",
      historial: [{ accion: "abierta", ...quien(usuario), en: ahora, nota: p.nota, foto: p.foto }] };
    DB.supervision.fallas.push(nueva);
    return nueva;
  });
  Object.assign(visita, { estado: "terminada", terminada_en: ahora });
  return { visita, fallas };
}

function fallaAbierta(DB, fallaId) {
  const falla = DB.supervision.fallas.find((f) => f.id === Number(fallaId));
  if (!falla) throw noEncontrado("La falla no existe");
  if (falla.estado !== "abierta") throw new Error("La falla ya no está abierta");
  return falla;
}

function delResponsable(DB, fallaId, usuario, accion) {
  const falla = fallaAbierta(DB, fallaId);
  if (falla.responsable_id !== usuario?.id) throw new Error(`Solo el responsable puede ${accion} esta falla`);
  return falla;
}

function marcarPaso(DB, fallaId, indice, usuario) {
  const falla = delResponsable(DB, fallaId, usuario, "avanzar");
  const paso = falla.pasos[Number(indice)];
  if (!Number.isInteger(Number(indice)) || !paso) throw new Error("Ese paso no existe");
  if (!paso.hecho_en) {
    Object.assign(paso, { hecho_en: new Date().toISOString(), hecho_por_id: usuario.id });
    falla.historial.push({ accion: "paso", ...quien(usuario), en: paso.hecho_en, nota: paso.texto, foto: null });
  }
  return falla;
}

function resolverFalla(DB, fallaId, { nota }, usuario, foto = null) {
  const falla = delResponsable(DB, fallaId, usuario, "resolver");
  const limpia = texto(nota, "nota de cómo se resolvió", 300);
  if (!foto?.drive_id) throw new Error("Para resolver la falla sube la foto de cómo quedó");
  const en = new Date().toISOString();
  Object.assign(falla, { estado: "resuelta", resuelta_en: en });
  falla.historial.push({ accion: "resuelta", ...quien(usuario), en, nota: limpia, foto });
  return falla;
}

function reasignarFalla(DB, fallaId, { responsable_id, motivo }, usuario) {
  const falla = fallaAbierta(DB, fallaId);
  const limpio = motivoObligatorio(motivo, "Reasignar una falla");
  const responsable = responsableDeTienda(DB, responsable_id, falla.sucursal_id);
  Object.assign(falla, { responsable_id: responsable.id, responsable_nombre: responsable.nombre });
  falla.historial.push({ accion: "reasignada", ...quien(usuario), en: new Date().toISOString(), nota: limpio, foto: null,
    responsable_id: responsable.id });
  return falla;
}

function cancelarFalla(DB, fallaId, { motivo }, usuario) {
  const falla = fallaAbierta(DB, fallaId);
  const limpio = motivoObligatorio(motivo, "Cancelar una falla");
  falla.estado = "cancelada";
  falla.historial.push({ accion: "cancelada", ...quien(usuario), en: new Date().toISOString(), nota: limpio, foto: null });
  return falla;
}

const fallaAtrasada = (falla, hoy) => falla.estado === "abierta" && hoy > falla.limite;

module.exports = {
  DIAS_FALLA, SECCIONES, CHECKLIST_INICIAL, asegurarChecklistInicial, editarChecklist, iniciarVisita, marcarPunto, terminarVisita,
  marcarPaso, resolverFalla, reasignarFalla, cancelarFalla, fallaAtrasada,
};
