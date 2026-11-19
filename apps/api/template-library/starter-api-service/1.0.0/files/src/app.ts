import express from "express";
import helmet from "helmet";

export const SERVICE_NAME = "{{projectName}}";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: SERVICE_NAME });
  });
  return app;
}
