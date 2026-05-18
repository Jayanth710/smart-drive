import logger from "../logger.js";

type EnvRule = { name: string; minLength?: number };

const REQUIRED: EnvRule[] = [
    { name: "MONGO_URI" },
    { name: "JWT_SECRET", minLength: 32 },
    { name: "JWT_REFRESH_SECRET", minLength: 32 },
    { name: "FRONT_END_URL" },
    { name: "GMAIL_USER" },
    { name: "GMAIL_APP_PASSWORD" },
];

/**
 * Fail fast at boot if a required env var is missing or trivially weak.
 * In production: exit on any problem.
 * In development: log warnings but keep going, so iteration isn't blocked
 * by a placeholder secret.
 */
export function validateEnv(): void {
    const problems: string[] = [];

    for (const rule of REQUIRED) {
        const value = process.env[rule.name];
        if (!value) {
            problems.push(`${rule.name} is not set`);
            continue;
        }
        if (rule.minLength && value.length < rule.minLength) {
            problems.push(`${rule.name} is shorter than ${rule.minLength} chars (have ${value.length})`);
        }
    }

    if (process.env.JWT_SECRET && process.env.JWT_REFRESH_SECRET &&
        process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
        problems.push("JWT_SECRET and JWT_REFRESH_SECRET must differ");
    }

    if (problems.length === 0) {
        logger.info("Environment validation passed");
        return;
    }

    const isProd = process.env.NODE_ENV === "production";
    const header = isProd
        ? "Refusing to start. Environment misconfigured:"
        : "Environment misconfigured (dev mode — continuing anyway):";

    logger.error(header);
    for (const p of problems) logger.error(`  - ${p}`);

    if (isProd) {
        process.exit(1);
    }
}
