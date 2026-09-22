/**
 * seccionesCompras.js — En qué parte de la pantalla cae cada fila.
 *
 * Esto vivía suelto dentro de la pantalla, en cuatro filtros escritos uno al
 * lado del otro, y así fue posible que una fila no cayera en NINGUNO: al
 * marcar un producto como "ya lo pedí" pasaba a "observar", pero la sección de
 * observar solo muestra contradicciones, así que la fila desaparecía de la
 * pantalla entera. Con ella se iba el botón para quitar la marca: se podía
 * silenciar un producto y ya no había forma de volver a verlo.
 *
 * Aquí el reparto es una sola función que se puede probar: toda fila cae en
 * alguna sección, y una fila silenciada tiene su propio lugar donde consultarla
 * y devolverla a la lista de compras.
 */

/** Situaciones que se contradicen entre sí y hay que mirar antes de decidir. */
export const CONTRADICCIONES = new Set([
  "RADAR_SIN_EXISTENCIA_PERO_HAY_STOCK", "DEMANDA_CON_STOCK_PERO_SIN_VENTAS",
  "PRODUCTO_INACTIVO_CON_DEMANDA", "DEMANDA_CONCENTRADA_UN_CONTACTO",
  "STOCK_SOBRE_MAXIMO", "TRASPASO_ENTRANTE_CUBRE_MINIMO",
]);

export const estaMarcadaComoPedida = (fila) => fila?.pedido_proveedor?.marcado === true;

const esContradiccion = (fila) => fila.clasificacion === "EVIDENCIA_INSUFICIENTE"
  || (fila.clasificacion === "OBSERVAR" && (fila.razones || []).some((r) => CONTRADICCIONES.has(r)));

/**
 * Reparte las oportunidades en las secciones de la pantalla.
 *
 * Las ya pedidas se sacan primero: son un estado legítimo —alguien dijo que la
 * mercancía viene en camino—, no una contradicción, y mezclarlas con los
 * problemas haría ruido en las dos listas.
 */
export function repartirOportunidades(oportunidades = []) {
  const yaPedidas = oportunidades.filter(estaMarcadaComoPedida);
  const resto = oportunidades.filter((fila) => !estaMarcadaComoPedida(fila));
  return {
    yaPedidas,
    prioritarias: resto.filter((f) => ["REVISAR_TRASPASO", "REVISAR_COMPRA"].includes(f.clasificacion)),
    compras: resto.filter((f) => f.clasificacion === "REVISAR_COMPRA"),
    traspasos: resto.filter((f) => f.clasificacion === "REVISAR_TRASPASO"),
    observar: resto.filter(esContradiccion),
  };
}

/** Ninguna fila puede quedarse sin sección: eso es lo que falló antes. */
export function filasSinSeccion(oportunidades = []) {
  const s = repartirOportunidades(oportunidades);
  const visibles = new Set([...s.yaPedidas, ...s.prioritarias, ...s.compras, ...s.traspasos, ...s.observar]);
  return oportunidades.filter((fila) => !visibles.has(fila));
}
