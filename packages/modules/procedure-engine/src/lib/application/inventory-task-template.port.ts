export const INVENTORY_TASK_TEMPLATE_RESOLVER = Symbol('INVENTORY_TASK_TEMPLATE_RESOLVER');

/**
 * Reads Role E task lists from the Inventory module.
 *
 * Called only when publishing a definition: the result is frozen into
 * raci_assignments.e_task_config so a published version keeps running the same
 * task list even if the source asset changes afterwards.
 */
export interface InventoryTaskTemplateResolver {
  resolveAssetTaskTemplate(
    tenantId: string,
    assetCode: string,
  ): Promise<Record<string, unknown>[] | null>;
}
