declare namespace Express {
  interface Request {
    validated?: {
      body?: unknown;
      query?: unknown;
      params?: unknown;
    };
    /**
     * All set together by gateAuth.middleware.ts, from the authenticated
     * session's actual owner — never from anything the client supplied.
     * `userId` is the field every existing module already reads for
     * ownership scoping; the rest are additions for RBAC (requireRole
     * middleware, the CRM, session response).
     */
    userId?: number;
    userRole?: "ADMIN" | "USER" | "VIEWER";
    userEmail?: string;
    userDisplayName?: string;
  }
}
