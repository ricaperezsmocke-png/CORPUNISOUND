/**
 * validarPermisos.js — Guardia de arranque del sistema de permisos.
 *
 * REGLA DE ORO DEL PROYECTO UNISOUND:
 * Todo módulo y todo botón con acción debe ser administrable desde
 * "Roles y Personal". Este archivo lo hace OBLIGATORIO de verdad: se
 * ejecuta al arrancar el backend y, si detecta un módulo o permiso que
 * no está bien registrado, DETIENE el arranque con un error claro.
 *
 * Así es imposible "olvidar" registrar un permiso: el sistema no levanta
 * hasta que se corrija. Ver CONVENCION-PERMISOS.md para el checklist.
 */

const { listarPermisos, listarModulosSistema } = require("./permisosCatalogo");

/**
 * Cada módulo del sistema que se registra aquí DEBE tener al menos un
 * permiso en el catálogo. Cuando se crea un módulo nuevo, se agrega su id
 * a esta lista — y si no tiene permisos asociados, el backend no arranca.
 *
 * Esta lista es la "fuente de verdad" de qué módulos existen. Agregar un
 * módulo al sistema sin agregarlo aquí (o agregarlo aquí sin darle
 * permisos) es exactamente lo que este guardia impide.
 */
const MODULOS_QUE_REQUIEREN_PERMISOS = [
  "pos",
  "corte",
  "inventario",
  "crm",
  "admin",
  "ml",
  "reportes",
];

function validarSistemaDePermisos() {
  const permisos = listarPermisos();
  const modulosCatalogo = listarModulosSistema();
  const errores = [];

  // 1. Cada módulo que requiere permisos debe existir en MODULOS_SISTEMA
  //    (para que aparezca como sección en la pantalla de Roles).
  for (const modId of MODULOS_QUE_REQUIEREN_PERMISOS) {
    const existe = modulosCatalogo.some((m) => m.id === modId);
    if (!existe) {
      errores.push(`El módulo "${modId}" no está registrado en MODULOS_SISTEMA (permisosCatalogo.js) — no aparecería como sección en Roles y Personal.`);
    }
  }

  // 2. Cada módulo que requiere permisos debe tener AL MENOS un permiso
  //    en el catálogo (si no, en Roles aparecería vacío, sin botones que
  //    activar o desactivar).
  for (const modId of MODULOS_QUE_REQUIEREN_PERMISOS) {
    const tienePermisos = permisos.some((p) => p.modulo === modId);
    if (!tienePermisos) {
      errores.push(`El módulo "${modId}" no tiene ningún permiso en el catálogo — en Roles y Personal aparecería sin botones para dar/cerrar acceso. Agrega al menos un permiso con modulo: "${modId}" en permisosCatalogo.js.`);
    }
  }

  // 3. Cada permiso debe apuntar a un módulo que exista en MODULOS_SISTEMA
  //    (si no, ese permiso quedaría "huérfano" y no se mostraría agrupado
  //    en ninguna sección de Roles).
  for (const p of permisos) {
    const moduloExiste = modulosCatalogo.some((m) => m.id === p.modulo);
    if (!moduloExiste) {
      errores.push(`El permiso "${p.clave}" apunta al módulo "${p.modulo}", que no existe en MODULOS_SISTEMA — no se mostraría en ninguna sección de Roles y Personal.`);
    }
  }

  // 4. Claves duplicadas (dos permisos con la misma clave rompen el gating).
  const vistas = new Set();
  for (const p of permisos) {
    if (vistas.has(p.clave)) {
      errores.push(`El permiso "${p.clave}" está duplicado en el catálogo — cada clave debe ser única.`);
    }
    vistas.add(p.clave);
  }

  if (errores.length > 0) {
    console.error("\n╔══════════════════════════════════════════════════════════════╗");
    console.error("║  ⛔ ARRANQUE BLOQUEADO — sistema de permisos incompleto        ║");
    console.error("╚══════════════════════════════════════════════════════════════╝\n");
    console.error("La regla del proyecto (CONVENCION-PERMISOS.md) exige que todo");
    console.error("módulo y botón sea administrable desde Roles y Personal.\n");
    console.error("Se encontraron estos problemas:\n");
    errores.forEach((e, i) => console.error(`  ${i + 1}. ${e}\n`));
    console.error("Corrige lo anterior en backend/permisosCatalogo.js y vuelve a arrancar.");
    console.error("El backend NO levantará hasta que esto se resuelva.\n");
    throw new Error("Validación del sistema de permisos falló — ver detalles arriba.");
  }

  console.log(`✓ Sistema de permisos validado: ${modulosCatalogo.length} módulos, ${permisos.length} permisos, todo administrable desde Roles y Personal.`);
}

module.exports = { validarSistemaDePermisos, MODULOS_QUE_REQUIEREN_PERMISOS };
