import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/common";
import { Alert, Badge, Button, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useResource } from "@/lib/hooks";
import { formatDateTime } from "@/lib/utils";

export interface CommentView {
  id: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  body: string;
  deleted: boolean;
  createdAt: string;
  editedAt: string | null;
  resolved: boolean;
}

/** Group a flat comment list into threads (first comment plus its replies), keeping creation order. */
export function toThreads(comments: CommentView[]): { root: CommentView; replies: CommentView[] }[] {
  const roots = comments.filter((comment) => !comment.parentId);
  return roots.map((root) => ({ root, replies: comments.filter((comment) => comment.parentId === root.id) }));
}

/**
 * Threaded comments on a project, template version or file. Edit and delete are offered only on your own
 * comments; resolving needs write access (the server decides and explains).
 */
export function CommentsPanel({
  projectId,
  targetType,
  targetRef = "",
  readOnly = false,
  title = "Comments",
}: {
  projectId: string;
  targetType: "PROJECT" | "TEMPLATE" | "FILE";
  targetRef?: string;
  readOnly?: boolean;
  title?: string;
}) {
  const { owner } = useAuth();
  const [showResolved, setShowResolved] = useState(false);
  const base = `/projects/${projectId}/collaboration/comments`;
  const query = `targetType=${targetType}&targetRef=${encodeURIComponent(targetRef)}&includeResolved=${showResolved}`;
  const list = useResource<{ comments: CommentView[] }>(`${base}?${query}`);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(task: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      after?.();
      list.reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "The action failed.");
    } finally {
      setBusy(false);
    }
  }

  const post = () =>
    act(
      () => api(base, { method: "POST", body: { targetType, targetRef, body: draft, parentId: replyTo ?? undefined } }),
      () => {
        setDraft("");
        setReplyTo(null);
      },
    );

  if (list.state !== "ready") return null;
  const threads = toThreads(list.data.comments);

  const item = (comment: CommentView, isRoot: boolean) => (
    <li key={comment.id} className="space-y-1 text-sm">
      <p className="text-xs text-muted-foreground">
        {comment.authorName} · {formatDateTime(comment.createdAt)}
        {comment.editedAt ? " · edited" : ""}
        {comment.resolved ? " · resolved" : ""}
      </p>
      {comment.deleted ? (
        <p className="italic text-muted-foreground">This comment was deleted.</p>
      ) : editing?.id === comment.id ? (
        <div className="space-y-2">
          <Field label="Edit comment">
            <Textarea
              rows={3}
              value={editing.body}
              onChange={(e) => setEditing({ id: comment.id, body: e.target.value })}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !editing.body.trim()}
              onClick={() =>
                void act(
                  () => api(`${base}/${comment.id}`, { method: "PATCH", body: { body: editing.body } }),
                  () => setEditing(null),
                )
              }
            >
              Save comment
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words">{comment.body}</p>
      )}
      {!comment.deleted && !readOnly && (
        <div className="flex flex-wrap gap-2">
          {isRoot && (
            <Button size="sm" variant="outline" onClick={() => setReplyTo(comment.id)}>
              Reply
            </Button>
          )}
          {comment.authorId === owner?.id && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing({ id: comment.id, body: comment.body })}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void act(() => api(`${base}/${comment.id}`, { method: "DELETE" }))}
              >
                Delete
              </Button>
            </>
          )}
          {isRoot && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  api(`${base}/${comment.id}/resolve`, { method: "POST", body: { resolved: !comment.resolved } }),
                )
              }
            >
              {comment.resolved ? "Reopen" : "Resolve"}
            </Button>
          )}
        </div>
      )}
    </li>
  );

  return (
    <section aria-label={title} className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MessageSquare aria-hidden="true" className="size-4" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge>{threads.length} thread(s)</Badge>
        <label className="ml-auto flex items-center gap-1 text-xs">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
      </div>
      {message && <Alert tone="danger">{message}</Alert>}
      <ul className="space-y-3">
        {threads.map(({ root, replies }) => (
          <li key={root.id} className="space-y-2 border-l-2 pl-3">
            <ul className="space-y-2">
              {item(root, true)}
              {replies.map((reply) => item(reply, false))}
            </ul>
          </li>
        ))}
        {threads.length === 0 && <li className="text-sm text-muted-foreground">No comments yet.</li>}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) void post();
        }}
      >
        <Field label={replyTo ? "Reply" : "New comment"} hint="Mention a project member with @their-email.">
          <Textarea
            rows={3}
            maxLength={4000}
            value={draft}
            disabled={readOnly}
            onChange={(e) => setDraft(e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy || readOnly || !draft.trim()}>
            {replyTo ? "Post reply" : "Post comment"}
          </Button>
          {replyTo && (
            <Button type="button" size="sm" variant="outline" onClick={() => setReplyTo(null)}>
              Cancel reply
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
