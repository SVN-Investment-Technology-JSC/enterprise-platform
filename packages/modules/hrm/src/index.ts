export * from './lib/module-hrm.module.js';
export * from './lib/infrastructure/hrm-context.service.js';
export { receiveHrmProcedureResult, processHrmProcedureSync } from './lib/infrastructure/hrm-procedure-sync.js';
export { runHrmAutomation } from './lib/infrastructure/hrm-automation.js';
export {
  processHrmWorkflows,
  receiveHrmWorkflowResult,
} from './lib/infrastructure/hrm-workflow.js';
