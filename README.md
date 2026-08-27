# Sistema de semáforos inteligentes (Software para IoT)

Dos semáforos y dos sensores de tráfico simulados que se comunican mediante CoAP con un backend en Node.js. El backend almacena los datos en MongoDB y alimenta un dashboard en Angular con KPIs, gráficas en tiempo real, operación manual, alarmas y una simulación de la avenida.

## Requisitos

- Node.js LTS (probado con v24)
- MongoDB corriendo en `mongodb://127.0.0.1:27017` (instalacion local por defecto)

## Instalación (una sola vez)

```
cd dispositivos
npm install
cd ../backend
npm install
cd ../dashboard
npm install
```

## Ejecución

Abrir una terminal por proceso, en este orden.

Terminales 1 y 2, los sensores de tráfico:

```
cd dispositivos
node sensor-trafico.js sensor1 5683
```

```
cd dispositivos
node sensor-trafico.js sensor2 5684
```

Terminales 3 y 4, los controladores de semáforo:

```
cd dispositivos
node controlador-semaforo.js semaforo1 5685
```

```
cd dispositivos
node controlador-semaforo.js semaforo2 5686
```

Terminal 5, el backend (API REST en el puerto 3000):

```
cd backend
node servidor.js
```

Terminal 6, el dashboard:

```
cd dashboard
npm start
```

Dashboard: http://localhost:4200

## Estructura

```
semaforo-inteligente/
├── backend/          Express, cliente CoAP, Socket.IO, calidad de datos, alarmas, KPIs
├── dispositivos/     sensor-trafico.js, controlador-semaforo.js, config.json
├── dashboard/        proyecto Angular (Bootstrap 5 + Chart.js)
└── README.md
```

Los puertos CoAP (5683 a 5686) y las direcciones de los dispositivos están en `dispositivos/config.json`. El día simulado de 24 horas se comprime en 12 minutos y todos los tiempos nominales del semáforo se dividen entre el factor de tiempo (10 por defecto, configurable desde el dashboard).
