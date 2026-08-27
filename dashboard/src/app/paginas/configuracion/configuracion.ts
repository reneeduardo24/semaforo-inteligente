// Vista de configuracion: duracion del amarillo, sincronizacion (velocidad y
// distancia), umbrales de nivel y factor de tiempo por semaforo. Al guardar,
// el backend persiste en Mongo y reenvia la configuracion al dispositivo.

import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ServicioApi } from '../../servicios/api';
import { Configuracion as ModeloConfiguracion } from '../../modelos';

@Component({
  selector: 'app-configuracion',
  imports: [FormsModule],
  templateUrl: './configuracion.html'
})
export class Configuracion implements OnInit {
  configuraciones: ModeloConfiguracion[] = [];
  mensajes: { [id: string]: string } = {};
  guardando: { [id: string]: boolean } = {};

  constructor(private api: ServicioApi) {}

  ngOnInit() {
    this.api.configuracion().subscribe((configuraciones) => (this.configuraciones = configuraciones));
  }

  // Guarda los campos editados; el backend responde con la confirmacion del dispositivo
  // y con el documento realmente guardado, que se usa para refrescar la tarjeta
  guardar(configuracion: ModeloConfiguracion) {
    const u = configuracion.umbrales;
    if (!(u.pocoMax > 0 && u.normalMax > u.pocoMax && u.muchoMax > u.normalMax)) {
      this.mensajes[configuracion.semaforoId] = 'Los umbrales deben cumplir poco < normal < mucho.';
      return;
    }
    if (!(configuracion.duracionAmarilloSeg > 0 && configuracion.factorTiempo > 0 &&
          configuracion.velocidadKmh > 0 && configuracion.distanciaM > 0)) {
      this.mensajes[configuracion.semaforoId] = 'Todos los valores numericos deben ser mayores a cero.';
      return;
    }
    this.guardando[configuracion.semaforoId] = true;
    this.api.guardarConfiguracion(configuracion.semaforoId, {
      duracionAmarilloSeg: configuracion.duracionAmarilloSeg,
      velocidadKmh: configuracion.velocidadKmh,
      distanciaM: configuracion.distanciaM,
      factorTiempo: configuracion.factorTiempo,
      sincronizacionActiva: configuracion.sincronizacionActiva,
      umbrales: configuracion.umbrales
    }).subscribe({
      next: (respuesta) => {
        this.guardando[configuracion.semaforoId] = false;
        if (respuesta.configuracion) Object.assign(configuracion, respuesta.configuracion);
        this.mensajes[configuracion.semaforoId] = respuesta.entregada
          ? 'Configuracion guardada y entregada al dispositivo.'
          : 'Configuracion guardada; el dispositivo no la acepto todavia.';
      },
      error: (error) => {
        this.guardando[configuracion.semaforoId] = false;
        const detalle = error.error && error.error.error;
        this.mensajes[configuracion.semaforoId] = 'Error: ' + (detalle || 'no se pudo guardar');
      }
    });
  }
}
