const { cambiarCuentaInterna } = require('./crmCuentasInternas');

function registrarRutasCRMPerfil(app, {
  DB, repoSicar, consultasCRM, contextoCRM, rutaCRM, requiereLogin, requierePermiso, resolverPermisosDeRol, guardar,
}) {
  app.get('/api/crm/v2/clientes/:ref/que-compra', requiereLogin,
    rutaCRM((ctx, req) => consultasCRM.queCompra(ctx, req.params.ref)));
  app.put('/api/crm/v2/clientes/:ref/cuenta-interna', requiereLogin,
    requierePermiso('marcar_cuenta_interna', resolverPermisosDeRol), (req, res) => {
      try {
        const ficha = cambiarCuentaInterna({ DB, repo: repoSicar, consultas: consultasCRM, guardar },
          contextoCRM(req), req.params.ref, req.body, req.usuarioToken.id);
        // Ya persistido: evitar el guardado automático posterior a res.json.
        res.type('json').send(JSON.stringify(ficha));
      } catch (e) {
        res.status(e.status || 503).json({ error: e.status ? e.message : 'No se pudo guardar la cuenta interna.' });
      }
    });
}
module.exports = { registrarRutasCRMPerfil };
