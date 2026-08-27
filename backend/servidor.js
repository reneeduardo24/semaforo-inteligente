// Servidor principal del backend. Conecta con MongoDB, observa por CoAP los sensores
// y semaforos, corre el control de calidad y las alarmas, coordina la ola verde y
// expone la API REST y Socket.IO para el dashboard.
// Uso: node servidor.js

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

const dispositivos = require('../dispositivos/config.json');
const calidad = require('./calidad-datos');
const alarmas = require('./alarmas');
const { observar, enviarPut } = require('./coap-cliente');
const { crearRutas } = require('./rutas');

const PUERTO_HTTP = 3000;
const URL_MONGO = 'mongodb://127.0.0.1:27017';
const NOMBRE_BD = 'semaforo_iot';
// el sensor publica cada 6 s reales; mas de 2 intervalos sin reportar dispara la alarma
const INTERVALO_SENSOR_SEG = 6;
const UMBRAL_SILENCIO_SEG = INTERVALO_SENSOR_SEG * 2;
// equivalencia numerica de los niveles, para graficarlos y compararlos en alarmas
const NIVELES = { nulo: 0, poco: 1, normal: 2, mucho: 3, congestionamiento: 4 };

// Estado en memoria con lo ultimo observado de cada dispositivo (lo consume el dashboard)
const estadoGeneral = { semaforos: {}, sensores: {} };
// Cache de los documentos de configuracion por semaforo
const configuraciones = {};

// Crea los indices de las colecciones por semaforo y tiempo, como pide el diseno
async function crearIndices(db) {
  await db.collection('lecturas_trafico').createIndex({ semaforoId: 1, ts: 1 });
  await db.collection('lecturas_trafico').createIndex({ sensorId: 1, ts: 1 });
  await db.collection('estados_semaforo').createIndex({ semaforoId: 1, ts: 1 });
  await db.collection('operaciones_manuales').createIndex({ semaforoId: 1, tsInicio: 1 });
  await db.collection('notificaciones').createIndex({ ts: 1 });
}

// Inserta la configuracion inicial de cada semaforo y las alarmas de ejemplo
// solo si no existen todavia (para no pisar lo configurado desde el dashboard)
async function sembrarDatosIniciales(db) {
  for (const semaforo of dispositivos.semaforos) {
    const existe = await db.collection('configuracion').findOne({ semaforoId: semaforo.id });
    if (!existe) {
      await db.collection('configuracion').insertOne({
        semaforoId: semaforo.id,
        duracionAmarilloSeg: 20,
        velocidadKmh: 60,
        distanciaM: 500,
        umbrales: { pocoMax: 5, normalMax: 15, muchoMax: 30 },
        factorTiempo: 10,
        sincronizacionActiva: true
      });
    }
  }
  const hayAlarmas = await db.collection('alarmas').countDocuments();
  if (hayAlarmas === 0) {
    await db.collection('alarmas').insertMany([
      { nombre: 'Congestionamiento detectado', variable: 'vehiculos', condicion: '>', umbral: 30, activa: true },
      { nombre: 'Sensor silencioso', variable: 'segundosSinReporte', condicion: '>', umbral: UMBRAL_SILENCIO_SEG, activa: true },
      { nombre: 'Exceso de lecturas atipicas', variable: 'porcentajeAtipicos', condicion: '>', umbral: 10, activa: false }
    ]);
  }
}

// Envia la configuracion guardada en Mongo a un dispositivo. Se llama al arrancar y
// despues cada minuto: los dispositivos pueden arrancar mas tarde que el backend o
// reiniciarse a media demo, y al reiniciar pierden la configuracion remota.
const configuracionEntregada = {};
function empujarConfiguracion(semaforo) {
  const documento = configuraciones[semaforo.id];
  enviarPut(semaforo.host, semaforo.puerto, '/config', {
    duracionAmarilloSeg: documento.duracionAmarilloSeg,
    factorTiempo: documento.factorTiempo,
    umbrales: documento.umbrales
  }).then((respuesta) => {
    const acepto = String(respuesta.codigo).indexOf('2.') === 0;
    if (acepto && !configuracionEntregada[semaforo.id]) {
      console.log('[config] configuracion entregada a ' + semaforo.id);
    }
    configuracionEntregada[semaforo.id] = acepto;
  }).catch(() => {
    configuracionEntregada[semaforo.id] = false;
  });
}

// Punto de entrada: conecta Mongo, siembra datos, levanta la API y Socket.IO,
// arranca las observaciones CoAP y las vigilancias periodicas
async function principal() {
  const cliente = new MongoClient(URL_MONGO);
  await cliente.connect();
  const db = cliente.db(NOMBRE_BD);
  console.log('[mongo] conectado a ' + URL_MONGO + '/' + NOMBRE_BD);

  await crearIndices(db);
  await sembrarDatosIniciales(db);
  for (const doc of await db.collection('configuracion').find({}).toArray()) {
    configuraciones[doc.semaforoId] = doc;
  }

  // Estado inicial en memoria de cada dispositivo
  for (const semaforo of dispositivos.semaforos) {
    estadoGeneral.semaforos[semaforo.id] = { estado: 'desconocido', origen: null, nivelTrafico: null, ts: null, modoManual: false };
  }
  for (const sensor of dispositivos.sensores) {
    estadoGeneral.sensores[sensor.id] = { vehiculos: null, ts: null, horaSimulada: null, atipico: false };
    calidad.registrarSensor(sensor.id);
  }

  // Express + Socket.IO
  const app = express();
  app.use(cors());
  app.use(express.json());
  const servidorHttp = http.createServer(app);
  const io = new Server(servidorHttp, { cors: { origin: '*' } });
  await alarmas.iniciar(db, io);
  app.use('/api', crearRutas({ db: db, dispositivos: dispositivos, estadoGeneral: estadoGeneral, configuraciones: configuraciones }));

  io.on('connection', (socket) => {
    // al conectarse, el dashboard recibe de inmediato el ultimo estado conocido
    socket.emit('estado-general', estadoGeneral);
  });

  // Observa el /trafico de cada sensor: guarda la lectura con su marca de calidad,
  // la emite al dashboard y evalua las alarmas de trafico y de calidad.
  // Si un sensor deja de notificar mas de 20 s la observacion se restablece sola.
  for (const sensor of dispositivos.sensores) {
    observar(sensor.id, sensor.host, sensor.puerto, '/trafico', async (lectura) => {
      const resultado = calidad.evaluarLectura(lectura);
      const documento = {
        semaforoId: lectura.semaforoId,
        sensorId: lectura.sensorId,
        // si el timestamp del sensor es ilegible se usa la hora de llegada
        ts: Number.isNaN(Date.parse(lectura.ts)) ? new Date() : new Date(lectura.ts),
        horaSimulada: lectura.horaSimulada,
        vehiculos: lectura.vehiculos,
        intervaloSeg: lectura.intervaloSeg,
        atipico: resultado.atipico,
        motivoAtipico: resultado.motivo
      };
      await db.collection('lecturas_trafico').insertOne(documento);
      io.emit('lectura', documento);
      estadoGeneral.sensores[lectura.sensorId] = {
        vehiculos: lectura.vehiculos,
        ts: documento.ts,
        horaSimulada: lectura.horaSimulada,
        atipico: resultado.atipico
      };
      if (resultado.atipico) {
        console.log('[calidad] lectura atipica de ' + lectura.sensorId + ': ' + lectura.vehiculos + ' (' + resultado.motivo + ')');
      } else {
        await alarmas.evaluar('vehiculos', lectura.vehiculos, { sensorId: lectura.sensorId, semaforoId: lectura.semaforoId });
      }
      await alarmas.evaluar('porcentajeAtipicos', calidad.porcentajeAtipicas(lectura.sensorId), { sensorId: lectura.sensorId });
    }, 20);
  }

  // Observa el /estado de cada semaforo: guarda cada cambio de luz, lo emite al
  // dashboard, evalua alarmas de nivel y coordina la ola verde
  for (const semaforo of dispositivos.semaforos) {
    observar(semaforo.id, semaforo.host, semaforo.puerto, '/estado', async (estado) => {
      const anterior = estadoGeneral.semaforos[estado.semaforoId];
      // el observe reenvia el estado vigente al registrarse; si no cambio nada no es
      // un cambio de luz y no debe insertarse ni disparar la sincronizacion
      const esRepetido = anterior.estado === estado.estado && anterior.origen === estado.origen &&
        anterior.nivelTrafico === estado.nivelTrafico;
      if (esRepetido) return;
      const documento = {
        semaforoId: estado.semaforoId,
        ts: Number.isNaN(Date.parse(estado.ts)) ? new Date() : new Date(estado.ts),
        estado: estado.estado,
        origen: estado.origen,
        nivelTrafico: estado.nivelTrafico
      };
      await db.collection('estados_semaforo').insertOne(documento);
      io.emit('estado', { ...documento, nivelNumerico: NIVELES[estado.nivelTrafico] });
      estadoGeneral.semaforos[estado.semaforoId] = {
        estado: estado.estado,
        origen: estado.origen,
        nivelTrafico: estado.nivelTrafico,
        ts: documento.ts,
        // en modo manual todos los cambios llegan con origen manual; uno automatico
        // o de sincronizacion implica que el modo manual ya no esta activo
        modoManual: estado.origen === 'manual'
      };
      await alarmas.evaluar('nivelTrafico', NIVELES[estado.nivelTrafico], { semaforoId: estado.semaforoId });
      // Ola verde: cuando el maestro hace una transicion real a verde se avisa al
      // esclavo con el desfase nominal distancia / velocidad. La notificacion inicial
      // de la observacion (estado anterior desconocido) no cuenta como transicion.
      const sincronizacion = dispositivos.sincronizacion;
      if (estado.semaforoId === sincronizacion.maestro && estado.estado === 'verde' &&
          estado.origen !== 'manual' && anterior.estado !== 'desconocido' && anterior.estado !== 'verde') {
        const configuracionEsclavo = configuraciones[sincronizacion.esclavo];
        if (configuracionEsclavo && configuracionEsclavo.sincronizacionActiva) {
          const desfaseSeg = Math.round(configuracionEsclavo.distanciaM / (configuracionEsclavo.velocidadKmh / 3.6));
          const esclavo = dispositivos.semaforos.find((s) => s.id === sincronizacion.esclavo);
          try {
            const respuesta = await enviarPut(esclavo.host, esclavo.puerto, '/comando', { accion: 'sincronizar_verde', desfaseSeg: desfaseSeg });
            if (String(respuesta.codigo).indexOf('2.') === 0) {
              console.log('[sincronizacion] verde del esclavo programado con desfase nominal de ' + desfaseSeg + ' s');
            } else {
              console.log('[sincronizacion] el esclavo no acepto la senal: ' + JSON.stringify(respuesta.cuerpo && respuesta.cuerpo.resultado));
            }
          } catch (error) {
            console.log('[sincronizacion] no se pudo avisar al esclavo: ' + error.message);
          }
        }
      }
    }, 300);
  }

  // Vigilancia de sensores silenciosos: si un sensor pasa mas de 2 intervalos sin
  // reportar se evalua la alarma de completitud. Se evalua en cada revision (no solo
  // la primera vez) para que tambien disparen alarmas con umbrales mayores; el
  // cooldown del modulo de alarmas evita el exceso de notificaciones.
  setInterval(async () => {
    try {
      for (const silencioso of calidad.sensoresSilenciosos(UMBRAL_SILENCIO_SEG)) {
        if (silencioso.primeraVez) {
          console.log('[calidad] sensor silencioso: ' + silencioso.sensorId + ' lleva ' + silencioso.segundos + ' s sin reportar');
        }
        await alarmas.evaluar('segundosSinReporte', silencioso.segundos, { sensorId: silencioso.sensorId });
      }
    } catch (error) {
      console.error('[calidad] error en la vigilancia de silencio: ' + error.message);
    }
  }, 5000);

  // La configuracion vigente se empuja al arrancar y cada minuto, por si algun
  // dispositivo arranco tarde o se reinicio y perdio la configuracion remota
  for (const semaforo of dispositivos.semaforos) {
    empujarConfiguracion(semaforo);
  }
  setInterval(() => {
    for (const semaforo of dispositivos.semaforos) {
      empujarConfiguracion(semaforo);
    }
  }, 60000);

  servidorHttp.listen(PUERTO_HTTP, () => {
    console.log('[http] API REST y Socket.IO escuchando en http://localhost:' + PUERTO_HTTP);
  });
}

principal().catch((error) => {
  console.error('Error fatal del backend: ' + error.message);
  process.exit(1);
});
