export function validarTienda(datos, sucursales = []) {
  let { nombre, ciudad } = datos;
  const { lat, lng } = datos;
  const limpios = {};
  for (const [campo, valor] of [["nombre", nombre], ["ciudad", ciudad]]) {
    if (typeof valor !== "string") throw new Error(`El campo ${campo} es obligatorio y debe ser texto`);
    const limpio = valor.replace(/\p{Cf}/gu, "").replace(/[\s\p{White_Space}]+/gu, " ").trim();
    if (!/[\p{L}\p{N}]/u.test(limpio)) {
      throw new Error(campo === "nombre"
        ? "El nombre de la tienda debe tener letras o números"
        : "La ciudad de la tienda debe tener letras o números");
    }
    if (limpio.length > 60) throw new Error(`El campo ${campo} no puede exceder 60 caracteres`);
    limpios[campo] = limpio;
  }
  ({ nombre, ciudad } = limpios);
  const normalizar = (texto) => texto.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "")
    .toLowerCase().replace(/[\s\p{White_Space}]/gu, "");
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

export async function leerRespuestaAlta(respuesta) {
  let datos;
  try { datos = await respuesta.json(); }
  catch { throw new Error("No se pudo crear la tienda"); }
  if (!respuesta.ok) throw new Error(datos?.error || "No se pudo crear la tienda");
  return datos;
}
