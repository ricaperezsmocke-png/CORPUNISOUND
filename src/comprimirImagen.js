/**
 * comprimirImagen.js — Reduce la foto del comprobante ANTES de subirla.
 *
 * Una foto de celular moderno pesa varios MB. Sobre el internet de una tienda
 * eso son decenas de segundos por gasto, con la cajera esperando. Reescalar a
 * 1600 px de lado largo y recomprimir a JPEG al 80% deja un ticket térmico o
 * una factura perfectamente legibles y baja el archivo a unos cientos de KB.
 *
 * Decisiones deliberadas:
 * - Los PDF NO se tocan: ya vienen comprimidos y recomprimirlos los degrada.
 * - Nunca se AGRANDA una imagen que ya sea más chica que el límite.
 * - Si el resultado pesara más que el original (pasa con capturas de pantalla
 *   y con PNG de pocos colores), se conserva el original.
 * - Se decodifica con `imageOrientation: "from-image"` porque las fotos de
 *   celular traen la rotación en los metadatos EXIF; sin eso el comprobante
 *   se sube acostado.
 */

const LADO_MAXIMO = 1600;
const CALIDAD = 0.8;
const COMPRIMIBLES = ["image/jpeg", "image/png"];

/** Cambia la extensión del nombre a .jpg, conservando el resto. */
function nombreComoJpg(nombre) {
  return nombre.replace(/\.[^.]+$/, "") + ".jpg";
}

export async function comprimirImagen(archivo, opciones = {}) {
  const ladoMaximo = opciones.ladoMaximo || LADO_MAXIMO;
  const calidad = opciones.calidad || CALIDAD;

  if (!archivo || !COMPRIMIBLES.includes(archivo.type)) return archivo;

  let bitmap;
  try {
    bitmap = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  } catch {
    return archivo; // si el navegador no puede decodificarla, se sube tal cual
  }

  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);

  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext("2d");
  // Fondo blanco: un PNG con transparencia quedaría negro al pasar a JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close?.();

  const blob = await new Promise((resolve) =>
    lienzo.toBlob(resolve, "image/jpeg", calidad)
  );
  if (!blob || blob.size >= archivo.size) return archivo;

  return new File([blob], nombreComoJpg(archivo.name), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}
