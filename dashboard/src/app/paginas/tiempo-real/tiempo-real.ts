// Seccion de tiempo real: las seis variables del sistema graficadas a la vez en
// una rejilla (conteo de cada sensor, nivel de trafico y estado de la luz de cada
// semaforo). Los puntos llegan por Socket.IO y cada grafica mantiene una ventana
// de los ultimos 30.

import { Component, OnDestroy, OnInit, QueryList, ViewChildren } from '@angular/core';
import { Subscription } from 'rxjs';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { ServicioSocket } from '../../servicios/socket';
import { Estado, Lectura } from '../../modelos';

const MAX_PUNTOS = 30;
// equivalencia numerica para graficar los estados de la luz
const VALOR_ESTADO: { [estado: string]: number } = { rojo: 0, amarillo: 1, amarillo_intermitente: 1, verde: 2 };
const NOMBRE_ESTADO = ['rojo', 'amarillo', 'verde'];
// en el eje se abrevia congestionamiento para que quepa en las graficas chicas
const NOMBRE_NIVEL = ['nulo', 'poco', 'normal', 'mucho', 'congest.'];

interface Grafica {
  clave: string;
  titulo: string;
  datos: ChartConfiguration<'line'>['data'];
  opciones: ChartConfiguration<'line'>['options'];
}

@Component({
  selector: 'app-tiempo-real',
  imports: [BaseChartDirective],
  templateUrl: './tiempo-real.html'
})
export class TiempoReal implements OnInit, OnDestroy {
  @ViewChildren(BaseChartDirective) lienzos?: QueryList<BaseChartDirective>;

  graficas: Grafica[] = [];
  atipicasOmitidas = 0;
  private suscripciones: Subscription[] = [];

  constructor(private socket: ServicioSocket) {}

  ngOnInit() {
    this.graficas = [
      this.crearGrafica('vehiculos:sensor1', 'Vehiculos por minuto (sensor1)', 'vehiculos'),
      this.crearGrafica('vehiculos:sensor2', 'Vehiculos por minuto (sensor2)', 'vehiculos'),
      this.crearGrafica('nivel:semaforo1', 'Nivel de trafico (semaforo1)', 'nivel'),
      this.crearGrafica('nivel:semaforo2', 'Nivel de trafico (semaforo2)', 'nivel'),
      this.crearGrafica('estado:semaforo1', 'Estado de la luz (semaforo1)', 'estado'),
      this.crearGrafica('estado:semaforo2', 'Estado de la luz (semaforo2)', 'estado')
    ];
    // cada lectura valida alimenta la grafica de su sensor
    this.suscripciones.push(this.socket.escuchar<Lectura>('lectura').subscribe((lectura) => {
      if (lectura.atipico) {
        this.atipicasOmitidas = this.atipicasOmitidas + 1;
        return;
      }
      this.agregarPunto('vehiculos:' + lectura.sensorId, lectura.ts, lectura.vehiculos);
    }));
    // cada cambio de estado alimenta las graficas de nivel y de luz de su semaforo
    this.suscripciones.push(this.socket.escuchar<Estado>('estado').subscribe((estado) => {
      this.agregarPunto('nivel:' + estado.semaforoId, estado.ts, estado.nivelNumerico ?? 0);
      this.agregarPunto('estado:' + estado.semaforoId, estado.ts, VALOR_ESTADO[estado.estado] ?? 0);
    }));
  }

  // Arma una grafica vacia con los ejes que corresponden al tipo de variable
  private crearGrafica(clave: string, titulo: string, tipo: 'vehiculos' | 'nivel' | 'estado'): Grafica {
    const base: ChartConfiguration<'line'>['options'] = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { maxTicksLimit: 5, font: { size: 10 } } } }
    };
    if (tipo === 'vehiculos') {
      base.scales!['y'] = { beginAtZero: true, ticks: { font: { size: 10 } } };
    } else if (tipo === 'nivel') {
      base.scales!['y'] = { min: 0, max: 4, ticks: { stepSize: 1, font: { size: 10 }, callback: (v) => NOMBRE_NIVEL[Number(v)] ?? v } };
    } else {
      base.scales!['y'] = { min: 0, max: 2, ticks: { stepSize: 1, font: { size: 10 }, callback: (v) => NOMBRE_ESTADO[Number(v)] ?? v } };
    }
    return {
      clave: clave,
      titulo: titulo,
      datos: {
        labels: [],
        datasets: [{
          label: titulo,
          data: [],
          borderColor: '#0d6efd',
          backgroundColor: 'rgba(13,110,253,0.15)',
          fill: false,
          tension: 0.2,
          stepped: tipo !== 'vehiculos',
          pointRadius: 2
        }]
      },
      opciones: base
    };
  }

  // Agrega un punto a la ventana deslizante de la grafica indicada y la redibuja
  private agregarPunto(clave: string, ts: string, valor: number) {
    const indice = this.graficas.findIndex((g) => g.clave === clave);
    if (indice === -1) return;
    const grafica = this.graficas[indice];
    const etiquetas = grafica.datos.labels as string[];
    const serie = grafica.datos.datasets[0].data as number[];
    etiquetas.push(new Date(ts).toLocaleTimeString());
    serie.push(valor);
    if (etiquetas.length > MAX_PUNTOS) {
      etiquetas.shift();
      serie.shift();
    }
    this.lienzos?.get(indice)?.update();
  }

  ngOnDestroy() {
    this.suscripciones.forEach((s) => s.unsubscribe());
  }
}
