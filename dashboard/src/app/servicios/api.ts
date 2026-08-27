// Servicio de acceso a la API REST del backend. Todas las vistas consultan y
// mandan comandos a traves de este unico punto.

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Alarma, Configuracion, Estado, EstadoGeneral, Lectura, Notificacion, OperacionManual } from '../modelos';

const BASE = 'http://localhost:3000/api';

@Injectable({ providedIn: 'root' })
export class ServicioApi {
  private http = inject(HttpClient);

  // Estado actual de semaforos y sensores
  estadoGeneral(): Observable<EstadoGeneral> {
    return this.http.get<EstadoGeneral>(BASE + '/estado-general');
  }

  // Los seis KPIs calculados con pipelines de agregacion
  kpis(): Observable<any> {
    return this.http.get<any>(BASE + '/kpis');
  }

  // Ultimas lecturas de trafico
  lecturas(limite: number): Observable<Lectura[]> {
    return this.http.get<Lectura[]>(BASE + '/lecturas?limite=' + limite);
  }

  // Ultimos cambios de estado
  estados(limite: number): Observable<Estado[]> {
    return this.http.get<Estado[]>(BASE + '/estados?limite=' + limite);
  }

  // Envia un comando de operacion manual a un semaforo
  enviarComando(semaforoId: string, accion: string): Observable<any> {
    return this.http.post<any>(BASE + '/semaforos/' + semaforoId + '/comando', { accion });
  }

  // Historial de sesiones de operacion manual
  operacionesManuales(): Observable<OperacionManual[]> {
    return this.http.get<OperacionManual[]>(BASE + '/operaciones-manuales?limite=20');
  }

  // Configuracion vigente de los semaforos
  configuracion(): Observable<Configuracion[]> {
    return this.http.get<Configuracion[]>(BASE + '/configuracion');
  }

  // Guarda la configuracion de un semaforo y la reenvia al dispositivo
  guardarConfiguracion(semaforoId: string, cambios: Partial<Configuracion>): Observable<any> {
    return this.http.put<any>(BASE + '/configuracion/' + semaforoId, cambios);
  }

  // Definiciones de alarmas
  alarmas(): Observable<Alarma[]> {
    return this.http.get<Alarma[]>(BASE + '/alarmas');
  }

  // Crea una alarma nueva
  crearAlarma(alarma: Alarma): Observable<Alarma> {
    return this.http.post<Alarma>(BASE + '/alarmas', alarma);
  }

  // Edita una alarma existente
  editarAlarma(id: string, alarma: Alarma): Observable<Alarma> {
    const { _id, ...cuerpo } = alarma;
    return this.http.put<Alarma>(BASE + '/alarmas/' + id, cuerpo);
  }

  // Elimina una alarma
  eliminarAlarma(id: string): Observable<any> {
    return this.http.delete<any>(BASE + '/alarmas/' + id);
  }

  // Historial de notificaciones disparadas
  notificaciones(): Observable<Notificacion[]> {
    return this.http.get<Notificacion[]>(BASE + '/notificaciones?limite=50');
  }
}
