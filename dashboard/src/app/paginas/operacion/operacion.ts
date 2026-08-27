// Vista de operacion manual: activar o desactivar el modo manual por semaforo y
// forzar verde o rojo. Cada comando viaja por REST al backend, que lo reenvia por
// CoAP; la respuesta del dispositivo se muestra como confirmacion.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Subscription } from 'rxjs';
import { ServicioApi } from '../../servicios/api';
import { ServicioSocket } from '../../servicios/socket';
import { Estado, EstadoGeneral, OperacionManual } from '../../modelos';

@Component({
  selector: 'app-operacion',
  imports: [DatePipe],
  templateUrl: './operacion.html'
})
export class Operacion implements OnInit, OnDestroy {
  general: EstadoGeneral = { semaforos: {}, sensores: {} };
  operaciones: OperacionManual[] = [];
  // ultima confirmacion o error del dispositivo, por semaforo
  confirmaciones: { [id: string]: string } = {};
  enviando: { [id: string]: boolean } = {};
  private suscripciones: Subscription[] = [];

  constructor(private api: ServicioApi, private socket: ServicioSocket) {}

  ngOnInit() {
    this.api.estadoGeneral().subscribe((general) => (this.general = general));
    this.cargarOperaciones();
    // al (re)conectarse el socket, el backend manda el ultimo estado conocido
    this.suscripciones.push(this.socket.escuchar<EstadoGeneral>('estado-general').subscribe((general) => (this.general = general)));
    this.suscripciones.push(this.socket.escuchar<Estado>('estado').subscribe((estado) => {
      const semaforo = this.general.semaforos[estado.semaforoId];
      if (!semaforo) return;
      semaforo.estado = estado.estado;
      semaforo.origen = estado.origen;
      semaforo.nivelTrafico = estado.nivelTrafico;
      // un cambio con origen automatico o de sincronizacion implica manual desactivado
      semaforo.modoManual = estado.origen === 'manual';
    }));
  }

  idsSemaforos(): string[] {
    return Object.keys(this.general.semaforos).sort();
  }

  // Pide el historial de sesiones manuales
  cargarOperaciones() {
    this.api.operacionesManuales().subscribe((operaciones) => (this.operaciones = operaciones));
  }

  // Activa o desactiva el modo manual segun el estado actual del interruptor
  alternarManual(id: string) {
    const accion = this.general.semaforos[id].modoManual ? 'desactivar_manual' : 'activar_manual';
    this.enviarComando(id, accion);
  }

  // Envia un comando al semaforo y guarda la confirmacion que devuelve el dispositivo
  enviarComando(id: string, accion: string) {
    this.enviando[id] = true;
    this.api.enviarComando(id, accion).subscribe({
      next: (respuesta) => {
        this.enviando[id] = false;
        this.confirmaciones[id] = 'El dispositivo confirmo: ' + respuesta.dispositivo.resultado;
        if (accion === 'activar_manual') this.general.semaforos[id].modoManual = true;
        if (accion === 'desactivar_manual') this.general.semaforos[id].modoManual = false;
        if (respuesta.dispositivo.estado) {
          this.general.semaforos[id].estado = respuesta.dispositivo.estado.estado;
          this.general.semaforos[id].origen = respuesta.dispositivo.estado.origen;
        }
        this.cargarOperaciones();
      },
      error: (error) => {
        this.enviando[id] = false;
        const detalle = error.error && (error.error.error || (error.error.dispositivo && error.error.dispositivo.resultado));
        this.confirmaciones[id] = 'Error: ' + (detalle || 'no hubo respuesta del dispositivo');
      }
    });
  }

  // Clase del badge segun el color de la luz
  claseEstado(estado: string | null): string {
    if (estado === 'verde') return 'text-bg-success';
    if (estado === 'rojo') return 'text-bg-danger';
    if (estado === 'amarillo' || estado === 'amarillo_intermitente') return 'text-bg-warning';
    return 'text-bg-secondary';
  }

  etiquetaEstado(estado: string | null): string {
    if (estado === 'amarillo_intermitente') return 'amarillo intermitente';
    return estado || 'desconocido';
  }

  // Texto legible de una accion registrada en la sesion manual
  etiquetaAccion(accion: string): string {
    if (accion === 'forzar_verde') return 'forzar verde';
    if (accion === 'forzar_rojo') return 'forzar rojo';
    return accion;
  }

  ngOnDestroy() {
    this.suscripciones.forEach((s) => s.unsubscribe());
  }
}
