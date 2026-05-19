// utils/logger.util.ts
import pino, { Logger as PinoLogger } from 'pino';
import { config } from '../config';

// ============================================================
// Logger Configuration
// ============================================================

const isProduction = config.server.env === 'production';

const baseLogger = pino({
  level: isProduction ? 'info' : 'debug',
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ============================================================
// Child Loggers for Different Modules
// ============================================================

export const logger = {
  // Vector Service Logger
  vector: baseLogger.child({ module: 'vector-service' }),
  
  // OpenAI/Alibaba Service Logger
  embedding: baseLogger.child({ module: 'embedding-service' }),
  
  // General purpose
  app: baseLogger.child({ module: 'app' }),
  
  // Database Logger
  db: baseLogger.child({ module: 'database' }),
  
  // HTTP Logger
  http: baseLogger.child({ module: 'http' }),
};

// ============================================================
// Logger Interface for Consistent Logging
// ============================================================

export interface LogContext {
  userId?: string;
  agentId?: string;
  intentId?: string;
  requestId?: string;
  [key: string]: unknown;
}

export class StructuredLogger {
  private baseLogger: PinoLogger;
  private defaultContext: LogContext;

  constructor(baseLogger: PinoLogger, defaultContext: LogContext = {}) {
    this.baseLogger = baseLogger;
    this.defaultContext = defaultContext;
  }

  private withContext(context?: LogContext) {
    return { ...this.defaultContext, ...context };
  }

  debug(message: string, context?: LogContext, data?: unknown) {
    this.baseLogger.debug(
      { context: this.withContext(context), data },
      message
    );
  }

  info(message: string, context?: LogContext, data?: unknown) {
    this.baseLogger.info(
      { context: this.withContext(context), data },
      message
    );
  }

  warn(message: string, context?: LogContext, data?: unknown) {
    this.baseLogger.warn(
      { context: this.withContext(context), data },
      message
    );
  }

  error(message: string, context?: LogContext, error?: unknown) {
    this.baseLogger.error(
      { context: this.withContext(context), error },
      message
    );
  }

  fatal(message: string, context?: LogContext, error?: unknown) {
    this.baseLogger.fatal(
      { context: this.withContext(context), error },
      message
    );
  }

  // Metric logging
  metric(name: string, value: number, unit: string, context?: LogContext) {
    this.baseLogger.info(
      {
        metric: { name, value, unit },
        context: this.withContext(context),
      },
      `METRIC: ${name}=${value}${unit}`
    );
  }

  // Performance timing
  timing(
    operation: string,
    durationMs: number,
    context?: LogContext & { success?: boolean }
  ) {
    const level = context?.success === false ? 'warn' : 'info';
    this.baseLogger[level](
      {
        timing: { operation, durationMs },
        context: this.withContext(context),
      },
      `TIMING: ${operation} took ${durationMs.toFixed(2)}ms`
    );
  }
}

// Pre-configured structured loggers for different modules
export const vectorLogger = new StructuredLogger(
  baseLogger.child({ module: 'vector-service' })
);

export const embeddingLogger = new StructuredLogger(
  baseLogger.child({ module: 'embedding' })
);

export const appLogger = new StructuredLogger(
  baseLogger.child({ module: 'app' })
);
