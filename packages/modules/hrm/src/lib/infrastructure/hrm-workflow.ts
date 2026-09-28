// Compatibility exports: every caller now uses the single durable inbox and transition pipeline.
export {
  receiveHrmProcedureResult as receiveHrmWorkflowResult,
  processHrmProcedureSync as processHrmWorkflows,
} from './hrm-procedure-sync.js';
