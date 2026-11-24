import {
  GENERATOR_ADAPTERS,
  type GeneratorAdapterId,
  type TemplateInputValues,
  type TemplateManifest,
} from "@asaa/contracts";
import { GenerationError, renderPlan, type ProjectVariables, type RenderPlan } from "./render.js";

export interface GeneratorAdapterContext {
  manifest: TemplateManifest;
  sources: Map<string, Buffer>;
  values: TemplateInputValues;
  project: ProjectVariables;
}

export interface GeneratorAdapter {
  id: GeneratorAdapterId;
  render(context: GeneratorAdapterContext): RenderPlan;
}

const ADAPTER_REQUIREMENTS: Partial<
  Record<
    GeneratorAdapterId,
    {
      projectType: "web-app" | "api-service" | "blank";
      family: "web-app" | "backend-service" | "general";
      architecture: "single-page-app" | "layered-service" | "minimal";
      outputs: string[];
    }
  >
> = {
  "react-vite": {
    projectType: "web-app",
    family: "web-app",
    architecture: "single-page-app",
    outputs: ["package.json", "index.html", "src/main.tsx"],
  },
  "node-api": {
    projectType: "api-service",
    family: "backend-service",
    architecture: "layered-service",
    outputs: ["package.json", "src/server.ts"],
  },
  blank: { projectType: "blank", family: "general", architecture: "minimal", outputs: ["README.txt", "project.json"] },
};

/** Problems that make a manifest unusable with its declared adapter; empty when compatible. */
export function adapterProblems(manifest: TemplateManifest): string[] {
  const adapter = manifest.compatibility.adapter;
  const need = ADAPTER_REQUIREMENTS[adapter];
  if (!need) return [];
  const problems: string[] = [];
  if (manifest.kind !== "starter" || manifest.projectType !== need.projectType) {
    problems.push(`The ${adapter} adapter requires a ${need.projectType} starter.`);
  }
  const blueprint = manifest.blueprint;
  if (!blueprint || blueprint.family !== need.family || blueprint.architecture !== need.architecture) {
    problems.push(`The ${adapter} adapter requires blueprint ${need.family}/${need.architecture}.`);
  }
  const declared = new Set(manifest.validation.requiredOutputs);
  for (const output of need.outputs) {
    if (!declared.has(output)) problems.push(`The ${adapter} adapter requires "${output}" in validation.requiredOutputs.`);
  }
  return problems;
}

function requireStarter(context: GeneratorAdapterContext) {
  const [first] = adapterProblems(context.manifest);
  if (first) throw new GenerationError(first);
}

const fileTreeAdapter: GeneratorAdapter = {
  id: "file-tree",
  render: ({ manifest, sources, values, project }) => renderPlan(manifest, sources, values, project),
};

const reactViteAdapter: GeneratorAdapter = {
  id: "react-vite",
  render: (context) => {
    requireStarter(context);
    return renderPlan(context.manifest, context.sources, context.values, context.project);
  },
};

const nodeApiAdapter: GeneratorAdapter = {
  id: "node-api",
  render: (context) => {
    requireStarter(context);
    return renderPlan(context.manifest, context.sources, context.values, context.project);
  },
};

const blankAdapter: GeneratorAdapter = {
  id: "blank",
  render: (context) => {
    requireStarter(context);
    return renderPlan(context.manifest, context.sources, context.values, context.project);
  },
};

const registry: Record<GeneratorAdapterId, GeneratorAdapter> = {
  "file-tree": fileTreeAdapter,
  "react-vite": reactViteAdapter,
  "node-api": nodeApiAdapter,
  blank: blankAdapter,
};

/** Resolve only platform-registered adapters; template content is never loaded as code. */
export function getGeneratorAdapter(id: string): GeneratorAdapter {
  if (!(GENERATOR_ADAPTERS as readonly string[]).includes(id)) {
    throw new GenerationError(`Generator adapter "${id}" is not supported by this platform.`);
  }
  return registry[id as GeneratorAdapterId];
}

/** Adapter dispatch is deterministic and remains inside the platform renderer. */
export function renderWithAdapter(context: GeneratorAdapterContext): RenderPlan {
  return getGeneratorAdapter(context.manifest.compatibility.adapter).render(context);
}
