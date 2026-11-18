# Informe de implementación — Resurtido, Entrega 1

Worktree: `resurtido-e1`. Rama: `feature/resurtido-e1`. HEAD al retomar: `d6e48ba`.
Estado: entrega parcial, detenida antes de implementar Task 4 por contradicción de conducta.
Todos los cambios quedan sin staging ni commits. No se corrió la suite completa.

## Condición de detención: Task 4

El plan, líneas 180–181, pide guardar el valor nuevo tanto al pasar a existencia ≤ 0 como al salir de ella,
y dice que así se conserva el agotamiento aunque se resurtiera antes de la noche.
Sin embargo, la tabla tiene una sola fila por tienda/clave/día (línea 101) y `diasEnCero` consulta existencia ≤ 0
(línea 195). En un día con 5 → 0 → 8 piezas, guardar ambos valores nuevos termina en 8 y pierde el agotamiento.
Conservar el 0 cumpliría el objetivo, pero incumpliría guardar el valor nuevo al salir de cero.

Esto cambia la conducta que se construye; no es una diferencia de nombre o firma. Aplica la aclaración del contrato.
No se modificó la ingesta. Los cambios a `sicarRepositorio.js` son únicamente las tablas de Task 1.

Propuesta mínima pendiente de decisión: definir `resurtido_existencia_diaria` como el menor valor observado durante
el día; una observación posterior positiva no borra el agotamiento, y la existencia actual sigue leyéndose de
`sicar_existencias`. Mantiene el esquema, pero requiere corregir explícitamente la regla de Task 4.
Alternativa: conservar la última existencia y agregar un indicador diario de agotamiento; requiere ampliar esquema y respaldo.

## Task 1 — Tablas, configuración, permisos y respaldo

Archivos modificados:

- `backend/sicarRepositorio.js`: seis tablas de resurtido, incluida calidad del cálculo.
- `backend/sicarRespaldo.js`: tablas al final, generación anterior de 44 tablas conservada con/sin bandeja,
  selección de generación por datos presentes y reconocimiento del prefijo al preparar restauraciones.
- `backend/permisosCatalogo.js`: cinco permisos; visto bueno y aprobación permanecen no implementados.
- `backend/resurtido/config.js`: valores iniciales, lectura, validación y cambios con historial transaccional.
- `backend/resurtido/config.test.js` y `backend/sicarRespaldo.test.js`.

Pruebas nuevas: **7; las 7 estuvieron rojas antes** por conductas ausentes (5 de configuración/permisos y 2 de respaldo).
Se usaron funciones vacías iniciales para obtener aserciones rojas, sin depender de imports inexistentes.
Línea base de respaldo antes de los cambios: 60/60.

Comando desde la raíz:

```powershell
node --preserve-symlinks --preserve-symlinks-main --test backend/resurtido/config.test.js backend/sicarRespaldo.test.js
```

Salida: `tests 67; pass 67; fail 0; skipped 0`.
El caso de copia anterior comprueba 44 tablas, sin tablas de resurtido; la copia nueva restaura ajustes con y sin bandeja.

Arranque verificado durante cinco segundos en puerto local efímero, con base SQLite desechable y sin cargar
`backend/.env`: `Sistema de permisos validado: 13 módulos, 131 permisos`, `ARRANQUE_RESURTIDO_OK`, `NODE_EXIT=0`.
Se importó la aplicación y se abrió el puerto desde un script temporal, para no activar ciclos externos ni importar SAT.
No se ejecutó literalmente `node server.js`; ésta es una limitación del chequeo de arranque.

Desviaciones y detalles:

- Se amplió la sustitución de prefijos de restauración; sin ella intentaba crear las tablas vivas de nuevo.
  La falla se identificó y corrigió; las 60 pruebas existentes volvieron a verde.
- El plan no proporciona máximos concretos de configuración: se validan enteros seguros, días positivos,
  z no negativo y porcentaje entre 0 y 100, sin inventar topes de negocio. Antes de exponer la configuración
  debe revisarse el límite operativo de ventanas muy grandes: aún no hay servicio ni rutas.
- `npx eslint` falló por EPERM al resolver enlaces; se ejecutó el mismo ESLint instalado directamente con las
  dos banderas de Node, sin instalar ni cambiar dependencias.

## Task 2 — Temporada por marca

Archivos: `backend/resurtido/temporada.js`, `backend/resurtido/temporada.test.js`.
Pruebas nuevas: **6; las 6 estuvieron rojas antes**, después verdes.

```powershell
node --preserve-symlinks --preserve-symlinks-main --test backend/resurtido/temporada.test.js
```

Salida: `tests 6; pass 6; fail 0; skipped 0`.
Cubren índice de octubre, igual peso de claves, acotación, historia insuficiente, años incompletos/en curso y diciembre→enero.
Se sigue la firma ajustada de Task 2: datos por clave y respuesta con motivo.
Normalización antes de acotar, en el orden del plan. La acotación puede alterar la media final de los índices.
La entrada identifica un año completo mediante sus doce meses explícitos; los meses sin venta necesitan valor cero.

## Task 3 — Lector de ventas y existencias

Archivos: `backend/resurtido/lector.js`, `backend/resurtido/lector.test.js`.
Pruebas nuevas: **7; las 7 estuvieron rojas antes**, después verdes.

```powershell
node --preserve-symlinks --preserve-symlinks-main --test backend/resurtido/lector.test.js
```

Salida: `tests 7; pass 7; fail 0; skipped 0`.
Cubren ids duplicados bajo una clave, existencias sumadas, departamentos normalizados, claves omitidas,
cliente+mostrador, cuatro decimales, cancelación posterior, internas, meses por clave y exclusión de CEDIS/Innotec.

Correcciones obvias registradas:

- Se usa `crearRepositorioSicar(sqlite)`, conforme al plan corregido.
- `ventasMensualesMarca` devuelve `Map<clave, Map<YYYY-MM, cantidad>>`, porque Task 2 requiere conservar
  la dimensión clave para darles igual peso. El encabezado de Task 3 aún decía un Map mensual plano.
- `clavesDeMarca` devuelve el Map indicado y añade la propiedad `omitidas` para el conteo solicitado.
- Las primeras pruebas tenían un nombre incorrecto de columna en su fixture de internas; se corrigió a
  `usuario_id/fecha_hora` y se volvió a verificar rojo por aserción antes de implementar.

Riesgo de integración pendiente: el lector mensual devuelve meses con ventas. Al conectar el servicio de Task 6
se debe completar la serie con ceros y delimitar la historia disponible para cumplir el contrato de años completos
de Task 2; no se ha implementado esa integración.

## Tasks 4–8

| Task | Estado | Archivos tocados | Pruebas nuevas / rojas | Comando y salida |
|---|---|---|---|---|
| 4, existencia diaria | Detenida por contradicción descrita | Ninguno de esta task | 0 / 0 | No ejecutado |
| 5, cálculo | No iniciada | Ninguno | 0 / 0 | No ejecutado |
| 6, servicio | No iniciada | Ninguno | 0 / 0 | No ejecutado |
| 7, consultas y rutas | No iniciada | Ninguno | 0 / 0 | No ejecutado |
| 8, pantalla | No iniciada | Ninguno | 0 / 0 | No ejecutado |

## Verificación final del alcance implementado

```powershell
node --preserve-symlinks --preserve-symlinks-main --test backend/resurtido/config.test.js backend/sicarRespaldo.test.js backend/resurtido/temporada.test.js backend/resurtido/lector.test.js
```

Salida: `tests 80; pass 80; fail 0; cancelled 0; skipped 0; todo 0`.
Son 20 pruebas nuevas y 60 existentes; no es la suite completa.

ESLint sobre los diez archivos JS modificados/creados: salida vacía, código 0, usando
`node --preserve-symlinks --preserve-symlinks-main node_modules/eslint/bin/eslint.js <archivos explícitos> --quiet`.
`git diff --check` sin errores. Ninguna línea de esos archivos supera 200 caracteres.
Logs locales en `.superpowers/sdd/2026-11-18-resurtido-minmax-claude/`.

## Pendientes y riesgos

- No hay módulo utilizable aún: faltan observación/reconstrucción, cálculo, servicio, rutas y pantalla.
- No se hizo build ni prueba en navegador: no se modificó frontend.
- No se hizo revisión independiente; corresponde a Claude. Tampoco suite completa, commits, push ni merge.
- No se tocó producción, `agente-sicar/` ni `render.yaml`; no se agregaron dependencias.
- Review Focus 1 (datos atrasados), 3 (negativos en foto/pedido) y 4 (cambio de marca con ajuste) siguen sin cobertura.
- Review Focus 2 (dos ids de una clave) está cubierto por lectura de ventas y existencias.
- Review Focus 5 (cancelación posterior) está cubierto en el lector; falta probar la integración con el recálculo de Task 6.
- El guard de permisos arranca, pero los permisos nuevos de lectura/corrección/configuración no tienen todavía rutas
  ni pantalla que proteger; la entrega no está lista para desplegarse como funcionalidad terminada.
