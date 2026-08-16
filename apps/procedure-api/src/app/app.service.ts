import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getData(): { status: string; service: string } {
    return { status: 'ok', service: 'procedure-api' };
  }
}
