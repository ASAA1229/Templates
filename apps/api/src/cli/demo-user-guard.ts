import { PASSWORD_MAX, PASSWORD_MIN, loginSchema, passwordSchema } from "@asaa/contracts";

/** Pure checks for the development-only demo account seed. Nothing here ever returns or logs the password. */
export const PASSWORD_POLICY = `${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`;

export const TEST_DATA_LABEL = "TEMPORARY / TEST DATA";
export const SEED_DISPLAY_NAME = `Demo Owner – ${TEST_DATA_LABEL}`;
/** Stored in the seed's audit events so the seed can recognise (and only ever touch) the account it created. */
export const SEED_DATA_CLASS = "TEMPORARY_TEST_DATA";

const ENV_MESSAGE = "The demo account seed runs only when NODE_ENV or APP_ENV is explicitly development or test.";

/** An explicit NODE_ENV/APP_ENV of development or test is required: unset values are refused, and any other value always wins. */
export function assertDevelopmentEnvironment(env: NodeJS.ProcessEnv): void {
  const values = [env.APP_ENV, env.NODE_ENV]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  if (values.length === 0 || values.some((value) => value !== "development" && value !== "test"))
    throw new Error(ENV_MESSAGE);
}

/** The seed may only update an account it created itself (recorded by its own demo_user.create audit event). */
export function assertSeedOwnedAccount(email: string, createdBySeed: boolean): void {
  if (!createdBySeed) {
    throw new Error(
      `An account for ${email} already exists and is not the demo seed's ${TEST_DATA_LABEL} account. The seed never modifies such accounts: choose another DEMO_USER_EMAIL.`,
    );
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
