// Environment variable validation at startup

export type EnvironmentConfig = {
  // Supabase
  supabaseUrl: string;
  supabaseAnonKey: string;

  // App
  appUrl: string;
  appEnv: "development" | "staging" | "production";

  // Optional: Analytics, monitoring
  sentryDsn?: string;
};

const REQUIRED_ENV_VARS = {
  NEXT_PUBLIC_SUPABASE_URL: "Supabase project URL",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "Supabase anonymous key",
  NEXT_PUBLIC_APP_URL: "Application public URL",
};

const OPTIONAL_ENV_VARS = {
  NEXT_PUBLIC_SENTRY_DSN: "Sentry error tracking DSN",
  LOG_LEVEL: "Logging level (debug, info, warn, error)",
};

export function validateEnvironment(): EnvironmentConfig {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  Object.entries(REQUIRED_ENV_VARS).forEach(([key, description]) => {
    if (!process.env[key]) {
      errors.push(`Missing required environment variable: ${key} (${description})`);
    }
  });

  // Check optional variables
  Object.entries(OPTIONAL_ENV_VARS).forEach(([key, description]) => {
    if (!process.env[key]) {
      warnings.push(`Missing optional environment variable: ${key} (${description})`);
    }
  });

  // Fail fast if required vars missing
  if (errors.length > 0) {
    const message = `Environment validation failed:\n${errors.join("\n")}`;
    console.error(message);
    throw new Error(message);
  }

  // Log warnings
  if (warnings.length > 0) {
    console.warn(`Environment warnings:\n${warnings.join("\n")}`);
  }

  // Validate URL formats
  try {
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  } catch {
    throw new Error("Invalid NEXT_PUBLIC_SUPABASE_URL format");
  }

  try {
    new URL(process.env.NEXT_PUBLIC_APP_URL!);
  } catch {
    throw new Error("Invalid NEXT_PUBLIC_APP_URL format");
  }

  // Validate Sentry DSN if provided
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    try {
      new URL(process.env.NEXT_PUBLIC_SENTRY_DSN);
    } catch {
      throw new Error("Invalid NEXT_PUBLIC_SENTRY_DSN format");
    }
  }

  const appEnv = (process.env.NODE_ENV as any) || "development";
  if (!["development", "staging", "production"].includes(appEnv)) {
    throw new Error(`Invalid NODE_ENV: ${appEnv}`);
  }

  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    appUrl: process.env.NEXT_PUBLIC_APP_URL!,
    appEnv: appEnv as any,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  };
}

// Validate at module load time (server-side only)
if (typeof window === "undefined") {
  try {
    validateEnvironment();
    console.log("✓ Environment validation passed");
  } catch (error) {
    console.error("✗ Environment validation failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
