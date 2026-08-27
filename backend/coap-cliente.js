// Cliente CoAP del backend: observa recursos de los dispositivos y les envia comandos
// y configuraciones por PUT. El navegador no habla CoAP, asi que este modulo es el
// puente entre la nube y los dispositivos.

const coap = require('coap');

// Mantiene viva una observacion CoAP sobre un recurso; si el dispositivo no responde,
// la observacion termina o deja de notificar (inactividadSeg), reintenta cada 5 s.
// CoAP corre sobre UDP: si el dispositivo se reinicia, las notificaciones simplemente
// dejan de llegar sin ningun evento, por eso hace falta el vigilante de inactividad.
function observar(etiqueta, host, puerto, ruta, alRecibir, inactividadSeg) {
  let reintentoProgramado = false;
  let flujo = null;
  let vigilante = null;
  // evita programar dos reintentos cuando fallan la solicitud y la respuesta a la vez
  function reintentar(motivo) {
    if (reintentoProgramado) return;
    reintentoProgramado = true;
    clearTimeout(vigilante);
    try {
      if (flujo) flujo.close(); // cierra el flujo viejo para no procesar notificaciones dobles
    } catch (e) { /* el flujo pudo haber muerto ya */ }
    console.log('[coap] sin conexion con ' + etiqueta + ruta + ' (' + motivo + '), reintento en 5 s');
    setTimeout(() => observar(etiqueta, host, puerto, ruta, alRecibir, inactividadSeg), 5000);
  }
  // rearma el plazo de inactividad cada vez que llega una notificacion
  function armarVigilante() {
    if (!inactividadSeg) return;
    clearTimeout(vigilante);
    vigilante = setTimeout(() => reintentar('sin notificaciones en ' + inactividadSeg + ' s'), inactividadSeg * 1000);
  }
  const solicitud = coap.request({ host: host, port: puerto, pathname: ruta, method: 'GET', observe: true });
  solicitud.on('response', (respuesta) => {
    flujo = respuesta;
    console.log('[coap] observando ' + etiqueta + ruta);
    armarVigilante();
    respuesta.on('data', (datos) => {
      armarVigilante();
      try {
        // el callback puede ser async: se captura su promesa para que un error de
        // Mongo o de una alarma no tumbe el proceso como rechazo sin manejar
        Promise.resolve(alRecibir(JSON.parse(datos.toString()))).catch((error) => {
          console.error('[coap] error procesando mensaje de ' + etiqueta + ruta + ': ' + error.message);
        });
      } catch (e) {
        console.log('[coap] mensaje ilegible de ' + etiqueta + ruta);
      }
    });
    respuesta.on('error', () => reintentar('error de respuesta'));
    respuesta.on('end', () => reintentar('fin de la observacion'));
  });
  solicitud.on('error', () => reintentar('error de solicitud'));
  solicitud.end();
}

// Envia un PUT con cuerpo JSON a un dispositivo y devuelve su respuesta;
// falla a los 5 segundos para que la API REST no se quede colgada
function enviarPut(host, puerto, ruta, objeto) {
  return new Promise((resolver, rechazar) => {
    const solicitud = coap.request({ host: host, port: puerto, pathname: ruta, method: 'PUT' });
    solicitud.setOption('Content-Format', 'application/json');
    const limite = setTimeout(() => {
      rechazar(new Error('el dispositivo no respondio en 5 s'));
    }, 5000);
    solicitud.on('response', (respuesta) => {
      clearTimeout(limite);
      let cuerpo = null;
      try {
        cuerpo = JSON.parse(respuesta.payload.toString());
      } catch (e) {
        cuerpo = respuesta.payload.toString();
      }
      resolver({ codigo: respuesta.code, cuerpo: cuerpo });
    });
    solicitud.on('error', (error) => {
      clearTimeout(limite);
      rechazar(error);
    });
    solicitud.write(JSON.stringify(objeto));
    solicitud.end();
  });
}

module.exports = { observar, enviarPut };
