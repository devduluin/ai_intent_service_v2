// services/taskState.service.ts
import { TaskState } from '../types/task.types'
import { randomUUID } from 'crypto'

class TaskStateService {
  /**
   * TEMP STORE
   * key = userId:agentSlug
   * nanti bisa diganti Redis
   */
  private store = new Map<string, TaskState>()

  private buildKey(userId: string, agentSlug: string) {
    return `${userId}:${agentSlug}`
  }

  // ============================================================
  // GET ACTIVE TASK
  // ============================================================

  getActive(userId: string, agentSlug: string): TaskState | null {
    const key = this.buildKey(userId, agentSlug)
    const task = this.store.get(key)

    if (!task) return null

    // ignore finished tasks
    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled'
    ) {
      return null
    }

    return task
  }

  // ============================================================
  // CREATE TASK
  // ============================================================

  create(task: Omit<TaskState, 'taskId' | 'createdAt' | 'updatedAt'>): TaskState {
    const newTask: TaskState = {
      ...task,
      taskId: randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const key = this.buildKey(task.userId, task.agentSlug)
    this.store.set(key, newTask)

    return newTask
  }

  // ============================================================
  // UPDATE TASK
  // ============================================================

  update(taskId: string, patch: Partial<TaskState>) {
    const task = this.findByTaskId(taskId)
    if (!task) return

    Object.assign(task, patch)
    task.updatedAt = Date.now()

    const key = this.buildKey(task.userId, task.agentSlug)
    this.store.set(key, task)
  }

  // ============================================================
  // COMPLETE TASK
  // ============================================================

  complete(taskId: string, results: any) {
    const task = this.findByTaskId(taskId)
    if (!task) return

    task.status = 'completed'
    task.results = results
    task.updatedAt = Date.now()

    const key = this.buildKey(task.userId, task.agentSlug)
    this.store.set(key, task)
  }

  // ============================================================
  // FAIL TASK
  // ============================================================

  fail(taskId: string, error: any) {
    const task = this.findByTaskId(taskId)
    if (!task) return

    task.status = 'failed'
    task.results = error
    task.updatedAt = Date.now()

    const key = this.buildKey(task.userId, task.agentSlug)
    this.store.set(key, task)
  }

  // ============================================================
  // CANCEL TASK (user says cancel)
  // ============================================================

  cancel(userId: string, agentSlug: string) {
    const key = this.buildKey(userId, agentSlug)
    const task = this.store.get(key)
    if (!task) return

    task.status = 'cancelled'
    task.updatedAt = Date.now()

    this.store.set(key, task)
  }

  // ============================================================
  // SLOT FILLING HELPERS
  // ============================================================

  mergeParams(taskId: string, newParams: Record<string, any>) {
    const task = this.findByTaskId(taskId)
    if (!task) return

    task.params = {
      ...task.params,
      ...newParams
    }

    task.updatedAt = Date.now()
  }

  setMissingParams(taskId: string, missingParamsMap: TaskState['missingParamsMap']) {
    const task = this.findByTaskId(taskId)
    if (!task) return

    task.missingParamsMap = missingParamsMap
    task.updatedAt = Date.now()
  }

  incrementRetry(taskId: string) {
    const task = this.findByTaskId(taskId)
    if (!task) return

    task.retryCount += 1
    task.updatedAt = Date.now()
  }

  markReadyToExecute(taskId: string) {
    const task = this.findByTaskId(taskId)
    if (!task) return

    task.status = 'ready_to_execute'
    task.updatedAt = Date.now()
  }

  markExecuting(taskId: string) {
    const task = this.findByTaskId(taskId)
    if (!task) return

    task.status = 'executing'
    task.updatedAt = Date.now()
  }

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================

  private findByTaskId(taskId: string): TaskState | null {
    for (const task of this.store.values()) {
      if (task.taskId === taskId) return task
    }
    return null
  }
}

export const taskStateService = new TaskStateService()