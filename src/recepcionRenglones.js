// Renglones de Recepción de Compras. Cada renglón lleva su propia identidad (`uid`): una factura
// puede traer el mismo producto en dos renglones (3 piezas a un costo y 5 a otro) y los dos deben
// recibirse. Antes se buscaba el renglón por producto y el segundo pisaba al primero: se recibían 5
// en vez de 8 y la existencia quedaba corta.

let siguiente = 0;
export const nuevoUid = () => `r${Date.now().toString(36)}-${(siguiente += 1)}`;

export const conUid = (renglon) => (renglon.uid ? renglon : { ...renglon, uid: nuevoUid() });

// Lo importado de una factura (XML o IA) entra completo, un renglón por concepto. Si ese producto
// ya estaba capturado a mano, lo capturado se reemplaza por lo de la factura (comportamiento previo).
export function incorporarImportados(previos, importados) {
  const productos = new Set(importados.map((r) => r.producto_id));
  return [...previos.filter((r) => !productos.has(r.producto_id)), ...importados.map(conUid)];
}

// Captura manual de un artículo: si se estaba editando un renglón concreto, se reemplaza ese; si no,
// se agrega como renglón nuevo.
export function guardarManual(renglones, renglon, uidEditado) {
  if (uidEditado && renglones.some((r) => r.uid === uidEditado)) {
    return renglones.map((r) => (r.uid === uidEditado ? { ...renglon, uid: uidEditado } : r));
  }
  return [...renglones, conUid(renglon)];
}

export const cambiarRenglon = (renglones, uid, cambio) =>
  renglones.map((r) => (r.uid === uid ? { ...r, ...cambio(r) } : r));

export const quitarPorUid = (renglones, uid) => renglones.filter((r) => r.uid !== uid);

export const piezasTotales = (renglones, productoId) =>
  renglones.filter((r) => r.producto_id === productoId).reduce((suma, r) => suma + Number(r.cantidad), 0);
