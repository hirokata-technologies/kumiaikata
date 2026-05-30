// Re-export from the shared package so that all AppError instances across the
// codebase are the same class. Without this, local AppErrors thrown by
// middleware would fail the `instanceof AppError` check in the @kata/http
// errorHandler (two different class objects despite identical code).
export { AppError, errorHandler } from "@kata/http";
export type { ErrorCode } from "@kata/http";
