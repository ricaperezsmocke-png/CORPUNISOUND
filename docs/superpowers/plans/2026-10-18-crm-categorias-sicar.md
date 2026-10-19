# CRM categorias SICAR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clasificar las compras del CRM por departamento y categoria con articulos de SICAR, conservando la compatibilidad del contrato y respaldos existentes.

**Architecture:** El agente lee una pagina de articulos de SICAR en una transaccion de solo lectura y la envia como coleccion opcional del lote v1. El servidor valida y persiste los articulos por tienda; la consulta CRM los une a los detalles SICAR antes de recurrir al catalogo propio. La pantalla consume la nueva jerarquia `departamentos`.

**Tech Stack:** Node.js built-in test runner, better-sqlite3, React, MySQL reader existente.

**Spec:** `docs/superpowers/specs/2026-10-18-crm-categorias-sicar-design.md`

## Global Constraints

- No agregar dependencias ni modificar `package.json` o `package-lock.json`.
- Solo archivos autorizados por el despacho; no tocar `server.js`, `respaldos.js`, `crmFuentes.js`, `CRMFichaCliente.jsx`, `render.yaml` ni `seguridad.js`.
- Cada prueba se escribe y se observa fallar antes del codigo; ejecutar solo sus archivos con las dos banderas `--preserve-symlinks` desde `backend/` o `agente-sicar/`.
- Maximo 200 caracteres por linea en `.js` y `.jsx` de `src/` y `backend/`; UTF-8 estricto.
- El lote v1 conserva `schema_version: 1`; `articulos` es opcional, maximo 500, y un lote solo de articulos avanza la secuencia.
- La sucursal de un articulo procede exclusivamente de la llave autenticada, nunca del cuerpo.
- SICAR sigue siendo solo lectura: toda consulta nueva debe pasar `seguridad.js` sin cambiarlo.
- No ejecutar la suite completa ni la prueba de navegador; esos pasos corresponden a Claude.

## Review Focus

- Reenvio con el mismo `batch_id`: debe devolver el recibo original, incluyendo `aceptados.articulos`, sin duplicar ni alterar filas.
- Articulo sin departamento/categoria o sin coincidencia en SICAR: debe caer al catalogo por SKU y finalmente a ambos nombres de respaldo.
- Llaves y texto limite: texto con U+FFFD, 501 entidades y `art_id` repetido deben fallar antes de escribir.
- Respaldo antiguo de 10, 12 o 14 tablas: debe restaurar con `sicar_articulos` vacia y sin tocar `respaldos.js`.
- Agente fuera de la ventana nocturna o con columnas opcionales ausentes: no debe bloquear clientes ni ventas y debe dejar el evento seguro una vez por corrida.

---

### Task 1: Contrato v1 y persistencia transaccional de articulos

**Files:**
- Modify: `backend/sicarIngesta.js`, `backend/sicarRepositorio.js`, `backend/sicarContrato.test.js`, `backend/sicarIngesta.test.js`, `backend/sicarRepositorio.test.js`, `docs/sicar-contrato-v1.md`

**Interfaces:**
- Produces: lote validado con `articulos: Array<{art_id, clave, descripcion, categoria, departamento}>`; recibo con `aceptados.articulos`; tabla `sicar_articulos` indexada por `(sucursal_id, art_id)`.

- [ ] **Step 1: Write failing contract and repository tests**

Cubrir lote valido y solo-articulos, omision retrocompatible, limite 501, duplicado, texto de 101, U+FFFD, reenvio identico, upsert y aislamiento por sucursal.

- [ ] **Step 2: Run the tests to verify RED**

Run: `node --preserve-symlinks --preserve-symlinks-main --test sicarContrato.test.js sicarIngesta.test.js sicarRepositorio.test.js`

Expected: fallos por la propiedad `articulos` no declarada, tabla o recibo ausentes.

- [ ] **Step 3: Implement optional article validation and transactional upsert**

Permitir exactamente las propiedades del spec, normalizar vacio a `null`, crear `sicar_articulos`, incluirla en las escrituras/recibo e inicializar `aceptados.articulos` tambien para lotes viejos.

- [ ] **Step 4: Run the task tests to verify GREEN**

Run: `node --preserve-symlinks --preserve-symlinks-main --test sicarContrato.test.js sicarIngesta.test.js sicarRepositorio.test.js`

Expected: PASS, 0 fallos.

- [ ] **Step 5: Commit**

`git add` con rutas explicitas de esta tarea y `git commit -m "feat: guarda articulos sicar"`.

### Task 2: Respaldo SICAR compatible

**Files:**
- Modify: `backend/sicarRespaldo.js`, `backend/sicarRespaldo.test.js` y cualquier prueba de respaldo SICAR autorizada necesaria

**Interfaces:**
- Consumes: tabla `sicar_articulos` de Task 1.
- Produces: respaldos nuevos que incluyen la tabla y restauracion valida de manifiestos de 10, 12 y 14 tablas anteriores.

- [ ] **Step 1: Write failing backup tests**

Agregar un articulo a una fotografia/restauracion y afirmar que se conserva; afirmar que los tres manifiestos anteriores siguen restaurando con la nueva tabla vacia.

- [ ] **Step 2: Run the tests to verify RED**

Run: `node --preserve-symlinks --preserve-symlinks-main --test sicarRespaldo.test.js sicarRespaldoRetencion.test.js sicarRespaldoServidor.test.js`

Expected: falla porque el manifiesto nuevo no contiene `sicar_articulos`.

- [ ] **Step 3: Add the table to current backup generation only**

Extender `TABLAS` y aceptar las tres generaciones preexistentes mas la actual, sin editar `backend/respaldos.js`.

- [ ] **Step 4: Run the task tests to verify GREEN**

Run: `node --preserve-symlinks --preserve-symlinks-main --test sicarRespaldo.test.js sicarRespaldoRetencion.test.js sicarRespaldoServidor.test.js`

Expected: PASS, 0 fallos.

- [ ] **Step 5: Commit**

`git add` con rutas explicitas y `git commit -m "feat: respalda articulos sicar"`.

### Task 3: Consulta y pantalla de compras por departamento

**Files:**
- Modify: `backend/crmQueCompra.js`, `backend/crmQueCompra.test.js`, `backend/crmPerfilPantalla.test.js`, `src/CRMPerfilCompras.jsx`

**Interfaces:**
- Consumes: `sicar_articulos(sucursal_id, art_id, clave, descripcion, categoria, departamento)` de Task 1.
- Produces: `{ departamentos, articulos, ajustes_centavos, total_centavos }`, donde cada departamento contiene categorias y ambos niveles suman exactamente.

- [ ] **Step 1: Write failing query and UI tests**

Cubrir clasificacion SICAR, respaldo SKU, doble respaldo, normalizacion de nombres, cuadre de ambos niveles, POS por catalogo, alcance 404 y renderizado con departamentos/categorias sangrados.

- [ ] **Step 2: Run the tests to verify RED**

Run: `node --preserve-symlinks --preserve-symlinks-main --test crmQueCompra.test.js crmPerfilPantalla.test.js`

Expected: fallos porque aun retorna `categorias` plano y la interfaz no renderiza departamentos.

- [ ] **Step 3: Implement grouping and presentation**

Usar articulo SICAR por sucursal/articulo, despues SKU del catalogo; normalizar claves de agrupacion sin alterar el primer nombre visible. Conservar articulos y ajustes.

- [ ] **Step 4: Run the task tests to verify GREEN**

Run: `node --preserve-symlinks --preserve-symlinks-main --test crmQueCompra.test.js crmPerfilPantalla.test.js`

Expected: PASS, 0 fallos.

- [ ] **Step 5: Commit**

`git add` con rutas explicitas y `git commit -m "feat: agrupa compras por departamento"`.

### Task 4: Lectura y envio diario de articulos por el agente

**Files:**
- Modify: `agente-sicar/mapeo.js`, `agente-sicar/mapeo.test.js`, `agente-sicar/corrida.js`, `agente-sicar/corrida.test.js`, `agente-sicar/estado.js`, `agente-sicar/estado.test.js`, `agente-sicar/index.js`, `agente-sicar/LEEME.md`, y pruebas autorizadas del agente necesarias

**Interfaces:**
- Consumes: `COLUMNAS_ARTICULOS`, `fuente.articulos(cursor, limite)`, estado `articulos_cursor/articulos_dia`, y el lote v1 de Task 1.
- Produces: lotes exclusivos `articulos` de hasta 500, cursor que avanza solo al 200 y reporte de disponibilidad verificable.

- [ ] **Step 1: Write failing agent tests**

Cubrir consulta segura con esquema completo, paginas de 500 en ventana, fuera de ventana, `--articulos-ahora`, columnas faltantes con `ARTICULOS_NO_DISPONIBLES` una vez y ventas incrementales intactas, cursor tras 200 y salida de `--verificar`.

- [ ] **Step 2: Run the tests to verify RED**

Run: `node --preserve-symlinks --preserve-symlinks-main --test mapeo.test.js corrida.test.js estado.test.js contrato.test.js seguridad.test.js`

Expected: fallos por fuente, estado, flag y lotes de articulos ausentes.

- [ ] **Step 3: Implement optional source validation and daily scheduler**

Mantener obligatorias las columnas actuales; validar las tres tablas opcionales sin detener la sincronizacion. Priorizar incremental, enviar solo articulos por pagina, y persistir cursor/dia unicamente tras 200. Documentar el flag y verificacion.

- [ ] **Step 4: Run the task tests to verify GREEN**

Run: `node --preserve-symlinks --preserve-symlinks-main --test mapeo.test.js corrida.test.js estado.test.js contrato.test.js seguridad.test.js`

Expected: PASS, 0 fallos.

- [ ] **Step 5: Commit**

`git add` con rutas explicitas y `git commit -m "feat: envia articulos sicar"`.

## Self-Review

- Cobertura: Tasks 1-4 cubren contrato, tabla/upsert, recibo/idempotencia, respaldo, consulta y pantalla, agente, verificable y documentacion.
- Consistencia: el contrato y tabla de Task 1 son las interfaces consumidas por Tasks 2-4; la respuesta de Task 3 sustituye el campo plano por `departamentos` como fija el spec.
- Pruebas de foco: cada punto de Review Focus se asigna a Tasks 1, 3, 2 y 4 respectivamente.
- Proporcion: cuatro tareas independientes de entrega verificable, sin cambios fuera de los archivos autorizados.
