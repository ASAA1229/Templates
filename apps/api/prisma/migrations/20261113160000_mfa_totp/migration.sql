-- US-A04: TOTP multi-factor authentication state on accounts.
ALTER TABLE "Owner"
  ADD COLUMN "mfaSecretEnc" VARCHAR(512),
  ADD COLUMN "mfaEnabledAt" TIMESTAMPTZ(3),
  ADD COLUMN "mfaRecoveryHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mfaLastStep" INTEGER;
