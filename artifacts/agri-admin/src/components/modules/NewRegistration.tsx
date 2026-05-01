import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload, CheckCircle2, XCircle, Loader2, FileText,
  ChevronDown, ChevronUp, User, Landmark, FileStack, Sprout,
  ClipboardCheck, UserCheck, Pencil, ThumbsUp, Camera,
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
  bgColor: string;
}

const DOC_CARDS: DocCard[] = [
  {
    id: "form7",
    label: "Form 7 (Ownership Register)",
    shortLabel: "Form 7",
    description: "Maharashtra 7/12 — अधिकार अभिलेख (Rights Register)",
    icon: FileStack,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
  },
  {
    id: "form12",
    label: "Form 12 (Crop Inspection Register)",
    shortLabel: "Form 12",
    description: "Maharashtra 7/12 — पीक पाहणी (Crop Inspection Register)",
    icon: Sprout,
    color: "text-green-600",
    bgColor: "bg-green-50",
  },
  {
    id: "form8a",
    label: "Form 8A (Holding Register)",
    shortLabel: "Form 8A",
    description: "Maharashtra — धारण जमिनींची नोंदवही (Holding Register)",
    icon: ClipboardCheck,
    color: "text-teal-600",
    bgColor: "bg-teal-50",
  },
  {
    id: "aadhar",
    label: "Aadhaar Card",
    shortLabel: "Aadhaar",
    description: "UIDAI Aadhaar identity card",
    icon: User,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
  },
  {
    id: "bank_passbook",
    label: "Bank Passbook",
    shortLabel: "Passbook",
    description: "Bank account passbook front page",
    icon: Landmark,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
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
  images: Record<string, string> | null;
  /** Server-picked portrait photo (base64 + mimeType). Only set for Aadhaar. */
  aadharPhoto: { base64: string; mimeType: string } | null;
  error: string | null;
}

const DEFAULT_STATE: ExtractionState = {
  status: "idle",
  filename: "",
  requestId: null,
  sections: [],
  images: null,
  aadharPhoto: null,
  error: null,
};

export interface FarmerProfile {
  name: string;
  aadhaar: string;
  vid: string;
  dob: string;
  gender: string;
  fathersName: string;
  mobile: string;
  address: string;
  pincode: string;
  state: string;
  issueDate: string;
  enrolmentNumber: string;
  village: string;
  district: string;
  taluka: string;
  land: string;
  crop: string;
  surveyNumber: string;
  bankName: string;
  branchName: string;
  branchAddress: string;
  ifsc: string;
  micrCode: string;
  bankAccount: string;
  accountType: string;
  accountOpeningDate: string;
  customerIdCif: string;
  nomineeRelationship: string;
  bankHolderName: string;
  bankCustomerAddress: string;
  email: string;
}

const EMPTY_PROFILE: FarmerProfile = {
  name: "", aadhaar: "", vid: "", dob: "", gender: "", fathersName: "",
  mobile: "", address: "", pincode: "", state: "", issueDate: "",
  enrolmentNumber: "", village: "", district: "", taluka: "", land: "",
  crop: "", surveyNumber: "",
  bankName: "", branchName: "", branchAddress: "", ifsc: "", micrCode: "",
  bankAccount: "", accountType: "", accountOpeningDate: "", customerIdCif: "",
  nomineeRelationship: "", bankHolderName: "", bankCustomerAddress: "", email: "",
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
      if (!res.ok) { onError(data?.error ?? `Server error ${res.status}`); return; }
      if (data.status === "processing") continue;
      if (data.status === "error") { onError(data.error ?? "Extraction failed."); return; }
      if (data.status === "complete") {
        const markerImages: Record<string, string> | null = data.marker?.images ?? null;
        const aadharPhoto: { base64: string; mimeType: string } | null =
          data.aadhar_photo ?? null;
        onComplete({
          status: "complete",
          requestId,
          sections: data.structured?.sections ?? [],
          images: markerImages,
          aadharPhoto,
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
  const h = `${field.key} ${field.label}`.toLowerCase();
  return keywords.some((kw) => h.includes(kw));
}

function extractProfileFromStates(
  allStates: Record<DocTypeId, ExtractionState>,
): Partial<FarmerProfile> {
  const out: Partial<FarmerProfile> = {};

  // Strict pick — only looks at the listed doc types, never falls back to others
  const pick = (keywords: string[], field: keyof FarmerProfile, docTypes: DocTypeId[]) => {
    if (out[field]) return;
    for (const docId of docTypes) {
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

  // --- Aadhaar only ---
  pick(["full_name", "name"], "name", ["aadhar"]);
  pick(["aadhaar_number", "aadhaar", "uid", "uidai"], "aadhaar", ["aadhar"]);
  pick(["vid", "virtual_id"], "vid", ["aadhar"]);
  pick(["date_of_birth", "dob"], "dob", ["aadhar"]);
  pick(["gender"], "gender", ["aadhar"]);
  pick(["father", "husband", "guardian", "care_of"], "fathersName", ["aadhar"]);
  pick(["mobile_number", "mobile"], "mobile", ["aadhar"]);
  pick(["address"], "address", ["aadhar"]);
  pick(["pincode", "pin_code", "pin code", "postal"], "pincode", ["aadhar"]);
  pick(["state"], "state", ["aadhar"]);
  pick(["issue_date"], "issueDate", ["aadhar"]);
  pick(["enrolment_number", "enrolment_no"], "enrolmentNumber", ["aadhar"]);

  // --- Bank Passbook only (all fields go to their own dedicated keys) ---
  pick(["bank_name"], "bankName", ["bank_passbook"]);
  pick(["branch_name"], "branchName", ["bank_passbook"]);
  pick(["branch_address"], "branchAddress", ["bank_passbook"]);
  pick(["ifsc_code", "ifsc"], "ifsc", ["bank_passbook"]);
  pick(["micr_code", "micr"], "micrCode", ["bank_passbook"]);
  pick(["account_holder_name"], "bankHolderName", ["bank_passbook"]);
  pick(["customer address", "customer_address"], "bankCustomerAddress", ["bank_passbook"]);
  pick(["account_number"], "bankAccount", ["bank_passbook"]);
  pick(["account_type"], "accountType", ["bank_passbook"]);
  pick(["opening_date"], "accountOpeningDate", ["bank_passbook"]);
  pick(["customer_id"], "customerIdCif", ["bank_passbook"]);
  pick(["nominee_relationship"], "nomineeRelationship", ["bank_passbook"]);
  pick(["email"], "email", ["bank_passbook"]);

  // --- Land records (Form 7 / 8A / 12) only ---
  pick(["village", "gram"], "village", ["form7", "form8a", "form12"]);
  pick(["district", "jilha"], "district", ["form7", "form8a"]);
  pick(["taluka"], "taluka", ["form7", "form8a"]);
  pick(["area", "land", "holding", "total_area"], "land", ["form8a", "form7"]);
  pick(["crop_name", "crop"], "crop", ["form12"]);
  pick(["survey", "gat", "plot", "khata"], "surveyNumber", ["form7", "form8a"]);

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
                      {tbl.columns.map(c => <th key={c.key} className="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {tbl.rows.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        {tbl.columns.map(c => <td key={c.key} className="px-3 py-1.5 text-foreground">{row.values[c.key] ?? "—"}</td>)}
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

  const handleFile = useCallback(async (file: File) => {
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
        (result) => { onStateChange((prev: ExtractionState) => ({ ...prev, ...result })); },
        (msg) => { onStateChange((prev: ExtractionState) => ({ ...prev, status: "error", error: msg })); },
      );
    } catch (err) {
      onStateChange({ ...DEFAULT_STATE, filename: file.name, status: "error", error: err instanceof Error ? err.message : "Network error" });
    }
  }, [card.id, onStateChange]);

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
  const photoSrc = card.id === "aadhar" && state.aadharPhoto
    ? `data:${state.aadharPhoto.mimeType};base64,${state.aadharPhoto.base64}`
    : null;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`mt-0.5 flex-shrink-0 ${card.color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-foreground leading-tight">{card.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{card.description}</p>
              {state.filename && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <FileText className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{state.filename}</span>
                </p>
              )}
            </div>
            {photoSrc && (
              <div className="flex-shrink-0">
                <img
                  src={photoSrc}
                  alt="Aadhaar photo"
                  className="w-14 h-16 object-cover rounded-md border border-border shadow-sm"
                />
              </div>
            )}
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

type ProfileField = { key: keyof FarmerProfile; label: string; placeholder: string; span?: boolean };
type ProfileSubsection = { label: string; fields: ProfileField[] };

const PROFILE_SECTIONS: {
  id: string;
  label: string;
  docIds: DocTypeId[];
  headerColor: string;
  headerBg: string;
  subHeaderColor: string;
  subsections: ProfileSubsection[];
}[] = [
  {
    id: "identity",
    label: "Aadhaar Card",
    docIds: ["aadhar"],
    headerColor: "text-violet-700",
    headerBg: "bg-violet-50 border-violet-200",
    subHeaderColor: "text-violet-500",
    subsections: [
      {
        label: "Identity",
        fields: [
          { key: "name", label: "Full Name", placeholder: "Farmer's full name", span: true },
          { key: "gender", label: "Gender", placeholder: "Male / Female" },
          { key: "dob", label: "Date of Birth", placeholder: "DD/MM/YYYY" },
          { key: "aadhaar", label: "Aadhaar Number", placeholder: "XXXX XXXX XXXX" },
          { key: "vid", label: "Virtual ID (VID)", placeholder: "16-digit Virtual ID" },
          { key: "fathersName", label: "Father's / Husband's / Guardian's Name", placeholder: "Guardian name", span: true },
        ],
      },
      {
        label: "Address",
        fields: [
          { key: "address", label: "Address", placeholder: "Residential address", span: true },
          { key: "pincode", label: "PIN Code", placeholder: "6-digit PIN" },
          { key: "state", label: "State", placeholder: "State name" },
        ],
      },
      {
        label: "Document",
        fields: [
          { key: "issueDate", label: "Issue Date", placeholder: "DD/MM/YYYY" },
          { key: "mobile", label: "Mobile Number", placeholder: "10-digit number" },
          { key: "enrolmentNumber", label: "Enrolment No.", placeholder: "e.g. 0855/04021/00568" },
        ],
      },
    ],
  },
  {
    id: "bank",
    label: "Bank Passbook",
    docIds: ["bank_passbook"],
    headerColor: "text-blue-700",
    headerBg: "bg-blue-50 border-blue-200",
    subHeaderColor: "text-blue-500",
    subsections: [
      {
        label: "Bank & Branch",
        fields: [
          { key: "bankName", label: "Bank Name", placeholder: "e.g. State Bank of India" },
          { key: "branchName", label: "Branch Name", placeholder: "e.g. Samta Nagar Thane" },
          { key: "branchAddress", label: "Branch Address", placeholder: "Branch full address", span: true },
          { key: "ifsc", label: "IFSC Code", placeholder: "e.g. SBIN0013035" },
          { key: "micrCode", label: "MICR Code", placeholder: "9-digit MICR code" },
        ],
      },
      {
        label: "Account Holder",
        fields: [
          { key: "bankHolderName", label: "Account Holder Name", placeholder: "Full name of account holder", span: true },
          { key: "nomineeRelationship", label: "Nominee Relationship", placeholder: "e.g. S/D/H/o" },
          { key: "email", label: "Email Address", placeholder: "e.g. name@bank.in" },
          { key: "bankCustomerAddress", label: "Customer Address", placeholder: "Customer's mailing address", span: true },
        ],
      },
      {
        label: "Account Details",
        fields: [
          { key: "bankAccount", label: "Account Number", placeholder: "Account number" },
          { key: "accountType", label: "Account Type", placeholder: "e.g. Regular Savings Bank Account", span: true },
          { key: "customerIdCif", label: "Customer ID (CIF)", placeholder: "CIF number" },
          { key: "accountOpeningDate", label: "Account Opening Date", placeholder: "DD/MM/YYYY" },
        ],
      },
    ],
  },
  {
    id: "land",
    label: "Land Records — Form 7 / 8A / 12",
    docIds: ["form7", "form8a", "form12"],
    headerColor: "text-amber-700",
    headerBg: "bg-amber-50 border-amber-200",
    subHeaderColor: "text-amber-500",
    subsections: [
      {
        label: "Location",
        fields: [
          { key: "village", label: "Village / Gram", placeholder: "Village name" },
          { key: "taluka", label: "Taluka", placeholder: "Taluka name" },
          { key: "district", label: "District", placeholder: "District name" },
        ],
      },
      {
        label: "Land & Crop",
        fields: [
          { key: "land", label: "Land Area", placeholder: "e.g. 3.5 hectares" },
          { key: "crop", label: "Primary Crop", placeholder: "e.g. Cotton" },
          { key: "surveyNumber", label: "Survey / Gat Number", placeholder: "e.g. 123/4" },
        ],
      },
    ],
  },
];

const ALL_PROFILE_FIELDS = PROFILE_SECTIONS.flatMap(s => s.subsections.flatMap(sub => sub.fields));

function AllExtractedData({ docStates }: { docStates: Record<DocTypeId, ExtractionState> }) {
  const [open, setOpen] = useState(false);
  const cards = DOC_CARDS.filter(c => docStates[c.id].status === "complete" && docStates[c.id].sections.length > 0);
  if (!cards.length) return null;

  const totalFields = cards.reduce((sum, c) =>
    sum + docStates[c.id].sections.reduce((s, sec) => s + sec.fields.filter(f => f.value && f.value !== "—").length, 0), 0
  );

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors"
      >
        <span>All Extracted Document Data <span className="text-muted-foreground font-normal ml-1">({totalFields} total fields from {cards.length} document{cards.length > 1 ? "s" : ""})</span></span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-5">
          {cards.map(card => {
            const Icon = card.icon;
            const state = docStates[card.id];
            const photoSrc = card.id === "aadhar" && state.aadharPhoto
              ? `data:${state.aadharPhoto.mimeType};base64,${state.aadharPhoto.base64}` : null;
            return (
              <div key={card.id}>
                <div className={`flex items-center gap-2 mb-2 p-2 rounded-lg ${card.bgColor}`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                  <span className={`text-xs font-semibold ${card.color}`}>{card.label}</span>
                  {photoSrc && (
                    <div className="ml-auto flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5 text-blue-500" />
                      <span className="text-xs text-blue-600 font-medium">Photo extracted</span>
                    </div>
                  )}
                </div>
                {photoSrc && (
                  <div className="mb-2 flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <img
                      src={photoSrc}
                      alt="Aadhaar profile photo"
                      className="w-20 h-24 object-cover rounded-md border-2 border-white shadow-md"
                    />
                    <div>
                      <p className="text-xs font-semibold text-blue-800">Profile Photo</p>
                      <p className="text-xs text-blue-600 mt-0.5">Extracted from Aadhaar Card</p>
                    </div>
                  </div>
                )}
                <FieldsTable sections={state.sections} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FarmerProfileCard({
  docStates,
  profile,
  onChange,
  onApprove,
  approved,
}: {
  docStates: Record<DocTypeId, ExtractionState>;
  profile: FarmerProfile;
  onChange: (field: keyof FarmerProfile, value: string) => void;
  onApprove: () => void;
  approved: boolean;
}) {
  const filledCount = ALL_PROFILE_FIELDS.filter(f => Boolean(profile[f.key])).length;
  const photoSrc = docStates["aadhar"]?.aadharPhoto
    ? `data:${docStates["aadhar"].aadharPhoto.mimeType};base64,${docStates["aadhar"].aadharPhoto.base64}`
    : null;

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-card shadow-md overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-primary/5 border-b border-primary/20">
        <div className="flex items-center gap-3">
          {photoSrc ? (
            <img
              src={photoSrc}
              alt="Farmer photo"
              className="w-12 h-14 object-cover rounded-lg border-2 border-white shadow-md"
            />
          ) : (
            <div className="w-12 h-14 rounded-lg bg-primary/15 flex items-center justify-center border-2 border-white shadow-md">
              <UserCheck className="h-6 w-6 text-primary" />
            </div>
          )}
          <div>
            <h3 className="font-semibold text-sm text-foreground">
              {profile.name || "Auto-Built Farmer Profile"}
            </h3>
            <p className="text-xs text-muted-foreground">{filledCount} of {ALL_PROFILE_FIELDS.length} fields filled · Verify and edit before approving</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Editable</span>
        </div>
      </div>

      <div className="p-5 space-y-6">
        {PROFILE_SECTIONS.map((section) => {
          const isExtracted = section.docIds.some(id => docStates[id]?.status === "complete");
          const allFields = section.subsections.flatMap(sub => sub.fields);
          const sectionFilled = allFields.filter(f => Boolean(profile[f.key])).length;
          return (
            <div key={section.id}>
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg border mb-4 ${section.headerBg}`}>
                <span className={`text-xs font-bold tracking-wide uppercase ${section.headerColor}`}>
                  {section.label}
                </span>
                <span className={`text-xs font-medium ${section.headerColor} opacity-70`}>
                  {isExtracted ? `${sectionFilled} / ${allFields.length} filled` : "Upload document to extract"}
                </span>
              </div>
              <div className="space-y-5">
                {section.subsections.map((sub) => (
                  <div key={sub.label}>
                    <p className={`text-[10px] font-semibold tracking-widest uppercase mb-2 ${section.subHeaderColor}`}>
                      {sub.label}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {sub.fields.map(({ key, label, placeholder, span }) => (
                        <div key={key} className={span ? "sm:col-span-2" : ""}>
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
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <AllExtractedData docStates={docStates} />

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
    const extracted = extractProfileFromStates(docStates);
    setProfile((prev) => {
      const next = { ...prev };
      (Object.keys(extracted) as (keyof FarmerProfile)[]).forEach((k) => {
        if (!prev[k] && extracted[k]) next[k] = extracted[k]!;
      });
      return next;
    });
  }, [docStates, anyExtracted]);

  const handleStateChange = useCallback(
    (docId: DocTypeId) => (updater: StateUpdater) => {
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
      village: profile.village || profile.taluka || "—",
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
          docStates={docStates}
          profile={profile}
          onChange={handleProfileChange}
          onApprove={handleApprove}
          approved={approved}
        />
      )}
    </div>
  );
}
