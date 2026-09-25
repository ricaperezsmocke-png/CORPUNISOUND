function coleccionDeLista(lista) {
  if (lista === "marcas") return "objetivo_marcas";
  if (lista === "productos") return "objetivo_productos";
  throw new Error("La lista debe ser marcas o productos");
}

function listarElementos(DB, lista, { incluirInactivos = false } = {}) {
  const elementos = DB.pos[coleccionDeLista(lista)] || [];
  return elementos.filter((elemento) => incluirInactivos || elemento.activo);
}

function nombreComparable(nombre) {
  return nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

function altaElemento(DB, lista, { nombre }, usuario) {
  const coleccion = coleccionDeLista(lista);
  const elementos = DB.pos[coleccion] || [];
  if (typeof nombre !== "string" || !nombre.trim() || nombre.trim().length > 60) {
    throw new Error("El nombre debe tener entre 1 y 60 caracteres");
  }
  const nombreFinal = nombre.trim();
  const comparable = nombreComparable(nombreFinal);
  if (elementos.some((item) => item.activo && nombreComparable(item.nombre) === comparable)) {
    throw new Error("Ya existe un elemento activo con ese nombre en esta lista");
  }
  const elemento = {
    id: elementos.reduce((maximo, item) => Math.max(maximo, item.id), 0) + 1,
    nombre: nombreFinal,
    activo: true,
    creado_por: usuario?.nombre || "desconocido",
    creado_en: new Date().toISOString(),
    desactivado_por: null,
    desactivado_en: null,
    motivo_desactivacion: null,
  };
  elementos.push(elemento);
  DB.pos[coleccion] = elementos;
  return elemento;
}

function desactivarElemento(DB, lista, id, { motivo }, usuario) {
  const elementos = DB.pos[coleccionDeLista(lista)] || [];
  const elemento = elementos.find((item) => item.id === Number(id));
  if (!elemento) throw new Error("El elemento no existe");
  if (!elemento.activo) throw new Error("El elemento ya está desactivado");
  if (typeof motivo !== "string" || !motivo.trim()) {
    throw new Error("Desactivar requiere un motivo; no puede estar vacío");
  }
  elemento.activo = false;
  elemento.desactivado_por = usuario?.nombre || "desconocido";
  elemento.desactivado_en = new Date().toISOString();
  elemento.motivo_desactivacion = motivo.trim();
  return elemento;
}

function elementoActivo(DB, lista, id) {
  return listarElementos(DB, lista).find((elemento) => elemento.id === Number(id)) || null;
}

module.exports = { listarElementos, altaElemento, desactivarElemento, elementoActivo };
