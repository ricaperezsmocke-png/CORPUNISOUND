# CRM seguimiento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para implementar tarea por tarea.

**Goal:** Trabajar clientes SICAR con orden, filtros, estados auditados y WhatsApp.

**Architecture:** Conservar las consultas combinadas y el alcance del token. Guardar seguimiento SICAR en SQLite y respaldarlo junto con las tablas existentes. Registrar una ruta aislada y separar controles de pantalla.

**Tech Stack:** Node test runner, Express, better-sqlite3 y React existentes, sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-10-15-crm-seguimiento-design.md`.

## Global Constraints

- Base real f939396, rama feature/crm-seguimiento, árbol inicialmente limpio.
- Archivos permitidos según despacho; server.js solo registro de ruta (máximo 3 líneas) y filtrosCRM.
- crm.js solo exporta ESTADOS_MANUALES. No tocar CRM.jsx ni archivos de la rama paralela.
- Pruebas siempre `node --preserve-symlinks --preserve-symlinks-main --test ...`.
- No suite completa desde worktree; Claude la ejecuta y hace revisión independiente y navegador.
- No push, merge, rebase, dependencias, render.yaml ni staging global. Commits sin acentos.
- Líneas JS/JSX de máximo 200 caracteres. Texto de UI UTF-8.
- Ante archivo prohibido, regla de negocio sin definir o contradicción con spec: detener y reportar.

## Review Focus

- Fecha imposible o parámetro repetido: rechazar con 400, nunca ampliar silenciosamente el filtro (tarea 3).
- Dos identidades unidas con estados: usar el más reciente sin pisar el estado nativo (tarea 2).
- Fallo entre estado e historial: rollback de ambos (tarea 1).
- Restauración antigua sobre seguimiento existente: vaciar ambos registros nuevos (tarea 4).
- Cambio de ficha mientras hay petición pendiente: no pintar respuesta del cliente anterior (tarea 5).

### Task 1: Persistencia transaccional del seguimiento

**Files:** modificar backend/sicarRepositorio.js y backend/sicarRepositorio.test.js; crear backend/crmSeguimientoRepositorio.test.js.

**Interfaces:** repo.guardarEstadoCliente({ sucursal_id, cli_id, estado, usuario_id, fecha_hora }) guarda estado e historial atómicamente.

- [ ] Escribir pruebas de tablas idempotentes, dos cambios con anterior/nuevo/actor/fecha y rollback ante fallo de historial.
- [ ] Ejecutar archivo de prueba y comprobar rojo por funcionalidad ausente.
- [ ] Crear ambas tablas con claves de identidad y escritura en transacción inmediata; conservar clientes en SQLite.
- [ ] Ejecutar pruebas nuevas y regresiones del repositorio: cero fallos.
- [ ] Commit: `feat: persistir estados SICAR con historial` con rutas explícitas.

### Task 2: Estados visibles y ruta autorizada

**Files:** backend/crmFuentes.js, backend/crm.js (exportación), nuevo backend/crmSeguimientoRutas.js,
backend/server.js (registro máximo 3 líneas), nuevos backend/crmSeguimiento.test.js y backend/crmSeguimientoRutas.test.js.

**Interfaces:** crearConsultasCRM(DB, repo).ficha(ctx, ref) resuelve visibilidad y estado;
registrarRutasCRMSeguimiento(app, { DB, repoSicar, consultasCRM, contextoCRM, requiereLogin, requierePermiso, resolverPermisosDeRol }).

- [ ] Pruebas de estado SICAR; unido prioriza nativo y luego identidad más reciente; sin verSicar no filtra información.
- [ ] Pruebas HTTP: permiso vecino 403, otra tienda 404 aunque query/body pidan tienda, global ignora encabezado en ficha;
  nativo delega, inventado/null/compro 400, actor del token e historial persistido, sin sesión 401.
- [ ] Ejecutar los dos archivos y comprobar rojo antes de implementar.
- [ ] Exportar ESTADOS_MANUALES; consultar estados y resolver precedencia; registrar ruta con validación cerrada y contexto existente.
- [ ] Ejecutar nuevos archivos y crmSicar.test.js, crmSicarRutas.test.js, crmEstadoCliente.test.js: cero fallos.
- [ ] Commit: `feat: habilitar seguimiento CRM por referencia`.

### Task 3: Orden y filtros de lista

**Files:** backend/crmFuentes.js, backend/server.js (solo filtrosCRM), pruebas de seguimiento anteriores.

**Interfaces:** listar(ctx, { orden = 'reciente', desde, hasta, estado, buscar, cursor, limit }); fechas inclusivas sobre ultima_compra vigente.

- [ ] Probar reciente predeterminado, sin compras al final por nombre, nombre y monto, desempate ref y paginación estable;
  límites de fechas, sin compras excluido, totales filtrados, estado y sin_estado; inválidos 400 también por HTTP.
- [ ] Ejecutar pruebas y ver fallos por orden/filtros ausentes.
- [ ] Validar fechas reales AAAA-MM-DD, desde <= hasta y listas permitidas; filtrar antes de totales y paginación.
- [ ] Transmitir orden/desde/hasta/estado en filtrosCRM; verificar nuevas y regresiones CRM.
- [ ] Commit: `feat: ordenar y filtrar clientes por seguimiento`.

### Task 4: Respaldo compatible

**Files:** backend/sicarRespaldo.js, backend/sicarRespaldo.test.js.

**Interfaces:** TABLAS agrega sicar_estados y sicar_estados_historial; snapshots viejos aceptan ausencia conjunta de ambas.

- [ ] Probar ida/vuelta de estados e historial; respaldo viejo restaura vacíos sobre datos existentes; manifiesto incompleto sigue rechazado.
- [ ] Ejecutar pruebas de respaldo y comprobar rojo.
- [ ] Extender TABLAS y validación compatible, conservando verificación de conteos y restauración transaccional.
- [ ] Ejecutar sicarRespaldo.test.js: cero fallos.
- [ ] Commit: `feat: respaldar seguimiento SICAR con compatibilidad`.

### Task 5: Controles de seguimiento y WhatsApp

**Files:** src/CRMListaClientes.jsx; nuevos src/CRMFichaCliente.jsx, src/CRMSeguimiento.jsx, src/crmSeguimiento.js
y backend/crmSeguimientoPantalla.test.js.

**Interfaces:** controles reciben ficha, permiso y callback de actualización; helper numeroWhatsApp(telefono) devuelve dígitos normalizados o null.

- [ ] Probar normalización 10 dígitos a 52, 12 con 52 sin cambio y rechazo del resto; render de estados manuales,
  permiso deshabilitado, insignia Compró y enlace/deshabilitado de WhatsApp usando herramientas existentes.
- [ ] Ejecutar pruebas y comprobar rojo antes de escribir los componentes/helpers.
- [ ] Agregar controles de orden/fechas/estado con vuelta a página 1, etiquetas con colores existentes, acciones de ficha;
  recargar ficha y lista al guardar, errores visibles, protección de respuesta obsoleta y botón WhatsApp sin envío al servidor.
- [ ] Ejecutar pruebas específicas, eslint src backend y comprobación de líneas/UTF-8 y alcance del diff.
- [ ] Commit: `feat: mostrar controles de seguimiento y WhatsApp`.

## Entrega

Reportar commits, archivos, resultados rojos/verdes y regresiones, eslint, git status y limitaciones.
No afirmar suite completa ni navegador ejecutados: corresponden a Claude. Fallos de entorno documentados por despacho:
clavesSat.test.js y arranquePersistencia.test.js (5 pruebas por falta de .env/datos.sqlite), sin modificarlos.

## Registro de ejecución

- Plan escrito antes del código. Intento de staging/commit del plan rechazado por sandbox:
  `Unable to create .../.git/worktrees/crm-seguimiento/index.lock: Permission denied`.
  Se continúa sin commits bajo la excepción expresa del despacho, sin intentar evadir el sandbox.
- Tarea 1: dos pruebas rojas por método ausente, luego 2/2 verdes, incluida reversión ante fallo del historial.
- Tarea 2: dos pruebas de consulta rojas (estado null) y cinco HTTP rojas (ruta ausente);
  después 35/35 verdes con regresiones CRM.
- Tarea 3: cinco pruebas rojas por filtros/orden ausentes, después 34/34 verdes con regresiones CRM.
- Tarea 4: dos pruebas rojas por estados fuera del respaldo y restauración antigua; 31/31 verdes después.
  La prueba de manifiesto incompleto fue una regresión ya verde antes de implementar.
- Tarea 5: cuatro pruebas rojas por controles/helpers ausentes, luego 4/4 verdes; integración de filtros/ficha
  roja antes de implementarla, y fecha de renglón roja antes de incorporarla; después 6/6 verdes.
- Ajuste técnico: permisos leídos de `/auth/yo` existente porque CRM.jsx no transmite permisos a esta pantalla
  y está prohibido modificarlo. Sin permiso explícito los controles permanecen deshabilitados.
- Ajuste técnico: ficha extraída a CRMFichaCliente.jsx para separar carga/guardado y mantener archivos pequeños.
- Regresión ampliada: 104/105 inicialmente; único fallo era expectativa antigua de diez tablas del repositorio.
  Se actualiza a doce y se comprueba que ambas tablas de seguimiento comienzan vacías, conforme al spec.
- ESLint mediante CLI Node con ambas banderas: 0 errores, 748 warnings. El comando npx directo falla por EPERM
  al resolver enlaces; la ejecución directa utiliza el ESLint instalado, sin instalar dependencias.
- Pendientes externos: commits, revisión independiente por Claude, suite completa en copia principal y navegador.
- Verificación final: 105 pruebas pasan, 0 fallan, 0 omitidas (23 pruebas nuevas y regresiones seleccionadas).
  Comando ejecutado con las dos banderas obligatorias:

  ```powershell
  node --preserve-symlinks --preserve-symlinks-main --test backend/crmSeguimientoRepositorio.test.js backend/crmSeguimiento.test.js backend/crmSeguimientoRutas.test.js backend/crmSeguimientoPantalla.test.js backend/crmEstadoCliente.test.js backend/crmSicar.test.js backend/crmSicarRutas.test.js backend/sicarRepositorio.test.js backend/sicarMigracion.test.js backend/sicarRespaldo.test.js backend/sicarRespaldoRetencion.test.js backend/sicarRespaldoServidor.test.js
  ```

- `git diff --check` sin errores; archivos cambiados UTF-8 válido, sin patrones de mojibake detectados.
  Sin líneas nuevas de más de 200 caracteres. server.js solo filtrosCRM y dos líneas de registro;
  crm.js solo exportación de ESTADOS_MANUALES. Ningún archivo prohibido modificado.
