import { useState, useRef, useCallback } from "react";
import { Upload, CheckCircle2, XCircle, Loader2, FileText, ChevronDown, ChevronUp, User, Landmark, FileStack, Sprout, ClipboardCheck } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type DocTypeId = "form7" | "form12" | "form8a" | "aadhar" | "bank_passbook";
type ExtractionStatus = "idle" | "uploading" | "processing" | "complete" | "error";

interface DocCard {
  id: DocTypeId;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.FC<{ className?: string }>;
  color: string;
}

const DOC_CARDS: DocCard[] = [
  {
    id: "form7",
    label: "Form 7 (Ownership Register)",
    shortLabel: "Form 7",
    description: "Maharashtra 7/12 — अधिकार अभिलेख (Rights Register)",
    icon: FileStack,
    color: "text-emerald-600",
  },
  {
    id: "form12",
    label: "Form 12 (Crop Inspection Register)",
    shortLabel: "Form 12",
    description: "Maharashtra 7/12 — पीक पाहणी (Crop Inspection Register)",
    icon: Sprout,
    color: "text-green-600",
  },
  {
    id: "form8a",
    label: "Form 8A (Holding Register)",
    shortLabel: "Form 8A",
    description: "Maharashtra — धारण जमिनींची नोंदवही (Holding Register)",
    icon: ClipboardCheck,
    color: "text-teal-600",
  },
  {
    id: "aadhar",
    label: "Aadhaar Card",
    shortLabel: "Aadhaar",
    description: "UIDAI Aadhaar identity card",
    icon: User,
    color: "text-blue-600",
  },
  {
    id: "bank_passbook",
    label: "Bank Passbook",
    shortLabel: "Passbook",
    description: "Bank account passbook front page",
    icon: Landmark,
    color: "text-indigo-600",
  },
];

interface FieldRow {
  key: string;
  label: string;
  value: string;
}

interface TableData {
  key: string;
  label: string;
  columns: { key: string; label: string }[];
  rows: { values: Record<string, string> }[];
}

interface SectionData {
  title: string;
  fields: FieldRow[];
  tables: TableData[];
}

interface ExtractionState {
  status: ExtractionStatus;
  filename: string;
  requestId: string | null;
  sections: SectionData[];
  error: string | null;
  savedToProfile: boolean;
  profileSection: string | null;
}

const DEFAULT_STATE: ExtractionState = {
  status: "idle",
  filename: "",
  requestId: null,
  sections: [],
  error: null,
  savedToProfile: false,
  profileSection: null,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollUntilDone(
  requestId: string,
  onComplete: (result: ExtractionState) => void,
  onError: (msg: string) => void,
) {
  const maxAttempts = 60;
  let attempts = 0;

  while (attempts < maxAttempts) {
    await sleep(3000);
    attempts++;

    try {
      const res = await fetch(`${BASE_URL}/api/extract/${requestId}`);
      const data = await res.json();

      if (!res.ok) {
        onError(data?.error ?? `Server error ${res.status}`);
        return;
      }

      if (data.status === "processing") continue;

      if (data.status === "error") {
        onError(data.error ?? "Extraction failed.");
        return;
      }

      if (data.status === "complete") {
        onComplete({
          status: "complete",
          filename: "",
          requestId,
          sections: data.structured?.sections ?? [],
          error: null,
          savedToProfile: data.profile?.saved ?? false,
          profileSection: data.profile?.section ?? null,
        });
        return;
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Network error");
      return;
    }
  }

  onError("Timed out waiting for extraction result.");
}

function StatusBadge({ status }: { status: ExtractionStatus }) {
  if (status === "idle") return null;
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    uploading: { label: "Uploading…", cls: "bg-blue-100 text-blue-700", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    processing: { label: "Processing…", cls: "bg-amber-100 text-amber-700", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    complete: { label: "Extracted", cls: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    error: { label: "Failed", cls: "bg-red-100 text-red-700", icon: <XCircle className="h-3.5 w-3.5" /> },
  };
  const { label, cls, icon } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon}{label}
    </span>
  );
}

function FieldsTable({ sections }: { sections: SectionData[] }) {
  if (!sections.length) return null;
  return (
    <div className="mt-3 space-y-4">
      {sections.map((sec) => (
        <div key={sec.title}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{sec.title}</p>
          {sec.fields.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <tbody>
                  {sec.fields.filter(f => f.value && f.value !== "—").map((f) => (
                    <tr key={f.key} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5 text-muted-foreground w-2/5 font-medium">{f.label}</td>
                      <td className="px-3 py-1.5 text-foreground break-all">{f.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sec.tables.map((tbl) => tbl.rows.length > 0 && (
            <div key={tbl.key} className="mt-2">
              <p className="text-xs text-muted-foreground mb-1">{tbl.label}</p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      {tbl.columns.map(c => (
                        <th key={c.key} className="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tbl.rows.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        {tbl.columns.map(c => (
                          <td key={c.key} className="px-3 py-1.5 text-foreground">{row.values[c.key] ?? "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DocUploadCard({ card, phone }: { card: DocCard; phone: string }) {
  const [state, setState] = useState<ExtractionState>({ ...DEFAULT_STATE });
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const Icon = card.icon;

  const handleFile = useCallback(
    async (file: File) => {
      setState((s) => ({ ...s, status: "uploading", filename: file.name, error: null, sections: [], requestId: null }));

      const body = new FormData();
      body.append("file", file);
      body.append("document_type", card.id);
      body.append("mode", "accurate");
      if (phone.trim()) body.append("profile_phone", phone.trim());

      try {
        const res = await fetch(`${BASE_URL}/api/extract`, { method: "POST", body });
        const data = await res.json();

        if (!res.ok) {
          setState((s) => ({ ...s, status: "error", error: data?.error ?? `Upload failed (${res.status})` }));
          return;
        }

        const reqId: string = data.request_id;
        setState((s) => ({ ...s, status: "processing", requestId: reqId }));
        setExpanded(true);

        pollUntilDone(
          reqId,
          (result) => setState((s) => ({ ...s, ...result, filename: s.filename })),
          (msg) => setState((s) => ({ ...s, status: "error", error: msg })),
        );
      } catch (err) {
        setState((s) => ({ ...s, status: "error", error: err instanceof Error ? err.message : "Network error" }));
      }
    },
    [card.id, phone],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const busy = state.status === "uploading" || state.status === "processing";
  const hasResult = state.status === "complete" && state.sections.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`mt-0.5 flex-shrink-0 ${card.color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-foreground leading-tight">{card.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{card.description}</p>
              {state.filename && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <FileText className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{state.filename}</span>
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={state.status} />
            {state.status === "idle" || state.status === "error" || state.status === "complete" ? (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {state.status === "complete" ? "Re-upload" : "Upload"}
              </button>
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        {state.status === "idle" && (
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="mt-3 border-2 border-dashed border-border rounded-lg py-4 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
          >
            <Upload className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
            <p className="text-xs text-muted-foreground">Drag & drop or click to upload PDF / image</p>
          </div>
        )}

        {state.status === "error" && state.error && (
          <div className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {state.error}
          </div>
        )}

        {state.status === "complete" && state.savedToProfile && (
          <div className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
            Saved to MongoDB profile ({state.profileSection})
          </div>
        )}
      </div>

      {hasResult && (
        <div className="border-t border-border">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors"
          >
            <span>View extracted data ({state.sections.reduce((n, s) => n + s.fields.filter(f => f.value && f.value !== "—").length, 0)} fields)</span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {expanded && (
            <div className="px-4 pb-4">
              <FieldsTable sections={state.sections} />
            </div>
          )}
        </div>
      )}

      <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff" className="hidden" onChange={onInputChange} />
    </div>
  );
}

export default function NewRegistration() {
  const [phone, setPhone] = useState("");

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-semibold text-base mb-1">Farmer Profile Phone Number</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Enter the farmer's mobile number to auto-save extracted data directly into their MongoDB profile. Leave blank to extract without saving.
        </p>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 15))}
          placeholder="e.g. 9876543210"
          className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <h2 className="font-semibold text-base mb-3">Upload Documents for OCR Extraction</h2>
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2">
          {DOC_CARDS.map((card) => (
            <DocUploadCard key={card.id} card={card} phone={phone} />
          ))}
        </div>
      </div>
    </div>
  );
}
