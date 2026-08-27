// Controlador de semaforo simulado. Es un servidor CoAP con tres recursos:
//   /estado  (GET, observable): notifica cada cambio de luz
//   /comando (PUT): modo manual, forzar verde o rojo y sincronizacion de ola verde
//   /config  (GET y PUT): duracion del amarillo, umbrales y factor de tiempo
// Ademas observa el recurso /trafico de su sensor y decide el nivel de trafico
// en el borde con la mediana de las ultimas 3 lecturas validas.
// Uso: node controlador-semaforo.js <id> <puerto>   (ejemplo: node controlador-semaforo.js semaforo1 5685)

const coap = require('coap');
const config = require('./config.json');

const id = process.argv[2];
const puerto = parseInt(process.argv[3], 10);

if (!id || !puerto) {
  console.error('Uso: node controlador-semaforo.js <id> <puerto>');
  process.exit(1);
}

const datosSemaforo = config.semaforos.find((s) => s.id === id);
if (!datosSemaforo) {
  console.error('El semaforo ' + id + ' no existe en config.json');
  process.exit(1);
}
const datosSensor = config.sensores.find((s) => s.id === datosSemaforo.sensorId);
if (!datosSensor) {
  console.error('El sensor ' + datosSemaforo.sensorId + ' asignado a ' + id + ' no existe en config.json');
  process.exit(1);
}

// Configuracion modificable de forma remota via PUT /config
let configuracion = {
  duracionAmarilloSeg: 20,
  factorTiempo: 10,
  umbrales: { pocoMax: 5, normalMax: 15, muchoMax: 30 }
};

// Tiempos nominales de verde y rojo por nivel de trafico, segun la consigna
const TIEMPOS = {
  poco: { verdeSeg: 60, rojoSeg: 60 },
  normal: { verdeSeg: 180, rojoSeg: 180 },
  mucho: { verdeSeg: 300, rojoSeg: 180 },
  congestionamiento: { verdeSeg: 480, rojoSeg: 300 }
};

// Estado interno del semaforo
let estado = 'amarillo_intermitente';
let origen = 'automatico';
let nivelTrafico = 'nulo'; // arranca en nulo hasta que lleguen lecturas del sensor
let modoManual = false;
let transicionManualAVerde = false; // hay un amarillo -> verde manual en curso
let temporizador = null;
let ultimasValidas = []; // ultimas 3 lecturas validas del sensor
let observadoresEstado = [];

// Convierte segundos nominales a milisegundos reales aplicando el factor de tiempo
function ms(segundosNominales) {
  return (segundosNominales / configuracion.factorTiempo) * 1000;
}

// Arma el JSON del estado actual que se publica en /estado
function estadoActual() {
  return {
    semaforoId: id,
    ts: new Date().toISOString(),
    estado: estado,
    origen: origen,
    nivelTrafico: nivelTrafico
  };
}

// Cambia la luz, registra el origen del cambio y notifica a los observadores de /estado
function cambiarEstado(nuevoEstado, nuevoOrigen) {
  estado = nuevoEstado;
  origen = nuevoOrigen;
  const mensaje = JSON.stringify(estadoActual());
  observadoresEstado = observadoresEstado.filter((res) => {
    try {
      res.write(mensaje);
      return true;
    } catch (e) {
      return false;
    }
  });
  console.log('[' + id + '] estado: ' + nuevoEstado + ' (origen: ' + nuevoOrigen + ', nivel: ' + nivelTrafico + ')');
}

// Programa la siguiente transicion del ciclo cancelando cualquier temporizador previo
function programar(segundosNominales, funcion) {
  clearTimeout(temporizador);
  temporizador = setTimeout(funcion, ms(segundosNominales));
}

// Trafico nulo: amarillo intermitente sin temporizador, hasta que suba el nivel
function faseIntermitente() {
  clearTimeout(temporizador);
  cambiarEstado('amarillo_intermitente', 'automatico');
}

// Enciende el verde el tiempo que corresponde al nivel y despues pasa a rojo
function faseVerde(origenFase) {
  if (nivelTrafico === 'nulo') return faseIntermitente();
  cambiarEstado('verde', origenFase);
  programar(TIEMPOS[nivelTrafico].verdeSeg, () => faseRojo('automatico'));
}

// Enciende el rojo el tiempo del nivel y despues inicia el amarillo obligatorio
function faseRojo(origenFase) {
  if (nivelTrafico === 'nulo') return faseIntermitente();
  cambiarEstado('rojo', origenFase);
  programar(TIEMPOS[nivelTrafico].rojoSeg, () => faseAmarillo('automatico'));
}

// Amarillo obligatorio de 20 s (nominales) que siempre precede al paso de rojo a verde
function faseAmarillo(origenFase) {
  cambiarEstado('amarillo', origenFase);
  programar(configuracion.duracionAmarilloSeg, () => faseVerde(origenFase));
}

// Retoma el ciclo automatico desde el color actual sin repetir la notificacion del estado
function reanudarCiclo() {
  if (nivelTrafico === 'nulo') return faseIntermitente();
  if (estado === 'verde') return programar(TIEMPOS[nivelTrafico].verdeSeg, () => faseRojo('automatico'));
  if (estado === 'rojo') return programar(TIEMPOS[nivelTrafico].rojoSeg, () => faseAmarillo('automatico'));
  if (estado === 'amarillo') return programar(configuracion.duracionAmarilloSeg, () => faseVerde('automatico'));
  return faseAmarillo('automatico');
}

// Mediana de las ultimas lecturas validas; es robusta ante valores atipicos aislados
function mediana(valores) {
  const ordenados = valores.slice().sort((a, b) => a - b);
  return ordenados[Math.floor(ordenados.length / 2)];
}

// Traduce vehiculos por minuto al nivel de trafico usando los umbrales configurables
function calcularNivel(vehiculosPorMinuto) {
  const u = configuracion.umbrales;
  if (vehiculosPorMinuto <= 0) return 'nulo';
  if (vehiculosPorMinuto <= u.pocoMax) return 'poco';
  if (vehiculosPorMinuto <= u.normalMax) return 'normal';
  if (vehiculosPorMinuto <= u.muchoMax) return 'mucho';
  return 'congestionamiento';
}

// Procesa cada lectura del sensor: valida el rango, actualiza la mediana y el nivel.
// La validacion de rango evita que una lectura absurda del sensor altere el ciclo.
function procesarLectura(lectura) {
  const v = lectura.vehiculos;
  if (!Number.isInteger(v) || v < 0 || v > 200) {
    console.log('[' + id + '] lectura descartada por rango invalido: ' + v);
    return;
  }
  ultimasValidas.push(v);
  if (ultimasValidas.length > 3) ultimasValidas.shift();
  const nuevoNivel = calcularNivel(mediana(ultimasValidas));
  if (nuevoNivel === nivelTrafico) return;
  const nivelAnterior = nivelTrafico;
  nivelTrafico = nuevoNivel;
  console.log('[' + id + '] nivel de trafico: ' + nivelAnterior + ' -> ' + nuevoNivel);
  if (modoManual) return; // en manual el operador manda; el nivel solo se registra
  if (nuevoNivel === 'nulo') return faseIntermitente();
  // al salir de nulo se entra al ciclo pasando por el amarillo obligatorio
  if (estado === 'amarillo_intermitente') return faseAmarillo('automatico');
  // en los demas casos los tiempos nuevos se aplican al iniciar la siguiente fase
}

// Atiende las ordenes remotas recibidas por PUT /comando
function ejecutarComando(comando) {
  const accion = comando.accion;
  if (accion === 'activar_manual') {
    modoManual = true;
    clearTimeout(temporizador); // congela la luz actual hasta que el operador ordene
    return { ok: true, resultado: 'modo manual activado' };
  }
  if (accion === 'desactivar_manual') {
    modoManual = false;
    transicionManualAVerde = false;
    reanudarCiclo();
    return { ok: true, resultado: 'modo manual desactivado, ciclo automatico reanudado' };
  }
  if (accion === 'forzar_verde') {
    if (!modoManual) return { ok: false, resultado: 'rechazado: el modo manual no esta activo' };
    if (estado === 'verde') return { ok: true, resultado: 'el semaforo ya esta en verde' };
    // un segundo forzar_verde durante el amarillo obligatorio no lo reinicia
    if (estado === 'amarillo' && transicionManualAVerde) {
      return { ok: true, resultado: 'transicion a verde en curso (amarillo obligatorio)' };
    }
    // el amarillo obligatorio aplica tambien en modo manual
    transicionManualAVerde = true;
    cambiarEstado('amarillo', 'manual');
    programar(configuracion.duracionAmarilloSeg, () => {
      transicionManualAVerde = false;
      cambiarEstado('verde', 'manual');
    });
    return { ok: true, resultado: 'verde forzado (pasando por amarillo obligatorio)' };
  }
  if (accion === 'forzar_rojo') {
    if (!modoManual) return { ok: false, resultado: 'rechazado: el modo manual no esta activo' };
    clearTimeout(temporizador); // cancela un posible amarillo -> verde pendiente
    transicionManualAVerde = false;
    cambiarEstado('rojo', 'manual');
    return { ok: true, resultado: 'rojo forzado' };
  }
  if (accion === 'sincronizar_verde') {
    // Ola verde: la nube avisa que el semaforo maestro encendio su verde y este
    // semaforo programa el suyo con el desfase nominal recibido.
    if (modoManual) return { ok: false, resultado: 'ignorado: modo manual activo' };
    if (nivelTrafico === 'nulo') return { ok: false, resultado: 'ignorado: trafico nulo' };
    if (estado === 'verde') return { ok: true, resultado: 'ya esta en verde' };
    // en amarillo la transicion a verde ya esta en curso; reiniciarla alargaria el
    // amarillo obligatorio mas alla de su duracion configurada
    if (estado === 'amarillo') return { ok: true, resultado: 'ya esta en transicion a verde' };
    const desfaseSeg = Number(comando.desfaseSeg) || 0;
    const esperaSeg = Math.max(0, desfaseSeg - configuracion.duracionAmarilloSeg);
    clearTimeout(temporizador);
    temporizador = setTimeout(() => faseAmarillo('sincronizacion'), ms(esperaSeg));
    return { ok: true, resultado: 'verde sincronizado con desfase de ' + desfaseSeg + ' s nominales' };
  }
  return { ok: false, resultado: 'accion desconocida: ' + accion };
}

// Aplica una configuracion parcial recibida por PUT /config; devuelve si cambio algo
// (el backend reenvia la configuracion cada minuto y no conviene loguear repeticiones)
function aplicarConfiguracion(nueva) {
  const antes = JSON.stringify(configuracion);
  if (Number(nueva.duracionAmarilloSeg) > 0) configuracion.duracionAmarilloSeg = Number(nueva.duracionAmarilloSeg);
  if (Number(nueva.factorTiempo) > 0) configuracion.factorTiempo = Number(nueva.factorTiempo);
  if (nueva.umbrales) {
    const u = nueva.umbrales;
    if (Number(u.pocoMax) > 0 && Number(u.normalMax) > Number(u.pocoMax) && Number(u.muchoMax) > Number(u.normalMax)) {
      configuracion.umbrales = { pocoMax: Number(u.pocoMax), normalMax: Number(u.normalMax), muchoMax: Number(u.muchoMax) };
    }
  }
  return JSON.stringify(configuracion) !== antes;
}

// Observa el /trafico del sensor asignado; si el sensor no responde, la observacion
// termina o deja de notificar (por ejemplo porque el sensor se reinicio y perdio a
// sus observadores, algo que en UDP no genera ningun evento), reintenta cada 5 s
const SIN_LECTURAS_SEG = 20; // mas de 3 intervalos de publicacion sin noticias del sensor
function observarSensor() {
  let reintentoProgramado = false;
  let flujo = null;
  let vigilante = null;
  // evita programar dos reintentos cuando fallan la solicitud y la respuesta a la vez
  function reintentar(motivo) {
    if (reintentoProgramado) return;
    reintentoProgramado = true;
    clearTimeout(vigilante);
    try {
      if (flujo) flujo.close(); // cierra el flujo viejo para no procesar lecturas dobles
    } catch (e) { /* el flujo pudo haber muerto ya */ }
    console.log('[' + id + '] sin conexion con ' + datosSensor.id + ' (' + motivo + '), reintento en 5 s');
    setTimeout(observarSensor, 5000);
  }
  // rearma el plazo de inactividad con cada lectura recibida
  function armarVigilante() {
    clearTimeout(vigilante);
    vigilante = setTimeout(() => reintentar('sin lecturas en ' + SIN_LECTURAS_SEG + ' s'), SIN_LECTURAS_SEG * 1000);
  }
  const solicitud = coap.request({
    host: datosSensor.host,
    port: datosSensor.puerto,
    pathname: '/trafico',
    method: 'GET',
    observe: true
  });
  solicitud.on('response', (respuesta) => {
    flujo = respuesta;
    console.log('[' + id + '] observando /trafico de ' + datosSensor.id);
    armarVigilante();
    respuesta.on('data', (datos) => {
      armarVigilante();
      try {
        procesarLectura(JSON.parse(datos.toString()));
      } catch (e) {
        console.log('[' + id + '] lectura ilegible del sensor');
      }
    });
    respuesta.on('error', () => reintentar('error de respuesta'));
    respuesta.on('end', () => reintentar('fin de la observacion'));
  });
  solicitud.on('error', () => reintentar('error de solicitud'));
  solicitud.end();
}

// Servidor CoAP con los recursos /estado, /comando y /config
const servidor = coap.createServer();

servidor.on('request', (req, res) => {
  const cuerpo = req.payload ? req.payload.toString() : '';

  if (req.url === '/estado' && req.method === 'GET') {
    res.setOption('Content-Format', 'application/json');
    if (req.headers.Observe !== 0) {
      res.end(JSON.stringify(estadoActual()));
      return;
    }
    observadoresEstado.push(res);
    res.on('error', () => {
      observadoresEstado = observadoresEstado.filter((o) => o !== res);
    });
    res.on('finish', () => {
      observadoresEstado = observadoresEstado.filter((o) => o !== res);
    });
    res.write(JSON.stringify(estadoActual()));
    console.log('[' + id + '] nuevo observador de /estado (total: ' + observadoresEstado.length + ')');
    return;
  }

  if (req.url === '/comando' && req.method === 'PUT') {
    let respuesta;
    try {
      respuesta = ejecutarComando(JSON.parse(cuerpo));
    } catch (e) {
      respuesta = { ok: false, resultado: 'comando ilegible' };
    }
    res.code = respuesta.ok ? '2.04' : '4.00';
    res.setOption('Content-Format', 'application/json');
    res.end(JSON.stringify({ resultado: respuesta.resultado, estado: estadoActual() }));
    console.log('[' + id + '] comando recibido: ' + cuerpo + ' -> ' + respuesta.resultado);
    return;
  }

  if (req.url === '/config' && req.method === 'PUT') {
    let cambio = false;
    try {
      cambio = aplicarConfiguracion(JSON.parse(cuerpo));
      res.code = '2.04';
    } catch (e) {
      res.code = '4.00';
    }
    res.setOption('Content-Format', 'application/json');
    res.end(JSON.stringify(configuracion));
    if (cambio) console.log('[' + id + '] configuracion actualizada: ' + JSON.stringify(configuracion));
    return;
  }

  if (req.url === '/config' && req.method === 'GET') {
    res.setOption('Content-Format', 'application/json');
    res.end(JSON.stringify(configuracion));
    return;
  }

  res.code = '4.04';
  res.end();
});

servidor.listen(puerto, () => {
  console.log('[' + id + '] controlador de semaforo escuchando CoAP en puerto ' + puerto);
  faseIntermitente(); // arranca en amarillo intermitente hasta conocer el trafico
  observarSensor();
});
