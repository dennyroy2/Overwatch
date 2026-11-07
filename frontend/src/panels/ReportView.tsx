/**
 * ReportView: the search report panel (owner: Varad).
 *
 * Denny's shell renders this in the report slot (components/shell/Slots.tsx)
 * when "Close search" is clicked:
 *     <ReportView caseId={caseId} onClose={() => ...} />
 *
 * It fetches GET /report/{caseId} itself (contracts.models.Report), so it does not
 * need the store. "Export PDF" opens GET /report/{caseId}/pdf (ask Rishaan to add it;
 * it calls backend/report/generate_report.build_pdf).
 *
 * Styling follows frontend/DESIGN.md: amber = human decisions + probability,
 * cyan (text-ai) = only text the AI wrote, numbers in mono.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------- types
// Mirrors contracts/models.py (Report and friends). Swap for the generated types
// in frontend/src/types/api.ts once `make types` has been run on main.
type GeoPoint = { lat: number; lon: number };

type Evidence = {
  id: string;
  case_id: string;
  kind: "last_seen" | "sighting" | "clue" | "searched_area" | "favourite_place" | "constraint" | "note";
  time: string;
  location?: GeoPoint | null;
  radius_m?: number | null;
  source: string;
  reliability: number;
  confirmed: boolean;
  summary: string;
};

type TaskingRequest = {
  id: string;
  asset: string;
  expected_gain: number;
  duration_min: number;
  reasons: string[];
  status: "pending" | "approved" | "rejected";
};

type LogEntry = { time: string; actor: string; action: string; detail: string };

type SubjectProfile = {
  case_id: string;
  name: string;
  age: number;
  condition: string;
  mobility: string;
  clothing: string[];
  notes: string;
  last_seen?: GeoPoint | null;
  last_seen_time?: string | null;
};

export type Report = {
  case: SubjectProfile;
  evidence: Evidence[];
  requests: TaskingRequest[];
  log: LogEntry[];
};

export type ReportViewProps = { caseId: string; onClose: () => void };

// ---------------------------------------------------------------- helpers
// Same env var + default as Denny's frontend/src/lib/config.ts (API_URL). Switch to
// `import { API_URL } from "@/lib/config"` once his branch is on main.
const API_BASE: string = (
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const pct = (x: number) => `${Math.round(x * 100)}%`;
const nice = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Decisions are logged as action="decision", detail="<asset>: <status> (<reason>)". */
function findDecision(log: LogEntry[], req: TaskingRequest) {
  const entry = log.find(
    (e) => e.action === "decision" && e.detail.startsWith(`${req.asset}:`) && e.detail.includes(req.status),
  );
  if (!entry) return null;
  const reason = entry.detail.match(/\((.*)\)\s*$/)?.[1];
  return { officer: entry.actor, time: entry.time, reason };
}

function outcomeOf(log: LogEntry[]) {
  const rev = [...log].reverse();
  const found = rev.find((e) => e.action === "found_confirmed" || e.action === "found");
  if (found) return { label: "Located", time: found.time, detail: found.detail };
  const closed = rev.find((e) => e.action === "search_closed" || e.action === "case_closed");
  if (closed) return { label: "Search closed", time: closed.time, detail: closed.detail };
  return { label: "Search ongoing", time: null, detail: "Report generated while the search is still active." };
}

// ---------------------------------------------------------------- small parts
function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm font-semibold text-ink">
        {title}
        {count !== undefined && <span className="ml-2 font-mono text-ink-3">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2">
      <div className="text-xs text-ink-3">{label}</div>
      <div className={`font-mono text-lg ${accent ? "text-amber" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: TaskingRequest["status"] }) {
  const cls =
    status === "approved" ? "text-success" : status === "rejected" ? "text-danger" : "text-ink-3";
  return <span className={`text-xs font-semibold uppercase tracking-wide ${cls}`}>{status}</span>;
}

// ---------------------------------------------------------------- main
export function ReportView({ caseId, onClose }: ReportViewProps) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfNote, setPdfNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/report/${encodeURIComponent(caseId)}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setReport((await res.json()) as Report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load report");
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Esc closes the panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const exportPdf = useCallback(async () => {
    setPdfNote(null);
    const url = `${API_BASE}/report/${encodeURIComponent(caseId)}/pdf`;
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (!res.ok && res.status !== 405) throw new Error(String(res.status));
      window.open(url, "_blank", "noopener");
    } catch {
      setPdfNote("PDF export isn't available on the server yet.");
    }
  }, [caseId]);

  const derived = useMemo(() => {
    if (!report) return null;
    const evidence = [...report.evidence].sort((a, b) => a.time.localeCompare(b.time));
    const log = [...report.log].sort((a, b) => a.time.localeCompare(b.time));
    return {
      evidence,
      log,
      outcome: outcomeOf(report.log),
      approved: report.requests.filter((r) => r.status === "approved").length,
      confirmed: report.evidence.filter((e) => e.confirmed).length,
    };
  }, [report]);

  return (
    <div
      role="dialog"
      aria-label="Search report"
      className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-line bg-panel shadow-panel"
    >
      {/* header */}
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Search report</h2>
          <p className="font-mono text-xs text-ink-3">{caseId}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportPdf} disabled={!report}>
            Export PDF
          </Button>
          <Button variant="ghost" onClick={onClose} aria-label="Close report">
            Close
          </Button>
        </div>
      </div>

      {/* body */}
      <div className="overflow-y-auto px-5 pb-6">
        {pdfNote && <p className="mt-3 text-xs text-danger">{pdfNote}</p>}

        {error && (
          <div className="mt-6 rounded-md border border-line bg-raised p-4 text-sm">
            <p className="text-danger">Couldn't load the report: {error}</p>
            <Button variant="secondary" className="mt-3" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {!report && !error && <p className="mt-6 text-sm text-ink-3">Loading report…</p>}

        {report && derived && (
          <>
            {/* outcome + subject */}
            <div className="mt-4 rounded-md border border-line bg-raised p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-base font-semibold text-amber">{derived.outcome.label}</span>
                <span className="font-mono text-xs text-ink-3">{fmtTime(derived.outcome.time)}</span>
              </div>
              <p className="mt-1 text-sm text-ink-2">{derived.outcome.detail}</p>
              <p className="mt-3 text-sm text-ink">
                {report.case.name}, <span className="font-mono">{report.case.age}</span> ·{" "}
                {nice(report.case.condition)} · {report.case.mobility} mobility
              </p>
              {report.case.clothing.length > 0 && (
                <p className="text-sm text-ink-2">Wearing: {report.case.clothing.join(", ")}</p>
              )}
              <p className="text-xs text-ink-3">
                Last seen <span className="font-mono">{fmtTime(report.case.last_seen_time)}</span>
              </p>
            </div>

            {/* stats */}
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Evidence (confirmed)" value={`${report.evidence.length} (${derived.confirmed})`} />
              <Stat label="Requests approved" value={`${derived.approved}/${report.requests.length}`} accent />
              <Stat label="Log entries" value={String(report.log.length)} />
            </div>

            {/* evidence */}
            <Section title="Evidence" count={derived.evidence.length}>
              <p className="mb-2 text-xs text-ink-3">Times are when each event happened, as reported.</p>
              {derived.evidence.length === 0 && <p className="text-sm italic text-ink-3">No evidence yet.</p>}
              <ul className="divide-y divide-line rounded-md border border-line empty:hidden">
                {derived.evidence.map((e) => (
                  <li key={e.id} className="flex gap-3 px-3 py-2 text-sm">
                    <span className="w-24 shrink-0 font-mono text-xs text-ink-3">{fmtTime(e.time)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-ink">{e.summary}</p>
                      <p className="text-xs text-ink-3">
                        {nice(e.kind)} · {nice(e.source)} · reliability{" "}
                        <span className="font-mono">{pct(e.reliability)}</span>
                        {e.confirmed ? " · confirmed" : " · unconfirmed"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>

            {/* tasking requests */}
            <Section title="Deployments" count={report.requests.length}>
              <p className="mb-2 text-xs text-ink-3">
                Overwatch recommends. An officer approves or rejects every deployment.
              </p>
              {report.requests.length === 0 && (
                <p className="text-sm italic text-ink-3">No deployments requested.</p>
              )}
              <ul className="space-y-2">
                {report.requests.map((r) => {
                  const d = findDecision(report.log, r);
                  return (
                    <li key={r.id} className="rounded-md border border-line bg-raised p-3 text-sm">
                      <div className="flex items-baseline justify-between">
                        <span className="font-semibold text-ink">{r.asset}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="text-xs text-ink-3">
                        covers <span className="font-mono text-amber">{pct(r.expected_gain)}</span> of remaining
                        probability in <span className="font-mono">{r.duration_min}</span> min
                      </p>
                      <ul className="mt-2 list-disc pl-4 text-ai">
                        {r.reasons.map((reason, i) => (
                          <li key={i}>{reason}</li>
                        ))}
                      </ul>
                      {d && (
                        <p className="mt-2 text-xs text-ink-2">
                          {nice(r.status)} by {d.officer} at <span className="font-mono">{fmtTime(d.time)}</span>
                          {d.reason && <> · “{d.reason}”</>}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Section>

            {/* log */}
            <Section title="Activity log" count={derived.log.length}>
              <p className="mb-2 text-xs text-ink-3">Times are when each action was entered in Overwatch.</p>
              {derived.log.length === 0 && <p className="text-sm italic text-ink-3">No activity logged.</p>}
              <ol className="rounded-md border border-line font-mono text-xs empty:hidden">
                {derived.log.map((e, i) => (
                  <li key={i} className="flex gap-3 border-b border-line px-3 py-1.5 last:border-b-0">
                    <span className="w-24 shrink-0 text-ink-3">{fmtTime(e.time)}</span>
                    <span className="w-28 shrink-0 truncate text-ink-2">{e.actor}</span>
                    <span className="min-w-0 flex-1 text-ink">{e.detail}</span>
                  </li>
                ))}
              </ol>
            </Section>

            <p className="mt-6 text-xs text-ink-3">
              AI outputs are recommendations. No deployment happens without an officer's approval, and every
              decision is logged with the officer's name.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default ReportView;
