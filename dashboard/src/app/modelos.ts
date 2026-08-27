// Tipos compartidos del dashboard. Reflejan los documentos que expone la API del backend.

// Lectura de trafico tal como se guarda en lecturas_trafico
export interface Lectura {
  semaforoId: string;
  sensorId: string;
  ts: string;
  horaSimulada: number;
  vehiculos: number;
  intervaloSeg: number;
  atipico: boolean;
  motivoAtipico: string | null;
}

// Cambio de estado de un semaforo tal como se guarda en estados_semaforo
export interface Estado {
  semaforoId: string;
  ts: string;
  estado: string;
  origen: string;
  nivelTrafico: string;
  nivelNumerico?: number;
}

// Estado en memoria que publica el backend al conectarse el socket
export interface EstadoGeneral {
  semaforos: { [id: string]: { estado: string; origen: string | null; nivelTrafico: string | null; ts: string | null; modoManual: boolean } };
  sensores: { [id: string]: { vehiculos: number | null; ts: string | null; horaSimulada: number | null; atipico: boolean } };
}

// Configuracion de un semaforo (documento de la coleccion configuracion)
export interface Configuracion {
  semaforoId: string;
  duracionAmarilloSeg: number;
  velocidadKmh: number;
  distanciaM: number;
  umbrales: { pocoMax: number; normalMax: number; muchoMax: number };
  factorTiempo: number;
  sincronizacionActiva: boolean;
}

// Definicion de alarma configurable
export interface Alarma {
  _id?: string;
  nombre: string;
  variable: string;
  condicion: string;
  umbral: number;
  activa: boolean;
}

// Notificación emitida cuando se activa una alarma
export interface Notificacion {
  alarmaId: string;
  ts: string;
  semaforoId: string | null;
  valor: number;
  mensaje: string;
}

// Sesion de operacion manual con sus acciones
export interface OperacionManual {
  semaforoId: string;
  tsInicio: string;
  tsFin: string | null;
  acciones: { ts: string; accion: string }[];
}
