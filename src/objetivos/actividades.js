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

const ETIQUETAS_CORTAS = { grupos: "Grupos", marketplace: "Marketplace", iglesia: "Iglesia", volanteo: "Volanteo" };

export function lineaAvanceActividades({ catalogo, metas, vendedorId, resumen, registros }) {
  return catalogo.flatMap(({ clave }) => {
    const reparto = metas.find((item) => item.actividad === clave);
    const linea = reparto?.lineas.find((item) => Number(item.vendedor_id) === Number(vendedorId));
    const meta = linea?.monto ?? 0;
    if (!(meta > 0) && !registros.some((item) => item.actividad === clave)) return [];
    const declaradas = resumen.find((item) => item.actividad === clave)?.declaradas ?? 0;
    return [{ clave, corta: ETIQUETAS_CORTAS[clave], declaradas, meta }];
  });
}

export const ultimoResultado = (registro) => registro.resultados.at(-1) || null;

export const declaradasEnTienda = (datos, actividad) =>
  datos?.resumen_tienda.find((item) => item.actividad === actividad)?.declaradas ?? null;

export function presentacionMetaActividad(reparto, datos) {
  const declaradas = declaradasEnTienda(datos, reparto.actividad);
  return { declaradas, inactiva: reparto.meta_tienda === 0 && declaradas === 0 };
}

export function declaradasPorPersona(datos, vendedorId, actividad) {
  if (!datos) return null;
  const persona = datos.resumen_por_persona.find((item) => Number(item.vendedor_id) === Number(vendedorId));
  return persona?.resumen.find((item) => item.actividad === actividad)?.declaradas ?? 0;
}

export function avanceActividad({ meta, declaradas }) {
  return {
    porcentaje: meta > 0 ? Math.round(declaradas / meta * 100) : 0,
    faltan: Math.max(0, meta - declaradas),
  };
}
