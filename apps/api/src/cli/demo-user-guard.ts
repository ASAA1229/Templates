import { PASSWORD_MAX, PASSWORD_MIN, loginSchema, passwordSchema } from "@asaa/contracts";

/** Pure checks for the development-only demo account seed. Nothing here ever returns or logs the password. */
export const PASSWORD_POLICY = `${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`;

export function assertDevelopmentEnvironment(env: NodeJS.ProcessEnv): void {
  const mode = (env.APP_ENV ?? env.NODE_ENV ?? "development").trim().toLowerCase();
  if (mode !== "development" && mode !== "test") {
    throw new Error("The demo account seed runs only when NODE_ENV/APP_ENV is development or test.");
  }
  // An explicit APP_ENV or NODE_ENV that says production/staging always wins, whichever one is set.
  for (const value of [env.APP_ENV, env.NODE_ENV]) {
    const normalized = value?.trim().toLowerCase();
    if (normalized && normalized !== "development" && normalized !== "test") {
      throw new Error("The demo account seed runs only when NODE_ENV/APP_ENV is development or test.");
    }
  }
}

export function readDemoCredentials(env: NodeJS.ProcessEnv): { email: string; password: string } {
  const rawEmail = env.DEMO_USER_EMAIL?.trim();
  const password = env.DEMO_USER_PASSWORD;
  if (!rawEmail || !password) {
    throw new Error(
      "Set DEMO_USER_EMAIL and DEMO_USER_PASSWORD in the environment or in the git-ignored apps/api/.env.",
    );
  }
  const email = loginSchema.shape.email.safeParse(rawEmail);
  if (!email.success) throw new Error("DEMO_USER_EMAIL is not a valid email address.");
  if (!passwordSchema.safeParse(password).success) {
    throw new Error(`DEMO_USER_PASSWORD does not meet the password policy: ${PASSWORD_POLICY}`);
  }
  return { email: email.data, password };
}
