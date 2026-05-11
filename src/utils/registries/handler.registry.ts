import type { ApiHandlerFn } from '../../types'

class HandlerRegistry {
  private handlers = new Map<string, ApiHandlerFn>()

  register(key: string, handler: ApiHandlerFn) {
    if (this.handlers.has(key)) {
      throw new Error(`Handler "${key}" sudah terdaftar`)
    }
    this.handlers.set(key, handler)
  }

  get(key: string): ApiHandlerFn {
    const handler = this.handlers.get(key)
    if (!handler) {
      throw new Error(`Handler "${key}" tidak ditemukan`)
    }
    return handler
  }

  has(key: string): boolean {
    return this.handlers.has(key)
  }
}

export const handlerRegistry = new HandlerRegistry()