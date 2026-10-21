import { NextResponse, type NextRequest } from "next/server";

// Allowed origins by environment
const ALLOWED_ORIGINS = {
  production: [
    'https://conxion.social',
    'https://www.conxion.social',
    'https://conxion.vercel.app',
  ],
  staging: [
    'https://staging.conxion.social',
    'http://localhost:3000',
  ],
  development: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8081', // Capacitor
  ],
};

function getAllowedOrigins(): string[] {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  if (env === 'production') {
    return ALLOWED_ORIGINS.production;
  }
  if (env === 'preview' || env === 'staging') {
    return ALLOWED_ORIGINS.staging;
  }
  return ALLOWED_ORIGINS.development;
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return getAllowedOrigins().includes(origin);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get('origin');

  // 1. HTTPS enforcement (redirect HTTP to HTTPS in production)
  if (process.env.NODE_ENV === 'production' && request.nextUrl.protocol === 'http:') {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    return NextResponse.redirect(url);
  }

  // 2. CORS validation for API routes
  if (pathname.startsWith('/api/')) {
    // Validate origin on state-changing requests
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method)) {
      if (origin && !isOriginAllowed(origin)) {
        console.error(`[cors] Rejected request from disallowed origin: ${origin}`);
        return NextResponse.json(
          { ok: false, error: 'CORS policy violation' },
          { status: 403 }
        );
      }
    }

    // Add CORS headers to response if origin is allowed
    if (origin && isOriginAllowed(origin)) {
      const response = NextResponse.next();
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Max-Age', '86400');
      return response;
    }

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': origin && isOriginAllowed(origin) ? origin : 'null',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
  }

  // Profiles always open the social page. The Dance Page has its own link
  // (/u/<username>/dance), so there is no profile → Dance Page redirect anymore.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/profile/:path*",
    "/u/:path*",
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|branding/).*)",
  ],
};
