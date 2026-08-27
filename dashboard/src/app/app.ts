// Componente raiz: barra de navegacion con anclas, las seis secciones del
// dashboard apiladas en una sola pagina y los toasts de alarmas.

import { Component, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Subscription } from 'rxjs';
import { ServicioSocket } from './servicios/socket';
import { Notificacion } from './modelos';
import { Resumen } from './paginas/resumen/resumen';
import { TiempoReal } from './paginas/tiempo-real/tiempo-real';
import { Operacion } from './paginas/operacion/operacion';
import { Configuracion } from './paginas/configuracion/configuracion';
import { Alarmas } from './paginas/alarmas/alarmas';
import { Simulacion } from './paginas/simulacion/simulacion';

@Component({
  selector: 'app-root',
  imports: [DatePipe, Resumen, TiempoReal, Operacion, Configuracion, Alarmas, Simulacion],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnDestroy {
  toasts: Notificacion[] = [];
  private suscripcion: Subscription;

  constructor(socket: ServicioSocket) {
    // cada notificacion de alarma se muestra como toast durante 6 segundos
    this.suscripcion = socket.escuchar<Notificacion>('notificacion').subscribe((notificacion) => {
      this.toasts.push(notificacion);
      setTimeout(() => this.cerrarToast(notificacion), 6000);
    });
  }

  // Quita un toast de la pantalla (por tiempo o por el boton de cerrar)
  cerrarToast(notificacion: Notificacion) {
    this.toasts = this.toasts.filter((t) => t !== notificacion);
  }

  ngOnDestroy() {
    this.suscripcion.unsubscribe();
  }
}
