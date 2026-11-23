-- Additive: optional identity-provider subject link for single sign-on.
ALTER TABLE "Owner" ADD COLUMN "ssoSubject" VARCHAR(255);
CREATE UNIQUE INDEX "Owner_ssoSubject_key" ON "Owner"("ssoSubject");
