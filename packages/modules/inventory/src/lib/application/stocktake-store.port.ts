import type {
  CreateStocktakeRequest,
  StocktakeLine,
  StocktakeSession,
  UpdateStocktakeLineInput,
} from '@enterprise-platform/contracts-inventory';

export interface LatestMaterialStocktake {
  readonly sessionCode: string;
  readonly countedAt: string;
  readonly systemQuantity: number;
  readonly actualQuantity?: number;
  readonly difference: number;
  readonly status: string;
}

export interface StocktakeStore {
  listSessions(tenantId: string): Promise<StocktakeSession[]>;
  listLines(tenantId: string, sessionId: string): Promise<StocktakeLine[]>;
  latestByMaterial(tenantId: string, materialCode: string): Promise<LatestMaterialStocktake | null>;
  createSession(tenantId: string, input: CreateStocktakeRequest): Promise<StocktakeSession>;
  startCounting(
    tenantId: string,
    sessionId: string,
  ): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }>;
  saveLines(
    tenantId: string,
    sessionId: string,
    updates: readonly UpdateStocktakeLineInput[],
    operator: string,
  ): Promise<{ session: StocktakeSession; lines: StocktakeLine[] }>;
  submitForApproval(tenantId: string, sessionId: string): Promise<StocktakeSession>;
  approveAndPost(
    tenantId: string,
    sessionId: string,
    approvedBy: string,
  ): Promise<{ session: StocktakeSession; transactionsCreated: number }>;
  rejectSession(tenantId: string, sessionId: string, reason?: string): Promise<StocktakeSession>;
  cancelSession(tenantId: string, sessionId: string, reason?: string): Promise<StocktakeSession>;
}

export const STOCKTAKE_STORE = 'STOCKTAKE_STORE';
