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

function requireStarter(
  context: GeneratorAdapterContext,
  projectType: "web-app" | "api-service" | "blank",
  outputs: string[],
) {
  if (context.manifest.kind !== "starter" || context.manifest.projectType !== projectType) {
    throw new GenerationError(`The ${context.manifest.compatibility.adapter} adapter requires a ${projectType} starter.`);
  }
  const declared = new Set(context.manifest.validation.requiredOutputs);
  for (const output of outputs) {
    if (!declared.has(output)) {
      throw new GenerationError(`The ${context.manifest.compatibility.adapter} adapter requires "${output}" in validation.requiredOutputs.`);
    }
  }
}

const fileTreeAdapter: GeneratorAdapter = {
  id: "file-tree",
  render: ({ manifest, sources, values, project }) => renderPlan(manifest, sources, values, project),
};

const reactViteAdapter: GeneratorAdapter = {
  id: "react-vite",
  render: (context) => {
    requireStarter(context, "web-app", ["package.json", "index.html", "src/main.tsx"]);
    return renderPlan(context.manifest, context.sources, context.values, context.project);
  },
};

const nodeApiAdapter: GeneratorAdapter = {
  id: "node-api",
  render: (context) => {
    requireStarter(context, "api-service", ["package.json", "src/server.ts"]);
    return renderPlan(context.manifest, context.sources, context.values, context.project);
  },
};

const blankAdapter: GeneratorAdapter = {
  id: "blank",
  render: (context) => {
    requireStarter(context, "blank", ["README.txt", "project.json"]);
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
