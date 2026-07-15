# Predicciones de Demanda — pantalla nueva en Inventario

**Fecha:** 2026-07-14
**Proyecto:** CORPUNISOUND (Unisound)
**Estado:** Diseño aprobado — listo para plan de implementación

## Objetivo

Darle a Victor una pantalla para ver, de forma visual, la predicción de
demanda de un producto o categoría — hoy esa capacidad ya existe en el
backend (`backend/predicciones.js`, ruta `GET /api/predicciones`) pero
**no tiene ninguna pantalla**: solo es accesible indirectamente a través
del Asistente de IA. Esta pantalla la hace visible y usable directamente,
como cuarta pestaña dentro de Inventario y Productos (junto a Productos,
Recepción de Compras y Migración de Datos).

El modelo de predicción en sí (tendencia + estacionalidad sobre el
historial real de ventas) **no cambia** — es lógica ya construida y
probada implícitamente por su uso desde el Asistente de IA. Este trabajo
es puramente de interfaz + un permiso nuevo.

## Decisiones de diseño (acordadas con Victor)

1. **Alcance: producto individual O categoría completa.** La pantalla deja
   elegir entre ambos modos — no solo uno.
2. **Visualización: gráfica Y tabla**, no solo una de las dos. La gráfica
   usa **Recharts** (librería nueva de frontend, decisión explícita de
   Victor sobre la alternativa de una gráfica hecha a la medida sin
   dependencia nueva) — línea sólida para histórico real, línea punteada
   para la proyección.
3. **Horizonte de predicción ajustable por el usuario vía calendario.**
   Victor pidió explícitamente un selector de fecha ("agrega un
   calendario para que seleccione fechas"), no un dropdown de 3/6/12
   meses fijos. La pantalla calcula `meses_adelante` como la diferencia
   en meses entre hoy y la fecha elegida, con un tope de 24 meses (un
   modelo de tendencia lineal simple pierde sentido proyectado más allá
   de eso — ver sección "Riesgo abierto").
4. **Permiso propio `ver_predicciones`**, módulo `inventario` — la ruta
   `GET /api/predicciones` hoy solo exige sesión iniciada (`requiereLogin`),
   sin permiso específico, a diferencia de todos los demás módulos del
   sistema. Se corrige agregándole el mismo patrón de permiso dedicado
   que ya usan Traspasos/Recepción de Compras/Migración de Datos. Por la
   reconciliación automática de roles, el Administrador lo recibe solo;
   otros roles (Cajero, Gerente) Victor los habilita a mano si quiere que
   vean esta pestaña.
5. **`predicciones.js` no se modifica.** El modelo estadístico (regresión
   lineal + índice estacional) ya existe y funciona — este trabajo solo
   construye la interfaz y gatea el acceso.
6. **Vive dentro del módulo "inventario" existente** — mismo patrón que
   Migración de Datos: sin módulo nuevo del sistema de permisos, solo un
   permiso nuevo dentro de "inventario".

## Arquitectura

### 1. Permiso nuevo (sin módulo nuevo)

**`backend/permisosCatalogo.js`** — se agrega a `PERMISOS`:

```js
{ clave: "ver_predicciones", etiqueta: "Ver Predicciones de Demanda", modulo: "inventario", implementado: true },
```

- **NO** se toca `MODULOS_SISTEMA` ni `MODULOS_QUE_REQUIEREN_PERMISOS` — el
  módulo "inventario" ya existe en ambos.
- `reconciliarRoles()` (ya activo en cada arranque) une el permiso nuevo
  automáticamente al rol Administrador.

### 2. Ruta protegida

**`backend/server.js`** — la ruta existente `GET /api/predicciones` gana
el gate `requierePermiso("ver_predicciones", resolverPermisosDeRol)`,
igual patrón que las demás rutas de módulos de Inventario. No cambia su
lógica interna (sigue llamando a `predecirDemanda` con el mismo alcance
por sucursal que ya tiene).

### 3. Dependencia nueva del frontend

**`recharts`** en `package.json` (raíz) — librería de gráficas React.
Se usa `<LineChart>` con dos series (`historico` sólida, `prediccion`
punteada) sobre un eje de tiempo mensual compartido.

### 4. Frontend: `src/PrediccionesDemanda.jsx` (nuevo)

Mismo lenguaje visual que el resto de pantallas de Inventario: tabla con
`thead` azul `#1a7fe8`, clases `inputCls`, aviso flotante
(`mostrarAviso`), componente local `BotonBarra` si aplica.

Estructura de la pantalla:

1. **Selector de modo**: "Producto" | "Categoría" (toggle simple, dos
   botones o pestañas internas — decisión de implementación, no de
   diseño).
2. **Si modo = Producto:** el mismo buscador de producto modal (texto +
   filtros + paginación) que ya usan Traspasos/Punto de Venta/Recepción
   de Compras — reutilizar el patrón, no inventar uno nuevo.
   **Si modo = Categoría:** un `<select>` con las categorías existentes
   (mismo patrón que el selector de categoría ya usado en
   `InventarioProductos.jsx`).
3. **Selector de fecha** ("Predecir hasta") — un `<input type="date">` con
   mínimo = hoy + 1 mes (no se permite elegir una fecha pasada o el mes
   actual). La pantalla calcula `meses_adelante` = diferencia en meses
   entre hoy y la fecha elegida, redondeada hacia arriba, con tope de 24.
   Si el usuario elige una fecha que implicaría más de 24 meses, se
   avisa y se usa el tope de 24.
4. **Botón "Calcular predicción"** → `GET /api/predicciones` con
   `producto_id` o `categoria_id` (según el modo) y `meses_adelante`.
5. **Resultado:**
   - Si la API regresa `{ error: "..." }` (sin historial de ventas): se
     muestra ese mensaje de forma clara, sin gráfica ni tabla vacías.
   - Si hay resultado: badge de confianza (`alta`/`media`/`baja`, con
     color — verde/ámbar/rojo) y, si viene `nota` (poco historial), se
     muestra visible arriba de la gráfica, no escondida.
   - **Gráfica Recharts**: eje X = periodo (mes), eje Y = cantidad. Serie
     "Histórico" (línea sólida) + serie "Predicción" (línea punteada),
     ambas en la misma gráfica para que se vea la continuidad.
   - **Tabla debajo**: una fila por periodo (histórico y proyectado),
     columnas Periodo | Cantidad | Tipo (Histórico/Proyectado).

Sin el permiso `ver_predicciones` la pestaña ni siquiera aparece en
Inventario (mismo patrón que Compras/Migración: el tab se filtra por
`puede(t.permiso)`), y si se llamara la ruta directo sin permiso, el
backend regresa 403 — regla de oro de CONVENCION-PERMISOS.md: el
frontend oculta, el backend niega.

### 5. Cableado en `InventarioProductos.jsx`

Se agrega una cuarta entrada al arreglo `TABS` ya existente (creado en el
trabajo de Migración de Datos):

```js
{ id: "predicciones", etiqueta: "Predicciones", permiso: "ver_predicciones" }
```

Y su render condicional `{tab === "predicciones" && <PrediccionesDemanda ... />}`,
mismo patrón que las otras dos pestañas ya cableadas.

## Flujo de datos

1. Usuario elige modo (Producto/Categoría), selecciona el producto o
   categoría, y elige la fecha límite de predicción.
2. Frontend calcula `meses_adelante` y llama
   `GET /api/predicciones?producto_id=X&meses_adelante=N` (o
   `categoria_id=Y`) vía `apiFetch`.
3. Backend calcula con la lógica ya existente de `predecirDemanda` (sin
   cambios) y regresa `{ historico, prediccion, confianza,
   meses_de_historial, nota }` o `{ error }`.
4. Frontend renderiza gráfica + tabla + badge de confianza + nota si
   aplica.

## Manejo de errores

- **Sin historial de ventas** para ese producto/categoría: la API regresa
  `{ error: "No hay historial de ventas para ese producto/categoría" }`
  — se muestra tal cual, sin intentar graficar nada vacío.
- **Fecha inválida** (pasada o mes actual): el `<input type="date">` no
  la permite seleccionar (atributo `min`); si de todos modos llega una
  fecha inválida, se avisa y no se llama a la API.
- **Errores de red/sesión**: mismo patrón `mostrarAviso("❌ " + mensaje)`
  ya usado en todas las demás pantallas.
- **Sin permiso** `ver_predicciones`: la pestaña no aparece (frontend);
  si se llama la ruta directo, 403 (backend) — ya cubierto arriba.

## Pruebas

- **Backend:** `backend/permisoVerPredicciones.test.js` (nuevo, mismo
  patrón que `permisoMigrarDatos.test.js`/`permisoRecibirCompra.test.js`):
  confirma que el permiso `ver_predicciones` existe en el catálogo con
  `modulo: "inventario"`, y que `validarSistemaDePermisos()` sigue
  pasando. No se agregan pruebas a `predicciones.js` — no se modifica.
- **Frontend:** sin pruebas automáticas — ninguna pantalla de este
  proyecto las tiene (patrón establecido). Verificación manual: build
  limpio de `npm run build`, y verificación en navegador real (Playwright
  + Chrome del sistema, mismo patrón usado en sesiones anteriores) antes
  de dar el trabajo por terminado, incluyendo al menos: pestaña visible
  con el permiso, oculta sin él; flujo completo de Producto y de
  Categoría; caso de "sin historial" mostrando el mensaje correcto en
  vez de una gráfica vacía.

## Riesgo abierto

- El modelo de `predicciones.js` es una regresión lineal simple sobre el
  historial mensual — es una herramienta orientativa, no una IA
  entrenada. Con poco historial (menos de 6 meses) la propia función ya
  regresa una `nota` advirtiendo que es "una proyección preliminar", y la
  pantalla la muestra visible. El tope de 24 meses hacia el futuro es una
  decisión de esta pantalla (no del backend) para evitar que un usuario
  pida una proyección tan lejana que pierda todo sentido estadístico —
  vale la pena que Victor lo sepa: **entre más historial real de ventas
  tenga cargado el sistema, más confiable será cualquier predicción**, y
  hoy el sistema es relativamente nuevo, así que las primeras
  predicciones probablemente digan "confianza baja".
- `recharts` es una dependencia nueva del frontend — aumenta el tamaño
  del bundle de producción. No se identificó ningún riesgo de seguridad
  conocido en la librería al momento de este diseño (es ampliamente usada
  en el ecosistema React), pero es la primera dependencia de gráficas
  del proyecto.

## Self-Review (hecho al escribir este spec)

**Cobertura:** Objetivo/alcance → Arquitectura completa. Producto y
categoría → sección 4, puntos 1-2. Gráfica + tabla → sección 4, punto 5.
Calendario/horizonte ajustable → sección 4, punto 3. Permiso propio →
secciones 1-2. Manejo de errores → sección propia. Pruebas → sección
propia.

**Placeholders:** ninguno.

**Consistencia:** el permiso `ver_predicciones` se usa igual en el
catálogo (sección 1), la ruta protegida (sección 2) y el filtro de la
pestaña en `InventarioProductos.jsx` (sección 5) — mismo nombre en los
tres lugares.
