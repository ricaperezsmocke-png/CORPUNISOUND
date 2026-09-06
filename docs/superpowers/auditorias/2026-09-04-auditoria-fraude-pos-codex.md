# Auditoría de riesgo de pérdida y fraude interno — CORPUNISOUND

Revisé la rama `feature/cajas-pos`, HEAD `e35a4dc31c42094409b8ae747fc80ebcd316fabf`, en solo lectura. El árbol quedó intacto. No repetí los hallazgos del plan previo sobre época sellada, doble conteo, `caja_id`, gastos por caja ni avisos/reportes de cortes.

## Resumen para Victor

Hoy existen tres caminos especialmente peligrosos:

1. Una persona con permiso de cancelar ventas puede entregar mercancía, cobrarla, cancelar el ticket antes del corte y quedarse con el efectivo. El corte puede cuadrar y el inventario también.
2. Cualquier cajera del rol estándar puede crear un cliente ficticio con el límite de crédito que quiera y entregar mercancía “a crédito”. El sistema no comprueba el límite y ni siquiera genera la deuda del cliente.
3. Un gerente puede crear una cuenta nueva con rol Administrador usando su permiso normal de alta de personal. Después tendría acceso total.

No encontré una operación completamente invisible en la base. El problema es más sutil: varias dejan un registro que parece legítimo, pero no producen una alerta, un faltante de caja o una responsabilidad claramente atribuida.

---

# I. Fraude deliberado

## 1. Cancelar una venta cobrada permite sacar efectivo y mercancía dejando caja e inventario aparentemente cuadrados

**Impacto:** hasta el valor completo de cualquier ticket.  
**Facilidad:** interfaz normal. Requiere `cancelar_ventas`; el Gerente de sucursal lo recibe actualmente. La Cajera estándar no.

### Guion concreto

Un gerente vende una bocina de $8,000 en efectivo a un cómplice. Cobra y entrega la bocina. Antes del corte abre Consultas de Ventas, selecciona el ticket, pulsa “Cancelar” y escribe “cliente se arrepintió”.

El sistema:

- elimina los $8,000 del efectivo esperado;
- devuelve la bocina al inventario lógico;
- no exige confirmar que se devolvió físicamente la mercancía;
- no registra un movimiento separado de devolución de dinero.

El gerente toma los $8,000. El cajón puede cuadrar y el sistema afirma que la bocina sigue en la tienda.

### Evidencia

[backend/ventas.js:182](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/ventas.js:182):

```js
venta.estatus = "cancelada";
venta.motivo_cancelacion = motivo || "";
venta.fecha_hora_cancelacion = new Date().toISOString();
venta.cancelada_por = usuario?.nombre || "—";
```

[backend/ventas.js:198](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/ventas.js:198):

```js
// Reintegra al inventario
ajustarExistencia(DB, l.producto_id, {
  cantidad: Number(l.cantidad),
  motivo: `Cancelación de venta — folio ${venta.id}`,
  sucursal_id: venta.sucursal_id
});
```

[backend/cortes.js:51](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/cortes.js:51) solo incluye ventas `estatus === "cerrada"`, por lo que la cancelada desaparece del efectivo esperado.

La pantalla permite hacerlo directamente en [src/ConsultasVentas.jsx:154](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/src/ConsultasVentas.jsx:154) y [src/ConsultasVentas.jsx:269](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/src/ConsultasVentas.jsx:269).

### Qué queda registrado

Queda:

- ticket cancelado;
- motivo libre;
- fecha y hora;
- nombre del usuario en `cancelada_por`;
- movimiento de inventario.

No queda:

- confirmación de recepción física;
- identidad de quien autorizó la devolución;
- monto y forma en que se devolvió el dinero;
- evidencia firmada por el cliente;
- alerta por cancelación de alto importe.

Además, el detalle mostrado en pantalla solo enseña el motivo en [src/ConsultasVentas.jsx:423](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/src/ConsultasVentas.jsx:423), no `cancelada_por`. El reporte general tampoco expone al cancelador.

### Arreglo

- Separar “solicitar cancelación” de “autorizar cancelación”.
- Exigir segundo usuario con PIN para importes altos o ventas en efectivo.
- Registrar devolución física por renglón y forma/monto del reembolso.
- No reintegrar stock hasta confirmar recepción física.
- Mostrar y exportar `cancelada_por`, hora y total cancelado.
- Generar alerta diaria de cancelaciones por usuario, importe y cercanía al corte.

---

## 2. Una cajera puede crear crédito ficticio e ilimitado y entregar mercancía sin generar una cuenta por cobrar

**Impacto:** potencialmente todo el inventario accesible.  
**Facilidad:** interfaz normal, sin manipular HTTP. El rol Cajero tiene `crear_cliente` y `cerrar_venta`.

### Guion concreto

Una cajera crea desde el POS un cliente llamado “Juan Pérez”, marca “Es sujeto de crédito” y captura límite de $100,000. Agrega $30,000 de mercancía, elige “CRÉDITO” en la forma de pago y entrega los artículos a un cómplice.

El sistema acepta la venta aunque:

- el cliente no hubiera sido autorizado;
- el límite fuera falso;
- ya tuviera saldo vencido;
- fuera Público en General;
- el total superara el límite.

Peor todavía: después de vender, `cliente.saldo` no aumenta. El reporte de cartera continúa mostrando que ese cliente no debe nada.

### Evidencia

La pantalla deja a la cajera decidir crédito y límite en [src/PuntoDeVenta.jsx:1093](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/src/PuntoDeVenta.jsx:1093):

```jsx
<input type="checkbox" checked={formCliente.sujeto_credito} ... />
<input type="number" ... value={formCliente.limite_credito} ... />
```

Todas las condiciones, incluida `CRÉDITO`, se muestran como opciones seleccionables en [src/PuntoDeVenta.jsx:1191](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/src/PuntoDeVenta.jsx:1191).

El catálogo la habilita para todas las sucursales en [backend/condicionesPago.js:14](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/condicionesPago.js:14):

```js
const FORMAS_PAGO_DEFAULT = [
  "EFECTIVO", "TARJETA", "VALES", "CHEQUE", "TRANSFERENCIA", "CRÉDITO"
];
```

El alta acepta directamente los datos enviados en [backend/clientes.js:47](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/clientes.js:47):

```js
sujeto_credito: !!datos.sujeto_credito,
limite_credito: Number(datos.limite_credito) || 0,
saldo: 0,
```

La venta solo copia el método y total recibidos en [backend/ventas.js:84](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/ventas.js:84). No busca al cliente, no valida crédito y no modifica su saldo.

La búsqueda completa de escrituras de `.saldo` confirmó que producción no incrementa el saldo al vender; solo las pruebas lo asignan manualmente.

### Qué queda registrado

Queda una venta aparentemente válida con método `CRÉDITO`.

No queda:

- deuda en el cliente;
- autorización;
- saldo anterior y posterior;
- quién concedió el límite;
- alerta de exceso;
- fecha de vencimiento real.

El corte muestra el total como crédito, de modo que no provoca faltante de efectivo.

### Arreglo

- Quitar campos de autorización de crédito del alta rápida del POS.
- Crear permiso específico `autorizar_credito_cliente`.
- Validar en servidor `sujeto_credito`, límite disponible y vencidos.
- Rechazar crédito a Público en General.
- Incrementar atómicamente `cliente.saldo`.
- Guardar vencimiento, autorizador y foto del límite utilizado.
- No confiar en la forma de pago enviada por el navegador.

---

## 3. Un gerente puede crear una cuenta Administrador

**Impacto:** control total: cancelaciones, inventario, restauraciones, roles y todas las sucursales.  
**Facilidad:** la API está expuesta con sus permisos normales. Desde la pantalla puede depender del acceso al módulo; mediante una petición HTTP manual es directo.

### Guion concreto

El rol Gerente posee `dar_alta_personal`. Envía el formulario de alta con el `rol_id` del rol Administrador y una contraseña propia. Inicia sesión con la cuenta nueva y ya tiene todos los permisos.

Los identificadores de roles son incluso consultables sin iniciar sesión mediante `GET /api/roles`.

### Evidencia

El gerente recibe prácticamente todos los permisos salvo cuatro en [backend/roles.js:68](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/roles.js:68); se excluye `administrar_roles`, pero no `dar_alta_personal`.

La ruta solo exige alta de personal en [backend/server.js:1265](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/server.js:1265):

```js
app.post("/api/usuarios",
  requiereLogin,
  requierePermiso("dar_alta_personal", resolverPermisosDeRol),
  async (req, res) => {
    res.json(await crearUsuario(DB, req.body));
  });
```

`crearUsuario` acepta el rol solicitado sin verificar que quien crea pueda asignarlo, en [backend/usuarios.js:142](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/usuarios.js:142):

```js
rol_id: Number(datos.rol_id),
sucursal_id: Number(datos.sucursal_id) || 1,
```

La pantalla presenta todos los roles en [src/AdminRoles.jsx:807](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/src/AdminRoles.jsx:807):

```jsx
{roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
```

Y [backend/server.js:1245](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/server.js:1245) expone la lista de roles sin login:

```js
app.get("/api/roles", (req, res) => res.json(listarRoles(DB)));
```

### Qué queda registrado

La cuenta nueva queda en Personal, pero no existe bitácora de:

- quién la creó;
- quién le asignó Administrador;
- fecha del alta;
- rol original del creador.

### Arreglo

- La ruta de alta debe exigir alcance global cuando se asignen roles globales.
- Una persona solo puede asignar roles contenidos dentro de sus propios permisos y alcance.
- `dar_alta_personal` de sucursal debe forzar la sucursal del token y una lista limitada de roles.
- Registrar creador, fecha, IP o sesión, rol y sucursal asignados.
- Proteger `GET /api/roles` y el catálogo de permisos con login.

---

## 4. Manipulando una petición, una cajera puede vender un artículo caro por $1 aunque no tenga permiso para cambiar precio

**Impacto:** diferencia completa entre precio real y precio enviado.  
**Facilidad:** exige modificar una petición HTTP. Basta una cuenta Cajero con `cerrar_venta`; no exige privilegios técnicos del servidor.

### Guion concreto

La cajera coloca una consola de $12,000 en el carrito. Modifica la petición antes de enviarla:

```json
{
  "total": 1,
  "lineas": [{
    "producto_id": 123,
    "cantidad": 1,
    "precio_unitario": 1,
    "descuento_pct": 0
  }]
}
```

El servidor registra una venta de $1 y descuenta la consola. No comprueba el precio del catálogo ni que la cajera posea `cambiar_numero_precio`.

También puede enviar `descuento_pct: 99.99` aunque no tenga permiso de descuentos.

### Evidencia

La única protección fina está en la interfaz, por ejemplo [src/PuntoDeVenta.jsx:669](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/src/PuntoDeVenta.jsx:669):

```jsx
{puede("cambiar_numero_precio") && <BotonBarra ... />}
```

Pero la ruta solamente comprueba `cerrar_venta` en [backend/server.js:1612](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/server.js:1612).

Y el backend copia los importes enviados en [backend/ventas.js:85](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/ventas.js:85):

```js
subtotal: Number(datos.subtotal) || 0,
descuento: Number(datos.descuento) || 0,
total: Number(datos.total) || 0,
```

Los detalles también copian precio y descuento en [backend/ventas.js:95](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/ventas.js:95).

### Qué queda registrado

El ticket queda registrado, pero parece una venta legítima de bajo valor. No queda:

- precio de catálogo al momento;
- diferencia autorizada;
- quién autorizó precio o descuento;
- regla de condición de pago aplicada.

### Arreglo

El servidor debe recalcular todo:

- obtener precio del catálogo y nivel autorizado;
- comprobar permisos para precio manual y descuento;
- recalcular subtotales y total;
- obtener el descuento de la condición de pago desde DB;
- rechazar cualquier diferencia entre total enviado y calculado;
- guardar precio original, precio cobrado, descuento y autorizador.

---

## 5. Un ajuste de inventario permite sacar mercancía; el movimiento no dice quién lo hizo

**Impacto:** cualquier cantidad disponible.  
**Facilidad:** interfaz normal con `ajustar_existencia`; el Gerente lo posee.

### Guion concreto

El gerente toma diez micrófonos. En Inventario selecciona el producto, pulsa “Ajustar”, escribe `-10` y como motivo “conteo físico”.

La existencia baja diez unidades, por lo que un inventario posterior cuadra. No hay venta ni faltante que apunte al responsable.

### Evidencia

La pantalla invita a capturar cantidades negativas y motivo libre en [src/InventarioProductos.jsx:738](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/src/InventarioProductos.jsx:738):

```jsx
<Campo label="Cantidad a sumar (usa negativo para restar)">
...
placeholder="Recepción de mercancía, merma, conteo físico..."
```

El movimiento guardado en [backend/productos.js:388](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/productos.js:388) no tiene usuario:

```js
DB.inventario.movimientos_inventario.push({
  producto_id: Number(id),
  sucursal_id: suc,
  fecha: new Date().toISOString(),
  tipo: delta >= 0 ? "entrada" : "salida",
  cantidad: delta,
  referencia_documento: motivo || "Ajuste manual",
});
```

La ruta tampoco pasa la identidad a `ajustarExistencia`: [backend/server.js:995](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/server.js:995).

### Qué queda registrado

Queda cantidad, fecha, sucursal y texto libre. No queda el usuario ni una autorización.

### Arreglo

- Guardar `usuario_id` y nombre desde el token.
- Motivos estructurados: merma, daño, conteo, robo, corrección.
- Evidencia obligatoria para mermas importantes.
- Segundo usuario para ajustes negativos superiores a un umbral.
- Reporte diario de ajustes por usuario, producto y costo.

---

## 6. Un gerente puede declarar depósitos inexistentes y ocultar dinero no entregado

**Impacto:** cualquier monto que la sucursal debiera entregar a la cuenta común.  
**Facilidad:** interfaz normal con `registrar_depositos`; el Gerente lo posee.

### Guion concreto

El gerente toma $25,000 que debía entregar. En Estado de Cuenta registra “Depósito $25,000, efectivo” sin adjuntar ficha.

El saldo de la sucursal aumenta $25,000 y parece que ya entregó el dinero al fondo común.

### Evidencia

El comprobante es opcional y la captura persiste incluso si Drive falla, en [backend/depositos.js:76](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/depositos.js:76):

```js
DB.cuenta_comun.depositos.push(deposito);
pushMovimiento(...);

// Comprobante OPCIONAL
if (buffer) {
  ...
} catch (_) {
  // Drive caído: se conserva el depósito sin comprobante.
}
```

El formulario solo adjunta archivo si se eligió uno, en [src/EstadoCuenta.jsx:176](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/src/EstadoCuenta.jsx:176).

El estado de cuenta suma todos los depósitos activos sin exigir comprobante, en [backend/estadoCuenta.js:32](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/estadoCuenta.js:32).

### Qué queda registrado

Sí quedan usuario, fecha, monto y ausencia visible del comprobante. No hay confirmación del receptor ni conciliación bancaria.

### Arreglo

- Un depósito capturado debe quedar `pendiente`, no `activo`.
- Requerir comprobante o confirmación independiente de CEDIS/administración.
- Solo un usuario distinto debe poder marcarlo como recibido.
- Comparar transferencias con estado bancario.
- Alertar depósitos en efectivo o sin ficha.

---

## 7. Un traspaso “en tránsito” puede usarse como escondite prolongado para mercancía

**Impacto:** costo de cualquier envío.  
**Facilidad:** interfaz normal con `realizar_traspasos`; exige responsable de inventario o gerente. Normalmente requiere colusión o control del traslado.

### Guion concreto

Se envían 20 bocinas a otra sucursal. El sistema las resta del origen inmediatamente. El receptor recibe físicamente 18, pero no confirma nada y dos desaparecen. Las veinte quedan indefinidamente “en tránsito”: no están en existencia de ninguna tienda.

### Evidencia

[backend/traspasos.js:4](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/traspasos.js:4):

```js
// se descuenta de inmediato la existencia de la sucursal origen,
// pero la sucursal destino no recibe nada todavía
```

[backend/traspasos.js:57](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/traspasos.js:57) resta todo al enviar. No existe cancelación, rechazo, recepción parcial, vencimiento ni escalamiento de tránsito atrasado.

### Qué queda registrado

Este fraude sí deja buen rastro del remitente y las unidades enviadas. Lo que falta es una alerta operativa que obligue a resolverlo.

### Arreglo

- Folio de embarque y responsable de transporte.
- Recepción con cantidades recibida, dañada y faltante.
- No permitir que un comentario libre sustituya la diferencia.
- Alertas por traspasos sin recibir después de 24/48 horas.
- Conciliación firmada por remitente y receptor.

---

# II. Fugas accidentales del sistema

## 8. Las ventas a crédito no crean saldo por cobrar

Es el mismo defecto del hallazgo 2, pero también ocurre sin mala fe: una cajera puede elegir legítimamente CRÉDITO para un cliente autorizado.

Una venta de $15,000 queda registrada y el corte muestra $15,000 como crédito, pero el cliente continúa con `saldo: 0`. La empresa entregó mercancía y pierde el control de quién debe pagar.

**Evidencia:** [backend/ventas.js:25](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/ventas.js:25) nunca modifica clientes; [backend/clientes.js:17](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/clientes.js:17) calcula el crédito disponible a partir de un saldo que las ventas no actualizan.

**Arreglo:** generar una cuenta por cobrar atómica junto con la venta, con vencimiento y saldo. Si falla, no crear la venta ni descontar inventario.

---

## 9. El “nivel de precio” del cliente está guardado pero no se usa al agregar productos

**Impacto:** diferencia entre lista 1 y lista 2–4 en cada venta.  
**Probabilidad:** alta; ocurre desde la interfaz normal.

El cliente guarda `precio_lista`, pero al agregar un artículo el POS usa siempre `producto.precio_venta`, que es el nivel 1.

### Evidencia

[src/PuntoDeVenta.jsx:360](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/src/PuntoDeVenta.jsx:360):

```js
precioUnitario: producto.precio_venta,
```

[backend/productos.js:227](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/productos.js:227):

```js
producto.precio_venta = producto.precios[0]?.precioVenta || 0;
```

El nivel elegido sí se guarda en [backend/clientes.js:48](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/clientes.js:48), pero no participa en la venta.

Dependiendo de cómo estén ordenadas las listas, CORPUNISOUND puede cobrar de más o de menos. El código no permite determinar el sentido económico sin revisar los datos reales.

### Arreglo

Resolver el precio en servidor con `cliente.precio_lista`, conservar una copia histórica y mostrar claramente “Lista N” en el ticket.

---

## 10. Una recepción de compra puede quedar aplicada a medias aunque la pantalla diga que falló

**Impacto:** inventario y costos duplicados o descoordinados.  
**Probabilidad:** media; especialmente con varios renglones o precios editados.

### Historia concreta

Se recibe una factura con varios artículos. El sistema:

1. guarda el encabezado;
2. añade existencias del primer producto;
3. cambia su costo y precios;
4. procesa los siguientes;
5. uno falla al validar precios.

La ruta responde “No se pudo registrar”. El usuario corrige y vuelve a intentarlo, pero parte de la primera recepción ya quedó guardada. Puede duplicar existencias o quedar bloqueado por UUID después de una recepción incompleta.

### Evidencia

En [backend/compras.js:71](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/compras.js:71) el encabezado se guarda antes del procesamiento:

```js
DB.inventario.compras.push(compra);
```

Después, dentro del bucle, muta sucesivamente:

```js
ajustarExistencia(...);             // línea 89
actualizarCostoDesdeCompra(...);    // línea 96
actualizarProducto(...);            // línea 104
```

`actualizarProducto` todavía puede lanzar, por ejemplo por cuatro precios en cero, en [backend/productos.js:248](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/productos.js:248).

No hay rollback o transacción del objeto en memoria.

### Arreglo

Validar todos los renglones y sus cambios de producto antes de la primera mutación. Después aplicar todo dentro de una transacción lógica/SQLite; ante cualquier excepción, restaurar el estado anterior.

---

## 11. Descuentos incorrectos en compras pueden registrar costos cero o negativos

**Impacto:** utilidad, inventario valorizado y precios de venta equivocados.  
**Probabilidad:** media; basta capturar mal pesos y porcentaje.

[backend/compras.js:61](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/compras.js:61):

```js
const costo = Number(r.costo);
const descuento_pesos = Number(r.descuento_pesos) || 0;
const descuento_porcentaje = Number(r.descuento_porcentaje) || 0;
const costoFinal = Math.round(
  (costo - descuento_pesos) * (1 - descuento_porcentaje / 100) * 100
) / 100;
```

No se valida que:

- `costo` sea finito y positivo;
- el descuento en pesos no exceda el costo;
- el porcentaje esté entre 0 y 100;
- el costo final sea positivo.

La existencia sí entra, pero [backend/compras.js:95](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/compras.js:95) solo actualiza el costo del producto si `costoFinal > 0`. El detalle de compra puede quedar en cero o negativo mientras el producto conserva otro costo.

**Arreglo:** límites estrictos, mostrar costo neto antes de confirmar y rechazar costos finales menores o iguales a cero salvo una operación especial autorizada.

---

## 12. Los gastos de garantía no afectan ninguna caja

**Impacto:** el corte muestra faltante igual al efectivo gastado.  
**Probabilidad:** alta si fletes o reparaciones se pagan con dinero del cajón.

### Historia concreta

La cajera paga $700 en efectivo por el traslado de una garantía y lo registra en “Gastos” de esa garantía. El reporte de garantías suma $700, pero el corte no descuenta nada porque ese registro no tiene forma de pago, sucursal ni caja.

### Evidencia

El registro de [backend/garantiasGastos.js:47](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/garantiasGastos.js:47) solo contiene:

```js
garantia_id,
tipo,
monto,
descripcion,
...
usuario,
fecha
```

No tiene `forma_pago`, `sucursal_id`, `caja_id`, `estatus` ni `corte_id`.

La pantalla tampoco pregunta cómo se pagó ni de dónde salió el dinero: [src/Garantias.jsx:624](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/src/Garantias.jsx:624).

El corte solo descuenta los registros del módulo general de gastos: [backend/cortes.js:164](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/cortes.js:164).

### Arreglo

Un gasto de garantía debe crear o enlazar un gasto general, declarando forma de pago y caja. Si fue efectivo, debe entrar en el mismo sellado de corte.

---

## 13. Los gastos de garantía se pueden borrar, junto con su comprobante

**Impacto:** pérdida de evidencia y subestimación del costo real de garantías.  
**Facilidad:** interfaz normal con `gestionar_garantias`; el Gerente lo posee.

[backend/garantiasGastos.js:79](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/garantiasGastos.js:79):

```js
if (gasto.drive_file_id) await drive.eliminarArchivoDeDrive(...);
DB.inventario.garantia_gastos.splice(idx, 1);
pushMovimiento(..., "gasto_eliminado", ...);
```

Queda una nota textual en movimientos, pero desaparecen descripción completa, archivo, fecha original y otros datos estructurados del gasto.

**Arreglo:** cancelar, nunca borrar. Conservar registro y comprobante, marcándolo `cancelado`, con motivo, fecha y usuario.

---

## 14. MercadoLibre puede importar órdenes no cobradas o canceladas como ventas cerradas

**Impacto:** ingresos ficticios e inventario reducido incorrectamente.  
**Probabilidad:** media; depende de qué estados devuelva la API.

### Evidencia

`importarOrdenComoVenta` obtiene la orden en [backend/mercadolibre.js:239](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/mercadolibre.js:239), pero no consulta ni valida `orden.status`, estado de pagos o cancelación.

Luego crea directamente:

```js
total: orden.total_amount,
metodo_pago: "mercadolibre",
estatus: "cerrada",
```

en [backend/mercadolibre.js:315](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/mercadolibre.js:315).

Esto es evidencia directa de que no existe el guard. Que MercadoLibre entregue efectivamente órdenes no cobradas en esa búsqueda depende de su respuesta externa; esa parte es una hipótesis operativa que debe comprobarse con datos reales.

### Arreglo

Importar solo estados explícitamente cobrados y no cancelados. Guardar ID, estado, pagos y total conciliado. Si cambia posteriormente a cancelado/reembolsado, crear una reversa automática.

---

## 15. MercadoLibre oculta faltantes de inventario al recortar el stock a cero

Si una orden vende cinco unidades y el sistema solo tenía dos, el código no deja `-3`, sino `0`:

[backend/mercadolibre.js:353](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/mercadolibre.js:353):

```js
if (ex) ex.cantidad_actual = Math.max(0, ex.cantidad_actual - l.cantidad);
```

Se pierden las tres unidades de diferencia. Además, no genera `movimientos_inventario`, a diferencia de ventas, compras y traspasos.

**Arreglo:** conservar negativos hasta conciliarlos, registrar movimiento por orden y alertar cualquier importación que exceda la existencia.

---

## 16. Una venta puede cerrarse sin descontar inventario si falta la fila de existencia

**Impacto:** existencias infladas y mercancía faltante.  
**Probabilidad:** baja en productos nuevos, mayor con datos restaurados o legados.

[backend/ventas.js:112](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/ventas.js:112):

```js
try {
  ajustarExistencia(...);
} catch (e) {
  // Si el producto no tiene registro de existencia en esta sucursal,
  // no se detiene la venta
}
```

La venta y su dinero se registran, pero el inventario no baja. La excepción se traga sin bitácora ni alerta.

El mismo patrón existe en apartados y cancelaciones.

**Arreglo:** no ignorar errores. Si se admite un dato legado sin fila, crear la fila de manera explícita, registrar la reparación y aplicar el movimiento; para cualquier otro error, revertir toda la venta.

---

## 17. La existencia inicial de productos no identifica quién introdujo el stock

[backend/productos.js:231](C:/Users/Victor/Desktop/CORPUNISOUND/.claude/worktrees/cajas-pos/backend/productos.js:231) crea directamente:

```js
cantidad_actual: esOrigen ? (Number(datos.existencia_inicial) || 0) : 0
```

No genera movimiento de inventario y `crearProducto` no recibe usuario. Esto dificulta distinguir una existencia inicial legítima de una cantidad inventada para tapar un faltante.

**Arreglo:** generar movimiento “existencia inicial”, con usuario, costo, sucursal y fecha; impedir cantidades negativas y requerir autorización sobre importes altos.

---

# Controles que sí encontré bien resueltos

Para no presentar todo como roto:

- Los gastos generales exigen comprobante antes de afectar DB y conservan evidencia al cancelarse.
- Cancelar gastos no borra el registro.
- Traspasos registran remitente y receptor.
- Las garantías tienen bitácora de movimientos y guard de sucursal.
- Restaurar un respaldo exige permiso propio, alcance global, clave adicional, palabra de confirmación y genera un respaldo previo.
- No encontré una vía normal para que una cajera restaure y borre rastros por sí sola. El riesgo de restauración aparece únicamente después de una escalada a Administrador o compromiso de sus credenciales.

# Orden recomendado de corrección

1. Bloquear crédito hasta implementar saldo, límite y autorización.
2. Endurecer cancelaciones y devoluciones físicas.
3. Impedir que `dar_alta_personal` asigne Administrador.
4. Recalcular precios, descuentos y totales completamente en backend.
5. Añadir usuario y doble autorización a ajustes de inventario.
6. Convertir depósitos en pendientes hasta conciliación.
7. Hacer atómicas las recepciones de compra.
8. Integrar gastos de garantía con caja y evitar su borrado.
9. Conciliar estados y movimientos de MercadoLibre.
10. Añadir alertas de traspasos pendientes y trazabilidad de existencia inicial.