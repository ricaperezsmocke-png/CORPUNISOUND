export function validarTienda(datos, sucursales = []) {
  const { nombre, ciudad, lat, lng } = datos;
  for (const [campo, valor] of [["nombre", nombre], ["ciudad", ciudad]]) {
    if (typeof valor !== "string" || !valor.trim()) throw new Error(`El campo ${campo} es obligatorio y debe ser texto`);
    if (valor.trim().length > 60) throw new Error(`El campo ${campo} no puede exceder 60 caracteres`);
  }
  const normalizar = (texto) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
  const existente = sucursales.find((s) => normalizar(s.nombre) === normalizar(nombre));
  if (existente) throw new Error(`Ya existe una tienda con ese nombre: ${existente.nombre}`);
  if ([lat, lng].some((valor) => valor == null || (typeof valor === "string" && !valor.trim()))) {
    throw new Error("Captura la ubicación GPS de la tienda (latitud y longitud)");
  }
  for (const [campo, valor, limite] of [["latitud", lat, 90], ["longitud", lng, 180]]) {
    if (!["number", "string"].includes(typeof valor) || !Number.isFinite(Number(valor)) || Math.abs(Number(valor)) > limite) {
      throw new Error(`La ${campo} debe ser un número entre ${-limite} y ${limite}`);
    }
  }
  return { nombre: nombre.trim(), ciudad: ciudad.trim(), lat: Number(lat), lng: Number(lng) };
}
