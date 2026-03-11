export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function format(level: string, message: string): string {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
}

export function setLogLevel(level: string): void {
  const normalized = level.toLowerCase();
  if (normalized in LEVELS) {
    currentLevel = normalized as LogLevel;
  } else {
    console.warn(
      format("warn", `Unknown log level "${level}", keeping "${currentLevel}"`)
    );
  }
}

export const log = {
  debug(message: string) {
    if (shouldLog("debug")) console.log(format("debug", message));
  },
  info(message: string) {
    if (shouldLog("info")) console.log(format("info", message));
  },
  warn(message: string) {
    if (shouldLog("warn")) console.warn(format("warn", message));
  },
  error(message: string) {
    if (shouldLog("error")) console.error(format("error", message));
  },
};
