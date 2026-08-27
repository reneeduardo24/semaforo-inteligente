// Vista de simulacion: una avenida dibujada en SVG con las dos intersecciones.
// Las luces se encienden con el estado real que llega por Socket.IO y los autos
// (rectangulos) avanzan y se detienen en la linea de alto cuando su semaforo
// esta en rojo o amarillo. La cantidad de autos es proporcional al conteo
// reciente de los sensores, y con la sincronizacion activa se aprecia la ola verde.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ServicioApi } from '../../servicios/api';
import { ServicioSocket } from '../../servicios/socket';
import { Estado, Lectura } from '../../modelos';

// posiciones fijas del dibujo: linea de alto y centro del semaforo por interseccion
const DIBUJOS = [
  { id: 'semaforo1', centroX: 283, stopX: 302 },
  { id: 'semaforo2', centroX: 683, stopX: 702 }
];
const VELOCIDAD = 4; // pixeles por tick de 50 ms
const LARGO_AUTO = 26;
const SEPARACION = 34; // distancia minima entre frentes de autos consecutivos
const COLORES_AUTO = ['#0d6efd', '#6610f2', '#d63384', '#fd7e14', '#20c997', '#0dcaf0', '#6c757d'];

interface Auto {
  x: number; // posicion del frente del auto
  color: string;
}

@Component({
  selector: 'app-simulacion',
  imports: [],
  templateUrl: './simulacion.html'
})
export class Simulacion implements OnInit, OnDestroy {
  dibujos = DIBUJOS;
  autos: Auto[] = [];
  // estado y nivel actuales por semaforo, alimentados por Socket.IO
  semaforos: { [id: string]: { estado: string; nivelTrafico: string | null } } = {
    semaforo1: { estado: 'desconocido', nivelTrafico: null },
    semaforo2: { estado: 'desconocido', nivelTrafico: null }
  };
  parpadeo = true; // alterna para que el amarillo intermitente parpadee
  private conteos: { [sensorId: string]: number } = {};
  private contadorAutos = 0;
  private temporizadores: any[] = [];
  private suscripciones: Subscription[] = [];

  constructor(private api: ServicioApi, private socket: ServicioSocket) {}

  ngOnInit() {
    // estado inicial y actualizaciones en vivo; el mismo volcado sirve para la
    // reconexion del socket, cuando el backend reenvia el estado general
    const volcar = (general: any) => {
      Object.keys(general.semaforos).forEach((id) => {
        this.semaforos[id] = {
          estado: general.semaforos[id].estado,
          nivelTrafico: general.semaforos[id].nivelTrafico
        };
      });
      Object.keys(general.sensores).forEach((id) => {
        // las lecturas atipicas no cuentan para la cantidad de autos en pantalla
        if (!general.sensores[id].atipico) this.conteos[id] = general.sensores[id].vehiculos || 0;
      });
    };
    this.api.estadoGeneral().subscribe(volcar);
    this.suscripciones.push(this.socket.escuchar<any>('estado-general').subscribe(volcar));
    this.suscripciones.push(this.socket.escuchar<Estado>('estado').subscribe((estado) => {
      this.semaforos[estado.semaforoId] = { estado: estado.estado, nivelTrafico: estado.nivelTrafico };
    }));
    this.suscripciones.push(this.socket.escuchar<Lectura>('lectura').subscribe((lectura) => {
      if (!lectura.atipico) this.conteos[lectura.sensorId] = lectura.vehiculos;
    }));
    // relojes de la animacion: movimiento, aparicion de autos y parpadeo
    this.temporizadores.push(setInterval(() => this.mover(), 50));
    this.temporizadores.push(setInterval(() => this.aparecerAuto(), 400));
    this.temporizadores.push(setInterval(() => (this.parpadeo = !this.parpadeo), 500));
  }

  // Un semaforo deja pasar en verde y en amarillo intermitente (paso con precaucion)
  private dejaPasar(id: string): boolean {
    const estado = this.semaforos[id]?.estado;
    return estado === 'verde' || estado === 'amarillo_intermitente';
  }

  // Avanza los autos respetando la distancia con el de adelante y las lineas de alto
  private mover() {
    const ordenados = this.autos.slice().sort((a, b) => b.x - a.x);
    let frenteAnterior = Infinity;
    for (const auto of ordenados) {
      let limite = frenteAnterior - SEPARACION;
      for (const dibujo of DIBUJOS) {
        // solo detiene a los autos que aun no cruzan la linea de ese semaforo
        if (!this.dejaPasar(dibujo.id) && auto.x < dibujo.stopX) {
          limite = Math.min(limite, dibujo.stopX - 4);
        }
      }
      auto.x = Math.max(auto.x, Math.min(auto.x + VELOCIDAD, limite));
      frenteAnterior = auto.x;
    }
    this.autos = this.autos.filter((auto) => auto.x - LARGO_AUTO < 1005);
  }

  // Mete un auto nuevo por la izquierda hasta alcanzar la cantidad objetivo,
  // que es proporcional al conteo reciente de los sensores
  private aparecerAuto() {
    const conteos = Object.values(this.conteos);
    const promedio = conteos.length ? conteos.reduce((s, v) => s + v, 0) / conteos.length : 0;
    const objetivo = Math.min(Math.round(promedio * 0.6), 18);
    const entradaLibre = !this.autos.some((auto) => auto.x < LARGO_AUTO + SEPARACION);
    if (this.autos.length < objetivo && entradaLibre) {
      this.contadorAutos = this.contadorAutos + 1;
      this.autos.push({ x: 4, color: COLORES_AUTO[this.contadorAutos % COLORES_AUTO.length] });
    }
  }

  // Colores de los focos: cada circulo se enciende solo con su estado
  colorFoco(id: string, foco: 'rojo' | 'amarillo' | 'verde'): string {
    const estado = this.semaforos[id]?.estado;
    if (foco === 'rojo') return estado === 'rojo' ? '#dc3545' : '#3a3f44';
    if (foco === 'verde') return estado === 'verde' ? '#198754' : '#3a3f44';
    const encendido = estado === 'amarillo' || (estado === 'amarillo_intermitente' && this.parpadeo);
    return encendido ? '#ffc107' : '#3a3f44';
  }

  // Texto informativo bajo cada interseccion
  etiqueta(id: string): string {
    const semaforo = this.semaforos[id];
    if (!semaforo) return id;
    const estado = semaforo.estado === 'amarillo_intermitente' ? 'amarillo intermitente' : semaforo.estado;
    return id + ': ' + estado + (semaforo.nivelTrafico ? ' (trafico ' + semaforo.nivelTrafico + ')' : '');
  }

  ngOnDestroy() {
    this.temporizadores.forEach((t) => clearInterval(t));
    this.suscripciones.forEach((s) => s.unsubscribe());
  }
}
