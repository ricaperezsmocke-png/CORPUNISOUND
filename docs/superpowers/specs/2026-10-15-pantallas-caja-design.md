# Entrega 2 — Interruptores de pantallas de caja

Fecha: 2026-10-15. Decisiones de Victor tomadas en conversación con Claude. Base: master `e9372b2`.

## 1. Para qué

Las tiendas cobran en SICAR. El Punto de Venta de CORPUNISOUND casi no se usa (en producción: 12 ventas, la última
del 2026-09-13, 0 apartados, sin cajas abiertas, revisado por Claude el 2026-10-15). Victor quiere **apagar** las
pantallas de caja sin borrarlas, y poder volver a encenderlas. Decidió **un interruptor por pantalla**.

Éxito: el Administrador apaga Punto de Venta; desaparece del menú para todos, y nadie puede cobrar ni abrir caja aunque
mande la petición a mano. Las ventas viejas, cortes y reportes se siguen consultando. Se puede volver a encender.

## 2. Interruptores

| Clave | Pantalla | Qué bloquea al apagarse |
|---|---|---|
| `punto_venta` | Punto de Venta | Crear ventas, cancelar ventas, cambiar caja de una venta, apartados (crear, abonar, cancelar) y cualquier ruta que guarde cotizaciones o tickets en espera |
| `corte_caja` | Corte de Caja | Crear/cerrar cortes |
| `gastos_caja` | Gastos | Crear, cambiar origen y cancelar gastos; crear/editar categorías |
| `dinero_garantias_caja` | Cobro y gastos en efectivo de garantías | Toda ruta de garantías que cree un movimiento que el corte cobra (cobros y gastos en efectivo) |
| `depositos` | Depósitos | Crear, adjuntar comprobante y cancelar depósitos |

Las garantías siguen funcionando (registrar, enviar, resolver, recibir, entregar) sin el dinero en caja.
Objetivos, CRM, Inventario, Traspasos, Reportes, MercadoLibre y Estado de Cuenta no cambian.

## 3. Reglas (todas en el servidor)

1. **Ninguna pantalla que mueve dinero puede quedar encendida sin corte**: no se puede apagar `corte_caja` mientras
   `punto_venta`, `gastos_caja`, `dinero_garantias_caja` o `depositos` estén encendidas; y no se puede encender ninguna
   de esas con `corte_caja` apagado. Respuesta 409 con el motivo.
2. **No se apaga `corte_caja` con dinero sin cortar**: si en cualquier tienda/caja hay movimientos que el siguiente
   corte cobraría (los mismos que usa la ruta de corte en curso, vía `esDeEstaCaja` de `backend/cajas.js`, sin una
   comparación propia de `caja_id`), 409 indicando qué tienda/caja. Primero se cierra el corte.
3. **Bloqueo real**: un middleware `requierePantalla(clave)` en cada ruta de escritura de la tabla anterior responde
   409 `{ codigo: 'PANTALLA_APAGADA', pantalla }` antes de tocar nada. Las rutas GET no se bloquean.
4. **Falla cerrando**: el valor guardado de cada interruptor es booleano. Si falta la clave (estado anterior a esta
   entrega) cuenta como **encendida**, para que el despliegue no cambie nada. Si existe y no es booleano, cuenta como
   **apagada**.
5. **Solo con permiso**: permiso nuevo `activar_pantallas_caja` (módulo `admin`, en `backend/permisosCatalogo.js`).
   Lo recibe el Administrador por la reconciliación de siempre; a nadie más se le da automático.
6. **Constancia**: cada cambio guarda quién, cuándo (ISO UTC), qué pantalla y de qué a qué, en una lista de solo
   agregar dentro de la configuración. Visible en el panel.
7. Las funciones internas (por ejemplo, `crearVenta` usada por otros módulos o pruebas) no se bloquean: el bloqueo vive
   en las rutas HTTP de la tabla. Si alguna otra ruta crea movimientos de caja por otro camino, se incluye y se reporta.

## 3b. MercadoLibre (decisión de Victor, 2026-10-15, tras la parada de Codex)

`POST /api/ml/ordenes/:ordenId/importar` crea ventas que entran al corte de la caja de MercadoLibre como
transferencia. Decisión: **el corte de MercadoLibre sigue funcionando siempre**.
- `corte_caja` apagado aplica solo a las tiendas que no son la de MercadoLibre. La tienda de MercadoLibre se identifica
  como lo hace hoy el código de ML (no por un número fijo nuevo); si no hay forma inequívoca, detente y reporta.
- La importación de órdenes de ML no se bloquea con ningún interruptor.
- Con `corte_caja` apagado, `POST /api/cortes` sigue aceptando la caja de MercadoLibre y rechaza (409
  `PANTALLA_APAGADA`) las demás. La pantalla Corte de Caja sigue en el menú solo para quien ve la tienda de
  MercadoLibre, y ahí solo deja elegir esa caja.
- La regla 2 (dinero sin cortar) no cuenta la caja de MercadoLibre.
- Pruebas: con corte apagado, importar orden ML funciona y su corte se puede cerrar; corte de otra tienda da 409.

## 4. Guardado

En la configuración existente (`backend/configuracion.js`, persistida como hoy): `pantallas: { punto_venta: true, ... }`
y `pantallas_historial: [...]`. Rutas: `GET /api/configuracion/pantallas` (cualquier usuario con sesión: el menú la
necesita) y `PUT /api/configuracion/pantallas` con `{ pantalla, activa }` (permiso `activar_pantallas_caja`).
Clave desconocida o `activa` no booleano → 400.

## 5. Pantalla

- Menú (`src/BarraLateral.jsx`, Dashboard): las pantallas apagadas no aparecen para nadie.
- Si alguien entra directo a una pantalla apagada: mensaje "Esta pantalla está desactivada por el administrador" y
  nada más.
- En Garantías, con `dinero_garantias_caja` apagado: se esconden los botones de cobro y gasto en efectivo.
- Panel "Pantallas de caja" (dentro de la configuración que ya existe, visible solo con el permiso): un interruptor por
  pantalla, el motivo cuando el servidor rechaza (regla 1 o 2), y el historial de cambios.

## 6. Dinero, inventario y personal

- Apagar no borra ni modifica ventas, cortes, gastos, depósitos ni garantías.
- La regla 2 evita que quede dinero sin corte que lo espere (faltante inventado a la cajera).
- Inventario: con `punto_venta` apagado no hay ventas que descuenten existencia; SICAR es quien vende.

## 7. Pruebas

- Backend: cada ruta de la tabla responde 409 apagada y funciona encendida; GET siguen; regla 1 en los dos sentidos;
  regla 2 con un movimiento sin cortar (y con una venta histórica `caja_id: null` que el corte de la Administrativa
  cobra); clave ausente = encendida, valor no booleano = apagada; sin permiso 403; historial guarda usuario y fecha;
  validación de permisos de arranque (`validarSistemaDePermisos`) pasa con el permiso nuevo.
- Navegador: apagar Punto de Venta y verlo desaparecer del menú; entrar por URL y ver el mensaje; intentar apagar
  Corte con Punto de Venta encendido y ver el motivo; volver a encender.

## 8. Fuera de alcance

Borrar código del Punto de Venta; cambiar roles existentes; Entrega 1 (CRM).
