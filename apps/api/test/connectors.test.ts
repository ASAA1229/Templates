import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CONNECTOR_CONTRACT_VERSION,
  ConnectorManager,
  EnvCredentialProvider,
  redact,
  type CredentialProvider,
} from "../src/integrations/connectors.js";
import { JenkinsConnector, NexusConnector } from "../src/integrations/http-connectors.js";
import { MockBuildConnector, MockRegistryConnector } from "../src/integrations/mock-connectors.js";

/** RG-12: provider-independent connector contracts, guarded manager, and HTTP adapters against fake servers. */
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const SECRET = "s3cr3t-token-value";
const credentials: CredentialProvider = new EnvCredentialProvider({
  TEST_JENKINS: `ci:${SECRET}`,
  TEST_NEXUS: `nx:${SECRET}`,
});

type Event = { connectorId: string; action: string; outcome: string; actor: string; detail?: string };

describe("connector manager", () => {
  let events: Event[];
  let manager: ConnectorManager;
  let build: MockBuildConnector;
  let registry: MockRegistryConnector;
  beforeEach(() => {
    events = [];
    manager = new ConnectorManager(credentials, (event) => void events.push(event));
    build = new MockBuildConnector();
    registry = new MockRegistryConnector();
    manager.register("jenkins-main", build, { jobs: ["web-build"] }, "TEST_JENKINS");
    manager.register("nexus-main", registry, { repositories: ["templates"] }, "TEST_NEXUS");
  });

  it("runs build and registry operations with approval, scope and audit", async () => {
    const approved = { actor: "owner", approvedBy: "owner" };
    const { buildId } = await manager.trigger(
      "jenkins-main",
      { job: "web-build", parameters: { branch: "new/x" } },
      approved,
    );
    expect((await manager.status("jenkins-main", "web-build", buildId, { actor: "dev" })).state).toBe("RUNNING");
    expect((await manager.status("jenkins-main", "web-build", buildId, { actor: "dev" })).state).toBe("SUCCESS");

    const content = Buffer.from("artifact bytes");
    await manager.publish(
      "nexus-main",
      { repository: "templates", path: "a/b-1.0.0.zip" },
      content,
      sha(content),
      approved,
    );
    expect(
      (
        await manager.fetch("nexus-main", { repository: "templates", path: "a/b-1.0.0.zip" }, { actor: "dev" })
      ).content.equals(content),
    ).toBe(true);
    expect(await manager.list("nexus-main", "templates", "a/", { actor: "dev" })).toEqual(["a/b-1.0.0.zip"]);
    expect(events.filter((event) => event.outcome === "SUCCESS").map((event) => event.action)).toEqual(
      expect.arrayContaining(["connector.build.trigger", "connector.registry.publish", "connector.registry.fetch"]),
    );
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  it("denies consequential actions without an approver and targets outside the granted scope", async () => {
    await expect(manager.trigger("jenkins-main", { job: "web-build" }, { actor: "dev" })).rejects.toThrow(
      /explicit approver/,
    );
    await expect(
      manager.trigger("jenkins-main", { job: "prod-deploy" }, { actor: "o", approvedBy: "o" }),
    ).rejects.toThrow(/outside/);
    const content = Buffer.from("x");
    await expect(
      manager.publish("nexus-main", { repository: "other", path: "x" }, content, sha(content), {
        actor: "o",
        approvedBy: "o",
      }),
    ).rejects.toThrow(/outside/);
    expect(events.filter((event) => event.outcome === "DENIED")).toHaveLength(3);
    // Scopes are explicit: an unscoped connector can do nothing.
    manager.register("unscoped", new MockBuildConnector(), {}, "TEST_JENKINS");
    await expect(manager.status("unscoped", "web-build", "1", { actor: "dev" })).rejects.toThrow(/outside/);
  });

  it("enforces contract version, capabilities, credentials and revocation", async () => {
    build.contract = CONNECTOR_CONTRACT_VERSION + 1;
    await expect(manager.status("jenkins-main", "web-build", "1", { actor: "d" })).rejects.toThrow(/contract/);
    build.contract = CONNECTOR_CONTRACT_VERSION;
    build.capabilities = ["status"];
    await expect(
      manager.trigger("jenkins-main", { job: "web-build" }, { actor: "o", approvedBy: "o" }),
    ).rejects.toThrow(/does not support trigger/);
    manager.register("no-credential", new MockBuildConnector(), { jobs: ["j"] }, "TEST_MISSING");
    await expect(manager.status("no-credential", "j", "1", { actor: "d" })).rejects.toThrow(
      /credential is not configured/,
    );
    expect((await manager.health("no-credential", "d")).status).toBe("misconfigured");
    await expect(manager.fetch("jenkins-main", { repository: "templates", path: "x" }, { actor: "d" })).rejects.toThrow(
      /not a ARTIFACT_REGISTRY/,
    );

    build.capabilities = ["trigger", "status", "cancel"];
    await manager.revoke("jenkins-main", "owner");
    await expect(manager.status("jenkins-main", "web-build", "1", { actor: "d" })).rejects.toThrow(/revoked/);
    expect((await manager.health("jenkins-main", "d")).ok).toBe(false);
    expect(events.some((event) => event.action === "connector.revoke")).toBe(true);
  });

  it("times out, redacts secrets from failures and never leaks credentials", async () => {
    build.status = async () => {
      throw new Error(
        `upstream said Authorization: Basic ${Buffer.from(`ci:${SECRET}`).toString("base64")} and ${SECRET}`,
      );
    };
    const failure = await manager
      .status("jenkins-main", "web-build", "1", { actor: "d" })
      .catch((error: Error) => error);
    expect((failure as Error).message).not.toContain(SECRET);
    expect((failure as Error).message).toContain("[redacted]");
    expect(JSON.stringify(events)).not.toContain(SECRET);
    build.status = () => new Promise(() => undefined);
    await expect(manager.status("jenkins-main", "web-build", "1", { actor: "d", timeoutMs: 50 })).rejects.toThrow(
      /did not respond/,
    );
    expect(redact(`token ${SECRET}`, [SECRET])).toBe("token [redacted]");
    expect(new EnvCredentialProvider({ lower: "x" }).get("lower")).toBeUndefined();
  });

  it("makes registry artifacts immutable and verifies checksums", async () => {
    const approved = { actor: "o", approvedBy: "o" };
    const ref = { repository: "templates", path: "pkg/1.0.0.zip" };
    const first = Buffer.from("one");
    await manager.publish("nexus-main", ref, first, sha(first), approved);
    await manager.publish("nexus-main", ref, first, sha(first), approved);
    const other = Buffer.from("two");
    await expect(manager.publish("nexus-main", ref, other, sha(other), approved)).rejects.toThrow(/immutable/);
    await expect(manager.publish("nexus-main", ref, first, sha(other), approved)).rejects.toThrow(/Checksum/);
  });
});

describe("HTTP adapters against protocol-faithful fake servers", () => {
  let jenkins: Server;
  let nexus: Server;
  let jenkinsUrl: string;
  let nexusUrl: string;
  const seen: { path: string; auth: string | undefined; crumb: string | undefined }[] = [];
  const blobs = new Map<string, Buffer>();
  let hang = false;

  const read = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });
  const expectedAuth = (user: string) => `Basic ${Buffer.from(`${user}:${SECRET}`).toString("base64")}`;

  beforeAll(async () => {
    jenkins = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "";
      seen.push({
        path: url,
        auth: req.headers.authorization,
        crumb: req.headers["jenkins-crumb"] as string | undefined,
      });
      if (hang) return;
      if (req.headers.authorization !== expectedAuth("ci")) {
        res.writeHead(401).end();
        return;
      }
      if (url.startsWith("/crumbIssuer")) {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ crumbRequestField: "Jenkins-Crumb", crumb: "abc123" }));
      } else if (url.startsWith("/api/json")) {
        res.writeHead(200, { "x-jenkins": "2.462.1", "content-type": "application/json" }).end("{}");
      } else if (req.method === "POST" && url.startsWith("/job/web-build/buildWithParameters")) {
        if (req.headers["jenkins-crumb"] !== "abc123") return void res.writeHead(403).end();
        const body = (await read(req)).toString();
        res
          .writeHead(body.includes("branch=new%2Fx") ? 201 : 400, { location: `http://127.0.0.1/queue/item/42/` })
          .end();
      } else if (url.startsWith("/queue/item/42/api/json")) {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ executable: { number: 7, url: "http://x/job/web-build/7/" } }));
      } else if (url.startsWith("/job/web-build/7/api/json")) {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ building: false, result: "SUCCESS", url: "http://x/job/web-build/7/" }));
      } else if (req.method === "POST" && url.startsWith("/queue/cancelItem?id=42")) {
        res.writeHead(302, { location: "/" }).end();
      } else if (url.startsWith("/redirect")) {
        res.writeHead(302, { location: "http://evil.example/" }).end();
      } else res.writeHead(404).end();
    });
    nexus = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "", "http://x");
      if (req.headers.authorization !== expectedAuth("nx")) return void res.writeHead(401).end();
      if (url.pathname === "/service/rest/v1/status") return void res.writeHead(200, { server: "Nexus/3.70" }).end();
      if (url.pathname.startsWith("/repository/")) {
        const key = decodeURIComponent(url.pathname.slice("/repository/".length));
        if (req.method === "PUT") {
          blobs.set(key, await read(req));
          return void res.writeHead(201).end();
        }
        const blob = blobs.get(key);
        return void (blob ? res.writeHead(200).end(blob) : res.writeHead(404).end());
      }
      if (url.pathname === "/service/rest/v1/assets") {
        const all = [...blobs.keys()].map((path) => path.slice(path.indexOf("/") + 1)).sort();
        const page = url.searchParams.get("continuationToken") === "p2" ? all.slice(1) : all.slice(0, 1);
        const token = url.searchParams.get("continuationToken") === "p2" || all.length < 2 ? null : "p2";
        return void res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ items: page.map((path) => ({ path })), continuationToken: token }));
      }
      res.writeHead(404).end();
    });
    await Promise.all(
      [jenkins, nexus].map((server) => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))),
    );
    jenkinsUrl = `http://127.0.0.1:${(jenkins.address() as AddressInfo).port}`;
    nexusUrl = `http://127.0.0.1:${(nexus.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await Promise.all([jenkins, nexus].map((server) => new Promise((resolve) => server.close(resolve))));
  });

  it("Jenkins: health, crumb, parameterised trigger, status and cancel with Basic auth", async () => {
    const connector = new JenkinsConnector({ baseUrl: jenkinsUrl, credentialRef: "TEST_JENKINS", credentials });
    expect(await connector.health()).toMatchObject({ ok: true, status: "up", version: "2.462.1" });
    const { buildId } = await connector.trigger({ job: "web-build", parameters: { branch: "new/x" } });
    expect(buildId).toBe("queue:42");
    expect(await connector.status("web-build", buildId)).toMatchObject({ state: "RUNNING" });
    expect(await connector.status("web-build", "7")).toMatchObject({ state: "SUCCESS" });
    await connector.cancel("web-build", buildId);
    expect(seen.every((entry) => entry.auth === expectedAuth("ci"))).toBe(true);
    expect(
      seen.some((entry) => entry.path.startsWith("/job/web-build/buildWithParameters") && entry.crumb === "abc123"),
    ).toBe(true);
  });

  it("Jenkins: maps 401 to unauthorized, refuses redirects, bad job names and timeouts", async () => {
    const wrong = new JenkinsConnector({
      baseUrl: jenkinsUrl,
      credentialRef: "TEST_NEXUS",
      credentials: new EnvCredentialProvider({ TEST_NEXUS: "ci:wrong" }),
    });
    expect((await wrong.health()).status).toBe("unauthorized");
    const missing = new JenkinsConnector({ baseUrl: jenkinsUrl, credentialRef: "TEST_ABSENT", credentials });
    expect((await missing.health()).status).toBe("misconfigured");
    const connector = new JenkinsConnector({ baseUrl: jenkinsUrl, credentialRef: "TEST_JENKINS", credentials });
    await expect(connector.trigger({ job: "../admin" })).rejects.toThrow(/Invalid job name/);
    hang = true;
    const slow = new JenkinsConnector({
      baseUrl: jenkinsUrl,
      credentialRef: "TEST_JENKINS",
      credentials,
      timeoutMs: 100,
    });
    expect((await slow.health()).status).toBe("down");
    hang = false;
    expect(
      () => new JenkinsConnector({ baseUrl: "http://jenkins.example.com", credentialRef: "X", credentials }),
    ).toThrow(/https/);
    expect(
      () => new JenkinsConnector({ baseUrl: "https://user:pw@jenkins.example.com", credentialRef: "X", credentials }),
    ).toThrow(/credentials/);
  });

  it("Nexus: publish with read-after-write verification, immutability, fetch and paged listing", async () => {
    const connector = new NexusConnector({ baseUrl: nexusUrl, credentialRef: "TEST_NEXUS", credentials });
    expect((await connector.health()).status).toBe("up");
    const content = Buffer.from("template archive");
    const ref = { repository: "templates", path: "restaurant/1.0.0.zip" };
    const published = await connector.publish(ref, content, sha(content));
    expect(published.url).toBe(`${nexusUrl}/repository/templates/restaurant/1.0.0.zip`);
    expect((await connector.fetch(ref)).sha256).toBe(sha(content));
    // Same content again is idempotent; different content is refused.
    await connector.publish(ref, content, sha(content));
    const changed = Buffer.from("tampered");
    await expect(connector.publish(ref, changed, sha(changed))).rejects.toThrow(/different content/);
    await expect(connector.publish(ref, changed, sha(content))).rejects.toThrow(/checksum does not match/);
    await connector.publish({ repository: "templates", path: "retail/1.0.0.zip" }, changed, sha(changed));
    expect(await connector.list("templates", "")).toEqual(["restaurant/1.0.0.zip", "retail/1.0.0.zip"]);
    await expect(connector.fetch({ repository: "templates", path: "missing.zip" })).rejects.toThrow(/not found/);
    await expect(connector.fetch({ repository: "templates", path: "../../etc/passwd" })).rejects.toThrow(
      /Invalid artifact path/,
    );
  });

  it("works through the manager end to end with scoped, approved calls", async () => {
    const events: Event[] = [];
    const manager = new ConnectorManager(credentials, (event) => void events.push(event));
    manager.register(
      "jenkins",
      new JenkinsConnector({ baseUrl: jenkinsUrl, credentialRef: "TEST_JENKINS", credentials }),
      { jobs: ["web-build"] },
      "TEST_JENKINS",
    );
    const { buildId } = await manager.trigger(
      "jenkins",
      { job: "web-build", parameters: { branch: "new/x" } },
      { actor: "owner", approvedBy: "owner" },
    );
    expect(buildId).toBe("queue:42");
    await expect(
      manager.trigger("jenkins", { job: "deploy-prod" }, { actor: "owner", approvedBy: "owner" }),
    ).rejects.toThrow(/outside/);
    expect(events.map((event) => event.outcome)).toEqual(["SUCCESS", "DENIED"]);
  });
});
