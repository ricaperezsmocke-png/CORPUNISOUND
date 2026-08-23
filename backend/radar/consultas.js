const { normalizarRadarDemanda, copiar, texto } = require("./modelo");

function estaDentroDeAlcance(registro, alcance) {
  if (!alcance || alcance.verTodas === true) return true;
  return Number(registro.sucursal_id) === Number(alcance.sucursalId);
}

function buscarRegistro(DB, id, alcance) {
  const radar = normalizarRadarDemanda(DB);
  const registro = radar.registros.find((item) => item.id === Number(id));
  if (!registro || !estaDentroDeAlcance(registro, alcance)) {
    throw new Error("Demanda no encontrada");
  }
  return registro;
}

function listarDemandas(DB, alcance, filtros = {}) {
  let lista = normalizarRadarDemanda(DB).registros.filter((item) => estaDentroDeAlcance(item, alcance));
  if (filtros.estado) lista = lista.filter((item) => item.estado === filtros.estado);
  if (filtros.motivo_no_venta) {
    lista = lista.filter((item) => item.motivo_no_venta === filtros.motivo_no_venta);
  }
  if (filtros.vendedor_id != null && filtros.vendedor_id !== "") {
    lista = lista.filter((item) => item.vendedor_id === Number(filtros.vendedor_id));
  }
  if (filtros.cliente_id != null && filtros.cliente_id !== "") {
    lista = lista.filter((item) => item.cliente_id === Number(filtros.cliente_id));
  }
  if (filtros.producto_id != null && filtros.producto_id !== "") {
    lista = lista.filter((item) => item.producto_id === Number(filtros.producto_id));
  }
  if (filtros.fecha_inicio) lista = lista.filter((item) => item.fecha_registro >= filtros.fecha_inicio);
  if (filtros.fecha_fin) lista = lista.filter((item) => item.fecha_registro <= filtros.fecha_fin);
  if (filtros.texto) {
    const buscado = texto(filtros.texto).toLocaleLowerCase("es");
    lista = lista.filter((item) => [
      item.producto_nombre_registrado, item.producto_sku_registrado,
      item.producto_buscado, item.marca_solicitada, item.modelo_solicitado,
      item.variante_solicitada, item.nombre_contacto, item.telefono_contacto,
    ].some((valor) => texto(valor).toLocaleLowerCase("es").includes(buscado)));
  }
  return copiar(lista.sort((a, b) => b.fecha_registro.localeCompare(a.fecha_registro) || b.id - a.id));
}

function obtenerDemanda(DB, id, alcance) {
  return copiar(buscarRegistro(DB, id, alcance));
}

function listarVentasCandidatas(DB, demanda, filtros = {}) {
  const limiteSolicitado = Number(filtros.limite);
  const limite = Number.isInteger(limiteSolicitado) && limiteSolicitado > 0
    ? Math.min(limiteSolicitado, 100) : 50;
  const textoBuscado = texto(filtros.texto).toLocaleLowerCase("es");

  for (const campo of ["fecha_inicio", "fecha_fin"]) {
    if (!filtros[campo]) continue;
    const valor = texto(filtros[campo]);
    const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    const fecha = partes && new Date(`${valor}T00:00:00.000Z`);
    if (!partes || Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
      throw new Error(`${campo} debe ser una fecha válida con formato YYYY-MM-DD`);
    }
  }

  let ventas = (DB.pos?.ventas || []).filter(
    (venta) => Number(venta.sucursal_id) === Number(demanda.sucursal_id)
  );
  if (filtros.fecha_inicio) ventas = ventas.filter((venta) => texto(venta.fecha) >= texto(filtros.fecha_inicio));
  if (filtros.fecha_fin) ventas = ventas.filter((venta) => texto(venta.fecha) <= texto(filtros.fecha_fin));
  if (textoBuscado) {
    ventas = ventas.filter((venta) => {
      const cliente = (DB.crm?.clientes || []).find((item) => item.id === Number(venta.cliente_id));
      return String(venta.id).includes(textoBuscado)
        || texto(cliente?.nombre).toLocaleLowerCase("es").includes(textoBuscado);
    });
  }

  return ventas
    .sort((a, b) => texto(b.fecha).localeCompare(texto(a.fecha)) || Number(b.id) - Number(a.id))
    .slice(0, limite)
    .map((venta) => {
      const cliente = (DB.crm?.clientes || []).find((item) => item.id === Number(venta.cliente_id));
      const vendedor = (DB.pos?.vendedores || []).find((item) => item.id === Number(venta.vendedor_id));
      return {
        id: venta.id,
        fecha: venta.fecha || null,
        total: Number(venta.total) || 0,
        cliente_id: venta.cliente_id ?? null,
        cliente_nombre: cliente?.nombre || "Público en General",
        vendedor_id: venta.vendedor_id ?? null,
        vendedor_nombre: vendedor?.nombre || null,
      };
    });
}

module.exports = {
  estaDentroDeAlcance,
  buscarRegistro,
  listarDemandas,
  obtenerDemanda,
  listarVentasCandidatas,
};
