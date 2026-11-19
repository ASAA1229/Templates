import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { leaves, parseJsonObject, setAtPath, VisualJsonEditor } from "@/features/workspace/VisualJsonEditor";

describe("visual JSON editor", () => {
  it("flattens nested settings and updates immutably", () => {
    const obj = parseJsonObject('{"name":"a","server":{"port":80,"tls":false},"tags":["x"]}')!;
    expect(leaves(obj).map((leaf) => leaf.path.join("."))).toEqual(["name", "server.port", "server.tls"]);
    const next = setAtPath(obj, ["server", "port"], 81);
    expect(next).toMatchObject({ server: { port: 81, tls: false }, tags: ["x"] });
    expect(obj).toMatchObject({ server: { port: 80 } });
    expect(parseJsonObject("[1]")).toBeNull();
    expect(parseJsonObject("{bad")).toBeNull();
  });

  it("rewrites the JSON text when a control changes", async () => {
    const onChange = vi.fn();
    render(<VisualJsonEditor text='{"name":"a","on":false}' readOnly={false} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("on"));
    expect(JSON.parse(onChange.mock.calls[0]![0] as string)).toEqual({ name: "a", on: true });
    await userEvent.type(screen.getByLabelText("name"), "b");
    expect(JSON.parse(onChange.mock.calls[1]![0] as string)).toEqual({ name: "ab", on: false });
  });

  it("falls back to source editing for invalid JSON", () => {
    render(<VisualJsonEditor text="{oops" readOnly={false} onChange={() => undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/only be edited as source/);
  });
});
