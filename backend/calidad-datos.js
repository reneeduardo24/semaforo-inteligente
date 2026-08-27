// Control de calidad de datos del backend. Aplica el principio visto en el curso:
// nunca confiar en la entrada de las cosas. Cada lectura pasa por validacion de tipo
// y rango (exactitud), deteccion de duplicados y desorden temporal (consistencia),
// regla de 3 desviaciones estandar sobre ventana movil (exactitud) y vigilancia de
// sensores silenciosos (completitud). Las lecturas atipicas no se borran: se marcan.

const VENTANA = 20; // lecturas validas que forman la ventana movil para la desviacion estandar
const MINIMO_VENTANA = 5; // lecturas minimas antes de aplicar la regla de 3 sigma
const MAXIMO_FISICO = 200; // vehiculos por minuto fisicamente imposibles de superar en una avenida
const TS_RECIENTES = 50; // timestamps recordados por sensor para detectar duplicados

const porSensor = {};

// Crea (si hace falta) y devuelve el estado interno de calidad de un sensor
function estadoSensor(sensorId) {
  if (!porSensor[sensorId]) {
    porSensor[sensorId] = {
      valores: [], // ultimas lecturas validas (ventana movil)
      ultimaTs: null, // timestamp de la ultima lectura aceptada, para detectar desorden
      tsRecientes: [], // timestamps vistos, para detectar duplicados
      ultimoReporte: Date.now(), // momento del ultimo mensaje recibido, para el sensor silencioso
      silencioAvisado: false, // evita repetir la alarma dentro del mismo episodio de silencio
      total: 0,
      atipicas: 0
    };
  }
  return porSensor[sensorId];
}

// Registra los sensores al arrancar para que la vigilancia de silencio los conozca
// aunque todavia no hayan reportado nada
function registrarSensor(sensorId) {
  estadoSensor(sensorId);
}

// Media aritmetica de la ventana
function media(valores) {
  return valores.reduce((suma, v) => suma + v, 0) / valores.length;
}

// Desviacion estandar de la ventana
function desviacion(valores) {
  const m = media(valores);
  const varianza = valores.reduce((suma, v) => suma + (v - m) * (v - m), 0) / valores.length;
  return Math.sqrt(varianza);
}

// Evalua una lectura y devuelve si es atipica y por que; ademas actualiza la ventana
// movil y los contadores del sensor. El orden de las validaciones va de lo mas burdo
// (tipo y rango) a lo mas fino (outlier estadistico).
function evaluarLectura(lectura) {
  const s = estadoSensor(lectura.sensorId);
  s.ultimoReporte = Date.now();
  s.silencioAvisado = false; // el sensor volvio a hablar: se rearma la alarma de silencio
  const ts = new Date(lectura.ts).getTime();
  const v = lectura.vehiculos;
  let motivo = null;

  if (Number.isNaN(ts)) {
    motivo = 'tipo_o_rango: timestamp ausente o ilegible';
  } else if (!Number.isInteger(v) || v < 0) {
    motivo = 'tipo_o_rango: el conteo no es un entero mayor o igual a 0';
  } else if (v > MAXIMO_FISICO) {
    motivo = 'tipo_o_rango: supera el maximo fisico de ' + MAXIMO_FISICO + ' vehiculos por minuto';
  } else if (s.tsRecientes.indexOf(ts) !== -1) {
    motivo = 'duplicada: timestamp ya recibido de este sensor';
  } else if (s.ultimaTs !== null && ts < s.ultimaTs) {
    motivo = 'fuera_de_orden: timestamp anterior a la ultima lectura aceptada';
  } else if (s.valores.length >= MINIMO_VENTANA) {
    const sigma = desviacion(s.valores);
    if (sigma > 0 && Math.abs(v - media(s.valores)) > 3 * sigma) {
      motivo = 'outlier_3_sigma: se aleja mas de 3 desviaciones estandar de la ventana movil';
    }
  }

  if (!Number.isNaN(ts)) {
    s.tsRecientes.push(ts);
    if (s.tsRecientes.length > TS_RECIENTES) s.tsRecientes.shift();
  }
  // Las lecturas que pasan tipo, rango y orden entran a la ventana movil aunque la
  // regla de 3 sigma las marque: asi la linea base se adapta a cambios sostenidos
  // (una rampa de hora pico) y solo los picos aislados quedan como atipicos.
  const entraAVentana = motivo === null || motivo.indexOf('outlier_3_sigma') === 0;
  if (entraAVentana) {
    s.valores.push(v);
    if (s.valores.length > VENTANA) s.valores.shift();
    s.ultimaTs = ts;
  }
  s.total = s.total + 1;
  if (motivo !== null) s.atipicas = s.atipicas + 1;

  return { atipico: motivo !== null, motivo: motivo };
}

// Porcentaje acumulado de lecturas atipicas de un sensor (alimenta una alarma de calidad)
function porcentajeAtipicas(sensorId) {
  const s = estadoSensor(sensorId);
  if (s.total === 0) return 0;
  return (s.atipicas / s.total) * 100;
}

// Devuelve los sensores que llevan mas de umbralSeg sin reportar (problema de
// completitud). Se reportan en cada revision mientras dure el silencio, para que
// las alarmas con umbrales mayores tambien puedan dispararse; el cooldown del
// modulo de alarmas evita la inundacion de notificaciones. primeraVez permite
// escribir el aviso en consola una sola vez por episodio.
function sensoresSilenciosos(umbralSeg) {
  const ahora = Date.now();
  const silenciosos = [];
  Object.keys(porSensor).forEach((sensorId) => {
    const s = porSensor[sensorId];
    const segundos = (ahora - s.ultimoReporte) / 1000;
    if (segundos > umbralSeg) {
      silenciosos.push({ sensorId: sensorId, segundos: Math.round(segundos), primeraVez: !s.silencioAvisado });
      s.silencioAvisado = true;
    }
  });
  return silenciosos;
}

module.exports = { registrarSensor, evaluarLectura, porcentajeAtipicas, sensoresSilenciosos };
