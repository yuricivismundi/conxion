// Token expiry and refresh management

/**
 * Token validation and expiry handling
 * Ensures tokens are fresh and valid before use
 */

export type TokenInfo = {
  accessToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  issuedAt: number;
  refreshToken?: string;
};

/**
 * Check if token is expired or about to expire
 * Considers token expired if less than 5 minutes remaining
 */
export function isTokenExpired(token: TokenInfo, bufferMs = 5 * 60 * 1000): boolean {
  const now = Date.now();
  const timeRemaining = token.expiresAt - now;
  return timeRemaining < bufferMs;
}

/**
 * Get token age in milliseconds
 */
export function getTokenAge(token: TokenInfo): number {
  return Date.now() - token.issuedAt;
}

/**
 * Validate token before use
 */
export function validateToken(token: TokenInfo | null | undefined, context: string): TokenInfo {
  if (!token) {
    throw new Error(`No token available in ${context}`);
  }

  if (isTokenExpired(token)) {
    throw new Error(`Token expired in ${context}`);
  }

  if (token.accessToken.length === 0) {
    throw new Error(`Invalid token in ${context}`);
  }

  return token;
}

/**
 * Supabase token expiry handling patterns
 *
 * IMPORTANT: Supabase sessions auto-refresh on the client side
 * But API routes (server-side) need manual token management
 *
 * For API routes receiving Bearer tokens:
 * 1. Validate the token exists
 * 2. Validate the token with supabase.auth.getUser()
 * 3. If error, consider token expired (Supabase will reject it)
 */

export const TOKEN_EXPIRY_CHECKLIST = {
  description: "Verify all token operations handle expiry correctly",
  serverSide: [
    {
      file: "app/api/*/route.ts",
      check: "Every endpoint should validate token with supabase.auth.getUser()",
      pattern: `
        const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
        if (authErr || !authData.user) {
          return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
        }
      `,
    },
    {
      file: "lib/auth-middleware",
      check: "Middleware should reject requests without valid Authorization header",
      pattern: 'const token = req.headers.get("authorization")?.replace("Bearer ", "");',
    },
  ],
  clientSide: [
    {
      file: "app/messages/page.tsx", // or main page
      check: "Should use useEffect to refresh session on load",
      pattern: `
        useEffect(() => {
          const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'TOKEN_REFRESHED') {
              // Token was auto-refreshed by Supabase
              setToken(session?.access_token);
            }
            if (event === 'SIGNED_OUT') {
              setToken(null);
            }
          });
          return () => subscription?.unsubscribe();
        }, []);
      `,
    },
    {
      file: "lib/supabase/client.ts",
      check: "Client should have auto-refresh enabled (default)",
      pattern: "autoRefreshToken: true, // default in Supabase JS SDK",
    },
  ],
  criticalPaths: [
    {
      endpoint: "POST /api/activities",
      issue: "Token must be validated before accessing user data",
      check: "Calls supabase.auth.getUser(token)?",
    },
    {
      endpoint: "POST /api/messages/send",
      issue: "Token must be valid for message operations",
      check: "Calls supabase.auth.getUser(token)?",
    },
    {
      endpoint: "GET /api/*",
      issue: "All protected endpoints must validate token",
      check: "Validates token exists and is fresh?",
    },
  ],
};

/**
 * Example: Secure API route with token validation
 *
 * ✅ CORRECT
 * export async function POST(req: Request) {
 *   const token = getBearerToken(req);
 *   if (!token) return jsonError("Missing token", 401);
 *
 *   const userClient = getSupabaseUserClient(token);
 *   const { data: authData, error: authErr } = await userClient.auth.getUser(token);
 *   if (authErr || !authData?.user) {
 *     return jsonError("Invalid/expired token", 401);
 *   }
 *
 *   // Now safe to use authData.user.id
 * }
 *
 * ❌ WRONG - Doesn't validate token
 * export async function POST(req: Request) {
 *   const token = getBearerToken(req);
 *   // Uses token without validation - could be expired!
 * }
 */
