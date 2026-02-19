import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { BackendLoaderService } from '../services/backend-loader.service';
import { environment } from '../../environment';

export const backendLoaderInterceptor: HttpInterceptorFn = (req, next) => {
  const loader = inject(BackendLoaderService);
  const isApiRequest = req.url.startsWith(environment.apiUrl);

  if (!isApiRequest) {
    return next(req);
  }

  loader.requestStarted();

  return next(req).pipe(
    tap(() => loader.responseReceived()),
    catchError((err) => {
      loader.responseReceived();
      return throwError(() => err);
    })
  );
};
