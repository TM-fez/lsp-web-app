export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly error: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string) {
    return new AppError(400, 'Bad Request', message);
  }

  static unauthorized(message = 'Unauthorized') {
    return new AppError(401, 'Unauthorized', message);
  }

  static forbidden(message = 'Forbidden') {
    return new AppError(403, 'Forbidden', message);
  }

  static notFound(message: string) {
    return new AppError(404, 'Not Found', message);
  }

  static conflict(message: string) {
    return new AppError(409, 'Conflict', message);
  }

  static internal(message = 'Internal Server Error') {
    return new AppError(500, 'Internal Server Error', message);
  }
}
