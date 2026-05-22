import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Allowed origins by environment
const ALLOWED_ORIGINS = {
  production: [
    'https://conxion.app',
    'https://www.conxion.app',
  ],
  staging: [
    'https://staging.conxion.app',
    'http://localhost:3000',
  ],
  development: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8081', // Capacitor
  ],
};

function getAllowedOrigins(): string[] {
  const env = process.env.NODE_ENV;
  if (env === 'production') {
    return ALLOWED_ORIGINS.production;
  }
  if (env === 'staging') {
    return ALLOWED_ORIGINS.staging;
  }
  return ALLOWED_ORIGINS.development;
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return getAllowedOrigins().includes(origin);
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
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

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match API routes and all other routes except static assets
    '/((?!_next/static|_next/image|favicon.ico|branding/).*)',
  ],
};
