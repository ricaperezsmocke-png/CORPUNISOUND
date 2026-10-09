// Rutas de metas personalizadas. El vendedor sale SIEMPRE de la cuenta, nunca del cuerpo:
// nadie captura a nombre de otro. Lo de otra tienda responde 404, igual que en Objetivos.
const M = require("./metasPersonalizadas");
const { capturarMeta, anularCaptura, capturaParaRespuesta } = require("./metasCapturas");
const { tablero } = require("./metasAvance");
const { previoSello, sellarPeriodo, rectificarSello } = require("./metasSellos");
const { fechaLocal } = require("./fechas");

module.exports = function registrarRutasMetas(app, deps) {
  const { DB, drive, requiereLogin, requierePermiso, resolverPermisosDeRol, resolverAlcanceAutorizado, vendedorLigadoAObjetivos, idDeObjetivos } = deps;
  const permiso = (clave) => requierePermiso(clave, resolverPermisosDeRol);
  const admin = permiso("administrar_metas_personalizadas");
  const uso = permiso("usar_gerente_ventas");
  const tiene = (req, clave) => resolverPermisosDeRol(req.usuarioToken.rol_id).includes(clave);
  const hoy = () => fechaLocal(new Date());
  const responder = (res, fn) => { try { res.json(fn()); } catch (e) { res.status(400).json({ error: e.message }); } };
  const opcional = (valor, campo) => (valor === undefined || valor === "" ? null : idDeObjetivos(valor, campo));
  const clave = (req) => idDeObjetivos(req.params.clave, "clave");
  const periodoDe = (fuente) => ({ periodo: fuente?.periodo, inicio: fuente?.inicio });

  function visorDe(req) {
    const { verTodas, sucursalId } = resolverAlcanceAutorizado(req);
    const jefatura = tiene(req, "administrar_metas_personalizadas") || tiene(req, "anular_capturas_metas");
    return { vendedor_id: vendedorLigadoAObjetivos(req), jefatura, verTodas, sucursalId };
  }

  // Alcance de jefatura sobre una captura: su tienda; las de metas de empresa, solo quien ve todas.
  function capturaEnAlcance(req, captura) {
    const { verTodas, sucursalId } = resolverAlcanceAutorizado(req);
    if (verTodas) return true;
    const meta = DB.pos.metas_personalizadas.find((m) => m.clave === captura.meta_clave);
    return meta?.alcance !== "empresa" && captura.sucursal_id === sucursalId;
  }

  app.get("/api/metas/tablero", requiereLogin, uso, (req, res) => responder(res, () => tablero(DB, visorDe(req), {
    ...periodoDe(req.query), sucursal_id: opcional(req.query.sucursal_id, "sucursal_id"),
    vendedor_id: opcional(req.query.vendedor_id, "vendedor_id"),
  }, hoy())));

  app.get("/api/metas/admin", requiereLogin, admin, (req, res) => responder(res, () => {
    const delPeriodo = (r) => r.periodo === req.query.periodo && r.inicio === req.query.inicio;
    return { okrs: DB.pos.okrs.filter(delPeriodo), metas: DB.pos.metas_personalizadas.filter(delPeriodo) };
  }));

  app.get("/api/metas/revision", requiereLogin, permiso("anular_capturas_metas"), (req, res) => responder(res, () =>
    DB.pos.meta_capturas
      .filter((c) => c.periodo === req.query.periodo && c.inicio === req.query.inicio && capturaEnAlcance(req, c))
      .map((c) => ({
        ...capturaParaRespuesta(c),
        vendedor_nombre: DB.pos.vendedores.find((v) => v.id === c.vendedor_id)?.nombre || "desconocido",
        meta_nombre: M.historial(DB, "metas_personalizadas", c.meta_clave).at(-1)?.nombre || "desconocida",
      }))));

  app.get("/api/metas/sello", requiereLogin, admin, (req, res) => {
    const sello = DB.pos.meta_sellos.find((s) => s.periodo === req.query.periodo && s.inicio === req.query.inicio);
    if (!sello) return res.status(404).json({ error: "Sello no encontrado" });
    // La foto guarda las capturas completas; el id interno del archivo en Drive no sale.
    res.json({ ...sello, foto: { ...sello.foto, capturas: sello.foto.capturas.map(capturaParaRespuesta) } });
  });
  app.get("/api/metas/sello/previo", requiereLogin, admin, (req, res) => responder(res, () => previoSello(DB, periodoDe(req.query), hoy())));
  app.post("/api/metas/sello", requiereLogin, admin, (req, res) => responder(res, () =>
    sellarPeriodo(DB, periodoDe(req.body), req.usuarioToken, hoy())));
  app.post("/api/metas/sello/:id/rectificar", requiereLogin, admin, (req, res) => responder(res, () =>
    rectificarSello(DB, idDeObjetivos(req.params.id, "id"), req.body || {}, req.usuarioToken)));

  app.post("/api/metas/okr", requiereLogin, admin, (req, res) => responder(res, () => M.crearOkr(DB, req.body || {}, req.usuarioToken)));
  app.post("/api/metas/okr/:clave/editar", requiereLogin, admin, (req, res) => responder(res, () =>
    M.editarOkr(DB, clave(req), req.body || {}, req.usuarioToken)));
  app.post("/api/metas/okr/:clave/retirar", requiereLogin, admin, (req, res) => responder(res, () =>
    M.retirarOkr(DB, clave(req), req.body?.motivo, req.usuarioToken)));

  app.post("/api/metas/captura/:id/anular", requiereLogin, uso, (req, res) => {
    try {
      const id = idDeObjetivos(req.params.id, "id");
      const captura = DB.pos.meta_capturas.find((c) => c.id === id);
      const propia = captura && captura.vendedor_id === vendedorLigadoAObjetivos(req);
      const jefatura = captura && tiene(req, "anular_capturas_metas") && capturaEnAlcance(req, captura);
      if (!captura || (!propia && !jefatura)) return res.status(404).json({ error: "Captura no encontrada" });
      res.json(capturaParaRespuesta(anularCaptura(DB, id, req.body?.motivo, req.usuarioToken)));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/metas", requiereLogin, admin, (req, res) => responder(res, () => M.crearMeta(DB, req.body || {}, req.usuarioToken)));
  app.post("/api/metas/:clave/editar", requiereLogin, admin, (req, res) => responder(res, () =>
    M.editarMeta(DB, clave(req), req.body || {}, req.usuarioToken)));
  app.post("/api/metas/:clave/retirar", requiereLogin, admin, (req, res) => responder(res, () =>
    M.retirarMeta(DB, clave(req), req.body?.motivo, req.usuarioToken)));
  app.get("/api/metas/:clave/historial", requiereLogin, admin, (req, res) => responder(res, () =>
    M.historial(DB, "metas_personalizadas", clave(req))));

  app.post("/api/metas/:clave/captura", requiereLogin, uso, async (req, res) => {
    try {
      const captura = await capturarMeta(DB, clave(req), req.body || {}, {
        usuario: req.usuarioToken, vendedor_id: vendedorLigadoAObjetivos(req), drive,
      });
      res.json(capturaParaRespuesta(captura));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
};
