// Lógica de la ventana del planeador con IA. Nada viene aceptado de entrada: cada punto se decide a mano.
import { etiquetaPeriodo } from "./metas.js";
import { leer } from "../objetivos/datos.js";

export function estadoInicial(plan) {
  const { okr, metas } = plan.propuesta;
  return {
    okr: { decision: null, form: { titulo: okr.titulo, descripcion: okr.descripcion || "" } },
    metas: metas.map((m) => ({ indice: m.indice, decision: null, alcance: "base", vendedor_id: "",
      form: { nombre: m.nombre, unidad: m.unidad, prueba: m.prueba, valor_meta: String(m.valor_meta) } })),
  };
}

const puntos = (estado) => [estado.okr, ...estado.metas];
export const faltanPorDecidir = (estado) => puntos(estado).filter((p) => !p.decision).length;

export function puedeCrear(estado) {
  return faltanPorDecidir(estado) === 0 && puntos(estado).some((p) => p.decision === "aceptar")
    && !errorParaCrear(estado)
    && estado.metas.every((m) => m.decision !== "aceptar" || m.alcance !== "persona" || m.vendedor_id !== "");
}

export function errorParaCrear(estado) {
  for (const [i, meta] of estado.metas.entries()) {
    if (meta.decision !== "aceptar") continue;
    if (!meta.form.nombre.trim()) return `La meta ${i + 1} necesita nombre.`;
    if (!meta.form.unidad.trim()) return `La meta ${i + 1} necesita unidad.`;
    const cifra = Number(meta.form.valor_meta);
    if (!Number.isInteger(cifra) || cifra < 1) return `La meta ${i + 1} (${meta.form.nombre}) necesita una cifra entera mayor que cero.`;
  }
  return "";
}

export async function confirmarPlan(plan, estado, pedir) {
  try {
    const respuesta = await pedir(`/metas/plan-ia/${plan.id}/validar`, { method: "POST", body: JSON.stringify(cuerpoValidacion(plan, estado)) });
    return await leer(respuesta, "No se pudo guardar");
  } catch (error) {
    if (!error.status) {
      try {
        const registro = await pedir("/metas/plan-ia").then((r) => leer(r, "No se pudo consultar el plan"));
        const guardado = registro.planes.find((p) => Number(p.id) === Number(plan.id) && p.estado === "validado");
        if (guardado) return guardado;
      } catch { /* Conserva el error original si tampoco se pudo consultar. */ }
    }
    throw error;
  }
}

function cambios(original, form) {
  const salida = {};
  for (const [campo, valor] of Object.entries(form)) {
    const final = campo === "valor_meta" ? Number(valor) : valor;
    if ((original[campo] ?? "") !== final) salida[campo] = final;
  }
  return salida;
}

export function cuerpoValidacion(plan, estado) {
  return {
    okr: { decision: estado.okr.decision, cambios: cambios(plan.propuesta.okr, estado.okr.form) },
    metas: estado.metas.map((m) => {
      const original = plan.propuesta.metas.find((p) => p.indice === m.indice);
      const comun = { indice: m.indice, decision: m.decision, cambios: cambios(original, m.form), alcance: m.alcance };
      return m.alcance === "persona" ? { ...comun, vendedor_id: Number(m.vendedor_id) } : comun;
    }),
  };
}

export function resumenConfirmacion(plan, estado, nombreDestino) {
  const metas = estado.metas.filter((m) => m.decision === "aceptar").length;
  const partes = [estado.okr.decision === "aceptar" ? "1 OKR" : null, metas ? `${metas} meta${metas === 1 ? "" : "s"}` : null].filter(Boolean);
  return `Vas a crear ${partes.join(" y ")} para ${nombreDestino}, ${etiquetaPeriodo(plan.entrada.periodo, plan.entrada.inicio)}`;
}
