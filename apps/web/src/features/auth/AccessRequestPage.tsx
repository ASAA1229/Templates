import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Field } from "@/components/common";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";

export function AccessRequestPage() {
  const [form, setForm] = useState({ displayName: "", email: "", reason: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ message: string }>("/auth/access-requests", {
        method: "POST",
        body: form,
      });
      setMessage(result.message);
      setForm({ displayName: "", email: "", reason: "" });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to submit your request.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Request employee access</CardTitle>
          <CardDescription>
            Access is available to approved ASAA team members. An owner or administrator will review your request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            {message && <Alert tone="success">{message}</Alert>}
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Full name">
              <Input
                required
                maxLength={120}
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              />
            </Field>
            <Field label="Work email">
              <Input
                required
                type="email"
                maxLength={254}
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
            <Field label="Reason for access">
              <textarea
                maxLength={1000}
                rows={3}
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Submitting…" : "Submit access request"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <Link className="underline" to="/login">
                Return to sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
