import { Download } from "lucide-react";
import { ErrorState, LoadingState } from "@/components/common";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { useResource } from "@/lib/hooks";

interface ToolSummary {
  id: string;
  version: string;
  title: string;
  description: string;
  language: string;
  minRuntime: string;
  sha256: string | null;
  integrity: "ok" | "modified";
  fileCount: number;
}

/** Packaged offline tools users download and run on their own hosts (checksummed, served only when intact). */
export function ToolsPanel() {
  const tools = useResource<{ items: ToolSummary[] }>("/tools");
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Tools</CardTitle>
        <CardDescription>
          Offline utilities maintained with the platform. Each download is a ZIP with a SHA256SUMS file; verify the
          archive digest shown here before running anything on a server.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tools.state === "loading" && <LoadingState label="Loading tools" rows={1} />}
        {tools.state === "error" && <ErrorState error={tools.error} onRetry={tools.reload} />}
        {tools.state === "ready" && tools.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">No packaged tools were found on this server.</p>
        )}
        {tools.state === "ready" && tools.data.items.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label="Available tools">
            {tools.data.items.map((tool) => (
              <li key={tool.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium">
                    {tool.title} <span className="text-sm text-muted-foreground">v{tool.version}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{tool.description}</p>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="info">
                      {tool.language} {tool.minRuntime}+
                    </Badge>
                    <Badge>{tool.fileCount} files</Badge>
                    {tool.integrity === "modified" && <Badge tone="danger">Modified: download blocked</Badge>}
                  </div>
                  {tool.sha256 && (
                    <p className="text-xs text-muted-foreground">
                      SHA-256 <code className="break-all font-mono">{tool.sha256}</code>
                    </p>
                  )}
                </div>
                {tool.integrity === "ok" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left sm:max-w-[40%]"
                    asChild
                  >
                    <a href={`/api/tools/${tool.id}/download`} download>
                      <Download aria-hidden="true" /> Download {tool.title}
                    </a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
