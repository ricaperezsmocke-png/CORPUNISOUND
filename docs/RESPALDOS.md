# Respaldos y restauración — guía para Victor

Este documento explica, en español y sin jerga, cómo funciona el sistema de
respaldos de CORPUNISOUND, qué tienes que configurar, y qué hacer el día que
de verdad necesites recuperar todo.

Hay **tres copias** de los datos:

1. **En Render** — donde vive el sistema todos los días.
2. **En Google Drive**, cifradas — se suben solas cada hora, y dos veces al
   día (4pm y 5pm hora de Chiapas) quedan marcadas como "punto de
   restauración".
3. **En tu computadora**, también cifradas — un script las baja todos los
   días a una carpeta en tu PC. Es la copia que sobrevive aunque algo le
   pase a Render Y a tu cuenta de Google Drive al mismo tiempo. **Ojo:** hoy
   esa copia es solo de resguardo — la pantalla de restaurar lee de Drive, no
   de tu PC, así que todavía no hay un procedimiento para usar directamente
   los archivos de tu computadora si Drive no está disponible (ver el punto
   7, "El hueco que sigue abierto").

---

## 1. Qué se respalda y qué no

**Sí se respaldan:** todos los datos del negocio — ventas, clientes,
inventario, apartados, garantías, gastos, depósitos, usuarios, roles,
configuración de sucursales, etc. Básicamente todo lo que ves en el sistema.

**No se respaldan** (y no hace falta, porque ya están seguros en otro lado):

- **Los comprobantes de depósitos y las fotos/PDF de expedientes de personal**
  — esos ya viven en Google Drive por su cuenta, fuera de este sistema de
  respaldos.
- **El catálogo del SAT** (claves de producto, unidades, etc.) — es un
  catálogo público que se puede volver a bajar en cualquier momento, no es
  información de tu negocio.

## 2. Cómo generar `RESPALDO_LLAVE` y dónde anotarla

Los respaldos —los de Drive y los de tu PC— se guardan **cifrados**. Sin la
llave correcta, esos archivos son basura ilegible: ni tú, ni Google, ni nadie
puede abrirlos. Eso es a propósito: si alguien roba tu laptop o entra a tu
Drive, no se lleva la empresa.

**Cómo generarla (una sola vez):**

En cualquier computadora con Node instalado, abre una terminal y escribe:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Va a imprimir una cadena larga de letras y números (64 caracteres). Esa
cadena **es** tu `RESPALDO_LLAVE`.

**Dónde anotarla — en los DOS lugares:**

1. **En papel**, guardado en la caja fuerte de la oficina.
2. **En tu gestor de contraseñas** (el que ya usas para las demás claves del
   negocio).

> **Advertencia seria:** si pierdes esta llave, pierdes el acceso a TODOS
> los respaldos, tanto los de Drive como los de tu PC. No hay forma de
> recuperarla — ni Google, ni el desarrollador, ni nadie tiene una copia.
> Por eso va en dos lugares distintos.

Una vez generada, esa misma cadena se pega en Render (ver siguiente
sección de variables). **No se cambia después** — si la cambias, los
respaldos viejos quedan cifrados con la llave anterior y ya no se pueden
abrir con la nueva.

## 3. Cómo poner `CLAVE_RESTAURACION` en Render

Esta es una segunda clave, **distinta** de `RESPALDO_LLAVE`. Es la que se
teclea en la pantalla de Respaldos cada vez que alguien quiere **restaurar**
el sistema a un punto anterior. Piénsala como el "botón rojo": sin esta
variable configurada, el botón de restaurar **ni siquiera aparece** en el
sistema — restaurar está completamente apagado.

**Cómo configurarla:**

1. Entra al panel de Render → el servicio del backend de CORPUNISOUND →
   **Environment**.
2. Agrega una variable nueva: `CLAVE_RESTAURACION`, con el valor que tú
   elijas (una frase o clave que solo tú conozcas — no tiene que ser tan
   larga como `RESPALDO_LLAVE`, pero que no sea obvia).
3. Guarda. Render reinicia el servicio solo.

Igual que con `RESPALDO_LLAVE`: anótala en papel en la caja fuerte y en tu
gestor de contraseñas.

Mientras estés instalando el sistema por primera vez, también agrega ahí
mismo `RESPALDO_LLAVE` (sección anterior) y `TOKEN_DESCARGA_RESPALDOS`
(lo necesita el Apéndice, al final de este documento, para que el script de
tu PC pueda descargar los respaldos) — las tres se ponen igual, desde el
panel de Render, **a mano**. Nunca se tocan en el archivo `render.yaml` del
repositorio.

**Cómo generar `TOKEN_DESCARGA_RESPALDOS`:** igual que `RESPALDO_LLAVE`, con
el mismo comando:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Tiene que ser una cadena larga y aleatoria como esa — nunca una palabra que
se te ocurra a ti.** El sistema no bloquea los intentos en esta ruta (no
tiene el mismo freno que sí tiene el login), así que un token corto o
adivinable es un candado débil. Con los 32 bytes aleatorios del comando de
arriba, no hay forma práctica de adivinarlo.

## 4. Cómo restaurar, paso a paso

Solo hazlo si de verdad necesitas regresar el sistema a un momento anterior
(por ejemplo, después de un error grave o una restauración de emergencia).

1. Entra al sistema con un usuario que tenga el permiso de restaurar
   respaldos **y** acceso a **todas las sucursales** — con una cuenta
   amarrada a una sola tienda, el botón de restaurar ni siquiera aparece.
2. Ve al módulo **Respaldos**. Vas a ver la lista de puntos de restauración
   disponibles (las copias del día y las de antes de una restauración
   anterior).
3. Junto al punto al que quieres regresar, presiona **Restaurar**. Se abre
   una ventana que, apenas se abre, ya te muestra la comparación: qué tan
   distinto es ese punto de lo que hay ahora (cuántos registros se ganarían
   o perderían). No hay un botón "Comparar" aparte — la comparación viene
   incluida al abrir esa ventana.
4. Si decides seguir, en esa misma ventana el sistema te pide:
   - La **`CLAVE_RESTAURACION`** que configuraste en Render.
   - Escribir la palabra **`RESTAURAR`** para confirmar que entendiste lo
     que va a pasar.
5. Presiona el botón de confirmar dentro de la ventana.

> **Advertencia:** restaurar corta la sesión de **todos** los usuarios
> conectados en las 5 tiendas en ese momento. Todos van a tener que volver
> a iniciar sesión. Avisa antes de hacerlo, sobre todo si es en horario de
> venta.

Si te equivocas 5 veces seguidas con la `CLAVE_RESTAURACION`, el sistema se
bloquea un rato antes de dejarte intentar de nuevo (protección contra
adivinar la clave a la fuerza).

## 5. Cómo se deshace una restauración equivocada

Cada vez que restauras, el sistema automáticamente crea **otro** respaldo
justo *antes* de hacer el cambio, marcado como `pre_restauracion`, con la
fecha y hora de ese momento. Ese respaldo aparece en la misma lista del
módulo Respaldos.

Si restauraste al punto equivocado, o algo salió mal:

1. Ve al módulo Respaldos.
2. Busca el respaldo `pre_restauracion` con la fecha y hora de justo antes
   de tu restauración.
3. Restaura ese, con el mismo procedimiento de la sección 4.

Así regresas exactamente a como estaba el sistema un segundo antes de tu
error.

## 6. Qué hacer si el semáforo está rojo

El módulo Respaldos tiene un semáforo arriba, con solo dos colores: verde
(todo bien) o rojo (algo falla). Si está en rojo, revisa en este orden:

1. **La conexión de Google Drive**, en el módulo **Roles y Personal**, en el
   recuadro etiquetado *"Google Drive (expedientes de personal)"* — el
   nombre menciona expedientes porque ahí se conectó primero, pero **es la
   misma cuenta de Google que usan los respaldos**. Confirma que siga
   conectada y no haya pedido volver a iniciar sesión.
2. **Tu correo**, buscando avisos de **Sentry** — el sistema manda un aviso
   ahí cuando un respaldo falla varias veces seguidas.
3. **Que `RESPALDO_LLAVE` siga puesta en Render** (Environment del
   servicio) — si alguien la borró sin querer, el sistema deja de
   respaldar por completo, aunque el resto siga funcionando normal.

Si después de revisar esos tres puntos el semáforo sigue en rojo, es momento
de pedir ayuda técnica — pero ya tienes identificado dónde está el problema.

## 7. El hueco que sigue abierto

Este sistema respalda **los datos** (ventas, clientes, inventario, etc.),
pero **no respalda las llaves del sistema** — las variables de configuración
que solo existen en el panel de Render (la conexión a Google, la conexión a
Mercado Libre, la llave de inteligencia artificial, `RESPALDO_LLAVE` y
`CLAVE_RESTAURACION` entre ellas). Tampoco existe todavía un instructivo
para levantar el sistema completo (la aplicación, no solo los datos) en un
servidor nuevo desde cero.

Es decir: si Render desapareciera por completo, tienes los datos a salvo
(en Drive y en tu PC), pero instalar el sistema de nuevo en otro lado
requeriría trabajo técnico adicional que hoy no está documentado. Los
detalles de este pendiente están en el documento de diseño:
`docs/superpowers/specs/2026-08-11-respaldos-y-restauracion-design.md`
(sección final, "El hueco que sigue abierto").

---

## Apéndice: instalar la copia local en tu PC

Esta parte es más técnica — pídele ayuda a quien te instaló el sistema si
no te sientes cómodo haciéndolo tú mismo.

**1. Crea el archivo de configuración.** Junto al script
`scripts\respaldo-local.mjs`, crea un archivo llamado
`respaldo-local.config.json` con este contenido (ajusta los valores):

```json
{
  "api": "https://punto-de-venta-backend.onrender.com/api",
  "token": "el mismo valor que TOKEN_DESCARGA_RESPALDOS en Render",
  "carpeta": "C:\\Respaldos CORPUNISOUND",
  "diasAConservar": 90
}
```

Este archivo **no se sube a Internet ni a git** — vive solo en tu PC, porque
tiene el token de descarga adentro.

**2. Pruébalo a mano.** Abre una terminal en la carpeta `scripts` y corre:

```
node respaldo-local.mjs
```

Debe bajar los respaldos a la carpeta que configuraste y anotarlo en el
mensaje. Si lo corres una segunda vez seguida, debe decir "Al corriente" —
señal de que no hay nada nuevo que bajar.

**3. Instala la tarea programada de Windows** (para que se ejecute solo,
todos los días, sin que tengas que acordarte). Abre PowerShell **como
administrador** y escribe:

```powershell
schtasks /Create /TN "CORPUNISOUND-Respaldo-Local" /TR "C:\Users\Victor\Desktop\CORPUNISOUND\scripts\respaldo-local.cmd" /SC DAILY /ST 20:00 /RL HIGHEST /F
schtasks /Change /TN "CORPUNISOUND-Respaldo-Local" /Z /V1
```

La segunda línea hace que, si tu PC estaba apagada a las 8pm, la tarea se
ejecute en cuanto la prendas — así nunca se te acumulan varios días sin
respaldo local.

> Esta tarea vive en Windows, no en el sistema. Si cambias de computadora o
> reinstalas Windows, hay que volver a crearla con estos mismos comandos.

**Los archivos que se guardan en tu PC quedan cifrados.** Para abrirlos en
una emergencia hace falta `RESPALDO_LLAVE` (sección 2 de este documento) y
la herramienta de restauración del sistema — no se abren con un programa
común de Windows.
