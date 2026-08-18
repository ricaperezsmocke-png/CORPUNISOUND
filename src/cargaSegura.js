/**
 * cargaSegura.js — Distinguir "no hay datos" de "no se pudo cargar".
 *
 * EL DEFECTO QUE ESTO ARREGLA, repetido en media docena de pantallas:
 *
 *   const r = await apiFetch("/gastos");
 *   if (r.ok) setGastos(await r.json());
 *
 * Cuando esa llamada falla —backend caído, sesión sin permiso, internet de la
 * tienda— el estado se queda en `[]`, y `[]` es exactamente lo que la pantalla
 * pinta cuando de verdad no hay nada. El resultado es una pantalla que dice
 * "No hay gastos registrados" con total seguridad, cuando la verdad es que no
 * sabe. Quien la lee no es programador: cierra el mes creyendo que no hubo
 * gastos, o que nadie le debe, o que sí hay respaldos.
 *
 * Un `[]` que viene de un fallo NO es un dato, es la ausencia de dato, y la
 * pantalla tiene que poder decir cuál de los dos tiene enfrente. Por eso todo
 * lo que sale de aquí trae `datos` Y `error`, y el llamador guarda los dos.
 *
 * El modelo lo fijó GerenciaVentas.jsx (`errorCarga`/`errorEquipo`); esto es lo
 * mismo, pero en un solo lugar para no volver a escribirlo mal.
 *
 * No importa `apiFetch` a propósito: recibe la llamada ya armada. Así este
 * archivo no depende de `import.meta.env` (de Vite) y se puede probar con
 * `node --test` como todo lo demás del repo.
 */

/** Lo que se dice cuando no hubo forma de hablar con el backend. */
export function mensajeSinConexion(queEs) {
  return `No se pudo conectar con el sistema para cargar ${queEs}. ` +
    "Revisa tu internet y vuelve a intentar — esto NO significa que no haya datos.";
}

/** Lo que se dice cuando el backend contestó, pero con un error. */
export function mensajeDeFallo(queEs, detalle) {
  const base = `No se pudo cargar ${queEs}.`;
  const cola = " Lo que ves puede estar incompleto — esto NO significa que no haya datos.";
  return detalle ? `${base} ${detalle}${cola}` : `${base} Intenta recargar la página.${cola}`;
}

/**
 * Pide una LISTA. Devuelve siempre `{ datos, error }`:
 *  - éxito           -> { datos: [...], error: null }
 *  - fallo cualquiera -> { datos: [], error: "explicación en español" }
 *
 * `datos` siempre es un arreglo para que la pantalla pueda pintarlo sin
 * defenderse; el que manda para saber si creerle es `error`.
 *
 * @param {() => Promise<Response>} pedir  la llamada ya armada, ej:
 *                                         () => apiFetch("/gastos")
 * @param {string} queEs  cómo se llama esto EN ESPAÑOL y para el usuario
 *                        ("los gastos", "las sucursales"), no la ruta.
 */
export async function pedirLista(pedir, queEs) {
  try {
    const r = await pedir();
    if (!r.ok) {
      const cuerpo = await r.json().catch(() => ({}));
      return { datos: [], error: mensajeDeFallo(queEs, cuerpo?.error) };
    }
    const datos = await r.json();
    // Una respuesta que no es lista (un `{error}` colado con 200, o un HTML de
    // proxy) reventaba la pantalla en el primer `.map`. Se trata como fallo.
    if (!Array.isArray(datos)) {
      return { datos: [], error: mensajeDeFallo(queEs, "El sistema respondió algo inesperado.") };
    }
    return { datos, error: null };
  } catch (_) {
    return { datos: [], error: mensajeSinConexion(queEs) };
  }
}

/**
 * Igual que `pedirLista` pero para un OBJETO suelto (un resumen, un estado).
 * En el fallo `datos` es null, que es lo que la pantalla ya sabe interpretar
 * como "todavía no hay nada que pintar".
 */
export async function pedirDato(pedir, queEs) {
  try {
    const r = await pedir();
    if (!r.ok) {
      const cuerpo = await r.json().catch(() => ({}));
      return { datos: null, error: mensajeDeFallo(queEs, cuerpo?.error) };
    }
    return { datos: await r.json(), error: null };
  } catch (_) {
    return { datos: null, error: mensajeSinConexion(queEs) };
  }
}
