// Rutas de supervisión de tiendas (spec 2026-10-22 F2). El alcance sale del token: una tienda o una falla fuera de él
// responde 404. Las fotos se suben a Drive (nunca al disco de Render) y se borran si la operación no se guarda.
const S = require("./supervision");
const { prepararEvidencia } = require("./objetivosActividades");
const { fechaLocal } = require("./fechas");

module.exports = function registrarRutasSupervision(app, deps) {
  const { DB, drive, requiereLogin, resolverPermisosDeRol, resolverAlcanceAutorizado } = deps;
  const permisosDe = (req) => resolverPermisosDeRol(req.usuarioToken.rol_id);
  const tiene = (req, clave) => permisosDe(req).includes(clave);
  const alguno = (...claves) => (req, res, next) => (claves.some((c) => tiene(req, c))
    ? next() : res.status(403).json({ error: "No tienes permiso para esta acción" }));
  const enAlcance = (req, sucursalId) => {
    const { verTodas, sucursalId: propia } = resolverAlcanceAutorizado(req);
    return verTodas || Number(sucursalId) === Number(propia);
  };
  const fallo = (res, e) => res.status(e.status === 404 ? 404 : 400).json({ error: e.message });
  const conAtrasada = (f) => ({ ...f, atrasada: S.fallaAtrasada(f, fechaLocal(new Date())) });
  const realiza = alguno("realizar_visitas_tienda");
  const atiende = alguno("atender_fallas_visita");
  const supervisa = alguno("realizar_visitas_tienda", "ver_supervision");
  // Reasignar o cancelar es del supervisor (o del Administrador, que tiene todo); ver_supervision es solo para ver.
  // Y el responsable de una falla no la cierra por esta vía: la resuelve con foto.
  const fallaDeOtro = (req, id) => {
    const falla = fallaVisible(req, id);
    if (!enAlcance(req, falla.sucursal_id)) throw Object.assign(new Error("La falla no existe"), { status: 404 });
    if (falla.responsable_id === req.usuarioToken.id) throw new Error("Eres el responsable de esta falla: resuélvela con foto, no la canceles ni la pases");
    return falla;
  };

  async function subirFoto(sucursalId, archivo, etiqueta) {
    const { evidencia, buffer } = prepararEvidencia({ evidencia: "foto" }, { archivo });
    const sucursal = DB.pos.sucursales.find((s) => s.id === Number(sucursalId)) || { id: sucursalId };
    const carpetaId = await drive.asegurarCarpetaActividadesSucursal(DB, sucursal);
    const subido = await drive.subirArchivoADrive(DB, {
      nombre: `Supervision ${fechaLocal(new Date())} - ${sucursal.nombre || sucursalId} - ${etiqueta} - ${evidencia.nombre_archivo}`,
      mimeType: archivo.tipo_mime, contenidoBuffer: buffer, carpetaId,
    });
    if (!subido?.id || !subido.webViewLink) {
      if (subido?.id) await borrarFoto(subido.id);
      throw new Error("Drive no confirmó la subida de la foto; inténtalo de nuevo");
    }
    return { drive_id: subido.id, link: subido.webViewLink, nombre: evidencia.nombre_archivo, huella: evidencia.huella };
  }
  async function borrarFoto(id) {
    try { await drive.eliminarArchivoDeDrive(DB, id); } catch (e) { console.error("No se pudo borrar una foto de supervisión no guardada", e); }
  }
  // Sube la foto (si viene) y aplica la operación; si la operación falla, la foto se borra de Drive.
  async function conFoto(sucursalId, archivo, etiqueta, operar) {
    const foto = archivo ? await subirFoto(sucursalId, archivo, etiqueta) : null;
    try { return operar(foto); } catch (e) { if (foto) await borrarFoto(foto.drive_id); throw e; }
  }
  const visitaVisible = (req, id) => {
    const visita = DB.supervision.visitas.find((v) => v.id === Number(id));
    if (!visita || !enAlcance(req, visita.sucursal_id)) throw Object.assign(new Error("La visita no existe"), { status: 404 });
    return visita;
  };
  const fallaVisible = (req, id) => {
    const falla = DB.supervision.fallas.find((f) => f.id === Number(id));
    const propia = falla && falla.responsable_id === req.usuarioToken.id;
    if (!falla || (!propia && !enAlcance(req, falla.sucursal_id))) throw Object.assign(new Error("La falla no existe"), { status: 404 });
    return falla;
  };

  app.get("/api/supervision/checklist", requiereLogin, alguno("realizar_visitas_tienda", "administrar_checklist_visitas"), (req, res) =>
    res.json(DB.supervision.checklist));
  app.post("/api/supervision/checklist", requiereLogin, alguno("administrar_checklist_visitas"), (req, res) => {
    try { res.json(S.editarChecklist(DB, req.body || {}, req.usuarioToken)); } catch (e) { fallo(res, e); }
  });

  app.get("/api/supervision/responsables", requiereLogin, realiza, (req, res) => {
    const sucursalId = Number(req.query.sucursal_id);
    if (!enAlcance(req, sucursalId)) return res.status(404).json({ error: "Tienda no encontrada" });
    res.json({
      cuentas: DB.admin.usuarios.filter((u) => u.activo !== false && Number(u.sucursal_id) === sucursalId)
        .map((u) => ({ id: u.id, nombre: u.nombre })),
      sugerido: DB.supervision.encargado_sugerido[sucursalId] ?? null,
    });
  });

  app.post("/api/supervision/visitas", requiereLogin, realiza, (req, res) => {
    try {
      if (!enAlcance(req, req.body?.sucursal_id)) return res.status(404).json({ error: "Tienda no encontrada" });
      res.json(S.iniciarVisita(DB, req.body || {}, req.usuarioToken));
    } catch (e) { fallo(res, e); }
  });
  app.get("/api/supervision/visitas", requiereLogin, supervisa, (req, res) => {
    const mes = typeof req.query.mes === "string" && /^\d{4}-\d{2}$/.test(req.query.mes) ? req.query.mes : null;
    const veTodo = tiene(req, "ver_supervision");
    res.json(DB.supervision.visitas.filter((v) => (!mes || v.mes === mes) &&
      (v.supervisor_id === req.usuarioToken.id || (veTodo && enAlcance(req, v.sucursal_id)))));
  });
  app.post("/api/supervision/visitas/:id/puntos", requiereLogin, realiza, async (req, res) => {
    try {
      const visita = visitaVisible(req, req.params.id);
      const { archivo, ...datos } = req.body || {};
      const archivoFalla = datos.resultado === "falla" ? archivo : null;
      res.json(await conFoto(visita.sucursal_id, archivoFalla, "falla", (foto) =>
        S.marcarPunto(DB, visita.id, datos, req.usuarioToken, foto)));
    } catch (e) { fallo(res, e); }
  });
  app.post("/api/supervision/visitas/:id/terminar", requiereLogin, realiza, (req, res) => {
    try {
      const visita = visitaVisible(req, req.params.id);
      res.json(S.terminarVisita(DB, visita.id, req.usuarioToken));
    } catch (e) { fallo(res, e); }
  });

  app.get("/api/supervision/mis-fallas", requiereLogin, atiende, (req, res) =>
    res.json(DB.supervision.fallas.filter((f) => f.responsable_id === req.usuarioToken.id).map(conAtrasada)));
  app.get("/api/supervision/fallas", requiereLogin, alguno("ver_supervision"), (req, res) => {
    const estado = ["abierta", "resuelta", "cancelada"].includes(req.query.estado) ? req.query.estado : null;
    res.json(DB.supervision.fallas.filter((f) => (!estado || f.estado === estado) && enAlcance(req, f.sucursal_id)).map(conAtrasada));
  });
  app.post("/api/supervision/fallas/:id/pasos/:indice", requiereLogin, atiende, (req, res) => {
    try {
      const falla = fallaVisible(req, req.params.id);
      res.json(conAtrasada(S.marcarPaso(DB, falla.id, req.params.indice, req.usuarioToken)));
    } catch (e) { fallo(res, e); }
  });
  app.post("/api/supervision/fallas/:id/resolver", requiereLogin, atiende, async (req, res) => {
    try {
      const falla = fallaVisible(req, req.params.id);
      if (falla.responsable_id !== req.usuarioToken.id) throw new Error("Solo el responsable puede resolver esta falla");
      const { archivo, ...datos } = req.body || {};
      res.json(conAtrasada(await conFoto(falla.sucursal_id, archivo, "resuelta", (foto) =>
        S.resolverFalla(DB, falla.id, datos, req.usuarioToken, foto))));
    } catch (e) { fallo(res, e); }
  });
  app.post("/api/supervision/fallas/:id/reasignar", requiereLogin, realiza, (req, res) => {
    try {
      const falla = fallaDeOtro(req, req.params.id);
      res.json(conAtrasada(S.reasignarFalla(DB, falla.id, req.body || {}, req.usuarioToken)));
    } catch (e) { fallo(res, e); }
  });
  app.post("/api/supervision/fallas/:id/cancelar", requiereLogin, realiza, (req, res) => {
    try {
      const falla = fallaDeOtro(req, req.params.id);
      res.json(conAtrasada(S.cancelarFalla(DB, falla.id, req.body || {}, req.usuarioToken)));
    } catch (e) { fallo(res, e); }
  });
};
