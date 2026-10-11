import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import { sessionInterceptor } from './session.interceptor';

// Double-submit CSRF de l'API (apps/api/src/common/cookies.ts) : cookie csrf_token recopié dans X-CSRF-Token
// sur toute méthode non GET/HEAD vers la même origine.
export const provideApiHttp = () =>
  provideHttpClient(
    withXsrfConfiguration({ cookieName: 'csrf_token', headerName: 'X-CSRF-Token' }),
    withInterceptors([sessionInterceptor]),
  );
