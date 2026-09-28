export * from './lib/module-hrm.module.js';
export * from './lib/infrastructure/hrm-context.service.js';
export { runHrmAutomation } from './lib/infrastructure/hrm-automation.js';
export {
  processHrmWorkflows,
  receiveHrmWorkflowResult,
} from './lib/infrastructure/hrm-workflow.js';
