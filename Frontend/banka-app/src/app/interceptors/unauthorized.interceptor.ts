import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environment';

export const unauthorizedInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const isApiRequest = req.url.startsWith(environment.apiUrl);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (isApiRequest && err.status === 401) {
        router.navigateByUrl('/login');
      }
      return throwError(() => err);
    })
  );
};
