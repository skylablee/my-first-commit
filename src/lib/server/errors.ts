export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError(
    "INTERNAL_ERROR",
    "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    500,
  );
}
