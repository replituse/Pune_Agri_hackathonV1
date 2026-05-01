import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload, CheckCircle2, XCircle, Loader2, FileText,
  ChevronDown, ChevronUp, User, Landmark, FileStack, Sprout,
  ClipboardCheck, UserCheck, Pencil, ThumbsUp,
} from "lucide-react";
import { addApprovedFarmer, nextFarmerId } from "@/data/farmerStore";

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
}

const DEFAULT_STATE: ExtractionState = {
  status: "idle",
  filename: "",
  requestId: null,
  sections: [],
  error: null,
};

export interface FarmerProfile {
  name: string;
  aadhaar: string;
  village: string;
  district: string;
  land: string;
  crop: string;
  surveyNumber: string;
  bankAccount: string;
}

const EMPTY_PROFILE: FarmerProfile = {
  name: "",
  aadhaar: "",
  village: "",
  district: "",
  land: "",
  crop: "",
  surveyNumber: "",
  bankAccount: "",
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollUntilDone(
  requestId: string,
  onComplete: (result: Omit<ExtractionState, "filename">) => void,
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
          requestId,
          sections: data.structured?.sections ?? [],
          error: null,
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

function fieldMatch(field: FieldRow, keywords: string[]): boolean {
  const haystack = `${field.key} ${field.label}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw));
}

function extractProfileFromSections(
  allStates: Record<DocTypeId, ExtractionState>,
): Partial<FarmerProfile> {
  const out: Partial<FarmerProfile> = {};

  const pick = (keywords: string[], field: keyof FarmerProfile) => {
    if (out[field]) return;
    for (const docId of Object.keys(allStates) as DocTypeId[]) {
      const state = allStates[docId];
      if (state.status !== "complete") continue;
      for (const sec of state.sections) {
        for (const f of sec.fields) {
          if (f.value && f.value !== "—" && fieldMatch(f, keywords)) {
            out[field] = f.value;
            return;
          }
        }
      }
    }
  };

  pick(["name", "owner", "holder", "applicant", "farmer"], "name");
  pick(["aadhaar", "uid", "aadhar", "uidai", "identity"], "aadhaar");
  pick(["village", "gram", "गाव", "taluka"], "village");
  pick(["district", "jilha", "जिल्हा"], "district");
  pick(["area", "land", "holding", "acr", "hect", "क्षेत्र"], "land");
  pick(["crop", "पीक", "cultivation", "season crop"], "crop");
  pick(["survey", "gat", "plot", "khata", "सर्वे"], "surveyNumber");
  pick(["account", "bank", "acc no", "खाते"], "bankAccount");

  return out;
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

type StateUpdater = ExtractionState | ((prev: ExtractionState) => ExtractionState);

function DocUploadCard({
  card,
  state,
  onStateChange,
}: {
  card: DocCard;
  state: ExtractionState;
  onStateChange: (s: StateUpdater) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const Icon = card.icon;

  const handleFile = useCallback(
    async (file: File) => {
      onStateChange({ ...DEFAULT_STATE, status: "uploading", filename: file.name });

      const body = new FormData();
      body.append("file", file);
      body.append("document_type", card.id);
      body.append("mode", "accurate");

      try {
        const res = await fetch(`${BASE_URL}/api/extract`, { method: "POST", body });
        const data = await res.json();

        if (!res.ok) {
          onStateChange({ ...DEFAULT_STATE, filename: file.name, status: "error", error: data?.error ?? `Upload failed (${res.status})` });
          return;
        }

        const reqId: string = data.request_id;
        onStateChange((prev: ExtractionState) => ({ ...prev, status: "processing", requestId: reqId }));
        setExpanded(true);

        pollUntilDone(
          reqId,
          (result) => {
            onStateChange((prev: ExtractionState) => ({ ...prev, ...result }));
          },
          (msg) => {
            onStateChange((prev: ExtractionState) => ({ ...prev, status: "error", error: msg }));
          },
        );
      } catch (err) {
        onStateChange({ ...DEFAULT_STATE, filename: file.name, status: "error", error: err instanceof Error ? err.message : "Network error" });
      }
    },
    [card.id, onStateChange],
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
            {!busy ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
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

const PROFILE_FIELDS: { key: keyof FarmerProfile; label: string; placeholder: string }[] = [
  { key: "name", label: "Full Name", placeholder: "Farmer's full name" },
  { key: "aadhaar", label: "Aadhaar Number", placeholder: "XXXX-XXXX-XXXX" },
  { key: "village", label: "Village / Taluka", placeholder: "Village name" },
  { key: "district", label: "District", placeholder: "District name" },
  { key: "land", label: "Land Area (acres)", placeholder: "e.g. 3.5" },
  { key: "crop", label: "Primary Crop", placeholder: "e.g. Cotton" },
  { key: "surveyNumber", label: "Survey / Gat Number", placeholder: "e.g. 123/4" },
  { key: "bankAccount", label: "Bank Account Number", placeholder: "Account number" },
];

function FarmerProfileCard({
  profile,
  onChange,
  onApprove,
  approved,
}: {
  profile: FarmerProfile;
  onChange: (field: keyof FarmerProfile, value: string) => void;
  onApprove: () => void;
  approved: boolean;
}) {
  const filledCount = Object.values(profile).filter(Boolean).length;

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-card shadow-md overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-primary/5 border-b border-primary/20">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center">
            <UserCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-foreground">Auto-Built Farmer Profile</h3>
            <p className="text-xs text-muted-foreground">{filledCount} of {PROFILE_FIELDS.length} fields filled · Verify and edit before approving</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Editable</span>
        </div>
      </div>

      <div className="p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          {PROFILE_FIELDS.map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
              <input
                type="text"
                value={profile[key]}
                onChange={(e) => onChange(key, e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>
          ))}
        </div>

        {approved ? (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            Farmer profile approved and saved to the Farmer Registry!
          </div>
        ) : (
          <button
            onClick={onApprove}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors shadow-sm"
          >
            <ThumbsUp className="h-4 w-4" />
            Approve & Save to Farmer Registry
          </button>
        )}
      </div>
    </div>
  );
}

type DocStates = Record<DocTypeId, ExtractionState>;

const INITIAL_DOC_STATES: DocStates = Object.fromEntries(
  DOC_CARDS.map((c) => [c.id, { ...DEFAULT_STATE }]),
) as DocStates;

export default function NewRegistration() {
  const [docStates, setDocStates] = useState<DocStates>(INITIAL_DOC_STATES);
  const [profile, setProfile] = useState<FarmerProfile>({ ...EMPTY_PROFILE });
  const [approved, setApproved] = useState(false);

  const anyExtracted = Object.values(docStates).some((s) => s.status === "complete");

  useEffect(() => {
    if (!anyExtracted) return;
    const extracted = extractProfileFromSections(docStates);
    setProfile((prev) => {
      const next = { ...prev };
      (Object.keys(extracted) as (keyof FarmerProfile)[]).forEach((k) => {
        if (!prev[k] && extracted[k]) {
          next[k] = extracted[k]!;
        }
      });
      return next;
    });
  }, [docStates, anyExtracted]);

  const handleStateChange = useCallback(
    (docId: DocTypeId) => (updater: ExtractionState | ((s: ExtractionState) => ExtractionState)) => {
      setDocStates((prev) => ({
        ...prev,
        [docId]: typeof updater === "function" ? updater(prev[docId]) : updater,
      }));
    },
    [],
  );

  const handleProfileChange = (field: keyof FarmerProfile, value: string) => {
    setProfile((p) => ({ ...p, [field]: value }));
  };

  const handleApprove = () => {
    addApprovedFarmer({
      id: nextFarmerId(),
      name: profile.name || "Unknown Farmer",
      village: profile.village || "—",
      district: profile.district || "—",
      land: parseFloat(profile.land) || 0,
      crop: profile.crop || "—",
      aadhaar: profile.aadhaar || "—",
      surveyNumber: profile.surveyNumber || "—",
      bankAccount: profile.bankAccount || "—",
      status: "Active",
      source: "ocr",
      addedAt: new Date().toISOString(),
    });
    setApproved(true);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-semibold text-base mb-3">Upload Documents for OCR Extraction</h2>
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2">
          {DOC_CARDS.map((card) => (
            <DocUploadCard
              key={card.id}
              card={card}
              state={docStates[card.id]}
              onStateChange={handleStateChange(card.id)}
            />
          ))}
        </div>
      </div>

      {anyExtracted && (
        <FarmerProfileCard
          profile={profile}
          onChange={handleProfileChange}
          onApprove={handleApprove}
          approved={approved}
        />
      )}
    </div>
  );
}
