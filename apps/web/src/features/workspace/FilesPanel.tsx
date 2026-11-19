import { File, Folder, GitCompare, Save } from "lucide-react";
import { useState } from "react";
import { ErrorState, Field, LoadingState } from "@/components/common";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { AiAssist } from "./AiAssist";
import { CommentsPanel } from "./CommentsPanel";
import { PresenceBar } from "./PresenceBar";
import { VisualJsonEditor } from "./VisualJsonEditor";

interface TreeView {
  path: string;
  entries: { name: string; path: string; type: "file" | "directory"; size: number | null }[];
  truncated: boolean;
}
interface FileView {
  path: string;
  size: number;
  sha256: string;
  content: string;
}
interface DiffView {
  patch: string;
  truncated: boolean;
  untracked: string[];
}

/**
 * Online file browser and editor (RG-11). Edits are saved with the content hash they started from, so a
 * concurrent change is reported as a conflict instead of being overwritten.
 */
export function FilesPanel({ projectId, readOnly }: { projectId: string; readOnly: boolean }) {
  const [folder, setFolder] = useState("");
  const base = `/projects/${projectId}/workspace`;
  const tree = useResource<TreeView>(`${base}/files/tree?path=${encodeURIComponent(folder)}`);
  const [open, setOpen] = useState<FileView | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  const [diff, setDiff] = useState<DiffView | null>(null);
  const [busy, setBusy] = useState(false);
  const [visual, setVisual] = useState(false);

  async function openFile(path: string) {
    setMessage(null);
    setDiff(null);
    try {
      const file = await api<FileView>(`${base}/files/content?path=${encodeURIComponent(path)}`);
      setOpen(file);
      setDraft(file.content);
    } catch (error) {
      setOpen(null);
      setMessage({ tone: "danger", text: error instanceof ApiError ? error.message : "Could not open the file." });
    }
  }

  async function save() {
    if (!open) return;
    setBusy(true);
    try {
      const saved = await api<{ sha256: string; size: number }>(`${base}/files/content`, {
        method: "PUT",
        body: { path: open.path, content: draft, expectedSha256: open.sha256 },
      });
      setOpen({ ...open, content: draft, sha256: saved.sha256, size: saved.size });
      setMessage({ tone: "success", text: `Saved ${open.path}.` });
      setDiff(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMessage({
          tone: "warning",
          text: "This file changed since you opened it. Reload it to see the latest version, then re-apply your edits.",
        });
      } else {
        setMessage({ tone: "danger", text: error instanceof ApiError ? error.message : "Could not save the file." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function showDiff() {
    try {
      setDiff(await api<DiffView>(`${base}/diff${open ? `?path=${encodeURIComponent(open.path)}` : ""}`));
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof ApiError ? error.message : "Could not load the diff." });
    }
  }

  const isJson = Boolean(open?.path.toLowerCase().endsWith(".json"));
  const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Files</CardTitle>
        <CardDescription>
          Browse and edit project files. {readOnly ? "You have read-only access." : "Commit from a work branch."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <nav aria-label="Project files" className="space-y-1 text-sm">
          {tree.state === "loading" && <LoadingState label="Loading files…" />}
          {tree.state === "error" && <ErrorState error={tree.error} onRetry={tree.reload} />}
          {tree.state === "ready" && (
            <ul className="space-y-1">
              {folder && (
                <li>
                  <Button variant="ghost" size="sm" onClick={() => setFolder(parent)}>
                    <Folder aria-hidden="true" /> .. (up)
                  </Button>
                </li>
              )}
              {tree.data.entries.map((entry) => (
                <li key={entry.path}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => (entry.type === "directory" ? setFolder(entry.path) : void openFile(entry.path))}
                  >
                    {entry.type === "directory" ? <Folder aria-hidden="true" /> : <File aria-hidden="true" />}{" "}
                    {entry.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="space-y-3">
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          {open ? (
            <>
              {isJson && (
                <div role="group" aria-label="Editor mode" className="flex gap-2">
                  <Button
                    size="sm"
                    variant={visual ? "outline" : "default"}
                    aria-pressed={!visual}
                    onClick={() => setVisual(false)}
                  >
                    Source
                  </Button>
                  <Button
                    size="sm"
                    variant={visual ? "default" : "outline"}
                    aria-pressed={visual}
                    onClick={() => setVisual(true)}
                  >
                    Visual
                  </Button>
                </div>
              )}
              {isJson && visual ? (
                <VisualJsonEditor text={draft} readOnly={readOnly} onChange={setDraft} />
              ) : (
                <Field label={`Editing ${open.path}`}>
                  <Textarea
                    rows={14}
                    className="font-mono text-xs"
                    value={draft}
                    readOnly={readOnly}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                </Field>
              )}
              <PresenceBar projectId={projectId} filePath={open.path} editing={!readOnly && draft !== open.content} />
              <AiAssist fileName={open.path} content={draft} />
              <div className="flex flex-wrap gap-2">
                {!readOnly && (
                  <Button size="sm" disabled={busy || draft === open.content} onClick={() => void save()}>
                    <Save aria-hidden="true" /> {busy ? "Saving…" : "Save file"}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void openFile(open.path)}>
                  Reload
                </Button>
                <Button variant="outline" size="sm" onClick={() => void showDiff()}>
                  <GitCompare aria-hidden="true" /> Show changes
                </Button>
              </div>
              <CommentsPanel
                projectId={projectId}
                targetType="FILE"
                targetRef={open.path}
                title={`Comments on ${open.path}`}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a file to view it.</p>
          )}
          {diff && (
            <pre
              aria-label="Changes against the last commit"
              className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs"
              tabIndex={0}
            >
              {diff.patch || "No changes against the last commit."}
              {diff.untracked.length > 0 ? `\nUntracked: ${diff.untracked.join(", ")}` : ""}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
