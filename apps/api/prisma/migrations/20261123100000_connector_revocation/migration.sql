-- Durable connector revocation state (additive).
CREATE TABLE "ConnectorRevocation" (
  "connectorId" VARCHAR(40) NOT NULL,
  "revokedById" UUID,
  "revokedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorRevocation_pkey" PRIMARY KEY ("connectorId")
);
