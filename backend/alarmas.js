// Evaluacion de alarmas configurables. Las definiciones viven en la coleccion
// "alarmas" y cada disparo genera un documento en "notificaciones" que ademas se
// emite por Socket.IO para que el dashboard muestre el toast en el momento.

const COOLDOWN_MS = 30000; // tiempo minimo entre disparos repetidos de la misma alarma

let db = null;
let io = null;
let definiciones = [];
const ultimoDisparo = {}; // clave alarma+dispositivo -> momento del ultimo disparo

// Guarda las referencias a Mongo y Socket.IO y carga las definiciones iniciales
async function iniciar(baseDatos, socketIo) {
  db = baseDatos;
  io = socketIo;
  await recargar();
}

// Relee las definiciones desde Mongo; se llama al arrancar y cuando cambian por la API
async function recargar() {
  definiciones = await db.collection('alarmas').find({}).toArray();
}

// Compara un valor contra el umbral segun la condicion configurada
function cumple(valor, condicion, umbral) {
  if (condicion === '>') return valor > umbral;
  if (condicion === '<') return valor < umbral;
  if (condicion === '>=') return valor >= umbral;
  if (condicion === '<=') return valor <= umbral;
  if (condicion === '==') return valor === umbral;
  return false;
}

// Evalua todas las alarmas activas de una variable contra el valor recibido.
// El cooldown evita inundar de notificaciones cuando la condicion se sostiene.
async function evaluar(variable, valor, contexto) {
  for (const definicion of definiciones) {
    if (!definicion.activa || definicion.variable !== variable) continue;
    if (!cumple(valor, definicion.condicion, definicion.umbral)) continue;
    const clave = String(definicion._id) + '|' + (contexto.semaforoId || contexto.sensorId || 'global');
    if (Date.now() - (ultimoDisparo[clave] || 0) < COOLDOWN_MS) continue;
    ultimoDisparo[clave] = Date.now();
    const notificacion = {
      alarmaId: definicion._id,
      ts: new Date(),
      semaforoId: contexto.semaforoId || contexto.sensorId || null,
      valor: Math.round(valor * 100) / 100,
      mensaje: 'Alarma "' + definicion.nombre + '": ' + variable + ' = ' + (Math.round(valor * 100) / 100) +
        ' cumple la condicion ' + definicion.condicion + ' ' + definicion.umbral
    };
    await db.collection('notificaciones').insertOne(notificacion);
    io.emit('notificacion', notificacion);
    console.log('[alarma] ' + notificacion.mensaje);
  }
}

module.exports = { iniciar, recargar, evaluar };
