import { randomUUID } from 'node:crypto';
import type {
  ProcedureClock,
  ProcedureIdGenerator,
} from '../application/procedure-store.port.js';

export class SystemProcedureClock implements ProcedureClock {
  now(): Date {
    return new Date();
  }
}

export class UuidProcedureIdGenerator implements ProcedureIdGenerator {
  next(): string {
    return randomUUID();
  }
}
