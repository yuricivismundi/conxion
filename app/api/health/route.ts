import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type HealthStatus = "healthy" | "degraded" | "unhealthy";

type HealthResponse = {
  status: HealthStatus;
  timestamp: string;
  checks: {
    database: { status: HealthStatus; latencyMs?: number; error?: string };
    environment: { status: HealthStatus; error?: string };
  };
};

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const startTime = Date.now();
  const checks = {
    database: { status: "healthy" as HealthStatus },
    environment: { status: "healthy" as HealthStatus },
  };

  // Check database connectivity
  try {
    const service = getSupabaseServiceClient();
    const dbStartTime = Date.now();

    const { data, error } = await service.from("profiles").select("id", { head: true, count: "exact" }).limit(1);

    const latencyMs = Date.now() - dbStartTime;

    if (error) {
      checks.database = {
        status: "unhealthy",
        latencyMs,
        error: error.message,
      };
    } else {
      checks.database = {
        status: "healthy",
        latencyMs,
      };
    }
  } catch (err) {
    checks.database = {
      status: "unhealthy",
      error: err instanceof Error ? err.message : "Unknown database error",
    };
  }

  // Check environment variables
  try {
    const requiredEnvVars = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_APP_URL",
    ];

    const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

    if (missingVars.length > 0) {
      checks.environment = {
        status: "unhealthy",
        error: `Missing environment variables: ${missingVars.join(", ")}`,
      };
    }
  } catch (err) {
    checks.environment = {
      status: "unhealthy",
      error: err instanceof Error ? err.message : "Unknown environment error",
    };
  }

  // Determine overall status
  const allHealthy = Object.values(checks).every((c) => c.status === "healthy");
  const anyUnhealthy = Object.values(checks).some((c) => c.status === "unhealthy");

  const overallStatus: HealthStatus = anyUnhealthy ? "unhealthy" : allHealthy ? "healthy" : "degraded";

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
  };

  // Return 200 if healthy, 503 if unhealthy, 200 with degraded if degraded
  const statusCode = overallStatus === "unhealthy" ? 503 : 200;

  return NextResponse.json(response, { status: statusCode });
}
