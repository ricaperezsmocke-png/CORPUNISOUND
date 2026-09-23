export async function leerArchivoComoBase64(file) {
  if (!file || file.size === 0) throw new Error("Adjunta una foto en JPG o PNG");
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    throw new Error("Tipo de archivo no permitido: solo JPG o PNG");
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("El archivo no puede pesar más de 10 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const partes = [];
  // Convertir por bloques evita exceder el límite de argumentos con fotos grandes.
  for (let inicio = 0; inicio < bytes.length; inicio += 32768) {
    partes.push(String.fromCharCode(...bytes.subarray(inicio, inicio + 32768)));
  }
  return { nombre_archivo: file.name, tipo_mime: file.type, contenido_base64: btoa(partes.join("")) };
}

export function avanceActividad({ meta, declaradas }) {
  return {
    porcentaje: meta > 0 ? Math.round(declaradas / meta * 100) : 0,
    faltan: Math.max(0, meta - declaradas),
  };
}
