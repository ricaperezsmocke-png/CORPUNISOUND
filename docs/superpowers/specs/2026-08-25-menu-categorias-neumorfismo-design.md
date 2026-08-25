# Menú por categorías + neumorfismo (fase 1 de 3)

Fecha: 2026-08-25
Rama: `feature/menu-neumorfismo`
Commit base: `feea9cd`
Estado: aprobado por Victor el 2026-08-25 (alcance, agrupación, barra fija, neumorfismo solo en el mobiliario)

---

## 1. Por qué

El menú actual son **14 botones en una sola fila** que se parte en dos renglones
(`src/Dashboard.jsx`, arreglo `MODULOS`). No hay jerarquía: Punto de Venta y Respaldos
pesan lo mismo a la vista. Victor pidió agruparlos en categorías con subcategorías, y
darle al sistema un estilo neumórfico con tema claro y oscuro.

Este documento cubre **solo la fase 1**. El trabajo completo se dividió en tres porque
son tres proyectos distintos, y solo el primero da resultado visible pronto:

| Fase | Qué | Estado |
|---|---|---|
| **1** | Barra lateral con categorías, sistema de temas, neumorfismo en el mobiliario | **este spec** |
| 2 | Dashboard de inicio con tarjetas de métricas (ventas del día, tickets, leads, stock bajo, meta) | sin empezar — necesita endpoints nuevos |
| 3 | Barrido de neumorfismo y tema oscuro por las 14 pantallas | sin empezar |

### El número que decidió la división

Medido sobre `src/*.jsx` el 2026-08-25:

| | |
|---|---|
| Clases de color escritas a mano (`bg-white`, `text-slate-600`, `border-blue-200`…) | **2,053** en 26 archivos |
| Usos del sistema de tokens (`bg-background`, `text-muted-foreground`…) | **16** |
| Clases `dark:` en todo el proyecto | **0** |
| Bloque `.dark` en `src/index.css` | no existe |
| Estilos en línea `style={{…}}` | **177** |
| Pruebas de frontend | **ninguna** |

`tailwind.config.js` ya declara `darkMode: ["class"]`, `next-themes` ya está en
`package.json`, y los tokens (`--background`, `--card`, `--primary`…) ya están definidos
en `src/index.css`. **El andamiaje del tema existe y está hueco.** Un tema oscuro no se
"activa": hay que reescribir esas 2,053 clases, o las pantallas quedan blancas con texto
blanco. Ese barrido es la fase 3.

Hay dos generaciones visuales conviviendo: `src/Login.jsx` y `src/CRM.jsx` ya usan el
sistema de tokens de shadcn; los otros 26 archivos están pintados a mano.

---

## 2. Alcance de esta fase

### Entra

- Componente nuevo `src/BarraLateral.jsx`: navegación agrupada en tres categorías, con
  subcategorías desplegables, filtrada por permisos.
- `src/App.jsx`: pasa de layout en columna a layout en fila (barra + contenido).
- `src/Dashboard.jsx`: pierde la fila de botones; se queda solo con el Asistente de Negocio.
- `src/EncabezadoModulo.jsx`: se adelgaza (pierde "‹ Inicio" y el título del módulo).
- `src/index.css`: bloque `.dark`, variables de sombra neumórfica, utilidades `.neu*`.
- `src/main.jsx`: `ThemeProvider` de `next-themes`.
- Interruptor de tema claro/oscuro al pie de la barra lateral.

### NO entra

- **Las 14 pantallas de módulo no se tocan.** Reciben menos ancho y nada más. Ningún
  archivo de `src/` fuera de los cinco listados arriba se modifica.
- El dashboard de métricas (fase 2).
- El barrido de las 2,053 clases de color (fase 3). **En tema oscuro, las 14 pantallas
  se seguirán viendo claras. Es esperado, no es un defecto.** Sólo la barra, el
  encabezado y la pantalla de inicio responden al tema en esta fase.
- Infraestructura de pruebas de frontend. No existe en el proyecto y no se monta aquí.

---

## 3. Decisiones congeladas

Estas ya las decidió Victor. **No se re-deciden durante la implementación.** Si algo aquí
resulta imposible, la instrucción es detenerse y reportar, no elegir otra cosa.

### 3.1 La agrupación

| Categoría | Módulos (en este orden) |
|---|---|
| **OPERACIÓN** | Punto de Venta *(› Consultas de Ventas, › Apartados)*, Corte de Caja, Gastos, Inventario y Productos *(› Recepción de Compras)*, Traspasos entre Sucursales |
| **COMERCIAL** | CRM, Radar de Demanda, MercadoLibre, Mi Objetivo de Venta |
| **ADMINISTRACIÓN** | Reportes, Estado de Cuenta, Garantías, Roles y Personal, Respaldos, Configuración |

Razones, para que no se "corrijan" al implementar:

- **Garantías va en ADMINISTRACIÓN**, no en operación: quien la usa a diario no es la
  cajera sino quien gestiona el reclamo.
- **Migración de Datos queda fuera del menú.** Es una herramienta de una sola vez, no un
  módulo. Se sigue alcanzando desde dentro de Inventario y Productos, como hoy.
- Las subcategorías son pantallas que **ya existen enterradas** dentro de otros módulos:
  `ConsultasVentas.jsx` y `ModalApartados.jsx` viven dentro de `PuntoDeVenta.jsx`;
  `RecepcionCompras.jsx` vive dentro de `InventarioProductos.jsx`.
- **Configuración sí sube a módulo de primer nivel** en ADMINISTRACIÓN, y es la única
  excepción a "las pantallas enterradas no se cablean". Se verificó que es barato:
  `Configuracion({ onVolverAVenta, onVolverInicio, permisos })` no necesita nada que
  `App.jsx` no tenga ya. `PuntoDeVenta.jsx` conserva su camino interno hacia ella; no se
  toca. `App.jsx` gana una vista número 15, `configuracion`, con
  `modulo: "pos"` y `permiso: "editar_configuracion_pos"`.

### 3.2 Barra fija

La barra vive en `App.jsx` y acompaña a **todas** las pantallas, no solo al inicio. Cambiar
de Punto de Venta a Corte de Caja es un clic, sin pasar por el inicio.

### 3.3 Categoría vacía se esconde

Si a un rol no le queda **ningún** módulo visible dentro de una categoría, el encabezado de
esa categoría no se dibuja. Nada de secciones en gris que no llevan a ningún lado.

### 3.4 Neumorfismo en el mobiliario, no en los datos

Relieve en: la barra lateral, sus botones, las tarjetas y el encabezado.
Contraste normal y legible en: tablas, cifras, texto de datos.

Razón: el neumorfismo insinúa los bordes en vez de definirlos, y las cajeras leen números
en pantallas de tienda con mucha luz. Un total de venta con relieve suave es más bonito y
menos legible. Victor aprobó esta línea explícitamente.

### 3.5 Claro y oscuro, elegibles

Interruptor al pie de la barra. La preferencia se guarda en `localStorage` y sobrevive al
refresco.

---

## 4. Diseño

### 4.1 `src/BarraLateral.jsx` (nuevo)

Dueño único de la estructura del menú. Exporta por defecto el componente.

**Props:** `{ usuario, vista, onEntrarModulo, onSalir }`

**Estructura de datos interna** — reemplaza al arreglo `MODULOS` que hoy vive en
`src/Dashboard.jsx:8`. Cada entrada conserva **exactamente** los campos `id`, `nombre`,
`icono`, `modulo` y `permiso` que ya tiene hoy, con los mismos valores. Se agrega el
agrupamiento por encima y, donde aplique, `hijos`:

```js
const CATEGORIAS = [
  { id: "operacion",      nombre: "OPERACIÓN",      modulos: [...] },
  { id: "comercial",      nombre: "COMERCIAL",      modulos: [...] },
  { id: "administracion", nombre: "ADMINISTRACIÓN", modulos: [...] },
];
```

**Invariante crítica — el filtro de permisos no se reescribe.** El que hay hoy en
`Dashboard.jsx` está bien pensado y hay que copiarlo tal cual, incluida su lógica de lista:

```js
const moduloOk = !usuario?.modulos || usuario.modulos.includes(m.modulo);
const requeridos = m.permiso ? [].concat(m.permiso) : [];
const permisoOk =
  requeridos.length === 0 ||
  !usuario?.permisos ||
  requeridos.some((clave) => usuario.permisos.includes(clave));
```

El `permiso` acepta una clave **o una lista, y basta tener cualquiera**. No es un descuido:
a *Mi Objetivo de Venta* entra la vendedora (`usar_gerente_ventas`) y también la jefatura
(`editar_objetivos_venta`), y son permisos distintos. Con una sola clave, un rol que solo
tuviera el de jefatura no vería el azulejo y el módulo le desaparecía sin explicación.
Lo mismo con *Radar de Demanda*, que tiene tres puertas.

Encima de ese filtro se agrega **una sola regla nueva**: una categoría cuya lista de
módulos visibles quede vacía no se dibuja (decisión 3.3).

**Subcategorías.** Un módulo con `hijos` muestra un chevron y despliega. El estado de
abierto/cerrado es local al componente. Los tres hijos (Consultas de Ventas, Apartados,
Recepción de Compras) **no se cablean en esta fase**: se dibujan y navegan al módulo padre,
que es donde el usuario los alcanza hoy. Cablearlos de verdad exige tocar
`PuntoDeVenta.jsx` e `InventarioProductos.jsx` para que acepten una sub-vista inicial, y
esos dos archivos están fuera de alcance. Si al verlo resulta insatisfactorio, es material
de otra fase.

(Configuración es distinta: sube a módulo de primer nivel con su propia vista en `App.jsx`
— ver 3.1.)

### 4.2 `src/App.jsx`

De columna a fila. Hoy:

```jsx
<div className="w-full h-screen flex flex-col">
  {!esDashboard && <EncabezadoModulo … />}
  <div className="flex-1 min-h-0 overflow-auto">{…módulos…}</div>
</div>
```

Queda:

```jsx
<div className="w-full h-screen flex">
  <BarraLateral usuario={usuario} vista={vista} onEntrarModulo={setVista} onSalir={salir} />
  <div className="flex-1 min-w-0 flex flex-col">
    <EncabezadoModulo vista={vista} usuario={usuario} onSalir={salir} />
    <div className="flex-1 min-h-0 overflow-auto">{…módulos…}</div>
  </div>
</div>
```

`min-w-0` en la columna derecha es obligatorio: sin él, un hijo ancho (las tablas) estira el
flex y empuja la barra fuera de la pantalla.

El encabezado ahora se dibuja **siempre**, también en el inicio — antes lo hacía solo dentro
de módulos y el inicio traía su propio encabezado duplicado dentro de `Dashboard.jsx`.

Los `onVolver` que se pasan a cada módulo se conservan tal cual. Con barra fija dejan de ser
el camino principal, pero varios módulos los usan internamente para volver desde una
sub-pantalla y quitarlos rompería cosas fuera de alcance.

### 4.3 `src/Dashboard.jsx`

Pierde el arreglo `MODULOS`, el filtro (se mudan a `BarraLateral.jsx`) y su encabezado
propio (se mudó a `App.jsx`). Queda solo con el Asistente de Negocio y su mensaje de acceso
restringido para roles sin `usar_asistente_ia`. Debería bajar de ~130 líneas a ~25.

### 4.4 `src/EncabezadoModulo.jsx`

Pierde el botón "‹ Inicio": ya no hace falta, la barra siempre está.

**Conserva el mapa `TITULOS` y el título del módulo**, que es lo que muestra el boceto que
Victor aprobó. La barra marca el módulo activo, pero el título en el encabezado es la
respuesta grande a "¿dónde estoy?" y no cuesta nada. Se le agrega la entrada
`configuracion: "Configuración"`.

También conserva el logo, el `SelectorSucursal`, el nombre/rol del usuario y el botón Salir.

Su `background` en línea (`linear-gradient(90deg, #1a7fe8 0%, #1262b8 100%)`) pasa a
variables CSS para que el bloque `.dark` lo pueda redefinir.

### 4.5 Temas — `src/index.css` y `src/main.jsx`

`src/main.jsx` envuelve `<App/>` en el `ThemeProvider` de `next-themes` con
`attribute="class"` (que es lo que `tailwind.config.js` espera con `darkMode: ["class"]`),
`defaultTheme="light"` y `enableSystem={false}`.

`enableSystem={false}` a propósito: el sistema lo usan varias personas en el mismo equipo de
tienda, y que el tema cambie solo al anochecer porque Windows lo decidió es una sorpresa,
no una función.

`src/components/ui/sonner.jsx` **ya llama a `useTheme()`** y hoy no recibe ningún provider;
con este cambio empieza a funcionar solo. No hay que tocarlo.

En `src/index.css` se agrega el bloque `.dark` con los mismos nombres de token que ya
existen en `:root`. Ninguno se inventa ni se renombra.

### 4.6 Neumorfismo — utilidades

Las sombras van en variables CSS, redefinidas dentro de `.dark`, y las utilidades las
consumen. Así el modo oscuro no duplica clases:

```css
:root {
  --neu-fondo:  #e8ecf3;  /* tono medio: NUNCA blanco puro */
  --neu-luz:    #ffffff;  /* sombra clara, arriba-izquierda */
  --neu-sombra: #c3ccd9;  /* sombra oscura, abajo-derecha */
  --neu-distancia: 6px;
  --neu-difuminado: 12px;
}
.dark {
  --neu-fondo:  #1e2430;
  --neu-luz:    #262e3d;
  --neu-sombra: #141922;
}
```

Esos valores son el punto de partida, no dogma: si al verlos en pantalla el relieve queda
demasiado marcado o demasiado tímido, ajustarlos es parte del trabajo. Lo que **no** se
cambia sin preguntar es la regla de que el fondo no sea blanco puro y de que el relieve no
sea la única señal del módulo activo.

Utilidades: `.neu` (salido), `.neu-hundido` (para el módulo activo en la barra),
`.neu-boton` (salido en reposo, hundido al presionar).

**El fondo neumórfico no puede ser blanco puro** (`#fff`): la sombra clara desaparece contra
él y el relieve se pierde. El token `--background` en claro hoy es `0 0% 100%`. Se cambia a
un gris muy claro. Es el único token existente que este spec modifica, y se hace porque sin
eso el estilo entero no funciona.

**El relieve no debe ser la única señal** de que un módulo está activo: el activo lleva
además color y peso de texto distintos. Un usuario que no distingue las sombras suaves
tiene que poder ver en qué módulo está.

---

## 5. Riesgos, ya medidos

Verificado sobre el código el 2026-08-25, no supuesto:

- **Cero `h-screen` / `w-screen` dentro de los módulos.** Todos ya viven en un contenedor
  flexible, así que estrecharlos no rompe la estructura.
- **Los 44 usos de `fixed` son todos overlays de modal (`fixed inset-0`) y avisos
  (`fixed bottom-6 left-1/2`).** Deben ser relativos a la pantalla completa: un modal debe
  tapar también la barra. No hay barras de herramientas fijas. La barra lateral no los
  afecta.
- **`src/GerenciaVentas.jsx` tiene un `min-w-[560px]`.** Es el único ancho mínimo grande
  del proyecto. Con la barra puesta puede aparecerle scroll horizontal en pantallas
  angostas. Verificar al probar; si molesta, se resuelve en su propia fase, no aquí.
- `src/radar-demanda/RadarDemanda.jsx` es el único módulo que **no** recibe `onVolver`.
  No es un defecto y no hay que "arreglarlo".

---

## 6. Definition of Done

- Build (`npm run build`) pasa.
- `npx eslint src` sin errores nuevos (hay warnings preexistentes de imports sin usar; no
  son parte de este trabajo).
- `git diff --check` limpio.
- Ningún archivo modificado fuera de los cinco de la sección 2.
- Revisión independiente (nadie valida su propio trabajo).
- **Probado en navegador**, que es lo único que cubre esto:

| Prueba | Qué debe pasar |
|---|---|
| Rol Administrador | Ve las tres categorías y los 14 módulos |
| Rol Gerente de sucursal | Ve solo sus categorías; ninguna vacía se dibuja |
| Rol Cajero | Ve solo lo suyo; ADMINISTRACIÓN no aparece |
| Las 14 pantallas | Todas abren desde la barra y se dibujan completas, más angostas |
| Cambio directo | De Punto de Venta a Corte de Caja sin pasar por el inicio |
| Interruptor de tema | Cambia barra y encabezado; sobrevive al refresco de la página |
| Un modal cualquiera | Sigue centrado sobre la pantalla completa, tapando la barra |
| Subcategorías | Despliegan y navegan al módulo padre (ver 4.1) |

Para probar con roles distintos: `backend/resetPasswordLocal.js` cambia la contraseña en el
snapshot local `backend/datos.sqlite` (que está en `.gitignore`), y se niega a correr con el
backend levantado.

---

## 7. Lo que sigue

Fase 2 (dashboard de métricas) y fase 3 (barrido de estilo) tienen su propio spec y su
propia aprobación de Victor. **No se empiezan desde esta rama.**

Relacionado: `docs/superpowers/specs/` tiene los specs de las fases anteriores del proyecto.
