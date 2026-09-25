# Entrega C2 — Pantallas del gerente estilo SICAR (Venta de la tienda y Actividades de la tienda)

Fecha: 2026-09-25. Diseño aprobado por Victor en conversación ("si esta bien").
Rama `feature/objetivos-c2-gerente`, base `027caaf` (master con C1 en producción).
Precedente de estilo: C1 (`src/objetivos/CapturaVendedor.jsx`, `ActividadesVendedor.jsx`): rejilla con
encabezado `bg-blue-600 text-white`, filas alternas `odd:bg-white even:bg-blue-50`, `pesosConCentavos`.

## Objetivo

Que quien reparte metas vea de un vistazo cuánto falta o sobra por repartir y actúe desde una sola
rejilla. **Solo reacomodo de pantalla.** No cambia ninguna regla, ruta, permiso ni dato del servidor.
Se usa en COMPUTADORA.

## Alcance

Archivos autorizados:
- `src/objetivos/RepartoGerente.jsx` (reescritura de la presentación)
- `src/objetivos/ActividadesGerente.jsx` (reescritura de la presentación; cargar, sugerir, guardar meta,
  historial y el diálogo de meta se CONSERVAN en su lógica y peticiones)
- `src/GerenciaVentas.jsx` SOLO si hace falta pasar una prop nueva a RepartoGerente (p. ej. `mes`
  ya llega). Las funciones `agregar`, `editarMeta`, `abrirHistorial`, `pedirSugerencia`, `setBaja` y sus
  diálogos NO cambian.
- `src/objetivos/datos.js`, `src/objetivos/actividades.js` y sus `.test.js`: funciones puras nuevas.
- Opcional: extraer a `src/objetivos/ResultadosActividad.jsx` el componente `Resultado` (y el
  "Ver historial (N)") que hoy vive en `ActividadesVendedor.jsx`, y usarlo en ambos. Si se extrae,
  ActividadesVendedor solo cambia su import; su comportamiento no.

Prohibido: todo `backend/`, pantallas de vendedora salvo el import anterior, cierre, `MarcasGerente.jsx`,
`DialogosObjetivos.jsx`, dependencias nuevas, CSS global.

## Parte 1 — pestaña "Venta de la tienda" (RepartoGerente)

1. **Tres cifras grandes arriba**: `META DE TIENDA` (pesos con centavos), `ASIGNADO`, y el **estado del
   reparto en palabras** calculado de `objetivos.sin_asignar`:
   - `sin_asignar > 0` → `⚠ Faltan $X por repartir` (ámbar)
   - `sin_asignar === 0` y meta > 0 → `✔ Reparto completo` (verde)
   - `sin_asignar < 0` → `✖ Asignaste $X de más` (rojo, X en positivo)
   - meta 0 → `Sin meta de tienda` (gris)
   Comparar en centavos (`Math.round(x*100)`), no en flotantes.
2. **Barra de botones con icono** (lucide, estilo de las pestañas): `Fijar meta de tienda`
   (`editar(null, objetivos.meta_tienda)`), `Sugerir reparto` (`pedirSugerencia`), `Personal del mes`
   (abre ventana, ver 4), `Historial de tienda` (`historial(null)`). Mes cerrado: solo
   `Personal del mes` (solo lectura) e `Historial de tienda`.
3. **Rejilla por persona**: filas = unión de `objetivos.plantilla` y `objetivos.lineas` por
   `vendedor_id` (Number). Columnas: Persona, En tienda (`desde dd/mm` o `dd/mm–dd/mm` + motivo de baja
   si tiene `hasta`), Meta (`pesosConCentavos` o `—` si no tiene línea), Sugerida (solo si hay
   `sugerencia` cargada: monto + `✔ Guardada` cuando `sugerenciaGuardada(s, objetivos.lineas)`, si no
   botón `Usar` que llama `editar(vendedor_id, s.monto)`; sin sugerencia para esa persona `—`),
   Acciones (`Fijar meta` → `editar(vendedor_id, monto)` solo mes abierto; `Historial`).
   La fila de "Tienda" ya NO va en la rejilla (está arriba). Si `sugerencia` es `[]`, aviso
   `Primero fija la meta de tienda y registra el personal del mes.` Encima de la columna Sugerida,
   leyenda `La sugerencia no guarda nada: usa "Usar" en cada persona.`
4. **Ventana "Personal del mes"** (modal propio dentro de RepartoGerente, mismo estilo que los demás
   modales: `fixed inset-0 z-50 bg-black/40`, con `role="dialog"` y botón Cerrar): lista de la
   plantilla (nombre, desde, hasta/motivo, `Dar de baja` → `darBaja({...p, hasta: "", motivo: ""})`
   solo mes abierto) y el formulario actual de agregar (vendedor + desde opcional + `Agregar`,
   misma lógica y mismas validaciones que hoy). Mes cerrado: solo lectura, sin formulario ni bajas.
   Nota: el diálogo de baja existente vive en GerenciaVentas; al pulsar `Dar de baja` se cierra la
   ventana de personal para que no queden dos modales encimados.

Funciones puras nuevas (con pruebas) en `datos.js`:
- `estadoReparto({ meta, sinAsignar, unidad })` → `{ tono: "falta"|"completo"|"exceso"|"sin_meta",
  texto }`. `unidad` = `"pesos"` (formatea con `pesosConCentavos`) o `"unidades"` (enteros, texto
  `Faltan 10 por repartir`, `Asignaste 3 de más`). Compara en centavos para pesos.
- `filasReparto({ plantilla, lineas })` → arreglo ordenado (orden de plantilla, luego líneas sin
  plantilla) de `{ vendedor_id, desde, hasta, motivo_baja, monto|null }` sin duplicados, ids con Number.

## Parte 2 — pestaña "Actividades de la tienda" (ActividadesGerente)

1. **Rejilla de metas** con título `Metas de actividades · declaradas, no verificadas` (el aviso UNA
   vez aquí). Una fila por clase de `objetivos.actividades`: Actividad (etiqueta), Meta tienda,
   Asignado, Reparto (`estadoReparto` con `unidad: "unidades"`), Declaradas en tienda (de
   `datos.resumen_tienda`, NUNCA sumando personas: las conjuntas cuentan una vez). Clase con
   `meta_tienda === 0` y sin declaradas: fila en gris con `—`, sigue siendo clicable para fijarle meta.
2. **Tocar una fila la despliega** (▸/▾, `aria-expanded`), una a la vez o varias (a elección, simple):
   debajo aparece su detalle: botones `Fijar meta de tienda`, `Sugerir partes iguales`,
   `Historial de tienda` (mismas llamadas `abrir`/`sugerir` de hoy; solo mes abierto para fijar/sugerir),
   la nota `Una actividad conjunta cuenta una sola vez para la tienda.`, y una sub-rejilla por persona:
   Persona, Meta, Declaradas (de `resumen_por_persona`), Sugerida (si hay sugerencia de esa clase:
   `✔ Guardada` o `Usar` → `abrir(reparto, vendedor_id, monto)`), Acciones (`Editar parte`, `Historial`).
   Sin personas: `Todavía no hay personas en el personal del mes.`
3. **Registros del mes** con título `Registros del mes · declaradas, no verificadas` (aviso UNA vez),
   los dos filtros actuales (Persona, Actividad) en una fila, y rejilla: Persona, Fecha (dd/mm),
   Actividad (+ `Conjunta`, `registrado N días después`, nota, `Anulada: motivo` como en C1),
   Evidencia (`Ver foto`/`Ver publicación`, nueva pestaña, `noopener noreferrer`), Último resultado
   (+ `Ver historial (N)` si hay más de uno, con autor y fecha/hora). Anuladas tachadas en gris.
   El gerente NO anula ni agrega resultados aquí (igual que hoy).
4. Diálogo de meta de actividad: sin cambios de lógica. El aviso "Declaradas, no verificadas" dentro
   del diálogo puede quedarse (es otra agrupación).
5. Conteo máximo del aviso en la pestaña (sin diálogos): 2 veces.

## Invariantes (revisar en la auditoría)

- Guardado persona por persona, como hoy. NO agregar "Guardar todo".
- El exceso de reparto se ve como exceso, nunca como "completo".
- Total de tienda de actividades desde `resumen_tienda`, jamás sumando personas.
- Personas dadas de baja siguen visibles con sus fechas y motivo.
- Motivo obligatorio al cambiar una meta existente (lo exigen los diálogos actuales: no tocarlos).
- Mes cerrado = solo lectura (sin fijar, sugerir, usar, agregar ni dar de baja).
- Ninguna petición nueva al servidor.
- Líneas ≤ 200 caracteres; `className` largos a constantes. Acentos UTF-8 correctos.

## Pruebas y verificación

- TDD de `estadoReparto` y `filasReparto` (incluye: exceso con centavos, 0.1+0.2 vs 0.3, meta 0,
  persona con baja, persona con línea sin plantilla, ids texto vs número).
- `node --test src/` en verde; eslint sin errores; `npx vite build` OK.
- Navegador (Claude): reparto falta/completo/exceso, Usar sugerencia abre el diálogo con el monto,
  Personal del mes agrega y da de baja, actividades: desplegar fila, sugerir, usar, registros con
  filtros; mes cerrado de solo lectura.
