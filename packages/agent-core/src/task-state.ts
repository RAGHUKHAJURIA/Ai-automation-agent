import type { TaskState } from '@personal-agent/contracts';

const terminal = new Set<TaskState>(['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED']);
const allowed: Record<TaskState, readonly TaskState[]> = {
  RECEIVED: ['VALIDATING', 'CANCELLED', 'FAILED'],
  VALIDATING: ['PLANNING', 'WAITING_FOR_INPUT', 'FAILED', 'CANCELLED'],
  PLANNING: ['QUEUED', 'WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'FAILED', 'CANCELLED', 'EXPIRED'],
  QUEUED: ['RUNNING', 'PAUSED', 'WAITING_FOR_DEVICE', 'CANCELLED', 'EXPIRED', 'FAILED'],
  RUNNING: ['VERIFYING', 'WAITING_FOR_INPUT', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_DEVICE', 'PAUSED', 'QUEUED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  WAITING_FOR_APPROVAL: ['QUEUED', 'PAUSED', 'CANCELLED', 'EXPIRED', 'FAILED'],
  WAITING_FOR_INPUT: ['QUEUED', 'PAUSED', 'CANCELLED', 'EXPIRED', 'FAILED'],
  WAITING_FOR_DEVICE: ['QUEUED', 'PAUSED', 'CANCELLED', 'EXPIRED', 'FAILED'],
  PAUSED: ['QUEUED', 'CANCELLED', 'EXPIRED'],
  VERIFYING: ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'],
  SUCCEEDED: [], PARTIALLY_SUCCEEDED: [], FAILED: [], CANCELLED: [], EXPIRED: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return !terminal.has(from) && allowed[from].includes(to);
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) throw new Error(`Invalid task transition: ${from} -> ${to}`);
}

export function isTerminal(state: TaskState): boolean { return terminal.has(state); }
