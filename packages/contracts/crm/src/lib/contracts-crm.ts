export interface CrmCustomerSummary {
  readonly id: string;
  readonly displayName: string;
}

export interface CustomerCreatedEvent {
  readonly type: 'crm.customer-created.v1';
  readonly tenantId: string;
  readonly customerId: string;
  readonly occurredAt: string;
}
