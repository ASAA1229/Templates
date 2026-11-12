import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Props = { projectId: string; onSubmitted: () => void };

export function ProjectTemplateContribution({ projectId, onSubmitted }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [customerPermission, setCustomerPermission] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [secretsChecked, setSecretsChecked] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setSuccess("");
    const data = new FormData(form);
    let inputs: unknown[];
    try {
      const parsedInputs: unknown = JSON.parse(String(data.get("inputs") || "[]"));
      if (!Array.isArray(parsedInputs)) throw new Error("Reusable inputs must be a JSON array.");
      inputs = parsedInputs;
    } catch {
      setError("Reusable inputs must be valid JSON in array format.");
      setBusy(false);
      return;
    }
    try {
      const result = await api<{ submission: { id: string; status: string } }>(
        `/projects/${projectId}/template-submissions`,
        {
          method: "POST",
          body: {
            title: data.get("title"),
            slug: data.get("slug"),
            description: data.get("description"),
            category: data.get("category"),
            version: data.get("version"),
            license: data.get("license"),
            customerPermission,
            rightsConfirmed,
            secretsChecked,
            inputs,
          },
        },
      );
      setSuccess(`Submitted for review. Reference: ${result.submission.id}`);
      setOpen(false);
      onSubmitted();
      form.reset();
      setCustomerPermission(false);
      setRightsConfirmed(false);
      setSecretsChecked(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The template could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contribute this project as a reusable template</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Submit a copy of eligible generated project files to the private template library. It remains pending until an owner reviews and approves it.
          Customer-specific content, secrets and private data must not be included.
        </p>
        {success && <Alert tone="success">{success}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {!open ? (
          <Button onClick={() => setOpen(true)}>Prepare template submission</Button>
        ) : (
          <form className="space-y-3" onSubmit={(event) => void submit(event)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">Template title<input required name="title" maxLength={160} className="w-full rounded-md border bg-background px-3 py-2" /></label>
              <label className="space-y-1 text-sm">Slug<input required name="slug" pattern="[a-z0-9][a-z0-9-]{1,79}" maxLength={80} className="w-full rounded-md border bg-background px-3 py-2" /></label>
              <label className="space-y-1 text-sm">Category<input required name="category" maxLength={80} placeholder="web-app" className="w-full rounded-md border bg-background px-3 py-2" /></label>
              <label className="space-y-1 text-sm">Version<input required name="version" defaultValue="1.0.0" pattern="\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?" className="w-full rounded-md border bg-background px-3 py-2" /></label>
              <label className="space-y-1 text-sm sm:col-span-2">License / usage terms<input required name="license" maxLength={80} placeholder="MIT, Apache-2.0, UNLICENSED…" className="w-full rounded-md border bg-background px-3 py-2" /></label>
            </div>
            <label className="block space-y-1 text-sm">Description<textarea name="description" maxLength={2000} rows={3} className="w-full rounded-md border bg-background px-3 py-2" /></label>
            <label className="block space-y-1 text-sm">Reusable configuration inputs (JSON)
              <textarea name="inputs" defaultValue={JSON.stringify([{ id: "projectName", label: "Project name", type: "string", required: true, maxLength: 80 }], null, 2)} rows={6} spellCheck={false} className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" />
              <span className="text-xs text-muted-foreground">Define inputs with id, label, type (string, text, boolean or select), and optional defaults. Use matching placeholders such as {"{{projectName}}"} in text files and paths.</span>
            </label>
            <fieldset className="space-y-2 rounded-md border p-3 text-sm">
              <legend className="px-1 font-medium">Required confirmations</legend>
              <label className="flex gap-2"><input type="checkbox" checked={customerPermission} onChange={(event) => setCustomerPermission(event.target.checked)} required /> Customer permission is secured, or no customer-owned material is included.</label>
              <label className="flex gap-2"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} required /> I have the rights to contribute all included material.</label>
              <label className="flex gap-2"><input type="checkbox" checked={secretsChecked} onChange={(event) => setSecretsChecked(event.target.checked)} required /> I checked the project for credentials, secrets and private data.</label>
            </fieldset>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit for review"}</Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
