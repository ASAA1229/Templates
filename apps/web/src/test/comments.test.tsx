import { describe, expect, it } from "vitest";
import { toThreads, type CommentView } from "@/features/workspace/CommentsPanel";

const c = (id: string, parentId: string | null): CommentView => ({
  id,
  parentId,
  authorId: "a",
  authorName: "A",
  body: id,
  deleted: false,
  createdAt: "2026-01-01T00:00:00Z",
  editedAt: null,
  resolved: false,
});

describe("comment threads", () => {
  it("groups replies under their first comment in order", () => {
    const threads = toThreads([c("1", null), c("2", "1"), c("3", null), c("4", "1")]);
    expect(threads.map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual([
      ["1", ["2", "4"]],
      ["3", []],
    ]);
  });
});
