# REGLA PERMANENTE Y OBLIGATORIA: Todo módulo y botón pasa por Roles y Personal

**Esta regla NO es opcional. El backend tiene un guardia
(`backend/validarPermisos.js`) que se ejecuta al arrancar y BLOQUEA el
arranque si un módulo o permiso no está bien registrado para Roles y
Personal. Si no se cumple la regla, el sistema no levanta.**

---

## El principio

Ningún botón, atajo de teclado, acción o módulo se agrega "suelto". Cada
uno nace con su permiso registrado en el catálogo central, para que desde
el módulo **Roles y Personal** se pueda permitir o denegar a cualquier rol,
en cualquier momento, sin tocar código.

Si construyes un módulo nuevo (como pasó con Corte de Caja) y NO lo
registras correctamente, dos cosas fallan:
- El módulo no aparece como sección en Roles y Personal.
- Sus botones no aparecen para dar o cerrar acceso.

Este documento + el validador impiden que eso vuelva a pasar.

---

## El guardia automático (por qué ya no se puede "olvidar")

`backend/validarPermisos.js` corre al arrancar el backend y verifica:

1. Cada módulo del sistema está registrado en `MODULOS_SISTEMA`
   (permisosCatalogo.js) -> si no, no aparecería como sección en Roles.
2. Cada módulo tiene AL MENOS un permiso en el catálogo -> si no, en Roles
   aparecería vacío, sin botones que activar/desactivar.
3. Cada permiso apunta a un módulo que existe -> si no, quedaría huérfano.
4. No hay claves de permiso duplicadas.

Si algo falla, el backend imprime exactamente qué falta y NO levanta. Hay
que corregirlo para poder trabajar. Esto hace la regla obligatoria de
verdad, no solo una recomendación en un documento.

---

## Checklist obligatorio para CADA módulo o botón nuevo

### Al crear un MÓDULO nuevo (ej: Corte de Caja, Reportes, Compras...)

1. **Registrar el módulo** en `backend/permisosCatalogo.js` -> `MODULOS_SISTEMA`:
   { id: "mi_modulo", nombre: "Nombre visible en Roles" }
2. **Agregarlo al validador** en `backend/validarPermisos.js` ->
   `MODULOS_QUE_REQUIEREN_PERMISOS`.
3. **Crear al menos un permiso** con ese módulo (ver checklist de botón).
4. **Darlo a los roles seed** que deban verlo en `backend/roles.js`
   (campo modulos: [...]), y si la base es persistida (SQLite), migrar
   los roles ya sembrados.
5. **En el Dashboard** (src/Dashboard.jsx), si el módulo tiene su propio
   ícono, agregarlo a MODULOS con su modulo y, si aplica, un permiso
   específico para que solo lo vean quienes lo tengan.

### Al crear un BOTÓN o acción nueva (en cualquier módulo)

1. **Registrar el permiso** en `backend/permisosCatalogo.js` -> PERMISOS:
   { clave: "verbo_sustantivo", etiqueta: "Texto visible", modulo: "el_modulo", implementado: true }
   - clave: snake_case, empieza con verbo (crear_, editar_, eliminar_,
     ver_, exportar_, cancelar_, realizar_...).
   - modulo: debe ser uno de los de MODULOS_SISTEMA.
   - implementado: false si el botón existe pero su sistema aún no.

2. **Decidir qué roles seed lo reciben** en backend/roles.js.
   Migración una-sola-vez si la base ya está sembrada (SQLite).

3. **Proteger la ruta del backend** en server.js:
   app.post("/api/...", requiereLogin, requierePermiso("clave", resolverPermisosDeRol), ...)
   REGLA DE ORO: el frontend oculta, pero el backend es quien de verdad
   niega. Un botón oculto sin 403 en el backend es un hueco de seguridad.

4. **Gatear el botón en el frontend**:
   - El componente recibe permisos como prop (desde App.jsx).
   - Helper: const puede = (clave) => !permisos || permisos.includes(clave);
   - Botón: {puede("clave") && <Boton ... />}
   - Atajo de teclado equivalente: mismo puede().

5. **Probar con un rol limitado**: sin el permiso -> no ve el botón Y recibe
   403 si llama la ruta directo. Con el permiso -> funciona.

---

## Anti-patrones que NO se aceptan

- Módulo nuevo sin registrar en MODULOS_SISTEMA -> no aparece en Roles.
  (Esto es lo que pasó con Corte de Caja; este documento+validador lo arregla.)
- Botón visible para todos "porque el backend ya lo bloquea" -> ocultar
  además de bloquear.
- Botón oculto sin protección de backend -> seguridad de papel.
- Permiso hardcodeado sin registrarlo en el catálogo -> no aparece en Roles.
- Reusar un permiso existente para una acción distinta -> después no se
  puede separar quién puede qué.

---

## Estado actual (auditoría julio 2026)

Módulos registrados: pos, corte, inventario, crm, admin.
Corte de Caja ahora es su propio módulo (antes estaba mezclado en "pos",
por eso no aparecía como sección propia en Roles y Personal).
El validador de arranque está activo en server.js.
