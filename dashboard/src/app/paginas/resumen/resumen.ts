// Vista de resumen: tarjetas con los KPIs, el estado actual de cada semaforo y el
// nivel de trafico vigente. Los estados llegan por Socket.IO y los KPIs se
// refrescan periodicamente desde la API.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Subscription } from 'rxjs';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { ServicioApi } from '../../servicios/api';
import { ServicioSocket } from '../../servicios/socket';
import { Estado, EstadoGeneral, Lectura } from '../../modelos';

@Component({
  selector: 'app-resumen',
  imports: [DatePipe, BaseChartDirective],
  templateUrl: './resumen.html'
})
export class Resumen implements OnInit, OnDestroy {
  general: EstadoGeneral = { semaforos: {}, sensores: {} };
  kpis: any = null;
  private suscripciones: Subscription[] = [];
  private temporizadorKpis: any = null;

  // Grafica de barras de vehiculos por hora simulada, un dataset por semaforo
  datosPorHora: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  opcionesPorHora: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { title: { display: false } },
    scales: { y: { title: { display: true, text: 'vehiculos por hora' } }, x: { title: { display: true, text: 'hora simulada' } } }
  };

  // Grafica de barras del tiempo acumulado en cada nivel de trafico (KPI 3)
  datosPorNivel: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  opcionesPorNivel: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { title: { display: false } },
    scales: { y: { title: { display: true, text: 'segundos reales' } }, x: { title: { display: true, text: 'nivel de trafico' } } }
  };

  constructor(private api: ServicioApi, private socket: ServicioSocket) {}

  ngOnInit() {
    this.api.estadoGeneral().subscribe((general) => (this.general = general));
    this.cargarKpis();
    this.temporizadorKpis = setInterval(() => this.cargarKpis(), 15000);
    // al (re)conectarse el socket, el backend manda el ultimo estado conocido
    this.suscripciones.push(this.socket.escuchar<EstadoGeneral>('estado-general').subscribe((general) => (this.general = general)));
    // los cambios de estado y las lecturas actualizan las tarjetas al momento
    this.suscripciones.push(this.socket.escuchar<Estado>('estado').subscribe((estado) => {
      const semaforo = this.general.semaforos[estado.semaforoId];
      if (!semaforo) return;
      semaforo.estado = estado.estado;
      semaforo.origen = estado.origen;
      semaforo.nivelTrafico = estado.nivelTrafico;
      semaforo.ts = estado.ts;
      // en modo manual todos los cambios llegan con origen manual; uno automatico
      // o de sincronizacion implica que el modo manual ya se desactivo
      semaforo.modoManual = estado.origen === 'manual';
    }));
    this.suscripciones.push(this.socket.escuchar<Lectura>('lectura').subscribe((lectura) => {
      this.general.sensores[lectura.sensorId] = {
        vehiculos: lectura.vehiculos,
        ts: lectura.ts,
        horaSimulada: lectura.horaSimulada,
        atipico: lectura.atipico
      };
    }));
  }

  // Pide los KPIs a la API y arma las graficas de vehiculos por hora y de
  // tiempo por nivel de trafico
  cargarKpis() {
    this.api.kpis().subscribe((kpis) => {
      this.kpis = kpis;
      const horas = Array.from(new Set(kpis.vehiculosPorHora.map((f: any) => f.hora))).sort((a: any, b: any) => a - b);
      const semaforos = Array.from(new Set(kpis.vehiculosPorHora.map((f: any) => f.semaforoId))).sort();
      this.datosPorHora = {
        labels: horas.map((h: any) => this.etiquetaHora(h)),
        datasets: semaforos.map((id: any, indice: number) => ({
          label: id,
          data: horas.map((h: any) => {
            const fila = kpis.vehiculosPorHora.find((f: any) => f.semaforoId === id && f.hora === h);
            return fila ? fila.vehiculosPorHora : 0;
          }),
          backgroundColor: indice === 0 ? '#0d6efd' : '#6c757d'
        }))
      };
      const niveles = ['nulo', 'poco', 'normal', 'mucho', 'congestionamiento'];
      const semaforosNivel = Array.from(new Set(kpis.distribucionPorNivel.map((f: any) => f.semaforoId))).sort();
      this.datosPorNivel = {
        labels: niveles,
        datasets: semaforosNivel.map((id: any, indice: number) => ({
          label: id,
          data: niveles.map((nivel) => {
            const fila = kpis.distribucionPorNivel.find((f: any) => f.semaforoId === id && f.nivel === nivel);
            return fila ? fila.segundos : 0;
          }),
          backgroundColor: indice === 0 ? '#0d6efd' : '#6c757d'
        }))
      };
    });
  }

  // Identificadores de semaforos y sensores en orden estable para las tarjetas
  idsSemaforos(): string[] {
    return Object.keys(this.general.semaforos).sort();
  }

  idsSensores(): string[] {
    return Object.keys(this.general.sensores).sort();
  }

  // Formatea una hora simulada como texto de reloj
  etiquetaHora(hora: number | null | undefined): string {
    if (hora === null || hora === undefined) return '--';
    return String(hora).padStart(2, '0') + ':00';
  }

  // Clase de Bootstrap para el badge del estado de la luz
  claseEstado(estado: string | null): string {
    if (estado === 'verde') return 'text-bg-success';
    if (estado === 'rojo') return 'text-bg-danger';
    if (estado === 'amarillo' || estado === 'amarillo_intermitente') return 'text-bg-warning';
    return 'text-bg-secondary';
  }

  // Clase de Bootstrap para el badge del nivel de trafico
  claseNivel(nivel: string | null): string {
    if (nivel === 'nulo') return 'text-bg-secondary';
    if (nivel === 'poco') return 'text-bg-info';
    if (nivel === 'normal') return 'text-bg-primary';
    if (nivel === 'mucho') return 'text-bg-warning';
    if (nivel === 'congestionamiento') return 'text-bg-danger';
    return 'text-bg-light';
  }

  // Texto legible del estado (sin guiones bajos)
  etiquetaEstado(estado: string | null): string {
    if (estado === 'amarillo_intermitente') return 'amarillo intermitente';
    return estado || 'desconocido';
  }

  // Duracion promedio de verde o de ciclo para un semaforo segun el KPI 6
  duracionKpi(tipo: 'verde' | 'ciclo', semaforoId: string): number | null {
    if (!this.kpis || !this.kpis.cicloYVerde) return null;
    const filas = this.kpis.cicloYVerde[tipo] || [];
    const fila = filas.find((f: any) => f.semaforoId === semaforoId);
    return fila ? (tipo === 'verde' ? fila.verdePromedioSeg : fila.cicloPromedioSeg) : null;
  }

  // Total de operaciones manuales sumando todos los semaforos
  totalOperaciones(): number {
    if (!this.kpis) return 0;
    return this.kpis.operacionesManuales.reduce((suma: number, f: any) => suma + f.operaciones, 0);
  }

  ngOnDestroy() {
    clearInterval(this.temporizadorKpis);
    this.suscripciones.forEach((s) => s.unsubscribe());
  }
}
