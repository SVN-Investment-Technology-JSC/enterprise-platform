/** Token DI của `CrmDiagnostics`. */
export const CRM_DIAGNOSTICS = Symbol('CRM_DIAGNOSTICS');

/** Mức sẵn sàng của `crm_schema` trong DB của tenant. */
export interface CrmSchemaStatus {
  readonly schemaExists: boolean;
  readonly tablesReady: boolean;
}

export interface CrmDiagnostics {
  schemaStatus(tenantId: string): Promise<CrmSchemaStatus>;
}
