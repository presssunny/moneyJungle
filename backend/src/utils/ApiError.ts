export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = "לא מורשה") {
    return new ApiError(401, message);
  }

  static forbidden(message = "אין הרשאה") {
    return new ApiError(403, message);
  }

  static notFound(message = "לא נמצא") {
    return new ApiError(404, message);
  }

  static conflict(message: string) {
    return new ApiError(409, message);
  }

  static internal(message = "שגיאת שרת פנימית") {
    return new ApiError(500, message);
  }
}
