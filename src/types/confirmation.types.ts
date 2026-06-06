export type ConfirmationType =
  | 'automation_job_create'
  | 'automation_job_delete'
  | 'tool_write'
  | 'external_action';

export type ConfirmationStatus =
  | 'pending'
  | 'confirmed'
  | 'edited'
  | 'cancelled'
  | 'expired';

export interface ConfirmationCommitAction {
  resource: 'skill' | 'tool';
  key: string;
  params: Record<string, unknown>;
}

export interface PendingConfirmation {
  id: string;
  userId: string;
  appName: string;
  type: ConfirmationType;
  status: ConfirmationStatus;
  draft: Record<string, any>;
  editableFields: string[];
  commitAction: ConfirmationCommitAction;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface ConfirmationResolutionResult {
  isConfirmationResponse: boolean;
  status?: ConfirmationStatus;
  confirmation?: PendingConfirmation;
  shouldCommit?: boolean;
  shouldCancel?: boolean;
  shouldAskAgain?: boolean;
  patch?: Record<string, unknown>;
  message?: string;
  expired?: boolean;
}
