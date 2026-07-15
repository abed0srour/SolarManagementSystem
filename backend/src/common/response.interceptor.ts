import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Wraps JSON responses in a { success, data } envelope.
 * Binary/stream responses (PDF, file downloads via @Res) bypass interceptors.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        if (data === undefined) return data;
        if (Buffer.isBuffer(data) || data instanceof Uint8Array) return data;
        return { success: true, data };
      }),
    );
  }
}
