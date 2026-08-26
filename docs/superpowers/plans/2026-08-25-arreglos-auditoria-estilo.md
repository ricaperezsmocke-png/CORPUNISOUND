# Arreglos de la auditoría visual del estilo

Fecha: 2026-08-25
Base: `master` tras `9cf9fd0`
Origen: auditoría en navegador de **36 pantallas, pestañas y modales**, más la revisión
independiente del barrido (`b25b9f9`).

---

## Cómo se hizo la auditoría

Se abrió cada pantalla en Chrome con sesión de Administrador y se miró la captura, no solo
se midió. Cubiertas:

Login · Inicio · Punto de Venta (+ Consultas, + modales Cliente y Artículo Rápido) ·
Corte de Caja (+ modal de Corte, + Historial) · Gastos (+ Categorías, + modal) ·
Inventario (+ Recepción de Compras, + Migración, + Predicciones) · Traspasos (+ Historial) ·
CRM (Hoy, Clientes, Dashboard) · Radar de Demanda (Registrar, Mis demandas, Seguimientos,
Análisis, Inteligencia) · MercadoLibre (+ Configuración) · Mi Objetivo de Venta ·
Reportes (portada + Reporte de Ventas) · Estado de Cuenta (+ Depósitos) · Garantías
(+ modal Nueva garantía) · Roles y Personal (Roles, Personal, Vendedores, Ubicaciones,
Intentos Bloqueados) · Respaldos · Configuración (Ventas, Formas de Pago).

**Lo que quedó bien y no se toca:** Traspasos, Configuración, Reportes, Estado de Cuenta,
Garantías, Respaldos, MercadoLibre, Mi Objetivo, Consultas de Ventas, Recepción de Compras,
Migración, Predicciones, Roles (las cinco pestañas), Radar (las cinco pestañas) y los
modales de Cliente, Artículo Rápido, Nueva garantía e Historial de Cortes.

---

## Tarea 1 — Corte de Caja: lo que no se edita parece lo que hay que llenar

**Es el único hallazgo que puede costar dinero**, y por eso va primero. En el modal de corte,
la columna "Contado" (la que la cajera llena) está hundida en gris, correcto. Pero la columna
"Calculado" y el "Total" del retiro son **recuadros blancos**, y el blanco atrae más la vista
sobre un fondo gris. En la pantalla donde se cuadra la caja, eso invita a escribir en la
casilla equivocada.

Hay además tres totales de sólo lectura con tres aspectos distintos en el mismo modal.

**Archivo:** `src/CorteCaja.jsx`
- Línea 397 — `Total contado`: hoy `neu-campo` (hundido = "aquí se escribe") sobre un `<div>`
  de sólo lectura.
- Línea 398 — `Total calculado`: recuadro claro con borde.
- Línea 441 — `Total retiro`: otro recuadro claro con otro borde.

**Arreglo:** una sola apariencia para los tres, y que **no sea la de un campo**: fondo del
panel, sin relieve ni borde, cifra en negrita y un poco más grande. Sólo lo editable lleva
`.neu-campo`.

**Cómo se comprueba:** abrir el modal y confirmar de un vistazo que las únicas casillas con
aspecto de campo son las de la columna "Contado" y las de "Retiro por Corte".

---

## Tarea 2 — CRM: dos barras azules apiladas

Es lo más visible de toda la auditoría. El CRM dibuja su propio encabezado azul
("Unisound Imusa · CRM COMERCIAL") **justo debajo** del encabezado azul del módulo, con su
propio botón "← Inicio" que ya no hace falta porque la barra lateral está siempre presente.

No lo causó el barrido: es anterior. Pero antes el CRM ocupaba la pantalla entera y ahora se
ve pegado al encabezado del módulo, así que la duplicación salta a la vista.

**Archivo:** `src/CRM.jsx`, el `<header>` propio del componente.

**Arreglo:** quitarle al CRM la franja azul, la marca repetida y el botón "← Inicio".
Conservar únicamente las pestañas **Hoy / Clientes / Dashboard** y los contadores de la
derecha (postventa, alertas, Campaña masiva), sobre el fondo de la pantalla.

**Decisión que necesita Victor:** ¿se van también los contadores "2 postventa" y "1 alertas"
al lado de las pestañas, o se quedan? Yo los dejaría: son información, no navegación.

---

## Tarea 3 — El Login quedó a medias

Es la primera pantalla que ve cualquiera y hoy tiene **tres estilos conviviendo** en la misma
tarjeta: la tarjeta es blanca, los campos Usuario y Contraseña son blancos con borde, y el
selector de sucursal salió **gris**, porque usa el token de fondo que este trabajo cambió.

**Archivo:** `src/Login.jsx`

**Arreglo:** llevar la tarjeta al mismo idioma que el resto — superficie con relieve y los
tres campos hundidos. Es la opción coherente y deja la primera impresión alineada con lo
demás.

**Alternativa más barata si Victor prefiere no tocar el Login:** devolver el selector a
blanco con borde, para que al menos los tres campos se parezcan entre sí.

---

## Tarea 4 — Etiquetas fijas con cara de campo editable

Tres etiquetas que no se pueden escribir están hundidas como si sí:

| Archivo:línea | Qué es |
|---|---|
| `src/PuntoDeVenta.jsx:782` | El `MXN` a la derecha del cliente |
| `src/RecepcionCompras.jsx:547` | El `MXN` de la recepción |
| `src/RecepcionCompras.jsx` (etiqueta `Neto`) | Junto al buscador de clave |

Los tres llevan además `bg-slate-50` muerto, que `.neu-campo` ya pisa.

**Arreglo:** quitarles `.neu-campo` y el `bg-slate-50`. Son texto: van sin fondo y sin
relieve, en `text-slate-500`.

**Ojo, no confundir:** `PuntoDeVenta.jsx:775` y `:779` (elegir cliente y elegir vendedor)
**sí** deben conservar el aspecto hundido — son botones que abren un buscador y se comportan
como un desplegable. Esos están bien.

---

## Tarea 5 — El campo del asistente tiene el relieve al revés

`src/AsistenteIA.jsx:116` — la barra donde se escribe la pregunta usa `.neu-panel` y el campo
de adentro quedó salido. Es el único campo del sistema que contradice la regla "hundido =
aquí se escribe".

**Arreglo:** el input de la pregunta pasa a `.neu-campo`.

De paso, en el mismo archivo: `src/AsistenteIA.jsx:108`, los chips de sugerencia conservan un
`hover:border-[#1a7fe8]` que ya no hace nada porque `.neu` les quitó el borde. Se cambia por
un cambio de color de texto.

---

## Tarea 6 — Inventario: el panel derecho no se separa de la lista

`src/InventarioProductos.jsx:514` — el panel "Artículo Seleccionado" es `neu-panel`, que solo
iguala el tono y no tiene relieve, así que se funde con la tabla de la izquierda. Antes las
separaba un borde.

**Arreglo:** darle `.neu` (relieve) o devolverle una línea divisoria a la izquierda con
`border-l border-black/10`.

---

## Tarea 7 — Barrido de restos y de contrastes

Todo lo de esta tarea es de una pasada y se corrige casi entero en `src/index.css`.

**7a. Los separadores quedaron más tenues que antes.** La sustitución masiva de
`border-slate-200` por `border-black/5` se hizo asumiendo equivalencia y no lo es: sobre el
gris nuevo da **1.11:1** contra los **1.23:1** del original sobre blanco. Son ~60 sitios,
sobre todo pies de modal. **Arreglo:** subir de `/5` a `/10`.

**7b. Contraste del propio menú.** Sobre el fondo nuevo:
- encabezados de categoría (`src/BarraLateral.jsx`, `text-muted-foreground` a 10 px) ≈ **3.6:1**
- subcategorías ≈ **3.6:1**
- el módulo activo (`text-primary`) ≈ **3.5:1**

El mínimo recomendado para texto pequeño es 4.5:1. Es el mismo argumento que usamos para no
meter relieve en las cifras: pantallas de tienda con mucha luz. **Arreglo:** oscurecer
`--muted-foreground` y usar un azul más oscuro para el módulo activo.

**7c. `text-slate-500` cayó de 4.76:1 a 4.00:1** al cambiar el fondo. Se usa 302 veces. Cruza
el umbral, aunque sigue siendo legible. **Arreglo:** oscurecer un punto el token, o dejarlo y
anotarlo. Yo lo dejaría: tocar 302 usos por 0.5 puntos de contraste no compensa.

**7d. Restos muertos.** `focus:border-blue-500` sobrevive en los `inputCls` de 12 archivos
sobre elementos que ya no tienen borde; `hover:border-*` sobre `.neu` en `Reportes.jsx:41`.
No rompen nada, son ruido. **Arreglo:** quitarlos.

---

## Tarea 8 — Menores, sólo si sobra tiempo

- `src/GerenciaVentas.jsx` — "Ver tareas" queda más apagado que sus vecinos "Fijar meta" y
  "Sugerir meta". Igualar el tratamiento.
- `src/radar-demanda/AnalisisDemanda.jsx` — los títulos de las tarjetas se truncan
  ("NO CONVERTID…", "VALOR RECUPE…"). Con la barra lateral hay menos ancho que antes.
  Bajar el tamaño de letra o permitir dos renglones.

---

## Orden sugerido

1. **Tarea 1** (Corte de Caja) — es la única que puede costar dinero.
2. **Tareas 4, 5, 6** — las tres son de minutos y quitan las incoherencias más visibles.
3. **Tarea 7** — el barrido de restos y contrastes, en una sola pasada por `index.css`.
4. **Tarea 2** (CRM) — necesita una decisión de Victor antes de empezar.
5. **Tarea 3** (Login) — necesita que Victor elija entre las dos opciones.
6. **Tarea 8** — al final.

## Definition of Done

- `npm run build` pasa, `npx eslint src` sin errores nuevos, `node --test src/menuCategorias.test.js` en verde.
- `git diff --check` limpio.
- **Cada tarea probada en navegador**, en la pantalla concreta que arregla. Esta auditoría
  existe justamente porque las comprobaciones automáticas no vieron estos defectos.
- Victor decide el merge y el push.
