// Sensor de trafico simulado. Es un servidor CoAP con el recurso observable /trafico:
// cada intervalo publica el conteo de vehiculos de un minuto simulado de un dia comprimido.
// Uso: node sensor-trafico.js <id> <puerto>   (ejemplo: node sensor-trafico.js sensor1 5683)

const coap = require('coap');
const config = require('./config.json');

const id = process.argv[2];
const puerto = parseInt(process.argv[3], 10);

if (!id || !puerto) {
  console.error('Uso: node sensor-trafico.js <id> <puerto>');
  process.exit(1);
}

// Datos del sensor segun config.json (para saber a que semaforo pertenece)
const datosSensor = config.sensores.find((s) => s.id === id);
if (!datosSensor) {
  console.error('El sensor ' + id + ' no existe en config.json');
  process.exit(1);
}

// Un dia completo de 24 horas se comprime en 12 minutos reales para que la demo
// recorra madrugada, horas pico y valles sin esperar un dia entero.
const DURACION_DIA_REAL_SEG = 720;
// El dia simulado arranca a las 7:00 para que el pico de la manana aparezca pronto en la demo
const HORA_INICIO_SIMULADA = 7;
// Cada lectura representa el conteo de 1 minuto simulado; se publica cada 6 s reales
// (60 s nominales entre el factor de tiempo 10 del proyecto).
const INTERVALO_REAL_SEG = 6;
const INTERVALO_NOMINAL_SEG = 60;
// Proporcion de lecturas absurdas inyectadas a proposito para probar la calidad de datos
const PROBABILIDAD_ATIPICO = 0.02;

// Vehiculos por minuto tipicos para cada hora del dia: madrugada casi vacia,
// picos a las 8:00 y 18:00 y un valle a media manana.
const PERFIL_DIA = [0, 0, 0, 0, 1, 2, 5, 14, 28, 16, 8, 7, 10, 11, 9, 8, 10, 20, 30, 18, 10, 6, 3, 1];

const inicio = Date.now();
let observadores = []; // flujos de respuesta CoAP suscritos con observe
let ultimaLectura = null; // ultima lectura publicada, para responder GET y snapshots

// Devuelve la hora simulada (0 a 24, con fraccion) segun el tiempo real transcurrido
function horaSimulada() {
  const transcurridoSeg = (Date.now() - inicio) / 1000;
  const horas = ((transcurridoSeg % DURACION_DIA_REAL_SEG) / DURACION_DIA_REAL_SEG) * 24;
  return (HORA_INICIO_SIMULADA + horas) % 24;
}

// Interpola el perfil del dia entre horas enteras para que el trafico cambie suave
function tasaVehiculosPorMinuto(hora) {
  const h0 = Math.floor(hora) % 24;
  const h1 = (h0 + 1) % 24;
  const fraccion = hora - Math.floor(hora);
  return PERFIL_DIA[h0] + (PERFIL_DIA[h1] - PERFIL_DIA[h0]) * fraccion;
}

// Genera el conteo del intervalo: la tasa del perfil con ruido aleatorio de -30% a +30%,
// y con probabilidad del 2% una lectura absurda (negativa o enorme) para probar la calidad
function generarConteo(hora) {
  if (Math.random() < PROBABILIDAD_ATIPICO) {
    return Math.random() < 0.5 ? -7 : 4000 + Math.floor(Math.random() * 5000);
  }
  const tasa = tasaVehiculosPorMinuto(hora);
  const ruido = 0.7 + Math.random() * 0.6;
  return Math.max(0, Math.round(tasa * ruido));
}

// Arma el mensaje JSON que se publica en /trafico
function armarLectura() {
  const hora = horaSimulada();
  return JSON.stringify({
    sensorId: id,
    semaforoId: datosSensor.semaforoId,
    ts: new Date().toISOString(),
    horaSimulada: Math.floor(hora),
    vehiculos: generarConteo(hora),
    intervaloSeg: INTERVALO_NOMINAL_SEG
  });
}

// La lectura vigente: la ultima publicada, o una nueva si todavia no hay ninguna.
// Asi el GET simple y el snapshot del observe devuelven lo mismo que vio el flujo.
function lecturaVigente() {
  if (ultimaLectura === null) ultimaLectura = armarLectura();
  return ultimaLectura;
}

// Envia la lectura nueva a todos los observadores y limpia los que ya se desconectaron
function publicarLectura() {
  const lectura = armarLectura();
  ultimaLectura = lectura;
  observadores = observadores.filter((res) => {
    try {
      res.write(lectura);
      return true;
    } catch (e) {
      return false;
    }
  });
  const datos = JSON.parse(lectura);
  console.log('[' + id + '] hora simulada ' + String(datos.horaSimulada).padStart(2, '0') +
    ':00, vehiculos: ' + datos.vehiculos + ', observadores: ' + observadores.length);
}

// Servidor CoAP: atiende GET /trafico normal y con observe
const servidor = coap.createServer();

servidor.on('request', (req, res) => {
  if (req.url !== '/trafico' || req.method !== 'GET') {
    res.code = '4.04';
    res.end();
    return;
  }
  res.setOption('Content-Format', 'application/json');
  if (req.headers.Observe !== 0) {
    // GET simple: responde la lectura vigente y termina
    res.end(lecturaVigente());
    return;
  }
  // GET con observe: se registra el flujo y se le notificara en cada intervalo
  observadores.push(res);
  res.on('error', () => {
    observadores = observadores.filter((o) => o !== res);
  });
  res.on('finish', () => {
    observadores = observadores.filter((o) => o !== res);
  });
  res.write(lecturaVigente());
  console.log('[' + id + '] nuevo observador de /trafico (total: ' + observadores.length + ')');
});

servidor.listen(puerto, () => {
  console.log('[' + id + '] sensor de trafico escuchando CoAP en puerto ' + puerto);
  setInterval(publicarLectura, INTERVALO_REAL_SEG * 1000);
});
