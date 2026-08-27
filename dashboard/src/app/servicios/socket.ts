// Servicio de tiempo real. Mantiene una unica conexion Socket.IO con el backend
// y expone cada evento como un observable para que las vistas se suscriban.

import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';

@Injectable({ providedIn: 'root' })
export class ServicioSocket {
  private socket: Socket = io('http://localhost:3000');

  // Devuelve un observable del evento pedido; al desuscribirse se quita el manejador
  escuchar<T>(evento: string): Observable<T> {
    return new Observable<T>((suscriptor) => {
      const manejador = (datos: T) => suscriptor.next(datos);
      this.socket.on(evento, manejador);
      return () => this.socket.off(evento, manejador);
    });
  }
}
