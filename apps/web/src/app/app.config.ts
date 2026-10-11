import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { Session } from './core/auth/session';
import { provideApiHttp } from './core/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideApiHttp(),
    // GET /me avant tout écran : état connecté du shell + cookie CSRF posé avant le premier POST (login…).
    provideAppInitializer(() => inject(Session).restore()),
  ]
};
