/**
 * arranquePersistencia.test.js — El servidor NO debe arrancar en producción si
 * no puede guardar.
 *
 * Defecto original: `require("./persistencia")` dentro de un try/catch dejaba
 * `guardar` como función vacía y el backend arrancaba igual. Se podía cobrar
 * todo el día y perderlo todo en el siguiente reinicio.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { debeAbortarSinPersistencia, mensajeSinPersistencia } = require("./arranquePersistencia");

// ---------------------------------------------------------------------------
// El criterio, en aislamiento.
// ---------------------------------------------------------------------------

test("sin NODE_ENV se aborta: lo no declarado se trata como producción", () => {
  // Es el caso REAL de este despliegue: render.yaml no define NODE_ENV. Si esto
  // devolviera false, producción se quedaría con el comportamiento tolerante
  // que este arreglo vino a quitar.
  assert.strictEqual(debeAbortarSinPersistencia({}), true);
});

test("NODE_ENV=production aborta", () => {
  assert.strictEqual(debeAbortarSinPersistencia({ NODE_ENV: "production" }), true);
});

test("NODE_ENV=development tolera: es la salida a propósito de quien desarrolla", () => {
  assert.strictEqual(debeAbortarSinPersistencia({ NODE_ENV: "development" }), false);
});

test("NODE_ENV=test tolera", () => {
  assert.strictEqual(debeAbortarSinPersistencia({ NODE_ENV: "test" }), false);
});

test("NODE_ENV vacío o en blanco aborta (no cuenta como declarar nada)", () => {
  assert.strictEqual(debeAbortarSinPersistencia({ NODE_ENV: "" }), true);
  assert.strictEqual(debeAbortarSinPersistencia({ NODE_ENV: "   " }), true);
});

test("un NODE_ENV desconocido aborta: ante la duda, se falla cerrado", () => {
  assert.strictEqual(debeAbortarSinPersistencia({ NODE_ENV: "staging" }), true);
  assert.strictEqual(debeAbortarSinPersistencia({ NODE_ENV: "qa" }), true);
});

test("se acepta con mayúsculas y espacios, como llegan de una variable mal puesta", () => {
  assert.strictEqual(debeAbortarSinPersistencia({ NODE_ENV: "Development" }), false);
  assert.strictEqual(debeAbortarSinPersistencia({ NODE_ENV: " development " }), false);
});

test("el aviso de aborto dice la causa real y cómo salir del paso", () => {
  const texto = mensajeSinPersistencia(new Error("NODE_MODULE_VERSION mismatch"), true);
  assert.match(texto, /NODE_MODULE_VERSION mismatch/, "debe incluir la causa real, no solo 'falló'");
  assert.match(texto, /npm install/, "debe decir cómo se arregla");
  assert.match(texto, /NODE_ENV=development/, "y cuál es la salida deliberada");
});

test("el aviso tolerante es imposible de confundir con un arranque sano", () => {
  const texto = mensajeSinPersistencia(new Error("lo que sea"), false);
  assert.match(texto, /NADA DE LO QUE HAGAS SE VA A GUARDAR/, "tiene que gritar, no susurrar");
  assert.match(texto, /lo que sea/, "y decir la causa real");
});

// ---------------------------------------------------------------------------
// El arranque de verdad: se levanta server.js con la persistencia rota.
// ---------------------------------------------------------------------------

/**
 * Copia el backend a una carpeta temporal y deja `persistencia.js` reventando
 * al cargarse, que es justo lo que hace better-sqlite3 cuando cambia la versión
 * de Node. Se hace sobre una copia para no tocar el backend real.
 */
function backendConPersistenciaRota() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "arranque-"));
  for (const archivo of fs.readdirSync(__dirname)) {
    // `datos.sqlite` SÍ se copia: server.js consulta el catálogo del SAT al
    // arrancar (clavesSat.js) y sin ese archivo el proceso se muere por un
    // motivo que no es el que esta prueba está midiendo.
    //
    // `.env` NO se copia, por dos razones: trae credenciales reales (las de
    // MercadoLibre) y no tienen por qué acabar en una carpeta temporal; y
    // dotenv las cargaría, haciendo que el resultado de la prueba dependa de
    // qué tenga configurado la computadora donde corre.
    if (archivo === "node_modules" || archivo === ".env") continue;
    const origen = path.join(__dirname, archivo);
    if (fs.statSync(origen).isDirectory()) {
      fs.cpSync(origen, path.join(carpeta, archivo), { recursive: true });
    } else {
      fs.copyFileSync(origen, path.join(carpeta, archivo));
    }
  }
  // node_modules se enlaza por referencia: copiarlo entero sería lentísimo.
  fs.symlinkSync(path.join(__dirname, "node_modules"), path.join(carpeta, "node_modules"), "junction");
  fs.writeFileSync(
    path.join(carpeta, "persistencia.js"),
    'throw new Error("NODE_MODULE_VERSION mismatch simulado");\n'
  );
  return carpeta;
}

/**
 * Levanta server.js de verdad y distingue las DOS formas de "no responder":
 *
 *  - `murio`: el proceso terminó SOLO, con código distinto de cero. Es lo que
 *    queremos: el arranque se canceló.
 *  - `seQuedoVivo`: siguió corriendo hasta que lo tuvimos que matar. Eso es un
 *    servidor levantado y escuchando — o sea, cobrando en el vacío.
 *
 * La diferencia importa: una versión que solo IMPRIME el aviso y arranca igual
 * también deja de responder a este proceso (se queda escuchando), así que
 * mirar el texto de salida no alcanza para distinguirlas. Hay que mirar si el
 * proceso se murió solo o si tuvimos que matarlo.
 *
 * EL PLAZO NO ES DECORATIVO. Se distingue "se murió" de "sigue vivo" por si
 * hubo que matarlo, así que un plazo corto convierte una máquina ocupada en un
 * fallo falso: `node --test` corre los archivos en PARALELO, y con la suite
 * completa encima el proceso que iba a abortar puede no alcanzar ni a arrancar
 * antes de que se le acabe el tiempo. Ya pasó: esta prueba pasaba sola y
 * fallaba dentro de la suite.
 *
 * Por eso son dos plazos distintos, y cada uno se equivoca del lado seguro:
 *  - ABORTAR (PLAZO_MUERTE): generoso. Abortar toma ~2 s; si en 90 s no murió,
 *    es que de verdad se quedó escuchando, no que la máquina iba lenta.
 *  - SEGUIR VIVO (PLAZO_VIDA): corto. Solo hay que confirmar que NO se murió,
 *    y para eso basta con que aguante unos segundos.
 */
const PLAZO_MUERTE = 90000;
const PLAZO_VIDA = 10000;

/**
 * PORT=0 significa "que el sistema operativo elija un puerto libre".
 *
 * El hijo hereda `process.env`, y ahí viene `PORT`. Sin fijarlo, `server.js`
 * cae a su default 4000 o al PORT de quien corra las pruebas, y entonces el
 * resultado depende de qué más esté corriendo: un backend de desarrollo
 * levantado, o dos corridas de la suite a la vez, y el hijo muere por
 * EADDRINUSE. Eso se lee como "el servidor no sobrevivió sin persistencia",
 * que es una mentira: murió por el puerto, no por lo que la prueba mide.
 *
 * Está comprobado: dos corridas de este archivo compartiendo PORT dan 12/12 en
 * una y 11/12 en la otra. Un puerto FIJO no arregla eso — solo mueve el choque.
 * Pedirle uno libre al sistema en cada arranque sí, y como la prueba nunca se
 * conecta al servidor (solo mira si sigue vivo), no necesita saber cuál tocó.
 */
const PUERTO_PRUEBA = "0";

function arrancar(carpeta, env, plazo) {
  const r = spawnSync(process.execPath, [path.join(carpeta, "server.js")], {
    env: { ...process.env, PORT: PUERTO_PRUEBA, ...env },
    encoding: "utf8",
    timeout: plazo,
  });
  const salida = String(r.stdout || "") + String(r.stderr || "");
  // Si hubo que matarlo (signal), siguió vivo: arrancó.
  const seQuedoVivo = r.signal !== null || r.error?.code === "ETIMEDOUT";
  return { murio: !seQuedoVivo && r.status !== 0, seQuedoVivo, status: r.status, signal: r.signal, salida };
}

/**
 * Lo que el hijo dijo antes de morir, para el mensaje de la aserción.
 *
 * Sin esto, un fallo aquí se lee como "expected: true, actual: false" y punto:
 * no se distingue un puerto ocupado de una excepción de arranque, y hay que
 * reproducirlo a mano para enterarse. Ya pasó — costó una investigación
 * completa averiguar que el proceso simplemente se moría, sin saber de qué.
 * La salida del hijo es la evidencia; que viaje con el fallo.
 */
function detalle(r) {
  return `\n--- estado: status=${r.status} signal=${r.signal} ---\n--- salida del hijo ---\n${r.salida || "(vacía)"}\n---`;
}

test("ARRANQUE REAL: con la persistencia rota y sin NODE_ENV, el proceso se muere solo", () => {
  const carpeta = backendConPersistenciaRota();
  try {
    const r = arrancar(carpeta, { NODE_ENV: undefined, DB_PATH: undefined }, PLAZO_MUERTE);
    assert.strictEqual(
      r.seQuedoVivo, false,
      "el servidor se quedó escuchando: eso es cobrar todo el día en el vacío, justo el defecto original" + detalle(r)
    );
    assert.strictEqual(r.murio, true, `debió salir con código distinto de cero${detalle(r)}`);
    assert.match(r.salida, /ARRANQUE CANCELADO/, "y tiene que decir por qué, a gritos" + detalle(r));
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("ARRANQUE REAL: con NODE_ENV=production el proceso se muere solo", () => {
  const carpeta = backendConPersistenciaRota();
  try {
    const r = arrancar(carpeta, { NODE_ENV: "production", DB_PATH: undefined }, PLAZO_MUERTE);
    assert.strictEqual(r.seQuedoVivo, false, "en producción no puede quedarse escuchando sin poder guardar" + detalle(r));
    assert.strictEqual(r.murio, true, detalle(r));
    assert.match(r.salida, /ARRANQUE CANCELADO/, detalle(r));
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("ARRANQUE REAL: en desarrollo SÍ se tolera — se queda vivo, avisando", () => {
  const carpeta = backendConPersistenciaRota();
  try {
    const r = arrancar(carpeta, { NODE_ENV: "development", DB_PATH: undefined }, PLAZO_VIDA);
    assert.strictEqual(
      r.seQuedoVivo, true,
      "probar sin compilar el módulo nativo tiene que seguir siendo posible" + detalle(r)
    );
    assert.match(r.salida, /NADA DE LO QUE HAGAS SE VA A GUARDAR/, "pero con un aviso imposible de ignorar" + detalle(r));
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});
