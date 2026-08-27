// Configuracion global de la aplicacion: cliente HTTP y Chart.js.
// El dashboard es una sola pagina con secciones, por eso no hay enrutador.

import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideHttpClient(),
    provideCharts(withDefaultRegisterables())
  ]
};
