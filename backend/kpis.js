// KPIs del proyecto calculados con aggregation pipelines de MongoDB (no en JavaScript),
// como se trabajo en el curso. Cada funcion devuelve el resultado de un pipeline;
// los mismos pipelines estan documentados en documento/documento-proyecto.md.

// Nota sobre las horas: el dia simulado esta comprimido, por eso los KPIs de horas
// usan el campo horaSimulada (0 a 23) que reporta el sensor y no la hora real.

// KPI 1: vehiculos por hora por semaforo. Cada lectura valida representa un minuto
// simulado, por eso el promedio por minuto multiplicado por 60 estima la hora completa.
function vehiculosPorHora(db) {
  return db.collection('lecturas_trafico').aggregate([
    { $match: { atipico: false } },
    { $group: { _id: { semaforoId: '$semaforoId', hora: '$horaSimulada' }, promedioPorMinuto: { $avg: '$vehiculos' } } },
    { $project: {
        _id: 0,
        semaforoId: '$_id.semaforoId',
        hora: '$_id.hora',
        vehiculosPorHora: { $round: [{ $multiply: ['$promedioPorMinuto', 60] }, 0] }
    } },
    { $sort: { semaforoId: 1, hora: 1 } }
  ]).toArray();
}

// KPI 2: hora pico y hora valle del dia considerando ambos sensores. El valle se
// reporta de dos formas: el minimo absoluto del dia (que cae en la madrugada vacia)
// y el minimo considerando solo horas con trafico, que es el valle operativo.
function horaPicoYValle(db) {
  return db.collection('lecturas_trafico').aggregate([
    { $match: { atipico: false } },
    { $group: { _id: '$horaSimulada', promedioPorMinuto: { $avg: '$vehiculos' } } },
    { $project: { _id: 0, hora: '$_id', vehiculosPorHora: { $round: [{ $multiply: ['$promedioPorMinuto', 60] }, 0] } } },
    { $facet: {
        pico: [{ $sort: { vehiculosPorHora: -1, hora: 1 } }, { $limit: 1 }],
        valle: [{ $sort: { vehiculosPorHora: 1, hora: 1 } }, { $limit: 1 }],
        valleConTrafico: [{ $match: { vehiculosPorHora: { $gt: 0 } } }, { $sort: { vehiculosPorHora: 1, hora: 1 } }, { $limit: 1 }]
    } }
  ]).toArray();
}

// KPI 3: distribucion del tiempo por nivel de trafico. La duracion de cada registro
// de estado se obtiene restando su timestamp del siguiente con $setWindowFields.
function distribucionPorNivel(db) {
  return db.collection('estados_semaforo').aggregate([
    { $setWindowFields: {
        partitionBy: '$semaforoId',
        sortBy: { ts: 1 },
        output: { tsSiguiente: { $shift: { output: '$ts', by: 1 } } }
    } },
    { $match: { tsSiguiente: { $ne: null } } },
    { $project: {
        semaforoId: 1,
        nivelTrafico: 1,
        duracionSeg: { $divide: [{ $subtract: ['$tsSiguiente', '$ts'] }, 1000] }
    } },
    // se descartan duraciones mayores a 10 minutos: corresponden a lapsos con el sistema apagado
    { $match: { duracionSeg: { $lte: 600 } } },
    { $group: { _id: { semaforoId: '$semaforoId', nivel: '$nivelTrafico' }, segundos: { $sum: '$duracionSeg' } } },
    { $project: { _id: 0, semaforoId: '$_id.semaforoId', nivel: '$_id.nivel', segundos: { $round: ['$segundos', 0] } } },
    { $sort: { semaforoId: 1, nivel: 1 } }
  ]).toArray();
}

// KPI 4: numero de operaciones manuales con su duracion total y promedio por semaforo
function operacionesManuales(db) {
  return db.collection('operaciones_manuales').aggregate([
    { $match: { tsFin: { $ne: null } } },
    { $project: {
        semaforoId: 1,
        duracionSeg: { $divide: [{ $subtract: ['$tsFin', '$tsInicio'] }, 1000] },
        numAcciones: { $size: '$acciones' }
    } },
    { $group: {
        _id: '$semaforoId',
        operaciones: { $sum: 1 },
        duracionTotalSeg: { $sum: '$duracionSeg' },
        duracionPromedioSeg: { $avg: '$duracionSeg' },
        accionesTotales: { $sum: '$numAcciones' }
    } },
    { $project: {
        _id: 0,
        semaforoId: '$_id',
        operaciones: 1,
        duracionTotalSeg: { $round: ['$duracionTotalSeg', 0] },
        duracionPromedioSeg: { $round: ['$duracionPromedioSeg', 0] },
        accionesTotales: 1
    } },
    { $sort: { semaforoId: 1 } }
  ]).toArray();
}

// KPI 5: porcentaje de lecturas atipicas por sensor, el indicador de calidad de datos
function porcentajeAtipicas(db) {
  return db.collection('lecturas_trafico').aggregate([
    { $group: {
        _id: '$sensorId',
        total: { $sum: 1 },
        atipicas: { $sum: { $cond: ['$atipico', 1, 0] } }
    } },
    { $project: {
        _id: 0,
        sensorId: '$_id',
        total: 1,
        atipicas: 1,
        porcentaje: { $round: [{ $multiply: [{ $divide: ['$atipicas', '$total'] }, 100] }, 2] }
    } },
    { $sort: { sensorId: 1 } }
  ]).toArray();
}

// KPI 6: duracion promedio del ciclo (entre inicios de verde consecutivos) y del
// tiempo en verde por semaforo. Las duraciones son segundos reales de la demo,
// es decir, los nominales divididos entre el factor de tiempo.
function cicloYVerde(db) {
  return db.collection('estados_semaforo').aggregate([
    { $facet: {
        verde: [
          { $setWindowFields: {
              partitionBy: '$semaforoId',
              sortBy: { ts: 1 },
              output: { tsSiguiente: { $shift: { output: '$ts', by: 1 } } }
          } },
          { $match: { estado: 'verde', tsSiguiente: { $ne: null } } },
          { $project: { semaforoId: 1, duracionSeg: { $divide: [{ $subtract: ['$tsSiguiente', '$ts'] }, 1000] } } },
          // se descartan duraciones mayores a 10 minutos (lapsos con el sistema apagado)
          { $match: { duracionSeg: { $lte: 600 } } },
          { $group: {
              _id: '$semaforoId',
              verdePromedioSeg: { $avg: '$duracionSeg' }
          } },
          { $project: { _id: 0, semaforoId: '$_id', verdePromedioSeg: { $round: ['$verdePromedioSeg', 1] } } }
        ],
        ciclo: [
          { $match: { estado: 'verde' } },
          { $setWindowFields: {
              partitionBy: '$semaforoId',
              sortBy: { ts: 1 },
              output: { tsSiguienteVerde: { $shift: { output: '$ts', by: 1 } } }
          } },
          { $match: { tsSiguienteVerde: { $ne: null } } },
          { $project: { semaforoId: 1, cicloSeg: { $divide: [{ $subtract: ['$tsSiguienteVerde', '$ts'] }, 1000] } } },
          // se descartan ciclos mayores a 10 minutos (lapsos con el sistema apagado)
          { $match: { cicloSeg: { $lte: 600 } } },
          { $group: {
              _id: '$semaforoId',
              cicloPromedioSeg: { $avg: '$cicloSeg' }
          } },
          { $project: { _id: 0, semaforoId: '$_id', cicloPromedioSeg: { $round: ['$cicloPromedioSeg', 1] } } }
        ]
    } }
  ]).toArray();
}

// Ejecuta los seis KPIs en paralelo y arma el objeto que consume el dashboard
async function todos(db) {
  const [porHora, picoValle, porNivel, manuales, atipicas, ciclo] = await Promise.all([
    vehiculosPorHora(db),
    horaPicoYValle(db),
    distribucionPorNivel(db),
    operacionesManuales(db),
    porcentajeAtipicas(db),
    cicloYVerde(db)
  ]);
  return {
    vehiculosPorHora: porHora,
    horaPico: picoValle[0] ? picoValle[0].pico[0] || null : null,
    horaValle: picoValle[0] ? picoValle[0].valle[0] || null : null,
    horaValleConTrafico: picoValle[0] ? picoValle[0].valleConTrafico[0] || null : null,
    distribucionPorNivel: porNivel,
    operacionesManuales: manuales,
    porcentajeAtipicas: atipicas,
    cicloYVerde: ciclo[0] || { verde: [], ciclo: [] }
  };
}

module.exports = { vehiculosPorHora, horaPicoYValle, distribucionPorNivel, operacionesManuales, porcentajeAtipicas, cicloYVerde, todos };
