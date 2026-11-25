/** Token Symbol: port HTTP gọi sang Quy trình để đổi hồ sơ của một công việc. */
export const PROCEDURE_INSTANCE_REPLACER = Symbol('PROCEDURE_INSTANCE_REPLACER');

export interface ReplaceProcedureInstanceInput {
  readonly workItemId: string;
  /** Hồ sơ Workspace đang trỏ tới; Quy trình đối chiếu để chặn đổi nhầm hồ sơ. */
  readonly expectedInstanceId: string;
  readonly definitionId: string;
  readonly requestedBy: string;
  readonly requestedByName?: string;
  readonly requestedByIsTenantAdmin: boolean;
  readonly workItemCode: string;
  readonly workItemTitle: string;
  readonly projectCode: string;
}

export type ReplaceProcedureInstanceResult =
  | {
      readonly ok: true;
      readonly instance: {
        readonly id: string;
        readonly code: string;
        readonly title: string;
        readonly status: string;
        readonly definitionId: string;
      };
      readonly previous: { readonly id: string; readonly code: string };
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Nhờ Quy trình xoá hồ sơ mở nhầm và mở hồ sơ mới theo quy trình khác cho cùng
 * công việc, trong một transaction của Quy trình. Lỗi nghiệp vụ trả `ok: false`
 * kèm lý do; lỗi hạ tầng ném ra (không đổi gì ở cả hai module).
 */
export interface ProcedureInstanceReplacer {
  replace(tenantId: string, input: ReplaceProcedureInstanceInput): Promise<ReplaceProcedureInstanceResult>;
}
