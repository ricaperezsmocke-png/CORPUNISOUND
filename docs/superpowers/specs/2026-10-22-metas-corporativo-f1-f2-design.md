# Metas del corporativo — F1 (metas por persona) y F2 (visita mensual del supervisor)

Plan general aprobado por Victor el 2026-10-22: `C:\Users\Victor\.claude\plans\glittery-soaring-pebble.md`
(fases F0–F7). Este spec cubre solo F1 y F2, que no dependen de SICAR.

## 1. Para qué

- Que la administradora, el supervisor y el gerente de compras tengan metas propias como las vendedoras.
- Que lo que ya hacen en CORPUNISOUND cuente solo, sin capturar.
- Que el supervisor revise cada tienda una vez al mes, y que cada falla que encuentre se arregle con un responsable,
  un paso a paso y un plazo.

**Éxito:**
- Victor crea una meta para una persona del corporativo, y esa persona la ve en "Mis metas".
- Si la meta es automática, el avance sube solo al trabajar.
- Una visita a la tienda queda con ubicación, checklist y fotos, y sus fallas aparecen como pendientes del encargado
  hasta cerrarse.

## 2. Decisiones de Victor (2026-10-22)

- Medición automática + manual con prueba.
- Seguimiento de demanda del Radar "a tiempo" = **dentro de 2 días** desde que se registró la demanda.
- Visita del supervisor: **una por tienda por mes**.
- El checklist arranca con la lista de la sección 5.2, y el Administrador la edita después.
- **Las fallas las resuelve el encargado de la tienda.** El supervisor le deja **un paso a paso** de qué hacer.
- **Plazo de una falla: 7 días.** Después se marca atrasada.

## 3. Decisiones de diseño tomadas por Claude (Victor puede corregirlas al revisar)

- **Se agrega un alcance; no se crean vendedores falsos.** Un vendedor falso entraría al reparto de ventas, a las
  carteras de clientes y a los objetivos de tienda.
- **La meta apunta a una cuenta, no a un puesto.** Si cambia la persona, Victor retira la meta y crea otra, igual que
  hoy.
- **"Encargado de la tienda" no existe en el sistema.** El supervisor elige al responsable de cada falla entre las
  cuentas activas de esa tienda. La primera vez que elige a alguien para una tienda, el sistema lo recuerda como
  sugerencia para la siguiente.
- **Visita en tienda sin coordenadas:** no se puede comprobar la ubicación, así que la visita se guarda pero **no
  cuenta para la meta**. La pantalla le avisa a Victor qué tienda necesita su ubicación. Hoy el inicio de sesión deja
  pasar a esas tiendas sin GPS (`auth.js:328-333`). Aquí no se hace, porque una visita que no se puede comprobar es
  exactamente la que se puede inventar.
- **Radio de tolerancia:** 300 metros, igual que el inicio de sesión (`RADIO_TOLERANCIA_METROS`, `auth.js:289`).
- **Límite conocido:** la ubicación la da el navegador y un teléfono manipulado puede falsearla. Para eso son las
  fotos obligatorias y la hora del servidor.

## 4. F1 — Metas por persona del corporativo

### 4.1 Alcance nuevo `corporativo`
- En `validarAlcance` (`backend/metasPersonalizadas.js:41-58`): `alcance: "corporativo"` exige un `usuario_id` de una
  cuenta **activa** en `DB.admin.usuarios`.
  - Guarda `usuario_id`, más `vendedor_id: null`, `participantes: []`.
  - Guarda `sucursal_id` opcional (null = toda la empresa).
- Los alcances tienda, persona y empresa no cambian.
- Los OKR pueden agrupar metas de alcance corporativo; el promedio no cambia.
- El planeador IA **no** propone metas corporativas en esta fase. Su validación sigue rechazando ese alcance.

### 4.2 Fuente de la meta
- Campo nuevo `fuente` en la meta. Las metas existentes se leen como `"manual"`, sin migrar datos.
- `fuente` no se puede cambiar en una versión nueva: para cambiarla se elimina la meta y se crea otra, como el
  periodo.
- Las fuentes automáticas solo se permiten en alcance `corporativo`, y en ellas `prueba` es `"ninguna"`.
- Catálogo cerrado en el módulo nuevo `backend/metasFuentes.js`. Cada fuente es una función pura
  `contar(DB, {usuario_id, sucursal_id, inicio, fin, sqlite})` que devuelve `{valor, detalle: [{clave, fecha, texto}]}`:

| Fuente | Qué cuenta | De dónde |
|---|---|---|
| `radar_seguimiento_a_tiempo` | Demandas del Radar cuyo **primer** seguimiento lo hizo esta cuenta dentro de 2 días desde `fecha_registro`. Se cuenta en el periodo en que ocurrió el seguimiento. | `DB.radar_demanda.registros` + `seguimientos` (`radarDemanda.js:152-178, 291-300`) |
| `crm_cambios_estado` | Cambios de estado de clientes hechos por esta cuenta. Los automáticos, con `usuario_id` null, nunca cuentan. | `DB.crm.estados_historial` + `sicar_estados_historial` |
| `bandeja_respuestas` | Mensajes salientes de la bandeja enviados por esta cuenta. | `lead_interacciones` (`direccion = 'saliente'`, `usuario_id`) |
| `revisiones_metas_tienda` | Capturas de metas de tienda que esta cuenta marcó **revisada** o anuló, una sola vez por captura. | `DB.pos.meta_capturas` (`anulada.por_id`, nuevo `revisada.por_id`) |
| `visitas_tienda` | Visitas completas y con ubicación comprobada, una por tienda y por mes (F2). | `DB.supervision.visitas` |

- **Reglas comunes:**
  - cada renglón cuenta una vez por su `clave`;
  - fechas en día de tienda con `fechaLocal`, dentro de `[inicio, fin]` del periodo (`metasPeriodos.js`);
  - si la meta tiene `sucursal_id`, solo cuentan los hechos de esa tienda.

### 4.3 Avance, captura y sello
- **`metasAvance.js`:** si la fuente no es manual, el resultado es `contar(...).valor` y no la suma de capturas. El
  porcentaje, el semáforo y el promedio del OKR se calculan igual que hoy.
- **El tablero muestra el `detalle`** (qué contó y cuándo). La persona ve por qué lleva lo que lleva.
- **Captura (`metasCapturas.js`):**
  - **Meta automática:** se rechaza siempre, con el error "Esta meta se cuenta sola".
  - **Meta corporativa manual:** la captura la hace solo la cuenta dueña (`usuario_id` del token). No se exige
    vendedor ni plantilla, y la fecha debe caer en el periodo.
  - La foto va a Drive con `subirArchivoADrive`. Va a la carpeta de la tienda de la meta; si la meta no tiene tienda,
    a una carpeta nueva "Corporativo" que se crea con `asegurarCarpeta`.
  - Se usa la misma regla de liga o foto que no se puede repetir.
  - Las capturas guardan `usuario_id` además de `vendedor_id: null`.
- **Marca "revisada":** ruta nueva `POST /api/metas/capturas/:id/revisada`, con el permiso existente
  `anular_capturas_metas` y el mismo alcance de tienda que anular.
  - Guarda `revisada: {por_id, por_nombre, en}` una sola vez.
  - Marcar revisada no cambia el avance de la vendedora.
- **Sello (`metasSellos.js`):** al sellar, una meta automática guarda su valor y su `detalle` en la foto del periodo.
  Después del sello manda el valor sellado. Se rectifica con motivo, igual que hoy.

### 4.4 Quién ve qué
- **`puedeVer` (`metasAvance.js:54-65`):** una meta corporativa la ven su dueño y la jefatura con
  `ver_todas_las_sucursales`. Un gerente de tienda **no** ve las metas del corporativo, aunque tengan su tienda.
- **`puede_capturar`:** verdadero solo para el dueño de una meta corporativa manual.
- **Una cuenta sin vendedor con metas propias** ve "Mis metas". `/api/metas/tablero` sigue pidiendo
  `usar_gerente_ventas`, así que los roles del corporativo necesitan ese permiso. Esto se documenta en la pantalla de
  Roles y no se cambia el catálogo.
- Fuera de alcance: 404, como en el resto del sistema.

### 4.5 Pantallas
- **`AdministrarMetas.jsx`:** "¿Para quién?" agrega **"Persona del corporativo"**.
  - Lista de cuentas activas con nombre y rol.
  - Tienda opcional.
  - Selector **"¿Cómo se cuenta?"**: Manual (con su tipo de prueba) o una fuente automática con su frase.
- **`pestanasObjetivos.js` / `GerenciaVentas.jsx`:**
  - el grupo "Lo mío" muestra **solo "Mis metas extra"** a una cuenta sin vendedor, y solo si tiene metas propias o
    puede tenerlas;
  - el aviso ámbar de "cuenta sin vendedor" no se muestra a esas cuentas;
  - lo de venta, actividades y créditos sigue exigiendo vendedor.
- **`MisMetas.jsx`:** una meta automática no muestra "Hecho"; muestra "Se cuenta sola" y su detalle.
- **`TableroMetas.jsx`:** el filtro de persona incluye a las personas del corporativo.
- **Revisión de capturas:** botón "Revisada" junto a "Anular".

## 5. F2 — Visita mensual del supervisor

### 5.1 Datos (estado JSON, colección nueva `DB.supervision`, incluida en la semilla y en el respaldo)
- **`checklist`:** `[{id, seccion: imagen|sistemas|funcionamiento, texto, activo, orden}]`.
  - Versiones con motivo.
  - Desactivar un punto no lo borra.
- **`visitas`:** `{id, sucursal_id, mes, supervisor_id, supervisor_nombre, iniciada_en, terminada_en, ubicacion, puntos, estado}`.
  - `ubicacion` = `{lat, lng, distancia_m, comprobada}`.
  - `puntos` = `[{checklist_id, texto, seccion, resultado, nota, foto}]`, donde `resultado` es bien, falla o no_aplica,
    y `foto` es `{drive_id, nombre}`.
  - `estado` es en_curso o terminada.
- **`fallas`:** `{id, visita_id, sucursal_id, punto_texto, nota, foto, responsable_id, responsable_nombre, pasos,
  limite, estado, historial}`.
  - `pasos` = `[{texto, hecho_en, hecho_por_id}]`.
  - `limite` = fecha de la falla + 7 días.
  - `estado` es abierta, resuelta o cancelada.
  - `historial` = `[{accion, por_id, por_nombre, en, nota, foto}]`.
- **`encargado_sugerido`:** `{[sucursal_id]: usuario_id}`.

### 5.2 Checklist inicial
- **Imagen:** aparador, limpieza, exhibición, precios visibles, letrero.
- **Sistemas:** cajas, impresoras, internet, SICAR, cámaras, terminal.
- **Funcionamiento:** apertura a tiempo, uniformes, personal completo, atención al cliente.

### 5.3 Flujo
1. **Iniciar visita** (`POST /api/supervision/visitas`, permiso `realizar_visitas_tienda`):
   - lleva la tienda, la latitud y la longitud;
   - el servidor calcula la distancia con `distanciaMetros` (`auth.js:292`); se exporta, no se copia;
   - si la tienda no tiene coordenadas, `comprobada: false` y se avisa;
   - una visita **en curso** por supervisor y tienda;
   - un mes con visita terminada puede tener otra, pero la meta cuenta una sola.
2. **Marcar cada punto:** Bien, Falla o No aplica.
   - Una **falla exige nota, foto, responsable y al menos un paso** del paso a paso.
   - La foto se sube a Drive, a la carpeta de la tienda (`subirArchivoADrive`); nunca al disco de Render.
3. **Terminar la visita:**
   - exige todos los puntos activos marcados;
   - crea una falla por cada punto en Falla, con límite a 7 días;
   - la visita queda de solo lectura.
4. **El encargado** ve "Mis pendientes de tienda".
   - Va marcando los pasos.
   - Cierra la falla con nota y foto: `POST /api/supervision/fallas/:id/resolver`, permiso `atender_fallas_visita`,
     y solo si él es el responsable.
   - El supervisor o el Administrador pueden reasignar la falla (con motivo) o cancelarla (con motivo).
   - Todo queda en el `historial`.
5. **Atrasada:** se calcula, no se guarda. Una falla abierta después de su `limite` sale en rojo para el encargado, el
   supervisor y Victor.

### 5.4 Permisos nuevos (módulo nuevo `supervision` en `permisosCatalogo.js`; el Administrador los recibe solo por `reconciliarRoles`)
- `realizar_visitas_tienda`: iniciar y llenar visitas.
- `administrar_checklist_visitas`: editar el checklist.
- `atender_fallas_visita`: ver y resolver las fallas asignadas a uno.
- `ver_supervision`: ver todas las visitas y fallas. Con alcance global ve todas las tiendas; sin él, solo la suya.

### 5.5 Pantallas (`src/supervision/`)
- **"Visita a tienda", pensada para celular a 390 px:**
  - elegir la tienda, pedir la ubicación y llenar el checklist por sección;
  - cámara para la foto de cada falla;
  - paso a paso con una línea por paso.
- **"Pendientes de tienda":** las fallas del encargado, con sus pasos y el botón Resolver.
- **"Supervisión":** para Victor y el supervisor.
  - Visitas del mes por tienda: hecha, en curso o falta.
  - Fallas abiertas y atrasadas.
  - Historial.
- **Editor del checklist.**
- **Menú:** entrada nueva "Supervisión", visible si tiene cualquiera de los 4 permisos.

## 6. Lo que no entra

- Todo lo de SICAR: compras a tiempo, rezago por factura y auditoría de cajeras (F0, F4–F7).
- El historial de "Ya lo pedí" (F3).
- Metas corporativas en el planeador IA.
- Avisos por WhatsApp o correo de fallas atrasadas: solo se ven en pantalla.

## 7. Cómo se abusa y qué queda

- **Inflar una meta automática:**
  - cada renglón cuenta una vez por su clave;
  - los cambios automáticos del sistema no cuentan;
  - cambiar un estado de ida y vuelta sí cuenta dos veces. Por eso el tablero muestra el detalle, y la jefatura ve
    qué cliente se movió.
  - Riesgo aceptado, a revisar con datos reales.
- **Visita inventada:**
  - la ubicación se comprueba en el servidor;
  - las fallas llevan foto obligatoria;
  - una visita sin ubicación comprobada no cuenta.
- **Falla "resuelta" sin resolver:**
  - se cierra con foto;
  - el historial dice quién, cuándo y con qué nota;
  - el supervisor la ve en su siguiente visita, porque el mismo punto vuelve a evaluarse.
- **Culpar al encargado de algo que no le toca:**
  - reasignar exige motivo;
  - la falla atrasada muestra su historial, para ver si el atraso fue de él o de una reasignación tardía.

## 8. Pruebas

- **F1:**
  - alcance corporativo válido e inválido (cuenta inactiva o inexistente);
  - fuente automática solo en corporativo;
  - captura manual corporativa: solo el dueño, otro da 404 o 403, sin plantilla;
  - meta automática rechaza captura;
  - cada fuente: cuenta dentro del periodo, ignora fuera de él, ignora los null de sistema, no cuenta dos veces,
    respeta la tienda;
  - seguimiento a los 2 días cuenta y a los 3 no;
  - el sello congela el valor automático;
  - "revisada" una sola vez y con alcance;
  - las metas de vendedor quedan idénticas (la suite completa en 0 fallas);
  - pantallas con las pruebas de render existentes.
- **F2:**
  - visita lejos (más de 300 m) no comprobada y no cuenta;
  - tienda sin coordenadas: no cuenta;
  - falla sin foto, sin responsable o sin pasos se rechaza;
  - terminar sin todos los puntos se rechaza;
  - resolver solo el responsable;
  - reasignar y cancelar con motivo;
  - atrasada a los 8 días;
  - las fotos van a Drive (simulado) y no a disco;
  - reinicio del servidor conserva `DB.supervision`;
  - el respaldo la incluye.
- **Navegador:**
  - Victor crea una meta "seguimiento de demanda" para el gerente de compras;
  - el gerente da seguimiento en el Radar y su avance sube;
  - el supervisor, en celular a 390 px, hace una visita con una falla;
  - el encargado la ve, marca los pasos y la resuelve;
  - Victor la ve en Supervisión.

## 9. Ejecución

- Rama `feature/metas-corporativo`, worktree `.claude/worktrees/metas-corporativo`, base master `929bd5f`.
- Implementa Claude (Codex sin cuota hasta el 2026-11-17); revisa un agente Code Reviewer independiente.
- F1 y F2 van en commits separados, para que Victor pueda subir F1 sin F2 si quiere.
- Victor decide el merge y el push.
