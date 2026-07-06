declare namespace Express {
  interface Request {
    validated?: {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };
    userId?: number;
  }
}
