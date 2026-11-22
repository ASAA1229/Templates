import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { branchNameProblem } from "@asaa/contracts";
import { notEligible } from "../../lib/errors.js";
import { unsafeEntryName } from "../export/zip.js";
import { GitClient } from "../workspace/git.js";

/**
 * Provider-independent delivery interfaces (D3.13 repository handoff, D3.14 deployment).
 * The platform only talks to these interfaces. The built-in implementations are local: they write under the
 * configured delivery directory and never contact GitHub or a deployment platform. An external adapter can be
 * registered later by the owner without changing the delivery workflow, approvals or audit trail.
 */
export interface ProviderDescriptor {
  id: string;
  label: string;
  /** True only for adapters that talk to an external service. Built-in providers are always false. */
  external: boolean;
  /** False when the adapter is known but cannot be used (not registered or not approved). */
  available: boolean;
  note: string;
}

export interface HandoffFile {
  path: string;
  content: Buffer;
}

export interface RepositoryHostProvider extends ProviderDescriptor {
  createRepository(input: {
    name: string;
    description: string;
    files: HandoffFile[];
    defaultBranch: string;
    author: { name: string; email: string };
  }): Promise<{ location: string; commit: string; defaultBranch: string; fileCount: number }>;
}

export interface DeploymentProvider extends ProviderDescriptor {
  environments: readonly string[];
  deploy(input: {
    projectKey: string;
    environment: string;
    archive: Buffer;
    archiveSha256: string;
  }): Promise<{ location: string; sha256: string; release: string; previousRelease: string | null }>;
}

export const REPOSITORY_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,59}$/;
const PROJECT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9-]{1,19}$/;

/** Planned external adapters are listed for discovery but unavailable until an owner-approved adapter exists. */
export const PLANNED_EXTERNAL_PROVIDERS: ProviderDescriptor[] = [
  {
    id: "github",
    label: "GitHub",
    external: true,
    available: false,
    note: "Planned. Requires owner approval, an approved credential reference and a registered adapter. The platform never calls GitHub today.",
  },
  {
    id: "external-deploy",
    label: "External deployment platform",
    external: true,
    available: false,
    note: "Planned. Requires an owner-approved target and adapter; none is registered.",
  },
];

/** Creates an independent local Git repository (initial commit) under <deliveryDir>/repositories/<name>. */
export class LocalRepositoryHost implements RepositoryHostProvider {
  readonly id = "local-git-host";
  readonly label = "Local repository host";
  readonly external = false;
  readonly available = true;
  readonly note =
    "Creates a new independent Git repository on this machine under the delivery folder. Nothing is pushed anywhere.";
  private readonly root: string;
  private readonly git: GitClient;

  constructor(deliveryDir: string, gitExecutable: string, gitTimeoutMs: number, git?: GitClient) {
    this.root = path.join(deliveryDir, "repositories");
    this.git = git ?? new GitClient(gitExecutable, gitTimeoutMs, this.root);
  }

  async createRepository(input: Parameters<RepositoryHostProvider["createRepository"]>[0]) {
    if (!REPOSITORY_NAME_PATTERN.test(input.name))
      throw notEligible("Use a lowercase repository name (2-60 characters).");
    if (branchNameProblem(input.defaultBranch)) throw notEligible("Invalid default branch name.");
    if (input.files.length === 0) throw notEligible("There are no files to hand off.");
    await mkdir(this.root, { recursive: true });
    const destination = path.join(this.root, input.name);
    if (await lstat(destination).catch(() => null))
      throw notEligible(`A repository named "${input.name}" already exists.`);
    const staging = path.join(this.root, `.tmp-${input.name}-${process.pid}-${Date.now()}`);
    try {
      for (const file of input.files) {
        const reason = unsafeEntryName(file.path);
        if (reason) throw notEligible(`${file.path}: ${reason}`);
        const target = path.join(staging, ...file.path.split("/"));
        if (!path.resolve(target).startsWith(path.resolve(staging) + path.sep)) throw notEligible("Unsafe file path.");
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.content, { flag: "wx", mode: 0o644 });
      }
      await this.git.init(staging, input.defaultBranch);
      await this.git.run(staging, ["config", "--local", "user.name", input.author.name]);
      await this.git.run(staging, ["config", "--local", "user.email", input.author.email]);
      await this.git.run(staging, ["add", "--all"]);
      await this.git.run(staging, [
        "commit",
        "--quiet",
        "--no-verify",
        "-m",
        `Initial handoff of ${input.name}${input.description ? `: ${input.description.slice(0, 100)}` : ""}`,
      ]);
      const head = await this.git.run(staging, ["rev-parse", "HEAD"]);
      await rename(staging, destination);
      return {
        location: destination,
        commit: head.stdout.trim(),
        defaultBranch: input.defaultBranch,
        fileCount: input.files.length,
      };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
}

/** Writes an immutable release bundle per environment under <deliveryDir>/deployments and keeps a current pointer. */
export class LocalDeploymentTarget implements DeploymentProvider {
  readonly id = "local-bundle";
  readonly label = "Local release bundles";
  readonly external = false;
  readonly available = true;
  readonly note =
    "Stores a verified release bundle (ZIP) per environment on this machine and tracks the current and previous release. Nothing is deployed to a remote host.";
  readonly environments = ["staging", "production"] as const;
  private readonly root: string;

  constructor(deliveryDir: string) {
    this.root = path.join(deliveryDir, "deployments");
  }

  async deploy(input: Parameters<DeploymentProvider["deploy"]>[0]) {
    if (!PROJECT_KEY_PATTERN.test(input.projectKey)) throw notEligible("Invalid project key.");
    if (!(this.environments as readonly string[]).includes(input.environment)) {
      throw notEligible(`Unknown environment "${input.environment}".`);
    }
    const actual = createHash("sha256").update(input.archive).digest("hex");
    if (actual !== input.archiveSha256) throw notEligible("The release bundle failed its checksum verification.");
    const dir = path.join(this.root, input.projectKey.toLowerCase(), input.environment);
    await mkdir(dir, { recursive: true });
    const release = `${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}-${actual.slice(0, 12)}`;
    const bundle = path.join(dir, `${release}.zip`);
    const pointer = path.join(dir, "current.json");
    let previousRelease: string | null = null;
    try {
      previousRelease = (JSON.parse(await readFile(pointer, "utf8")) as { release?: string }).release ?? null;
    } catch {
      previousRelease = null;
    }
    await writeFile(bundle, input.archive, { flag: "wx", mode: 0o644 });
    const next = `${pointer}.tmp`;
    await writeFile(next, JSON.stringify({ release, sha256: actual, previousRelease }, null, 2));
    await rename(next, pointer);
    return { location: bundle, sha256: actual, release, previousRelease };
  }
}
