-- Supports outbox retention: purge DELIVERED/DEAD rows by age and evict the oldest PENDING rows.
CREATE INDEX "AsaaEventOutbox_status_createdAt_idx" ON "AsaaEventOutbox"("status", "createdAt");
