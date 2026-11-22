import { connectorPublishSchema, connectorTriggerSchema, type ConnectorView } from "@asaa/contracts";
import { Router, type Request } from "express";
import type { AppContext } from "../../context.js";
import {
  ConnectorManager,
  EnvCredentialProvider,
  type CallOptions,
  type ConnectorScope,
  type CredentialProvider,
} from "../../integrations/connectors.js";
import { JenkinsConnector, NexusConnector } from "../../integrations/http-connectors.js";
import { MockBuildConnector, MockRegistryConnector } from "../../integrations/mock-connectors.js";
import { notFound, validationFailed } from "../../lib/errors.js";
import { audit } from "../audit/audit.service.js";
import { authorize } from "../auth/policy.js";
import { buildArchive } from "../delivery/delivery.js";
import { loadProjectAccess } from "../projects/projects.js";

const csv = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

interface Registered {
  label: string;
  origin: ConnectorView["origin"];
}

export interface ConnectorHub {
  manager: ConnectorManager;
  info: Map<string, Registered>;
}

/**
 * Build the connector registry (D3.20). Local mock connectors for CI and an artifact registry are always present so
 * the workflow is usable offline. Jenkins and Nexus HTTP adapters register only when an owner configures their URL;
 * credentials are read from the environment at call time and never stored. The HTTP adapters have not been exercised
 * against a live Jenkins or Nexus.
 */
export function createConnectorHub(
  ctx: AppContext,
  credentials: CredentialProvider = new EnvCredentialProvider(),
): ConnectorHub {
  const manager = new ConnectorManager(credentials, (event) =>
    audit(ctx, null, {
      action: event.action,
      outcome: event.outcome,
      targetType: "connector",
      targetId: event.connectorId,
      metadata: { actor: event.actor, ...(event.detail ? { detail: event.detail } : {}) },
    }),
  );
  const info = new Map<string, Registered>();
  const add = (
    id: string,
    label: string,
    origin: Registered["origin"],
    connector: Parameters<ConnectorManager["register"]>[1],
    scope: ConnectorScope,
    credentialRef: string | null,
  ) => {
    manager.register(id, connector, scope, credentialRef);
    info.set(id, { label, origin });
  };
  add(
    "local-build",
    "Local build runner (mock)",
    "local-mock",
    new MockBuildConnector(),
    { jobs: ["templates-ci"] },
    null,
  );
  add(
    "local-registry",
    "Local artifact registry (mock)",
    "local-mock",
    new MockRegistryConnector(),
    { repositories: ["templates-artifacts"] },
    null,
  );
  const { CONNECTOR_JENKINS_URL, CONNECTOR_JENKINS_JOBS, CONNECTOR_NEXUS_URL, CONNECTOR_NEXUS_REPOSITORIES } =
    ctx.config;
  if (CONNECTOR_JENKINS_URL) {
    add(
      "jenkins",
      "Jenkins",
      "configured",
      new JenkinsConnector({ baseUrl: CONNECTOR_JENKINS_URL, credentialRef: "JENKINS_TOKEN", credentials }),
      { jobs: csv(CONNECTOR_JENKINS_JOBS) },
      "JENKINS_TOKEN",
    );
  }
  if (CONNECTOR_NEXUS_URL) {
    add(
      "nexus",
      "Nexus Repository",
      "configured",
      new NexusConnector({ baseUrl: CONNECTOR_NEXUS_URL, credentialRef: "NEXUS_TOKEN", credentials }),
      { repositories: csv(CONNECTOR_NEXUS_REPOSITORIES) },
      "NEXUS_TOKEN",
    );
  }
  return { manager, info };
}

const actorOf = (req: Request): CallOptions => ({
  actor: req.owner!.id,
  approvedBy: req.owner!.id,
});

/** Connector operations: read for developers and management, trigger/publish/revoke for management only. */
export function connectorsRouter(ctx: AppContext, hub: ConnectorHub = createConnectorHub(ctx)): Router {
  const router = Router();
  const { manager, info } = hub;

  const describe = (id: string): ConnectorView => {
    if (!info.has(id)) throw notFound("Connector");
    const meta = info.get(id)!;
    const described = manager.describe(id);
    return {
      id,
      label: meta.label,
      kind: described.kind,
      capabilities: described.capabilities,
      scope: described.scope,
      revoked: described.revoked,
      origin: meta.origin,
      health: null,
    };
  };
  const idOf = (req: Request) => {
    const id = String(req.params.id);
    if (!info.has(id)) throw notFound("Connector");
    return id;
  };

  router.get("/", authorize(ctx, "connector:read"), (_req, res) => {
    res.json({ connectors: [...info.keys()].map(describe) });
  });

  router.get("/:id/health", authorize(ctx, "connector:read"), async (req, res, next) => {
    try {
      const id = idOf(req);
      res.json({ health: await manager.health(id, req.owner!.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/builds", authorize(ctx, "connector:operate"), async (req, res, next) => {
    try {
      const id = idOf(req);
      const input = connectorTriggerSchema.parse(req.body);
      const build = await manager.trigger(id, { job: input.job, parameters: input.parameters }, actorOf(req));
      res.status(201).json({ build: { ...build, job: input.job } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/builds/:buildId", authorize(ctx, "connector:read"), async (req, res, next) => {
    try {
      const id = idOf(req);
      const job = typeof req.query.job === "string" ? req.query.job : "";
      if (!job) throw validationFailed({ job: "Provide the job name." });
      res.json({ status: await manager.status(id, job, String(req.params.buildId), actorOf(req)) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/builds/:buildId/cancel", authorize(ctx, "connector:operate"), async (req, res, next) => {
    try {
      const id = idOf(req);
      const { job } = connectorTriggerSchema.pick({ job: true }).parse(req.body);
      await manager.cancel(id, job, String(req.params.buildId), actorOf(req));
      res.json({ cancelled: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:id/artifacts", authorize(ctx, "connector:read"), async (req, res, next) => {
    try {
      const id = idOf(req);
      const repository = typeof req.query.repository === "string" ? req.query.repository : "";
      if (!repository) throw validationFailed({ repository: "Provide the repository." });
      const prefix = typeof req.query.prefix === "string" ? req.query.prefix : undefined;
      res.json({ artifacts: await manager.list(id, repository, prefix, actorOf(req)) });
    } catch (error) {
      next(error);
    }
  });

  /** Publish a project's verified export archive to an artifact registry (management, explicit approver recorded). */
  router.post("/:id/artifacts", authorize(ctx, "connector:operate"), async (req, res, next) => {
    try {
      const id = idOf(req);
      const input = connectorPublishSchema.parse(req.body);
      const project = await loadProjectAccess(ctx, req.owner!.id, input.projectId, "write");
      const built = await buildArchive(ctx, project.id, false);
      const published = await manager.publish(
        id,
        { repository: input.repository, path: input.path },
        built.archive,
        built.sha256,
        actorOf(req),
      );
      await audit(ctx, req, {
        action: "connector.artifact_publish",
        outcome: "SUCCESS",
        targetType: "project",
        targetId: project.id,
        metadata: { connectorId: id, repository: input.repository, path: input.path, sha256: built.sha256 },
      });
      res.status(201).json({ artifact: published });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:id/revoke", authorize(ctx, "connector:operate"), async (req, res, next) => {
    try {
      const id = idOf(req);
      await manager.revoke(id, req.owner!.id);
      res.json({ connector: describe(id) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
