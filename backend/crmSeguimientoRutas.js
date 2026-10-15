const { ESTADOS_MANUALES, cambiarEstadoCliente } = require('./crm');

function registrarRutasCRMSeguimiento(app, {
  DB, repoSicar, consultasCRM, contextoCRM, requiereLogin, requierePermiso, resolverPermisosDeRol,
}) {
  app.put('/api/crm/v2/clientes/:ref/estado', requiereLogin,
    requierePermiso('cambiar_estado_cliente', resolverPermisosDeRol), (req, res) => {
      try {
        const ctx = contextoCRM(req);
        const persona = consultasCRM.ficha(ctx, req.params.ref);
        const estado = req.body?.estado;
        if (!ESTADOS_MANUALES.includes(estado)) {
          const error = estado === 'compro'
            ? 'El estado Compró se gana con una venta cerrada, no se asigna a mano'
            : 'El estado no es válido';
          return res.status(400).json({ error });
        }
        if (persona.fuente === 'crm') cambiarEstadoCliente(DB, persona.cliente_id, estado);
        else {
          const [, sucursal, cli_id] = persona.ref.split(':');
          repoSicar.guardarEstadoCliente({ sucursal_id: Number(sucursal), cli_id, estado,
            usuario_id: req.usuarioToken.id, fecha_hora: new Date().toISOString() });
        }
        res.json(consultasCRM.ficha(ctx, persona.ref));
      } catch (e) {
        res.status(e.status || 503).json({ error: e.status ? e.message : 'No se pudo guardar el estado del cliente.' });
      }
    });
}

module.exports = { registrarRutasCRMSeguimiento };
