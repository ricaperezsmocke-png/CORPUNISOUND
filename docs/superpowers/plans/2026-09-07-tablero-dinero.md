# Tablero de Dinero — plan de implementación

**Goal:** Que Victor y el contador puedan comprobar cuánto efectivo espera el sistema en cada cajón y en la tómbola, y cuánto se registró como depositado al banco, sin duplicar erogaciones ni cargar dinero del resguardo al corte de una cajera.

**Architecture:** Primero crear el concepto persistente de salida de tómbola y migrar una sola vez los depósitos y los gastos ya marcados como caja fuerte. Conservar depósitos/gastos como fuentes monetarias únicas y sus pantallas como adaptadores; proteger todas las puertas con reserva síncrona persistida, rechazo de coincidencias y autorización de un solo uso por otra persona. Calcular el tablero desde cortes y salidas, con componentes verificables y alcance independiente del encabezado.

**Tech Stack:** Node.js/CommonJS, Express, DB en memoria persistida como JSON en SQLite mediante `better-sqlite3` ya instalado; React 18, Vite y Tailwind existentes; Drive actual; `node:test`, `node:assert/strict`, `node:crypto` y `fetch` nativo. Ninguna dependencia nueva.

**Spec:** `docs/superpowers/specs/2026-09-07-salidas-tombola-design.md` — leerlo completo. Sus secciones 3–10 fijan datos, coincidencias, estados, permisos, fórmulas y responsabilidad; las tareas siguientes fijan contratos y pruebas.

**Base auditada:** `9b5e98fa677c7eb4d446fdfabc1f8468c06821b0`, rama `docs/plan-tablero-dinero`, worktree `C:/Users/Victor/Desktop/CORPUNISOUND`. Solo se escriben este plan y el spec en este despacho. Los commits de las tareas son instrucciones para la implementación futura, no autorización para implementar ahora.

## Global Constraints

Las citas siguientes se copian textualmente de `CLAUDE.md`; no son reglas nuevas de este plan.

> - **No agregar dependencias.** Ninguna. Las pruebas usan el runner integrado de Node (`node --test`).
>   Si crees que necesitas una, detente y pregunta.
> - **No `git add .`** — el repo tiene ~527 archivos sin seguimiento (`.agents/`, `graphify-out/`,
>   `skills-lock.json`). Siempre staging por rutas explícitas.
> - **No push, no merge, no rebase.** Eso lo hace Victor, siempre. Commits en la rama de trabajo, sí.
> - **No subir archivos al disco de Render.** Todo lo que sea archivo va a Drive: el disco de Render se
>   llena y apaga los respaldos.
> - **No tocar `render.yaml`** salvo que se te pida explícitamente. Durante un mes declaró un plan que
>   no era el real y una resincronización habría borrado el disco con toda la base.

> **1. Toda validación de dinero va en el SERVIDOR.** Una comprobación que solo vive en `src/` no es
> una comprobación: es una sugerencia. Quien manda la petición a mano se la salta. Ya pasó con el
> precio de venta (el servidor copiaba el total que mandaba el navegador) y con el descuento.
>
> **2. Las guardas fallan CERRANDO, no abriendo.** Valida contra la lista de lo permitido, no contra la
> de lo prohibido. La guarda del crédito comparaba contra "CREDITO" normalizando el acento; una
> petición con el cuerpo mal codificado llegaba como `CR�DITO`, no coincidía con nada, y la venta
> a crédito **entraba**. Ninguna prueba lo encontró: todas mandan texto bien formado.
>
> **3. `esDeEstaCaja` (`backend/cajas.js`) es la ÚNICA definición de "este movimiento es de esta
> caja".** La usan ventas, abonos, gastos y cortes. Una comparación suelta de `caja_id` en cualquier
> otro lado esconde las ventas históricas (`caja_id: null`) que el corte de la Administrativa sí cobra
> — y quien investiga un faltante no ve las ventas que le están cobrando.
>
> **4. Los ids que llegan del cuerpo HTTP pueden ser TEXTO.** `"9" === 9` es falso, y un guard que
> compara con igualdad estricta falla **abriendo**. Normaliza con `Number(...)` antes de comparar,
> cuidando que `Number(null)` es `0`.
>
> **5. El selector de sucursal del encabezado es un FILTRO de listas, nunca la fuente del alcance.**
> `apiFetch` (`src/api.js`) inyecta `sucursal_id` y `caja_id` desde `localStorage` en toda petición que
> no los traiga. Un guard que resuelva el alcance desde `?sucursal_id=` acaba escondiéndole al
> administrador registros que sí ve en la lista de al lado. **Ya mordió cuatro veces.** Para un guard
> por `:id`, resuelve el alcance solo de quien pregunta: su permiso `ver_todas_las_sucursales` y la
> `sucursal_id` de su token. Y cuidado con que la sucursal salga del token mientras la caja sale del
> encabezado: son dos fuentes para una sola decisión, y revienta.

> - **Fechas solas** (`fecha`): `fechaLocal()` de `backend/fechas.js`, zona `America/Mexico_City`.
> - **Marcas completas** (`fecha_hora`): ISO en UTC, a propósito.
>
> No mezclar. Los datos anteriores al 2026-08-04 conservan su fecha corrida; no se migraron.

> Hay un guard de arranque (`validarSistemaDePermisos`) que **tumba el backend** si un módulo no está
> registrado. Todo módulo o permiso nuevo se da de alta en `backend/permisosCatalogo.js`, y la ruta usa
> **su** permiso, nunca uno prestado de otro módulo.
>
> El rol Administrador se reconcilia solo contra el catálogo en cada arranque. Los demás roles no: si
> un permiso nuevo debe llegarle a un gerente o a una cajera, Victor tiene que dárselo a mano en Roles
> y Personal.

> - **`backend/testHelpers.js` exporta solo `construirDBPrueba` y `sembrarCuentas`.** No existen
>   `datosVentaDePrueba`, `usuarioDePrueba`, `driveFalso` ni nada parecido: **no los inventes**.
> - El patrón es un `prepararDB()` local dentro del propio archivo de prueba. Cópialo de
>   `backend/cajas.test.js`.
> - Una línea de venta es `{ descripcion, cantidad, precio_unitario }` — `precio_unitario`, no `precio`.
>   Las líneas **sin `producto_id`** son productos rápidos: no tienen catálogo contra el cual validar.
> - **Verifica que la prueba se pone ROJA antes de implementar.** Una prueba que nunca falló no prueba
>   nada. Si mutas código para comprobarlo, revierte la mutación **en el mismo turno**: ya van dos
>   sesiones muertas dejando código mutado sin commitear, y una costó una sesión entera de diagnóstico.
> - Una prueba de permisos con un rol de `permisos: []` **no prueba el permiso**: pasaría con cualquier
>   clave. Dale permisos vecinos del mismo módulo.

> **La línea base es 0 fallas y 0 errores de eslint.** Si tu cambio baja ese número, no está terminado.

> Para trabajo grande: spec → plan → implementación por tareas con TDD → **revisión independiente** →
> prueba en navegador → Victor mergea.
>
> **Nadie valida su propio trabajo.** Quien implementa no revisa. Y si el trabajo lo hizo Codex, la
> revisión no puede ir a Codex.
>
> **Una rama = un worktree = un solo responsable de escritura.** Antes de despachar a alguien: confirma
> rama, worktree, commit base y `git status` reales — no los asumas por la conversación.
>
> **Al retomar una sesión que se cortó:** `git status`, `git diff`, corre la suite, y
> `grep -n "if (false" backend/*.js` buscando mutaciones vivas, ANTES de diagnosticar nada.
>
> **Mensajes de commit sin acentos** (el terminal de Windows los rompe). En el código y en la interfaz,
> los acentos sí van.

Límites adicionales decididos por Victor, copiados del encargo:

> Una sola migracion. Los depositos historicos sin caja los absorbe la caja predeterminada, como todo lo demas en este sistema.
>
> Es un rechazo, no una advertencia.
>
> Si git te rechaza el commit, no insistas: deja los archivos en el arbol y dilo en tu informe, que yo los rescato.

## Estado comprobado y orden de ejecución

Cero fases del plan del 2026-09-03 están implementadas en esta rama: no existe `backend/tableroDinero.js`, pantalla del tablero, `deposito.caja_id` ni permiso de tablero. El filtro de gastos de caja fuerte **sí está construido** y su riesgo original está cerrado. El spec, sección 2, enumera las otras afirmaciones sustituidas y sus fuentes. La corrección de origen existe, pero le faltan alcance interno, prevalidación atómica y protección histórica completa; no confundir su existencia con una garantía suficiente.

Los doce entregables van en orden. Tareas 1–7 forman la escritura protegida; 8–9 la lectura; 10–11 las pantallas; 12 comprueba y completa supervivencia a reinicios/restauraciones. Cada tarea tiene pruebas propias, pero **no desplegar estados intermedios** que expongan una puerta sin todas las guardas. Revisión independiente antes de habilitar escrituras y antes de entregar a Victor. Un solo implementador; ninguna tarea requiere escritores paralelos.

En esta revisión documental se intentó `node --test` desde `backend`; los procesos de prueba fallaron antes de cargar los archivos con `EPERM: operation not permitted, lstat 'C:\\Users\\Victor'` en este entorno. No se certifica aquí la suite ni se atribuye ese bloqueo al código. Antes de ejecutar el plan, obtener una corrida normal en el entorno de desarrollo autorizado. El árbol versionado estaba limpio; había archivos sin seguimiento preexistentes que no forman parte del trabajo. La búsqueda de `if (false` no encontró mutaciones vivas.

## Contratos comunes de las tareas

Los tipos siguientes son contratos documentados de objetos JavaScript, no una incorporación de TypeScript.

- `Usuario = { id, nombre, rol_id, sucursal_id }`, ids positivos normalizados; la identidad se obtiene de sesión, jamás del cuerpo.
- `Alcance = { verTodas: boolean, sucursalId: number|null }`, obligatorio; global solo con permiso.
- `Archivo = { nombre_archivo, tipo_mime, contenido_base64 }`; PDF/JPG/PNG, máximo 10 MiB. No persistir base64.
- `SalidaVinculo`, `Salida`, `Reserva`, `Solicitud` y `erogacion`: campos exactos en secciones 3, 5, 6 y 7 del spec. `salida_id` identifica ST; `fuente_id` identifica GA/DEP. No intercambiarlos.
- `ErrorTombola = Error & { estatus: 400|403|404|409|503, codigo: string, solicitud_id?: number, conflictos?: Array<{fuente_tipo,fuente_id,folio}> }`.
- `ContextoErogacion = { usuario, sucursal_id, caja_id, fuente_prevista: "gasto"|"deposito", tipo_salida: "DEPOSITO"|"NOMINA"|"SERVICIO"|"OTRO"|null, accion: "crear"|"corregir", fuente_excluida: null|{tipo,id} }`. La exclusión la construye el servidor desde el registro que corrige; nunca se copia de HTTP.
- `Preparada = { operacion_id, huella, monto_centavos, erogacion, contexto, archivo_sha256 }`; no acepta un bypass ni autorización como booleano.
- `Tx = { asignar(objeto, clave, valor): void, agregar(lista, registro): void }`; síncrona, sin promesas.
- `FiltrosTablero = { sucursal_id?: string }`; solo consulta actual. No filtro temporal del saldo ni `caja_id` heredado.
- `Componente = { fuente_tipo, fuente_id, folio, fecha, concepto, importe_centavos, usuario_nombre, evidencia_disponible }`.
- `Cifra = { importe_centavos: number|null, componentes: Componente[], incidencias: string[] }`; `null` es desconocido, 0 es cero confirmado.
- `Tablero = { generado_en, fecha_local, sucursales: Array<{sucursal_id,sucursal_nombre,cajas,totales}>, totales, incidencias }`. Cada caja contiene `caja_id`, `caja_nombre`, `cajon`, `fondo`, `neto_turno`, `tombola`, `disponible`, `banco_efectivo`, `banco_transferencia`, `banco_total` y `cortes_hoy: { cantidad, contado, retiro, diferencia }`. Las cifras de totales se derivan de esos hijos.

Los comandos de prueba por archivo se ejecutan desde la raíz, usando las rutas explícitas de cada tarea. `cd backend` y `node --test` son dos comandos separados para la suite completa en PowerShell. No se requiere instalar un runner de frontend: los helpers de interfaz sin JSX se prueban con Node, y el render/interacción se verifica en navegador. En cada tarea, las pruebas nombradas en el paso rojo son también los criterios exactos de su paso de implementación; no son títulos que puedan sustituirse por una prueba genérica.

### Task 1: Crear el concepto de salida y su única migración

**Files:**
- Create: `backend/tombolaModelo.js`
- Modify: `backend/server.js`
- Modify: `backend/reconciliarRestauracion.js`
- Test: `backend/tombolaMigracion.test.js`

**Interfaces:**
- Consumes: `sembrarCajas(DB)`, `repararCajas(DB)`, `resolverCajaDeSucursal(DB, sucursalId, cajaId)`, `esDeEstaCaja(registro, caja)` de `backend/cajas.js`.
- Produces: `nuevoEstadoTombola(): object`; `migrarSalidasTombola(DB, ahoraISO): {creadas, depositos_sin_caja, gastos_fuerte}`; `vincularSalida(DB, {tipo, fuente_tipo, fuente_id, historica}, ahoraISO, tx): SalidaVinculo`; `leerSalida(DB, id, alcance): Salida`; `listarSalidasTombola(DB, filtros, alcance): Salida[]`. `tx` es obligatorio para altas ordinarias; migración usa su lote síncrono tras validar todos los registros. `leerSalida` rechaza alcance ausente y usa `dentroDeAlcance` después de validarlo.

- [ ] Escribir en `tombolaMigracion.test.js` las pruebas `migra depositos activos y cancelados sin cambiar ningun campo original`, `dos migraciones producen los mismos vinculos y eventos`, `deposito historico nulo pertenece solo a la predeterminada`, `vincula gasto fuerte efectivo pero no gasto del cajon ni transferencia`, `forma o caja historica invalida aborta sin migracion parcial`, `leer salida exige alcance y no revela fuentes ajenas`. Usar un `prepararDB()` local con `construirDBPrueba()`, limpiar ventas/cortes/abonos, `sembrarCajas(DB)` y crear explícitamente `DB.cuenta_comun = {depositos:[], deposito_movimientos:[], ultimo_id:0}`. Guardar `structuredClone` de los campos y bitácoras originales; después quitar solo los nuevos campos antes de `deepStrictEqual`.
- [ ] Ejecutar `node --test backend/tombolaMigracion.test.js`; verificar fallo por exportación/módulo inexistente y, al existir el esqueleto, por vínculos ausentes. No aceptar errores de entorno como rojo funcional.
- [ ] Implementar `nuevoEstadoTombola`, migración validada en dos pasadas y vínculos únicos según spec 3–4. En el seed declarar `cuenta_comun.tombola`; llamar migración después de `sembrarCajas` en arranque y después de `repararCajas` al restaurar. Guardar la migración de arranque antes de aceptar peticiones. Conservar `DEP-`/`GA-`, contadores y fuentes canceladas. Leer montos/estado/evidencia desde la fuente; no duplicar campos monetarios en el vínculo.

```js
// Regla de atribución usada por las pruebas y por los consumidores.
const pertenece = (registro, sucursalId, caja) =>
  Number(registro.sucursal_id) === Number(sucursalId) && esDeEstaCaja(registro, caja);
// El histórico sigue sin una caja elegida por una persona.
assert.equal(depositoHistorico.caja_id, null);
assert.equal(pertenece(depositoHistorico, 1, administrativa), true);
assert.equal(pertenece(depositoHistorico, 1, fiscal), false);
```

- [ ] Ejecutar `node --test backend/tombolaMigracion.test.js backend/reconciliarRestauracion.test.js backend/depositos.test.js`; verificar todas pasan y que un gasto CAJON previo conserva origen, caja, fecha y sello. Este entregable prueba la migración sin pantalla ni cálculo nuevo.
- [ ] Commit desde raíz: `git add backend/tombolaModelo.js backend/tombolaMigracion.test.js backend/server.js backend/reconciliarRestauracion.js`; después `git commit -m "feat(tombola): concepto de salida y migracion unica"`.

### Task 2: Persistir cambios atómicos y resolver alcance desde la persona

**Files:**
- Create: `backend/tombolaPersistencia.js`
- Create: `backend/tombolaAcceso.js`
- Modify: `backend/server.js`
- Test: `backend/tombolaPersistencia.test.js`
- Test: `backend/tombolaAcceso.test.js`

**Interfaces:**
- Consumes: `permisosDeRol(DB, rolId)` de `backend/roles.js`; `dentroDeAlcance(sucursalId, alcance)` de `backend/auth.js`; `guardar(db)` de `backend/persistencia.js`; estado producido por Task 1.
- Produces: `configurarPersistenciaTombola(DB, guardar): void`; `cambioTombola(DB, cambiar): any`, donde `cambiar(tx: Tx)` es síncrona; `alcanceActor(DB, usuario): Alcance`; `exigirAlcance(alcance): Alcance`; `exigirAccionTombola(DB, usuario, claves, sucursalId): void`. Cuenta activa requerida en acciones; alcance del token, permisos del rol vivo de la cuenta, ids numéricos, sin query.

- [ ] Escribir `guardar ocurre antes de confirmar el cambio`, `fallo al guardar deshace solo su lote y conserva identidad de objetos`, `una funcion async se rechaza antes de mutar`, `sin callback configurado la ruta no puede confirmar`, `alcance global no depende del encabezado`, `alcance local invalido falla cerrado`, `permiso vecino no concede cancelar`, `cuenta desactivada o permiso revocado rechaza accion`. Los fixtures de acceso crean roles con permisos vecinos y usuarios activos, nunca `permisos: []` como única prueba.
- [ ] Ejecutar `node --test backend/tombolaPersistencia.test.js backend/tombolaAcceso.test.js`; verificar rojo por exports inexistentes/contrato incumplido.
- [ ] Implementar diario de undo y `WeakMap` de callbacks sin importar SQLite desde los módulos de dominio. Configurar `guardar` real en `server.js`; no aceptar rutas de tómbola si faltó configuración. Para pruebas puras configurar explícitamente `configurarPersistenciaTombola(DB, () => {})`. Implementar alcance de actor con `ver_todas_las_sucursales` del rol vivo, sucursal del token validada y existencia de sucursal. No reutilizar el `resolverAlcance(req)` actual para rutas por id.

```js
// Lote mínimo que ejercita asignaciones y altas, conservando referencias.
configurarPersistenciaTombola(DB, () => { throw new Error("disco no disponible"); });
const original = DB.cuenta_comun.depositos[0];
assert.throws(() => cambioTombola(DB, (tx) => {
  tx.asignar(original, "estatus", "cancelado");
  tx.agregar(DB.cuenta_comun.tombola.movimientos, { id: 1 });
}), /disco no disponible/);
assert.equal(DB.cuenta_comun.depositos[0], original);
assert.equal(original.estatus, "activo");
assert.equal(DB.cuenta_comun.tombola.movimientos.length, 0);
```

- [ ] Ejecutar `node --test backend/tombolaPersistencia.test.js backend/tombolaAcceso.test.js backend/tombolaMigracion.test.js`; verificar verde. Configurar memoria explícita en fixtures nuevos; no esconder errores de persistencia en producción con un catch vacío.
- [ ] Commit: `git add backend/tombolaPersistencia.js backend/tombolaAcceso.js backend/tombolaPersistencia.test.js backend/tombolaAcceso.test.js backend/server.js`; `git commit -m "feat(tombola): persistencia atomica y alcance del actor"`.

### Task 3: Rechazar coincidencias durante Drive y destrabar una sola operación

**Files:**
- Create: `backend/erogaciones.js`
- Test: `backend/erogaciones.test.js`

**Interfaces:**
- Consumes: `cambioTombola(DB, cambiar)`, `exigirAccionTombola(DB, usuario, claves, sucursalId)`, `leerSalida(DB, id, alcance)`, `fechaLocal(instante)`; `createHash(algorithm)` de `node:crypto`.
- Produces: `centavosDeImporte(valor): number`; `prepararErogacion(DB, datos, contexto): Preparada`; `buscarCoincidencias(DB, preparada): Array<{fuente_tipo,fuente_id,folio}>`; `reservarErogacion(DB, preparada, autorizacionId, ahoraISO): Reserva`; `confirmarErogacion(DB, operacionId, resultado, ahoraISO, tx): void`; `fallarErogacion(DB, operacionId, motivo, ahoraISO): void`; `autorizarCoincidencia(DB, solicitudId, motivo, usuario, ahoraISO): Solicitud`; `rechazarCoincidencia(DB, solicitudId, motivo, usuario, ahoraISO): Solicitud`; `listarSolicitudesErogacion(DB, filtros, usuario): Solicitud[]`; `adjuntarEvidenciaSolicitud(DB, solicitudId, archivo, usuario, drive): Promise<Solicitud>`. Rechazo de reserva persiste solicitud y lanza `ErrorTombola` 409. Confirmación participa en el mismo `tx` que el alta fuente/vínculo. `centavosDeImporte` valida importes positivos nuevos; no se usa para rechazar diferencias/fondos firmados negativos del histórico.

- [ ] Escribir `identidad de nomina ignora importe caja y fecha de captura`, `servicio compara proveedor y referencia normalizada`, `mismo importe y fecha bloquea aunque el segundo diga OTRO`, `gasto historico sin metadatos participa sin reescribirse`, `dos representaciones de una fuente no son dos pagos`, `dos gastos OTRO distintos no se bloquean solo por monto`, `caja o categoria distinta no evade una salida coincidente`, `reserva previa bloquea al competidor sin esperar Drive`, `el orden gasto primero o salida primero no abre un hueco`, `409 deja solicitud persistida`, `ids de texto impiden autorizacion propia`, `permiso vecino no autoriza`, `autorizacion vencida o cambiada rechaza`, `nuevo conflicto invalida la aprobacion anterior`, `dos peticiones consumen una autorizacion una sola vez`, `reintento confirmado devuelve el mismo resultado`, `reutilizar UUID con otro cuerpo rechaza`, `fallo de archivo no reserva ni sube`, `monto fraccionario vacio booleano o no finito rechaza`. Para cada fecha inválida incluir 2026-02-30; normalización no fusiona referencias `AB-12` y `AB12`.
- [ ] Ejecutar `node --test backend/erogaciones.test.js`; verificar rojo funcional. En la prueba concurrente controlar la promesa, no usar pausas arbitrarias ni afirmar solo que los folios son distintos.

```js
function promesaControlada() {
  let resolver;
  const promesa = new Promise((r) => { resolver = r; });
  return { promesa, resolver };
}
// Este helper se declara LOCALMENTE en el archivo de prueba.
// A reserva; solo después B intenta la misma identidad; Drive aún no termina.
const primera = reservarErogacion(DB, preparadaA, null, "2026-09-07T18:00:00.000Z");
assert.equal(primera.estado, "reservada");
assert.throws(() => reservarErogacion(DB, preparadaB, null, "2026-09-07T18:00:00.001Z"),
  (e) => e.estatus === 409 && e.codigo === "EROGACION_COINCIDENTE");
```

- [ ] Implementar reglas exactas del spec 5–7: clave documental y coincidencia conservadora, fechas/centavos normalizados, reservas persistidas y solicitudes ligadas a huella/actor/operación. No comparar caja para detectar repetición. Excluir TRANSFERENCIA de las coincidencias de efectivo; depósitos no participan como nómina/servicio por compartir monto. Hacer compare-and-set síncrono de aprobación a `en_uso`, y de confirmación a `consumida`; caducidad 15 minutos. Motivo de autorización/rechazo mínimo 15 caracteres. La cuenta autorizadora debe ser otra tras normalizar ids y mantener permisos vigentes. Un fallo solo permite reintentar la misma huella con su autorización aún vigente, nunca prestar el permiso.

```js
function centavosDeImporte(valor) {
  if (!["string", "number"].includes(typeof valor)) throw new Error("Monto inválido");
  const texto = String(valor).trim();
  const partes = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(texto);
  if (!partes) throw new Error("El monto debe ser positivo y tener máximo dos decimales");
  const centavos = BigInt(partes[1]) * 100n + BigInt((partes[2] || "").padEnd(2, "0"));
  if (centavos <= 0n || centavos > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("El monto está fuera del rango permitido");
  }
  return Number(centavos);
}
// No falla por la representación binaria de 0.29 * 100.
assert.equal(centavosDeImporte("0.29"), 29);
assert.equal(centavosDeImporte(0.29), 29);
```
- [ ] Escribir y ejecutar en rojo `autorizar requiere comprobante de la solicitud`, `evidencia de solicitud exige mismo digest y solicitante`, `adjuntar evidencia no registra otro gasto`, `dos adjunciones de solicitud no sustituyen evidencia`. Implementar `adjuntarEvidenciaSolicitud` con carpeta de Gastos, folio SOL, archivo validado, candado en memoria y revalidación después de Drive; guardar enlace/evento sin dinero. `datos_propuestos` conserva la propuesta y digest para que quien autoriza pueda revisar ambos pagos. Para solicitudes vencidas/revocadas crear otra SOL ligada al mismo UUID no confirmado, conservando las anteriores. Ejecutar `node --test backend/erogaciones.test.js` y verificar verde.
- [ ] Ejecutar `node --test backend/erogaciones.test.js backend/tombolaPersistencia.test.js backend/tombolaAcceso.test.js`; verificar verde, incluyendo dos reservas enfrentadas en ambos órdenes. Revisar que la excepción nunca crea un gasto y que se guarda la solicitud aunque el resultado HTTP vaya a ser 409. Este es el entregable que se gana o se pierde: probar dos actores durante la espera, no dos llamadas secuenciales terminadas.
- [ ] Commit: `git add backend/erogaciones.js backend/erogaciones.test.js`; `git commit -m "feat(tombola): rechazo concurrente y autorizacion de un uso"`.

### Task 4: Integrar gastos y salidas sin una segunda contabilización

**Files:**
- Create: `backend/salidasTombola.js`
- Modify: `backend/gastos.js`
- Modify: `backend/gastos.test.js`
- Modify: `backend/gastosCajaFuerte.test.js`
- Modify: `backend/gastosCorteCaja.test.js`
- Modify: `backend/reporteGastos.test.js`
- Test: `backend/salidasTombola.test.js`
- Test: `backend/gastosTombola.test.js`

**Interfaces:**
- Consumes: `crearGasto(DB, datos, sucursalId, usuario, drive, cajaId)` existente; `buscarHojaActiva(DB, id)` de `gastosCategorias.js`; `resolverCajaDeSucursal(DB, sucursalId, cajaId)`; `prepararErogacion(DB, datos, contexto)`; `reservarErogacion(DB, preparada, autorizacionId, ahoraISO)`; `confirmarErogacion(DB, operacionId, resultado, ahoraISO, tx)`; `fallarErogacion(DB, operacionId, motivo, ahoraISO)`; `vincularSalida(DB, datos, ahoraISO, tx)`.
- Produces: `crearSalidaTombola(DB, datos, sucursalId, usuario, drive): Promise<Salida>`; conserva firma `crearGasto(DB, datos, sucursalId, usuario, drive, cajaId): Promise<Gasto>`. `datos` para nómina/servicio/otro contiene `{tipo,caja_id,categoria_id,concepto,descripcion,monto,archivo,operacion_id,erogacion,autorizacion_id?,proveedor_id?,numero_factura?}`. Para crear desde Gastos, `erogacion.tipo` decide el tipo del vínculo si origen CAJA_FUERTE. Ambos caminos usan la misma operación interna de Gastos, sin llamadas recursivas entre módulos.

- [ ] Escribir `crear nomina produce un gasto y una salida con el mismo pago`, `salida fuerte no cambia el efectivo esperado del cajon`, `gasto CAJON si resta al turno`, `gasto fuerte legado ya vinculado no se descuenta dos veces`, `dos usuarios durante subida crean solo una erogacion`, `Drive fallido deja intento pero no gasto ni salida`, `respuesta tardia despues de timeout no confirma`, `permiso revocado durante Drive no crea salida`, `archivo invalido no consume folio ni autorizacion`, `categoria o caja invalida no deja estado parcial`, `registro confirmado persiste antes de devolver exito`. Usar el controlador de promesa local y el corte real `calcularCorteEnCurso(DB, 1, caja.id, true)`; registrar sus importes antes/después.
- [ ] Ejecutar `node --test backend/salidasTombola.test.js backend/gastosTombola.test.js`; verificar rojo por falta de vínculo/reserva, no porque una prueba espere que vuelva el defecto de CAJA_FUERTE.
- [ ] Integrar la reserva después de TODAS las validaciones síncronas de `crearGasto` y antes de su primera llamada a Drive. Mantener folio GA reservado antes de esperar y comprobante obligatorio. Tras Drive revalidar cuenta, permisos, generación de `DB.cuenta_comun.tombola`, reserva y conflictos; en un solo `cambioTombola` crear fuente, vínculo si CAJA_FUERTE, eventos y confirmación. No aceptar `salida_id` ni un flag `omitir_duplicado` del navegador. El propio servicio crea la representación única. `crearSalidaTombola` fija EFECTIVO/CAJA_FUERTE para NOMINA/SERVICIO/OTRO y devuelve la proyección. DEPOSITO se conecta en Task 5.

```js
// Frontera que debe sobrevivir intacta en gastosEfectivoDelTurnoLista.
.filter((g) => g.forma_pago === "EFECTIVO")
.filter((g) => g.origen !== "CAJA_FUERTE")
```

- [ ] Actualizar fixtures locales de `gastos.test.js`, `gastosCajaFuerte.test.js`, `gastosCorteCaja.test.js` y `reporteGastos.test.js`: cuenta con id/rol/sucursal y permiso, DB migrada, callback en memoria explícito, UUID distinto por pago nuevo, `erogacion:{tipo:"OTRO",fecha_pago:fechaLocal()}` y caja declarada. Conservar fixtures históricos insertados directamente y sus aserciones. Para las pruebas de catálogo ausente mantener el caso y esperar rechazo en altas nuevas de salida, sin cambiar la compatibilidad del corte histórico. Ejecutar `node --test backend/gastosTombola.test.js backend/salidasTombola.test.js backend/gastos.test.js backend/gastosCajaFuerte.test.js backend/gastosCorteCaja.test.js backend/reporteGastos.test.js`; verificar verde sin desactivar guardas.
- [ ] Commit: `git add backend/salidasTombola.js backend/gastos.js backend/salidasTombola.test.js backend/gastosTombola.test.js backend/gastos.test.js backend/gastosCajaFuerte.test.js backend/gastosCorteCaja.test.js backend/reporteGastos.test.js`; `git commit -m "feat(tombola): integrar gastos sin duplicar erogaciones"`.

### Task 5: Convertir depósitos en salidas conservando folios y concurrencia

**Files:**
- Modify: `backend/depositos.js`
- Modify: `backend/salidasTombola.js`
- Test: `backend/depositosTombola.test.js`
- Test: `backend/depositos.test.js`

**Interfaces:**
- Consumes: `vincularSalida(DB, datos, ahoraISO, tx)`, `cambioTombola(DB, cambiar)`, `prepararErogacion(DB, datos, contexto)`, `reservarErogacion(DB, preparada, autorizacionId, ahoraISO)`, `confirmarErogacion(DB, operacionId, resultado, ahoraISO, tx)`, `resolverCajaDeSucursal(DB, sucursalId, cajaId)`.
- Produces, conservadas: `crearDeposito(DB, datos, sucursalId, usuario, drive): Promise<Deposito>`; `adjuntarComprobante(DB, id, archivo, usuario, alcance, drive): Promise<Deposito>`; `cancelarDeposito(DB, id, motivo, usuario, alcance): Deposito`; `listarDepositos(DB, filtros, alcance): Deposito[]`. `datos` gana `caja_id`, `operacion_id`; DEPOSITO no exige identidad de nómina/servicio. `crearSalidaTombola` acepta `{tipo:"DEPOSITO",monto,forma_pago,caja_id,referencia,nota,archivo?,operacion_id}` y llama al depósito existente; retorna el vínculo proyectado, nunca crea un gasto.

- [ ] Escribir `deposito efectivo crea DEP y ST antes de esperar Drive`, `deposito transferencia se proyecta BANCO y no salida fisica`, `deposito invalido no crea fuente vinculo evento ni reserva`, `dos altas concurrentes tienen folios distintos y fuentes unicas`, `reintento del mismo deposito no acredita dos veces`, `fallo de Drive conserva deposito salida y saldo`, `adjuntar durante alta encuentra el WeakSet ocupado`, `dos adjunciones no reemplazan comprobante`, `cancelar durante alta o adjuncion no aplica un enlace tardio`, `la historia DEP no cambia al vincular`. Usar 12 depósitos simultáneos con UUID diferentes para folios; un UUID repetido para idempotencia. Diferenciar ambos casos.
- [ ] Ejecutar `node --test backend/depositosTombola.test.js`; verificar rojo funcional por ausencia de vínculo/operación, preservando las pruebas anteriores de folio síncrono.
- [ ] Leer de nuevo **entero** `backend/depositos.js` antes de editar durante la implementación. Validar caja del cuerpo contra sucursal del token; mantener folio/alta síncronos antes de cualquier `await`, ahora dentro del lote fuente/vínculo/confirmación persistido. Reutilizar `adjuntosEnCurso`, MIME/tamaño y las funciones Drive existentes. No cambiar archivo opcional en creación por obligatorio. En alta y adjunción, revalidar objeto/generación/estatus/permiso después de la espera antes de adjuntar. El evento nuevo conserva id de actor y Drive, sin modificar eventos originales. TRANSFERENCIA no se convierte en EFECTIVO ni se deduce del resguardo.

```js
// Mismo contrato público; caja declarada, sucursal de sesión.
const deposito = await crearDeposito(DB, {
  monto: 400, forma_pago: "TRANSFERENCIA", caja_id: fiscal.id,
  referencia: "TR-20260907", nota: "Cuenta de la sucursal",
  operacion_id: "d638b466-ef33-43f4-84f3-8ae808860001",
}, 1, usuario, driveLocal);
assert.equal(leerSalida(DB, deposito.salida_id, alcance).origen, "BANCO");
assert.equal(DB.gastos.gastos.length, 0);
```

- [ ] Ejecutar `node --test backend/depositosTombola.test.js backend/depositos.test.js backend/estadoCuenta.test.js backend/tombolaMigracion.test.js`; verificar verde, comprobante posterior y cancelación sin borrar Drive. Actualizar `nuevoDB()` local de depósitos para sembrar cajas y cuenta/permiso explícitos cuando haga falta; conservar su propósito original.
- [ ] Commit: `git add backend/depositos.js backend/salidasTombola.js backend/depositosTombola.test.js backend/depositos.test.js`; `git commit -m "feat(tombola): depositos vinculados sin perder su historia"`.

### Task 6: Cerrar cancelaciones y correcciones como puertas de dinero

**Files:**
- Modify: `backend/gastos.js`
- Modify: `backend/depositos.js`
- Modify: `backend/salidasTombola.js`
- Test: `backend/tombolaCorrecciones.test.js`

**Interfaces:**
- Consumes: `esDeLaEraSellada(fechaHora, DB)`, `esDeEstaCaja(registro, caja)`, `resolverCajaDeSucursal(DB, sucursalId, cajaId)`, `exigirAccionTombola(DB, usuario, claves, sucursalId)`, `cambioTombola(DB, cambiar)`, `prepararErogacion(DB, datos, contexto)`, `buscarCoincidencias(DB, preparada)`, `reservarErogacion(DB, preparada, autorizacionId, ahoraISO)` y `confirmarErogacion(DB, operacionId, resultado, ahoraISO, tx)`.
- Produces: `gastoYaCortado(DB, gasto): boolean`; `corregirOrigenGasto(DB, id, cambios, usuario, alcance): Gasto` (se agrega alcance obligatorio a la firma actual de cuatro argumentos); `cancelarSalidaTombola(DB, id, motivo, usuario, alcance): Salida`; `corregirSalidaTombola(DB, id, cambios, usuario, alcance): Salida`; `adjuntarComprobanteSalida(DB, id, archivo, usuario, alcance, drive): Promise<Salida>`. `cambios = {caja_id,motivo,operacion_id,autorizacion_id?,origen?}`; solo Gastos admite origen. La corrección tiene un UUID de operación distinto del alta, pero conserva el UUID original y la identidad de la erogación en el registro fuente. Corrección de depósito/salida fuerte cambia solo caja con motivo; origen de un gasto se corrige mediante el servicio de Gastos y actualiza su vínculo en el mismo lote. Todas las operaciones conservan las bitácoras fuente y agregan evento ST con antes/después.

- [ ] Escribir `corregir gasto ajeno responde no encontrado sin mutar`, `caja invalida no deja origen cambiado`, `gasto sellado no admite correccion`, `gasto historico anterior a corte tampoco se reescribe`, `corregir origen abierto crea o conserva un solo vinculo`, `correccion hacia cajon revisa coincidencias y reserva activa`, `cancelar por fuente actualiza la unica salida`, `cancelar por salida conserva fuente comprobante y motivo`, `segunda cancelacion no repone dinero otra vez`, `corregir caja de deposito conserva monto y forma`, `permiso de registrar no permite cancelar ni corregir`, `cancelar durante Drive invalida el resultado tardio`. El fixture de gasto histórico debe tener fecha previa a época y corte posterior sin `corte_id`, para demostrar el hueco real.
- [ ] Ejecutar `node --test backend/tombolaCorrecciones.test.js`; verificar rojo: la corrección actual permite acceso ajeno y puede cambiar origen antes de lanzar por caja.
- [ ] Implementar prevalidación completa y lote síncrono. `gastoYaCortado` devuelve true si hay sello; en era histórica si existe corte de la misma sucursal y `esDeEstaCaja` con fecha_hora mayor o igual a la del gasto. En era sellada sin sello devuelve false. No modificar `cortes.js`. Validar forma/origen/caja/permisos antes de tocar el gasto. Una corrección no es una segunda erogación: excluir su propia fuente en la búsqueda, conservar UUID/identidad del alta y registrar antes/después. Reservar la corrección bajo su UUID nuevo, con `contexto.accion:"corregir"` y fuente excluida resuelta por el servidor. Si otro pago/reserva coincide, lanzar 409 y no cambiar nada; la autorización se vincula a la corrección concreta. Cancelar nunca borra el archivo ni reabre un corte antiguo.

```js
const antes = structuredClone(gasto);
assert.throws(() => corregirOrigenGasto(DB, gasto.id,
  { origen: "CAJA_FUERTE", caja_id: cajaAjena.id }, usuario, alcance));
assert.deepEqual(gasto, antes);
```

- [ ] Ejecutar `node --test backend/tombolaCorrecciones.test.js backend/gastosCorteCaja.test.js backend/depositosTombola.test.js`; verificar verde y comparar cortes cerrados byte por byte antes/después de cada intento rechazado. Adjuntar a una fuente gasto que ya tiene archivo debe rechazar reemplazo; el camino normal de adjunción faltante es el depósito.
- [ ] Commit: `git add backend/gastos.js backend/depositos.js backend/salidasTombola.js backend/tombolaCorrecciones.test.js`; `git commit -m "fix(tombola): correcciones y cancelaciones con alcance y rastro"`.

### Task 7: Registrar permisos y conectar todas las rutas de escritura

**Files:**
- Modify: `backend/permisosCatalogo.js`
- Modify: `backend/validarPermisos.js`
- Modify: `backend/server.js`
- Test: `backend/tombolaRutas.test.js`
- Test: `backend/tombolaPermisos.test.js`
- Modify: `backend/gastosRutaCaja.test.js`
- Modify: `backend/gastoCajaFuertePermiso.test.js`

**Interfaces:**
- Consumes: `alcanceActor(DB, usuario)`, `crearSalidaTombola(DB,datos,sucursalId,usuario,drive)`, `cancelarSalidaTombola(DB,id,motivo,usuario,alcance)`, `corregirSalidaTombola(DB,id,cambios,usuario,alcance)`, `adjuntarComprobanteSalida(DB,id,archivo,usuario,alcance,drive)`, `autorizarCoincidencia(DB,solicitudId,motivo,usuario,ahoraISO)`, `rechazarCoincidencia(DB,solicitudId,motivo,usuario,ahoraISO)`, `adjuntarEvidenciaSolicitud(DB,solicitudId,archivo,usuario,drive)`, `listarSolicitudesErogacion(DB,filtros,usuario)`, `requiereLogin(req,res,next)`, `requierePermiso(clave,resolverPermisosDeRol)` y `sembrarCuentas(app, cuentas)`.
- Produces: `POST /api/salidas-tombola` → Salida; `PUT /api/salidas-tombola/:id/cancelar` con `{motivo}` → Salida; `PUT /api/salidas-tombola/:id/caja` con `{caja_id,motivo,operacion_id,autorizacion_id?}` → Salida; `POST /api/salidas-tombola/:id/comprobante` con `{archivo}` → Salida; `GET /api/erogaciones/solicitudes` → Solicitud[]; `POST /api/erogaciones/solicitudes/:id/autorizar` y `/rechazar` con `{motivo}` → Solicitud; `POST /api/erogaciones/solicitudes/:id/comprobante` con `{archivo}` → Solicitud. Las rutas actuales `/api/gastos`, `/api/gastos/:id/origen`, `/api/gastos/:id/cancelar`, `/api/depositos`, `/api/depositos/:id/cancelar`, `/api/depositos/:id/comprobante` llaman a los mismos servicios protegidos. Éxito 200; errores tipados con su estatus y cuerpo `{error,codigo,solicitud_id?,conflictos?}`.

- [ ] Escribir `catalogo y guard contienen tablero_dinero y sus seis permisos`, `Administrador se reconcilia y Cajero no recibe permisos nuevos`, `ver no autoriza registrar cancelar adjuntar corregir ni desbloquear`, `permiso de gasto no crea salida fuerte por API vieja`, `permiso de deposito no retira tombola por API vieja`, `sucursal de alta sale del token y caja del cuerpo`, `query de otra sucursal no es guarda por id`, `local no lee ni muta id ajeno`, `HTTP duplicado responde 409 y persiste solicitud`, `autorizar desde cuenta propia con id textual se rechaza`, `respuesta exitosa se envia despues del guardado`, `autorizacion por API no puede traer aprobador falsificado`. Para cada denegación dar permisos vecinos, y probar la misma petición con el permiso correcto como control positivo.
- [ ] Ejecutar `node --test backend/tombolaPermisos.test.js backend/tombolaRutas.test.js`; verificar rojo por catálogo/ruta ausentes y controles viejos insuficientes. Preparar servidor real con `DB_PATH` temporal ANTES de `require("./server")`, `app.listen(0)`, `firmarToken`, `sembrarCuentas`; seguir estructura de `gastosRutaCaja.test.js`. Sustituir funciones de Drive en memoria y restaurarlas en `after`, no usar Drive real.
- [ ] Añadir las seis claves del spec 8 con campos reales `{clave,etiqueta,modulo:"tablero_dinero",implementado:true}`, módulo en `MODULOS_SISTEMA` y `MODULOS_QUE_REQUIEREN_PERMISOS`. Conectar rutas con permisos propios y fuente según matriz del spec. Preservar permisos de operaciones no vinculadas. En altas usar `req.usuarioToken.sucursal_id` y `req.body.caja_id`; por id pasar `alcanceActor`, nunca query. Comprobar permiso y cuenta nuevamente en servicios tras esperas. El error 409 debe permitir a la UI conservar `solicitud_id`. Cambiar el middleware para omitir auto-guardado solo si el servicio ya persistió y marcó `res.locals.tombolaPersistida`; no enviar JSON de éxito antes de esa confirmación.
- [ ] Escribir `corte durante registro de gasto del cajon espera sin firmar faltante`, `salida fuerte pendiente no bloquea corte`, `gasto pendiente de otra caja no bloquea este corte`; ejecutar `node --test backend/tombolaRutas.test.js` y verificar rojo. En `POST /api/cortes`, antes de `crearCorte`, comprobar reservas activas de origen CAJON con sucursal del corte ya resuelta y `esDeEstaCaja(reserva,cajaResuelta)`; responder 409 `GASTO_EN_REGISTRO` con el texto del spec 6. No cambiar `calcularCorteEnCurso`, `crearCorte` ni su sellado. Ejecutar el mismo comando y verificar verde. Esta guarda solo cubre el gasto que sigue guardándose: no convierte fallos de Drive en gastos confirmados.

```js
const alcance = alcanceActor(DB, req.usuarioToken);
const salida = cancelarSalidaTombola(DB, req.params.id, req.body.motivo,
  req.usuarioToken, alcance);
res.locals.tombolaPersistida = true;
res.json(salida);
```

- [ ] Actualizar `cuerpoGasto`/fixtures locales de `gastosRutaCaja.test.js` y `gastoCajaFuertePermiso.test.js` con UUID, caja declarada y erogación OTRO/fecha local. Dar los nuevos permisos solo al control positivo; mantener las pruebas negativas con permisos vecinos. Añadir `HTTP solicitud sin evidencia no se autoriza` y `HTTP archivo ajeno no se adjunta a solicitud`, comprobar rojo, conectar sus guardas y comprobar verde. Ejecutar `node --test backend/tombolaRutas.test.js backend/tombolaPermisos.test.js backend/gastosRutaCaja.test.js backend/gastoCajaFuertePermiso.test.js backend/permisoEstadoCuenta.test.js backend/arranquePersistencia.test.js`; verificar verde. Solicitar revisión independiente del dinero y permisos de Tasks 1–7 antes de habilitar estas escrituras; si implementó Codex, el revisor debe ser distinto de Codex.
- [ ] Commit: `git add backend/permisosCatalogo.js backend/validarPermisos.js backend/server.js backend/tombolaRutas.test.js backend/tombolaPermisos.test.js backend/gastosRutaCaja.test.js backend/gastoCajaFuertePermiso.test.js`; `git commit -m "feat(tombola): permisos propios y rutas sin puertas alternas"`.

### Task 8: Calcular las tres ubicaciones con componentes que suman

**Files:**
- Create: `backend/tableroDinero.js`
- Test: `backend/tableroDinero.test.js`

**Interfaces:**
- Consumes: `calcularCorteEnCurso(DB, sucursal_id, caja_id, incluirMovimientos = false)` de `cortes.js`, invocada con `true`; `esDeEstaCaja(registro,caja)`; `listarSalidasTombola(DB,filtros,alcance)`; `fechaLocal(instante)`; `exigirAlcance(alcance)`.
- Produces: `obtenerTableroDinero(DB, filtros, alcance, ahoraISO): Tablero`; `detalleCifraTablero(tablero, sucursalId, cajaId, concepto): Cifra`. Conceptos permitidos: `cajon`, `fondo`, `neto_turno`, `tombola`, `disponible`, `banco_efectivo`, `banco_transferencia`, `banco_total`, `cortes_hoy.contado`, `cortes_hoy.retiro`, `cortes_hoy.diferencia`. Funciones puras de lectura; no siembran cajas ni migran datos.

- [ ] Escribir `fondo del ultimo corte mas neto del turno da cajon`, `dos cortes no duplican el fondo retenido`, `retiro usa solo EFECTIVO y conserva el dinero entre ubicaciones`, `deposito efectivo mueve tombola a banco una sola vez`, `transferencia suma banco sin bajar tombola`, `salida de nomina baja tombola sin tocar cajon`, `gasto fuerte migrado no desaparece ni se duplica`, `tarjeta cheque vales transferencia ML credito y monedero no son efectivo`, `abono cuenta solo el pago real y no el apartado entero`, `garantias siguen exactamente los movimientos del corte`, `historico nulo y caja textual usan esDeEstaCaja`, `turno de ayer se incluye aunque cortes hoy use fecha local`, `sin cortes no inventa fondo inicial`, `resguardo negativo permanece visible`, `dato corrupto produce subtotal desconocido y no cero`, `cada componente y total reproduce exactamente su cifra`, `leer tablero no modifica DB`, `cancelacion posterior conserva contexto del corte anterior`. Sembrar un corte con contado 1000/retiro 800 y movimiento posterior de venta EFECTIVO 500; esperado cajón 700, tómbola 800.
- [ ] Ejecutar `node --test backend/tableroDinero.test.js`; verificar rojo por cálculo ausente, luego por valores aritméticos distintos si existe un esqueleto. Añadir valores 0.10 y 0.20 para probar suma exacta de centavos.
- [ ] Implementar fórmulas del spec 9. Ordenar cortes por fecha_hora y, en empate, id numérico para elegir el último; filtrar sucursal antes de `esDeEstaCaja`. Usar `.calculado.EFECTIVO`, nunca `.total_calculado`. Extraer componentes de `movimientos_incluidos` ya resueltos por el corte, no duplicar la lógica de épocas. Excluir de depósitos físicos TRANSFERENCIA; sumar banco desde fuentes DEP activas vinculadas una vez. Identificar fondos como “según último conteo” y diferencias como “firmadas”, sin mover cortes ni atribuir robo. Validar catálogo antes de llamar a una función que podría devolver caja null.

```js
const { calculado, movimientos_incluidos } = calcularCorteEnCurso(DB, 1, caja.id, true);
const fondoCentavos = Math.round(Number(ultimo.contado.EFECTIVO) * 100)
  - Math.round(Number(ultimo.retiro.EFECTIVO) * 100);
assert.equal(fondoCentavos, 20000);
assert.equal(Math.round(calculado.EFECTIVO * 100), 50000);
assert.equal(movimientos_incluidos.ventas.length, 1);
assert.equal(tablero.sucursales[0].cajas[0].cajon.importe_centavos, 70000);
```

- [ ] Ejecutar `node --test backend/tableroDinero.test.js backend/cajas.test.js backend/gastosCorteCaja.test.js`; verificar verde y `deepStrictEqual` de DB antes/después de la lectura. Probar cancelados en ambos tipos de fuente y que los cortes de hoy no se suman por segunda vez al disponible.
- [ ] Commit: `git add backend/tableroDinero.js backend/tableroDinero.test.js`; `git commit -m "feat(tablero): cifras de cajon tombola y depositos verificables"`.

### Task 9: Exponer lectura y evidencia sin filtrar mal ni revelar el corte ciego

**Files:**
- Modify: `backend/server.js`
- Modify: `backend/salidasTombola.js`
- Test: `backend/tableroDineroRutas.test.js`

**Interfaces:**
- Consumes: `obtenerTableroDinero(DB,filtros,alcance,ahoraISO)`, `leerSalida(DB,id,alcance)`, `alcanceActor(DB,usuario)`, `listarSolicitudesErogacion(DB,filtros,usuario)`.
- Produces: `GET /api/tablero-dinero?sucursal_id=todas|id` → Tablero; `GET /api/salidas-tombola?sucursal_id=todas|id&estatus=activo|cancelado` → Salida[]; `GET /api/salidas-tombola/:id` → Salida; `GET /api/salidas-tombola/:id/movimientos` → eventos ST y fuente identificados. Estas cuatro exigen `ver_tablero_dinero`. `GET /api/erogaciones/solicitudes` devuelve solicitudes propias a capturistas o todas las autorizadas por alcance a quien puede autorizar, con resumen reducido y sin saldos. `GET /api/salidas-tombola/catalogos` → `{cajas,empleados,proveedores,categorias}` de captura; `GET /api/salidas-tombola/operables` → operaciones mínimas que ese actor puede administrar; `GET /api/salidas-tombola/:id/operacion` → detalle para una acción permitida. En `salidasTombola.js` producir `catalogosCapturaTombola(DB,usuario)`, `listarSalidasOperables(DB,filtros,usuario)` y `leerSalidaOperable(DB,id,usuario)`. Registrar rutas estáticas antes de `/:id`.

- [ ] Escribir `ver_tablero es propio y permiso vecino no muestra esperado`, `registrar salida sin ver tablero no obtiene saldos por ninguna ruta`, `global abre evidencia de otra tienda pese al query inyectado`, `local recibe 404 para fuente ajena e inexistente`, `filtro todas no amplifica alcance local`, `query repetido invalido no se interpreta como todas`, `caja del encabezado no esconde la otra caja`, `total visible solo suma tiendas autorizadas`, `detalle conserva componentes del mismo instante`, `solicitante sin ver tablero recibe solo resumen de su conflicto`, `ninguna respuesta expone base64 reservas ajenas ni tokens de autorizacion`.
- [ ] Ejecutar `node --test backend/tableroDineroRutas.test.js`; verificar rojo por rutas ausentes o permisos insuficientes. Fixture real con DB_PATH temporal, `sembrarCuentas`, cuentas en sucursales 1 y 2 y rol con `registrar_salidas_tombola` pero sin ver.
- [ ] Conectar consulta con `alcanceActor`, validar filtro de lista contra valores permitidos e intersectarlo sin sustituir alcance. Ignorar query caja en resumen; las dos cajas siempre aparecen. Para fuentes por id, no leer sucursal/caja del query. Serializar únicamente DTO autorizados; la bitácora devuelve actor/id, fuente, fecha, antes/después y comprobante, nunca datos de sesión. Los componentes vienen en la respuesta del tablero para que abrir una cifra no cambie su composición por una operación posterior.
- [ ] Escribir `capturista obtiene nombres para nomina sin administrar roles`, `catalogo no revela cuenta password ni empleados ajenos`, `cancelador sin ver tablero puede localizar la salida pero no el esperado`, `solo registrador ve unicamente sus salidas operables`, `detalle operable ajeno devuelve 404`; ejecutar rojo con `node --test backend/tableroDineroRutas.test.js`. Implementar catálogos mínimos y acceso a operaciones del spec 8 y 11; no dar `administrar_roles` para llenar empleado. En operables, permiso de la acción fuente y de tómbola, alcance por token y autor propio para quien solo registra; cero saldos agregados/esperados. Ejecutar el mismo comando y verificar verde.

```js
const alcance = alcanceActor(DB, req.usuarioToken);
const resultado = obtenerTableroDinero(DB,
  { sucursal_id: req.query.sucursal_id }, alcance, new Date().toISOString());
res.json(resultado);
```

- [ ] Ejecutar `node --test backend/tableroDineroRutas.test.js backend/tombolaRutas.test.js backend/corteEnCursoPermiso.test.js`; verificar verde. Asegurar que el corte ciego sigue oculto en su API y que el permiso de ver tablero está documentado como acceso explícito al esperado, sin concederlo por registrar.
- [ ] Commit: `git add backend/server.js backend/salidasTombola.js backend/tableroDineroRutas.test.js`; `git commit -m "feat(tablero): lectura y evidencia con alcance independiente"`.

### Task 10: Capturar salidas y resolver rechazos desde las pantallas reales

**Files:**
- Create: `src/SalidasTombola.jsx`
- Create: `src/tombolaFormulario.js`
- Modify: `src/Gastos.jsx`
- Modify: `src/EstadoCuenta.jsx`
- Test: `src/tombolaFormulario.test.js`

**Interfaces:**
- Consumes: rutas de Tasks 7 y 9; `apiFetch(ruta,opciones)`, `pedirLista(pedir,descripcion)` y `pedirDato(pedir,descripcion)` existentes; `comprimirImagen(archivo)` existente.
- Produces: `SalidasTombola({permisos,usuario,onCambio})` (componente); `nuevoFormularioTombola(usuario,operacionId): object`; `cuerpoSalida(form,archivo): object`; `mensajeRechazoErogacion(respuesta): {texto,solicitud_id,accion}`; `puedeAccionTombola(permisos,accion): boolean`. Helpers sin JSX, comprobables con Node. `accion` admite `ver`, `registrar`, `cancelar`, `adjuntar`, `corregir`, `autorizar`, con correspondencia a las seis claves del spec; ausencia de permisos devuelve false.

- [ ] Escribir `formulario fija sucursal de sesion y no toma caja global`, `cuerpo conserva UUID al reintentar y declara caja elegida`, `deposito transferencia preserva forma referencia y nota`, `nomina envia empleado y periodo sin crear otro gasto`, `rechazo conserva solicitud y pasos para destrabarse`, `sin permisos no aparecen acciones`, `autorizacion no puede inventarse en el cuerpo`. Ejecutar `node --test src/tombolaFormulario.test.js`; verificar rojo funcional por helpers ausentes.
- [ ] Implementar helpers y `SalidasTombola`: tipo, caja propia, monto, concepto/categoría e identidad cuando corresponda, comprobante, resumen explícito de efecto. Generar UUID una vez con `crypto.randomUUID()` al abrir, conservarlo durante reintentos, generar otro al iniciar una operación distinta. Cargar `/salidas-tombola/catalogos`, que obtiene cajas/empleados de la sesión; no leer caja activa como destino. Usar `/salidas-tombola/operables` y `/:id/operacion` para acciones de quien no ve el tablero. Lista de solicitudes con “Enviar comprobante a revisión”, autorizar/rechazar solo en sesión del segundo actor, ambos comprobantes visibles para ese revisor, motivo obligatorio y estado persistente; tras aprobar, el capturista reintenta idéntica operación con `autorizacion_id` y el servidor verifica todo.

```js
// Copia de interfaz al recibir 409; no cerrar ni borrar el formulario.
const bloqueo = mensajeRechazoErogacion(data);
setRechazo(bloqueo);
setGuardando(false);
// Nunca reenviar automáticamente como origen CAJON.
```

- [ ] Integrar Gastos con `operacion_id` y metadatos de erogación en efectivo. La opción CAJA_FUERTE guarda fuente y ST una vez y muestra su enlace. Integrar Estado de Cuenta con caja explícita y UUID conservando DEP, referencia, nota, archivo opcional y adjunción posterior. Mostrar sucursal de sesión fija en ambos formularios; eliminar el bloqueo que depende de estar viendo esa misma sucursal en el encabezado, manteniendo confirmación visible del destino real. No cambiar la sucursal de escritura. Rechazo 409 es un panel persistente, no un aviso que desaparece en cuatro segundos. Todas las pantallas conservan archivo y datos para reintentar.
- [ ] Ejecutar `node --test src/tombolaFormulario.test.js` y `npx eslint src/SalidasTombola.jsx src/tombolaFormulario.js src/Gastos.jsx src/EstadoCuenta.jsx`; verificar verde y cero errores. Prueba de navegador `UI-SAL-01`: dos sesiones, nómina $300 fuerte, gasto coincidente rechazado; autorización por otra persona para servicio distinto, reintento único. `UI-DEP-01`: capturar sin ficha, adjuntarla después, fallo Drive visible, ninguna segunda acreditación. `UI-ALC-01`: encabezado Yajalón, sesión Ocosingo, formulario declara Ocosingo/Fiscal y guarda allí sin esconderse ni heredar caja ajena. Comprobar llamadas HTTP y el detalle fuente/ST.
- [ ] Commit: `git add src/SalidasTombola.jsx src/tombolaFormulario.js src/tombolaFormulario.test.js src/Gastos.jsx src/EstadoCuenta.jsx`; `git commit -m "feat(tombola): captura y desbloqueo visibles para la tienda"`.

### Task 11: Mostrar el tablero y abrir todas sus cifras

**Files:**
- Create: `src/TableroDinero.jsx`
- Create: `src/tableroDineroVista.js`
- Modify: `src/App.jsx`
- Modify: `src/menuCategorias.js`
- Modify: `src/BarraLateral.jsx`
- Modify: `src/EncabezadoModulo.jsx`
- Test: `src/tableroDineroVista.test.js`
- Test: `src/menuCategorias.test.js`

**Interfaces:**
- Consumes: `GET /api/tablero-dinero` → Tablero; `SalidasTombola({permisos,usuario,onCambio})`; `apiFetch(ruta,opciones)`; `categoriasVisibles(usuario)` de `menuCategorias.js`.
- Produces: `TableroDinero({onVolver,permisos,usuario})`; `estadoVistaTablero({cargando,error,datos}): {estado,texto,mostrarCifras}`; `seleccionarDetalle(tablero,sucursalId,cajaId,concepto): Cifra`; `aceptarRespuestaTablero(idRespuesta,idSolicitudActual): boolean`. Vista `tablero_dinero` en App y Administración; acceso al módulo para cualquiera de sus seis acciones, pestaña de cifras exclusivamente con ver.

- [ ] Escribir `cero real no se confunde con error o carga`, `error no conserva cifras de otra sucursal`, `respuesta antigua no pisa filtro nuevo`, `detalle abre componentes de la misma respuesta`, `banco se rotula depositado y no disponible`, `usuario que solo registra entra a Salidas sin ver Dinero`, `menu muestra tablero solo con su modulo y alguna accion`. Ejecutar `node --test src/tableroDineroVista.test.js src/menuCategorias.test.js`; verificar rojo por vista/helpers/entrada inexistentes.
- [ ] Implementar tabla por sucursal con Administrativa/Fiscal/Total, cifras del spec 9, hora de actualización, botón Actualizar y estados explícitos. Cada cifra abre el detalle ya recibido por teclado/clic; el detalle permite evidencia por fuente con la guarda de servidor. Estado error muestra “No disponible”, no `$0`. El id incremental de solicitud evita respuestas viejas. Listas envían `sucursal_id` explícito incluso en todas; el encabezado no modifica una respuesta a mitad de lectura. Mostrar cobertura histórica, fondo retenido y aclaración de banco, con resguardo negativo sin imputarlo a una cajera.

```js
{ id: "tablero_dinero", nombre: "Tablero de Dinero", modulo: "tablero_dinero",
  permiso: ["ver_tablero_dinero", "registrar_salidas_tombola",
    "cancelar_salidas_tombola", "adjuntar_comprobantes_tombola",
    "corregir_salidas_tombola", "autorizar_erogacion_repetida"] }
```

- [ ] Integrar `TableroDinero` en `App.jsx`/`MODULOS`, etiqueta en `EncabezadoModulo.jsx`, entrada en `menuCategorias.js` e icono `Landmark` ya importado en `BarraLateral.jsx`. `onCambio` recarga dinero solo si tiene ver; las demás pestañas no descargan el esperado. No usar el Dashboard anterior como menú: hoy el menú vive en BarraLateral/menuCategorias.
- [ ] Ejecutar `node --test src/tableroDineroVista.test.js src/menuCategorias.test.js` y `npx eslint src backend`; verificar verde/cero errores. Prueba navegador `UI-TAB-01`: ejemplo completo del spec 11, abrir cajón/tómbola/banco/cortes hoy y sumar los componentes. `UI-TAB-02`: rol capturista no obtiene cifras ni por pestaña ni por llamada API. `UI-TAB-03`: simular error HTTP y cambios rápidos de sucursal; no presentar ceros ni una respuesta vieja. `UI-TAB-04`: operar a 360 px, escritorio y solo teclado, sin botón de evidencia inaccesible.
- [ ] Commit: `git add src/TableroDinero.jsx src/tableroDineroVista.js src/tableroDineroVista.test.js src/App.jsx src/menuCategorias.js src/menuCategorias.test.js src/BarraLateral.jsx src/EncabezadoModulo.jsx`; `git commit -m "feat(tablero): pantalla y desglose de cada cifra"`.

### Task 12: Sobrevivir a reinicios y restauraciones y comprobar el circuito completo

**Files:**
- Modify: `backend/erogaciones.js`
- Modify: `backend/respaldos.js`
- Modify: `backend/reconciliarRestauracion.js`
- Modify: `backend/server.js`
- Test: `backend/tombolaRecuperacion.test.js`
- Test: `backend/tableroDineroIntegracion.test.js`

**Interfaces:**
- Consumes: `migrarSalidasTombola(DB,ahoraISO)`, `configurarPersistenciaTombola(DB,guardar)`, `reconciliarTrasRestaurar(db): {db,reparaciones}`, `validarAntesDeRestaurar(datos)`, `contarRegistros(DB)` de `respaldos.js`, `crearSalidaTombola(DB,datos,sucursalId,usuario,drive)`, `crearGasto(DB,datos,sucursalId,usuario,drive,cajaId)`, `autorizarCoincidencia(DB,solicitudId,motivo,usuario,ahoraISO)`, `adjuntarEvidenciaSolicitud(DB,solicitudId,archivo,usuario,drive)`, `obtenerTableroDinero(DB,filtros,alcance,ahoraISO)`.
- Produces: `recuperarErogacionesInterrumpidas(DB, ahoraISO): {interrumpidas,revocadas}`; nuevos conteos `salidas_tombola`, `reservas_erogaciones`, `solicitudes_erogaciones`; conserva formatos de respaldo y comparación de claves que una copia antigua realmente declaró. Recuperación solo en arranque/restauración, nunca al listar ni al crear otra reserva.

- [ ] Escribir `reinicio conserva operacion confirmada y no vuelve a pagar`, `reinicio interrumpe reserva y revoca aprobacion sin crear salida`, `restaurar foto vieja migra una sola vez sin mezclar vinculos actuales`, `restaurar durante Drive impide escritura tardia sobre foto nueva`, `respaldo contiene salidas solicitudes y bitacora`, `conteos nuevos no invalidan respaldo anterior que no los declara`, `flujo completo conserva dinero y protege a cajera`, `fallo de persistencia no responde exito ni pierde movimiento ajeno`. Usar DB_PATH temporal, cerrar/reabrir proceso de prueba con `node:child_process` y Drive simulado; la prueba de restauración cambia realmente `DB.cuenta_comun`, no solo una variable de prueba. El flujo conserva cajón 700 después de nómina/rechazo; tras el segundo servicio legítimo de 300 pagado realmente del CAJON y autorizado, acaba en cajón 400, tómbola 300 y depósitos registrados 600 según spec 11.
- [ ] Ejecutar `node --test backend/tombolaRecuperacion.test.js backend/tableroDineroIntegracion.test.js`; verificar rojo por reservas que todavía no se recuperan y conteos ausentes. Si el flujo aritmético ya pasa, conservarlo como integración; el rojo de la tarea corresponde a recuperación pendiente, no fabricar una regresión.
- [ ] Implementar transición durable reservada→interrumpida y autorización no consumida→revocada al arrancar/restaurar, con evento de sistema y motivo. Llamar después de migración y antes de aceptar escrituras; persistir una vez. Conservar operación confirmada y su resultado para idempotencia. Validar generación de `cuenta_comun.tombola` en toda continuación de Drive; una restauración la reemplaza y no puede aceptarse el resultado viejo. Agregar conteos bajo `cuenta_comun`, ya incluida en `COLECCIONES_RESPALDADAS`; no crear colección raíz que se olvide al respaldar. En respaldo viejo sin `tombola`, inicializar desde sus propias fuentes, nunca conservar vínculos del presente.

```js
const generacion = DB.cuenta_comun.tombola;
// Después de la espera de Drive y antes de confirmar cualquier fuente:
if (DB.cuenta_comun.tombola !== generacion) {
  throw Object.assign(new Error("Se restauró el sistema. Revisa el pago antes de reintentar."),
    { estatus: 409, codigo: "BASE_RESTAURADA" });
}
```

- [ ] Ejecutar `node --test backend/tombolaRecuperacion.test.js backend/tableroDineroIntegracion.test.js backend/respaldos.test.js backend/respaldosVersionAnterior.test.js backend/reconciliarRestauracion.test.js`; verificar verde. Desde `backend`, ejecutar `node --test`; después desde raíz `node --test src/tombolaFormulario.test.js src/tableroDineroVista.test.js src/menuCategorias.test.js`, `npx eslint src backend` y `git diff --check`. Verificar cero fallas/errores y ningún cambio a cortes, fechas históricas o archivos no previstos. No tratar EPERM de este despacho como aprobación de esas pruebas.
- [ ] Ejecutar en navegador `ACEPTACION-DINERO-01`: cobrar, contar/cortar con retiro, ver fondo y movimiento a tómbola, registrar nómina, competir desde otra sesión durante la subida, recibir 409, resolver coincidencia legítima con otro usuario, depositar efectivo, registrar transferencia y abrir cada cifra. `ACEPTACION-HISTORIA-01`: comparar corte viejo y depósito viejo, restaurar copia de prueba y repetir consulta sin duplicaciones. Revisor independiente inspecciona diff completo, race test, rutas viejas y nuevas y resultados del navegador. Entregar a Victor qué caja/sucursal afecta cada operación y evidencia de esas dos pruebas; si implementa Codex, esa revisión no puede hacerla Codex.
- [ ] Commit: `git add backend/erogaciones.js backend/respaldos.js backend/reconciliarRestauracion.js backend/server.js backend/tombolaRecuperacion.test.js backend/tableroDineroIntegracion.test.js`; `git commit -m "test(tombola): recuperacion y circuito completo del dinero"`. No push, merge ni rebase. Si rechaza el commit, detener intentos y reportar las rutas pendientes.

## Cobertura y criterio de entrega

| Necesidad | Entregable verificable |
|---|---|
| Concepto primero; una migración; historia intacta | Task 1, Task 12 |
| Una fuente monetaria, depósitos sin gasto ficticio, gastos fuertes existentes incluidos | Tasks 4–5, Task 8 |
| Rechazo concurrente, reserva, segundo actor, uso único y recuperación | Task 3, Task 4, Task 7, Task 12 |
| Caja del formulario/sucursal de sesión y alcance por id | Task 2, Task 6, Task 7, Task 9 |
| Banco separado de efectivo y fondo sin duplicar | Task 8, Task 11 |
| Corte ciego, permisos separados y registro en arranque | Task 7, Task 9, Task 11 |
| Evidencia y responsable por cada importe/acción | Matriz del spec 10; Tasks 1, 3–9, 11–12 |
| Persona de tienda sabe cómo destrabarse | Task 10, aceptación de Task 12 |

La tarea decisiva es **Task 3**: el rechazo debe existir mientras Drive sigue trabajando y la autorización no debe poder autorizarse a sí misma, prestarse ni consumirse dos veces. Tasks 4, 5 y 7 tienen que demostrar que todas las puertas realmente usan ese mismo control. Una pantalla bonita o una prueba secuencial no sustituye esa evidencia.
