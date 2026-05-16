export const logger = {
  logInfo: (context: string, message: string) => console.log(`[INFO] ${context}: ${message}`),
  logError: (context: string, message: string, data?: any) => console.error(`[ERROR] ${context}: ${message}`, data),
  logWarning: (context: string, message: string) => console.warn(`[WARN] ${context}: ${message}`),
};
