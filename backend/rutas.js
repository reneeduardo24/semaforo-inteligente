// API REST del backend. El dashboard consume estos endpoints; los comandos y las
// configuraciones siguen el camino dashboard -> REST -> backend -> PUT CoAP -> dispositivo.

const express = require('express');
const { ObjectId } = require('mongodb');
const kpis = require('./kpis');
const alarmas = require('./alarmas');
const { enviarPut } = require('./coap-cliente');

const ACCIONES_VALIDAS = ['activar_manual', 'desactivar_manual', 'forzar_verde', 'forzar_rojo'];
const VARIABLES_ALARMA = ['vehiculos', 'nivelTrafico', 'porcentajeAtipicos', 'segundosSinReporte'];
const CONDICIONES_ALARMA = ['>', '<', '>=', '<=', '=='];

// Envuelve un handler async para que cualquier error responda 500 en lugar de
// dejar una promesa rechazada que tumbe el proceso (Express 4 no las captura)
function seguro(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      console.error('[api] error en ' + req.method + ' ' + req.originalUrl + ': ' + error.message);
      if (!res.headersSent) res.status(500).json({ error: error.message });
    });
  };
}

// Crea el enrutador con acceso a la base, la configuracion de dispositivos y el
// estado en memoria que mantiene el servidor principal
function crearRutas(contexto) {
  const db = contexto.db;
  const dispositivos = contexto.dispositivos;
  const estadoGeneral = contexto.estadoGeneral;
  const configuraciones = contexto.configuraciones;
  const rutas = express.Router();

  // Estado actual de semaforos y sensores segun lo ultimo observado por CoAP
  rutas.get('/estado-general', (req, res) => {
    res.json(estadoGeneral);
  });

  // Los seis KPIs calculados con aggregation pipelines
  rutas.get('/kpis', seguro(async (req, res) => {
    res.json(await kpis.todos(db));
  }));

  // Ultimas lecturas de trafico (para tablas y graficas historicas)
  rutas.get('/lecturas', seguro(async (req, res) => {
    const limite = Math.min(parseInt(req.query.limite, 10) || 100, 1000);
    const lecturas = await db.collection('lecturas_trafico').find({}).sort({ ts: -1 }).limit(limite).toArray();
    res.json(lecturas);
  }));

  // Ultimos cambios de estado de los semaforos
  rutas.get('/estados', seguro(async (req, res) => {
    const limite = Math.min(parseInt(req.query.limite, 10) || 100, 1000);
    const estados = await db.collection('estados_semaforo').find({}).sort({ ts: -1 }).limit(limite).toArray();
    res.json(estados);
  }));

  // Historial de sesiones de operacion manual con sus acciones
  rutas.get('/operaciones-manuales', seguro(async (req, res) => {
    const limite = Math.min(parseInt(req.query.limite, 10) || 20, 200);
    const operaciones = await db.collection('operaciones_manuales').find({}).sort({ tsInicio: -1 }).limit(limite).toArray();
    res.json(operaciones);
  }));

  // Envia un comando de operacion manual al semaforo y registra la sesion manual
  rutas.post('/semaforos/:id/comando', seguro(async (req, res) => {
    const semaforoId = req.params.id;
    const accion = req.body.accion;
    const semaforo = dispositivos.semaforos.find((s) => s.id === semaforoId);
    if (!semaforo) return res.status(404).json({ error: 'semaforo desconocido: ' + semaforoId });
    if (ACCIONES_VALIDAS.indexOf(accion) === -1) return res.status(400).json({ error: 'accion invalida: ' + accion });
    try {
      const respuesta = await enviarPut(semaforo.host, semaforo.puerto, '/comando', { accion: accion });
      const acepto = String(respuesta.codigo).indexOf('2.') === 0;
      if (acepto) {
        await registrarAccionManual(semaforoId, accion);
      }
      res.status(acepto ? 200 : 409).json({ dispositivo: respuesta.cuerpo, codigoCoap: respuesta.codigo });
    } catch (error) {
      res.status(502).json({ error: 'el dispositivo no respondio: ' + error.message });
    }
  }));

  // Lleva el registro de las sesiones manuales: inicio, acciones realizadas y fin
  async function registrarAccionManual(semaforoId, accion) {
    const coleccion = db.collection('operaciones_manuales');
    if (accion === 'activar_manual') {
      estadoGeneral.semaforos[semaforoId].modoManual = true;
      // si ya hay una sesion abierta no se duplica (por ejemplo, doble clic en el dashboard)
      const abierta = await coleccion.findOne({ semaforoId: semaforoId, tsFin: null });
      if (!abierta) {
        await coleccion.insertOne({ semaforoId: semaforoId, tsInicio: new Date(), tsFin: null, acciones: [] });
      }
      return;
    }
    if (accion === 'desactivar_manual') {
      estadoGeneral.semaforos[semaforoId].modoManual = false;
      await coleccion.updateOne(
        { semaforoId: semaforoId, tsFin: null },
        { $set: { tsFin: new Date() } }
      );
      return;
    }
    await coleccion.updateOne(
      { semaforoId: semaforoId, tsFin: null },
      { $push: { acciones: { ts: new Date(), accion: accion } } }
    );
  }

  // Configuracion vigente de cada semaforo
  rutas.get('/configuracion', seguro(async (req, res) => {
    const documentos = await db.collection('configuracion').find({}).toArray();
    res.json(documentos);
  }));

  // Guarda la configuracion en Mongo y la reenvia al dispositivo por PUT CoAP
  rutas.put('/configuracion/:semaforoId', seguro(async (req, res) => {
    const semaforoId = req.params.semaforoId;
    const semaforo = dispositivos.semaforos.find((s) => s.id === semaforoId);
    if (!semaforo) return res.status(404).json({ error: 'semaforo desconocido: ' + semaforoId });
    const cuerpo = req.body;
    const cambios = {};
    const rechazados = [];
    if (Number(cuerpo.duracionAmarilloSeg) > 0) cambios.duracionAmarilloSeg = Number(cuerpo.duracionAmarilloSeg);
    else if (cuerpo.duracionAmarilloSeg !== undefined) rechazados.push('duracionAmarilloSeg');
    if (Number(cuerpo.velocidadKmh) > 0) cambios.velocidadKmh = Number(cuerpo.velocidadKmh);
    else if (cuerpo.velocidadKmh !== undefined) rechazados.push('velocidadKmh');
    if (Number(cuerpo.distanciaM) > 0) cambios.distanciaM = Number(cuerpo.distanciaM);
    else if (cuerpo.distanciaM !== undefined) rechazados.push('distanciaM');
    if (Number(cuerpo.factorTiempo) > 0) cambios.factorTiempo = Number(cuerpo.factorTiempo);
    else if (cuerpo.factorTiempo !== undefined) rechazados.push('factorTiempo');
    if (typeof cuerpo.sincronizacionActiva === 'boolean') cambios.sincronizacionActiva = cuerpo.sincronizacionActiva;
    if (cuerpo.umbrales) {
      const u = cuerpo.umbrales;
      if (Number(u.pocoMax) > 0 && Number(u.normalMax) > Number(u.pocoMax) && Number(u.muchoMax) > Number(u.normalMax)) {
        cambios.umbrales = { pocoMax: Number(u.pocoMax), normalMax: Number(u.normalMax), muchoMax: Number(u.muchoMax) };
      } else {
        rechazados.push('umbrales (deben cumplir poco < normal < mucho)');
      }
    }
    if (Object.keys(cambios).length === 0) return res.status(400).json({ error: 'no hay campos validos que actualizar', rechazados: rechazados });
    await db.collection('configuracion').updateOne({ semaforoId: semaforoId }, { $set: cambios });
    const documento = await db.collection('configuracion').findOne({ semaforoId: semaforoId });
    configuraciones[semaforoId] = documento;
    // al dispositivo solo le interesan el amarillo, el factor y los umbrales
    try {
      const respuesta = await enviarPut(semaforo.host, semaforo.puerto, '/config', {
        duracionAmarilloSeg: documento.duracionAmarilloSeg,
        factorTiempo: documento.factorTiempo,
        umbrales: documento.umbrales
      });
      const acepto = String(respuesta.codigo).indexOf('2.') === 0;
      res.json({ configuracion: documento, dispositivo: respuesta.cuerpo, entregada: acepto, rechazados: rechazados });
    } catch (error) {
      res.status(502).json({ configuracion: documento, rechazados: rechazados, error: 'guardado en Mongo pero el dispositivo no respondio: ' + error.message });
    }
  }));

  // Definiciones de alarmas
  rutas.get('/alarmas', seguro(async (req, res) => {
    res.json(await db.collection('alarmas').find({}).toArray());
  }));

  // Crea una alarma nueva y recarga el evaluador
  rutas.post('/alarmas', seguro(async (req, res) => {
    const alarma = validarAlarma(req.body);
    if (alarma === null) return res.status(400).json({ error: 'alarma invalida: se requiere nombre, variable, condicion y umbral validos' });
    const resultado = await db.collection('alarmas').insertOne(alarma);
    await alarmas.recargar();
    res.json({ _id: resultado.insertedId, ...alarma });
  }));

  // Edita una alarma existente y recarga el evaluador
  rutas.put('/alarmas/:id', seguro(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'id de alarma invalido' });
    const alarma = validarAlarma(req.body);
    if (alarma === null) return res.status(400).json({ error: 'alarma invalida' });
    await db.collection('alarmas').updateOne({ _id: new ObjectId(req.params.id) }, { $set: alarma });
    await alarmas.recargar();
    res.json(await db.collection('alarmas').findOne({ _id: new ObjectId(req.params.id) }));
  }));

  // Elimina una alarma
  rutas.delete('/alarmas/:id', seguro(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'id de alarma invalido' });
    await db.collection('alarmas').deleteOne({ _id: new ObjectId(req.params.id) });
    await alarmas.recargar();
    res.json({ ok: true });
  }));

  // Revisa que la definicion de alarma tenga variable y condicion conocidas
  function validarAlarma(cuerpo) {
    if (!cuerpo.nombre || VARIABLES_ALARMA.indexOf(cuerpo.variable) === -1) return null;
    if (CONDICIONES_ALARMA.indexOf(cuerpo.condicion) === -1) return null;
    if (typeof cuerpo.umbral !== 'number' || Number.isNaN(cuerpo.umbral)) return null;
    return {
      nombre: String(cuerpo.nombre),
      variable: cuerpo.variable,
      condicion: cuerpo.condicion,
      umbral: cuerpo.umbral,
      activa: cuerpo.activa !== false
    };
  }

  // Historial de notificaciones disparadas
  rutas.get('/notificaciones', seguro(async (req, res) => {
    const limite = Math.min(parseInt(req.query.limite, 10) || 50, 500);
    const notificaciones = await db.collection('notificaciones').find({}).sort({ ts: -1 }).limit(limite).toArray();
    res.json(notificaciones);
  }));

  return rutas;
}

module.exports = { crearRutas };
