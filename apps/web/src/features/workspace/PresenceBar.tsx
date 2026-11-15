import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface PresenceEntry {
  memberId: string;
  name: string;
  you: boolean;
  filePath: string;
  mode: "VIEWING" | "EDITING";
}

const HEARTBEAT_MS = 20_000;

/**
 * Heartbeat presence (no websockets): announces that you are viewing or editing a file every 20 seconds and
 * lists who else was active within the last minute.
 */
export function PresenceBar({
  projectId,
  filePath,
  editing,
}: {
  projectId: string;
  filePath: string;
  editing: boolean;
}) {
  const [others, setOthers] = useState<PresenceEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const base = `/projects/${projectId}/collaboration/presence`;
    async function beat() {
      try {
        await api(base, { method: "POST", body: { filePath, mode: editing ? "EDITING" : "VIEWING" } });
        const result = await api<{ presence: PresenceEntry[] }>(`${base}?filePath=${encodeURIComponent(filePath)}`);
        if (!cancelled) setOthers(result.presence.filter((entry) => !entry.you));
      } catch {
        if (!cancelled) setOthers([]);
      }
    }
    void beat();
    const timer = window.setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId, filePath, editing]);

  if (others.length === 0) return null;
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      <Users aria-hidden="true" className="size-4" />
      {others.map((entry) => `${entry.name} is ${entry.mode === "EDITING" ? "editing" : "viewing"}`).join(", ")} this
      file.
    </p>
  );
}
