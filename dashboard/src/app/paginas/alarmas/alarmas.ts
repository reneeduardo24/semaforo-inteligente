// Vista de alarmas: crear y editar definiciones (variable, condicion, umbral,
// activa) y consultar el historial de notificaciones. Cuando una alarma se
// dispara, el toast global aparece por el evento de Socket.IO.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ServicioApi } from '../../servicios/api';
import { ServicioSocket } from '../../servicios/socket';
import { Alarma, Notificacion } from '../../modelos';

@Component({
  selector: 'app-alarmas',
  imports: [DatePipe, FormsModule],
  templateUrl: './alarmas.html'
})
export class Alarmas implements OnInit, OnDestroy {
  // catalogo de variables que el backend sabe evaluar
  variables = [
    { clave: 'vehiculos', etiqueta: 'Vehiculos por minuto (lecturas validas)' },
    { clave: 'nivelTrafico', etiqueta: 'Nivel de trafico (0 nulo a 4 congestionamiento)' },
    { clave: 'porcentajeAtipicos', etiqueta: 'Porcentaje de lecturas atipicas del sensor' },
    { clave: 'segundosSinReporte', etiqueta: 'Segundos sin reporte del sensor' }
  ];
  condiciones = ['>', '<', '>=', '<=', '=='];

  alarmas: Alarma[] = [];
  notificaciones: Notificacion[] = [];
  // formulario de creacion o edicion; si editandoId es null se esta creando
  formulario: Alarma = this.formularioVacio();
  editandoId: string | null = null;
  mensaje = '';
  private suscripcion: Subscription | null = null;

  constructor(private api: ServicioApi, private socket: ServicioSocket) {}

  ngOnInit() {
    this.cargar();
    this.suscripcion = this.socket.escuchar<Notificacion>('notificacion').subscribe((notificacion) => {
      this.notificaciones = [notificacion, ...this.notificaciones].slice(0, 50);
    });
  }

  // Alarma en blanco para el formulario de creacion
  formularioVacio(): Alarma {
    return { nombre: '', variable: 'vehiculos', condicion: '>', umbral: 30, activa: true };
  }

  // Trae definiciones y notificaciones desde la API
  cargar() {
    this.api.alarmas().subscribe((alarmas) => (this.alarmas = alarmas));
    this.api.notificaciones().subscribe((notificaciones) => (this.notificaciones = notificaciones));
  }

  // Crea la alarma nueva o guarda los cambios de la que se esta editando
  guardar() {
    if (!this.formulario.nombre || this.formulario.umbral === null || this.formulario.umbral === undefined) {
      this.mensaje = 'Falta el nombre o el umbral de la alarma.';
      return;
    }
    const umbralNumerico = Number(this.formulario.umbral);
    const alarma: Alarma = { ...this.formulario, umbral: umbralNumerico };
    const peticion = this.editandoId
      ? this.api.editarAlarma(this.editandoId, alarma)
      : this.api.crearAlarma(alarma);
    peticion.subscribe({
      next: () => {
        this.mensaje = this.editandoId ? 'Alarma actualizada.' : 'Alarma creada.';
        this.cancelar();
        this.cargar();
      },
      error: (error) => {
        this.mensaje = 'Error: ' + ((error.error && error.error.error) || 'no se pudo guardar la alarma');
      }
    });
  }

  // Pasa una alarma al formulario para editarla
  editar(alarma: Alarma) {
    this.editandoId = alarma._id || null;
    this.formulario = { nombre: alarma.nombre, variable: alarma.variable, condicion: alarma.condicion, umbral: alarma.umbral, activa: alarma.activa };
  }

  // Activa o desactiva una alarma directamente desde la tabla
  alternarActiva(alarma: Alarma) {
    this.api.editarAlarma(alarma._id!, { ...alarma, activa: !alarma.activa }).subscribe({
      next: () => this.cargar(),
      error: () => {
        this.mensaje = 'Error: no se pudo cambiar la alarma.';
        this.cargar(); // recarga para que el interruptor refleje el valor real
      }
    });
  }

  // Elimina una alarma
  eliminar(alarma: Alarma) {
    this.api.eliminarAlarma(alarma._id!).subscribe({
      next: () => this.cargar(),
      error: () => {
        this.mensaje = 'Error: no se pudo eliminar la alarma.';
        this.cargar();
      }
    });
  }

  // Limpia el formulario y sale del modo edicion
  cancelar() {
    this.editandoId = null;
    this.formulario = this.formularioVacio();
  }

  // Etiqueta legible de la variable de una alarma
  etiquetaVariable(clave: string): string {
    const variable = this.variables.find((v) => v.clave === clave);
    return variable ? variable.etiqueta : clave;
  }

  ngOnDestroy() {
    this.suscripcion?.unsubscribe();
  }
}
