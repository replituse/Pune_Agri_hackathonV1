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

interface RawTable {
  blockId?: string;
  headers: string[];
  rows: string[][];
  html: string;
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
  rawTables: RawTable[];
  textBlocks: string[];
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
  rawTables: [],
  textBlocks: [],
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
  surveyNumber: string;
  puId: string;
  khateNumber: string;
  occupantClass: string;
  ownerNames: string;
  ownerShare: string;
  modeOfAcquisition: string;
  land: string;
  landRevenue: string;
  collectionCharges: string;
  nonAgriculturalArea: string;
  nonCultivatedArea: string;
  tenantName: string;
  tenantRent: string;
  otherRights: string;
  encumbrances: string;
  boundaryMarks: string;
  lastMutationNumber: string;
  lastMutationDate: string;
  pendingMutation: string;
  form8aYear: string;
  form8aReportDate: string;
  khateAccountType: string;
  khatedarNames: string;
  khatedarAddress: string;
  totalAssessment: string;
  totalDamageInherited: string;
  totalZpCess: string;
  totalGpCess: string;
  totalRecovery: string;
  grandTotal: string;
  crop: string;
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
  mobile: "", address: "", pincode: "", state: "", issueDate: "", enrolmentNumber: "",
  village: "", district: "", taluka: "", surveyNumber: "", puId: "",
  khateNumber: "", occupantClass: "", ownerNames: "", ownerShare: "", modeOfAcquisition: "",
  land: "", landRevenue: "", collectionCharges: "", nonAgriculturalArea: "", nonCultivatedArea: "",
  tenantName: "", tenantRent: "", otherRights: "", encumbrances: "", boundaryMarks: "",
  lastMutationNumber: "", lastMutationDate: "", pendingMutation: "",
  form8aYear: "", form8aReportDate: "", khateAccountType: "", khatedarNames: "",
  khatedarAddress: "", totalAssessment: "", totalDamageInherited: "",
  totalZpCess: "", totalGpCess: "", totalRecovery: "", grandTotal: "", crop: "",
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
    const pollUrl = `${BASE_URL}/api/extract/${requestId}`;
    try {
      const res = await fetch(pollUrl);
      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch (parseErr) {
        console.error(
          `[AgriAdmin] Poll attempt ${attempts}: Failed to parse JSON response from ${pollUrl}`,
          { status: res.status, statusText: res.statusText, parseErr },
        );
        onError("API server is unavailable. Please try again in a moment.");
        return;
      }
      if (!res.ok) {
        const msg = (data?.error as string) ?? `Server error ${res.status}`;
        console.error(
          `[AgriAdmin] Poll attempt ${attempts}: Non-OK response from ${pollUrl}`,
          { status: res.status, data },
        );
        onError(msg);
        return;
      }
      if (data.status === "processing") {
        console.debug(`[AgriAdmin] Poll attempt ${attempts}/${maxAttempts}: still processing (requestId=${requestId})`);
        continue;
      }
      if (data.status === "error") {
        const msg = (data.error as string) ?? "Extraction failed.";
        console.error(`[AgriAdmin] Extraction error from server for requestId=${requestId}:`, data);
        onError(msg);
        return;
      }
      if (data.status === "complete") {
        console.info(`[AgriAdmin] Extraction complete for requestId=${requestId} after ${attempts} poll(s)`);
        const markerImages: Record<string, string> | null = data.marker?.images ?? null;
        const aadharPhoto: { base64: string; mimeType: string } | null =
          data.aadhar_photo ?? null;
        onComplete({
          status: "complete",
          requestId,
          sections: data.structured?.sections ?? [],
          images: markerImages,
          rawTables: (data.raw_tables as RawTable[]) ?? [],
          textBlocks: (data.text_blocks as string[]) ?? [],
          aadharPhoto,
          error: null,
        });
        return;
      }
    } catch (err) {
      console.error(
        `[AgriAdmin] Poll attempt ${attempts}: Network error fetching ${pollUrl}`,
        err,
      );
      onError(err instanceof Error ? err.message : "Network error");
      return;
    }
  }
  console.error(`[AgriAdmin] Extraction timed out after ${maxAttempts} poll attempts (requestId=${requestId})`);
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

  // --- Form 7 / 8A / 12 — Location (common across all three) ---
  pick(["village"], "village", ["form7", "form8a", "form12"]);
  pick(["taluka"], "taluka", ["form7", "form8a", "form12"]);
  pick(["district"], "district", ["form7", "form8a", "form12"]);
  pick(["survey_number"], "surveyNumber", ["form7", "form12"]);
  pick(["pu_id"], "puId", ["form7"]);

  // --- Form 7 / 8A — Ownership ---
  pick(["khate_number", "khate number"], "khateNumber", ["form7", "form8a", "form12"]);
  pick(["occupant_class"], "occupantClass", ["form7"]);
  pick(["owner_names", "owner name"], "ownerNames", ["form7"]);
  pick(["owner_share"], "ownerShare", ["form7"]);
  pick(["mode_of_acquisition"], "modeOfAcquisition", ["form7"]);

  // --- Form 7 / 8A — Area & Assessment ---
  pick(["total_area"], "land", ["form7", "form8a"]);
  pick(["land_revenue_assessment"], "landRevenue", ["form7"]);
  pick(["collection_charges"], "collectionCharges", ["form7"]);
  pick(["non_agricultural_area"], "nonAgriculturalArea", ["form7"]);
  pick(["non_cultivated_area"], "nonCultivatedArea", ["form7"]);

  // --- Form 7 — Rights & Encumbrances ---
  pick(["tenant_name"], "tenantName", ["form7"]);
  pick(["tenant_rent"], "tenantRent", ["form7"]);
  pick(["other_rights"], "otherRights", ["form7"]);
  pick(["encumbrances"], "encumbrances", ["form7"]);
  pick(["boundary_and_survey_marks"], "boundaryMarks", ["form7"]);

  // --- Form 7 — Mutation ---
  pick(["last_mutation_number"], "lastMutationNumber", ["form7"]);
  pick(["last_mutation_date"], "lastMutationDate", ["form7"]);
  pick(["pending_mutation"], "pendingMutation", ["form7"]);

  // --- Form 8A — Header & Khatedar ---
  pick(["year"], "form8aYear", ["form8a"]);
  pick(["report_date"], "form8aReportDate", ["form8a"]);
  pick(["account_type", "khata type", "account type"], "khateAccountType", ["form8a"]);
  pick(["khatedar_names", "khatedar name"], "khatedarNames", ["form8a"]);
  pick(["khatedar_address"], "khatedarAddress", ["form8a"]);

  // --- Form 8A — Totals ---
  pick(["total_assessment_or_judi", "total assessment"], "totalAssessment", ["form8a"]);
  pick(["total_damage_on_inherited_land", "total damage"], "totalDamageInherited", ["form8a"]);
  pick(["total_zp_local_cess", "zp local cess"], "totalZpCess", ["form8a"]);
  pick(["total_gp_local_cess", "gp local cess"], "totalGpCess", ["form8a"]);
  pick(["total_recovery_amount", "total recovery"], "totalRecovery", ["form8a"]);
  pick(["grand_total"], "grandTotal", ["form8a"]);

  // --- Form 12 — Crop ---
  pick(["crop_name", "crop"], "crop", ["form12"]);

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

function isSectionAnchorLabel(text: string): boolean {
  return /^\s*[\u0900-\u097F]\s*\)/.test(text ?? "");
}

function splitLabelValue(line: string): { label: string; value: string | null } {
  const trimmed = (line ?? "").trim();
  if (!trimmed) return { label: "", value: null };
  const lastSpace = trimmed.search(/\s+\S+$/);
  if (lastSpace < 0) return { label: trimmed, value: null };
  const label = trimmed.slice(0, lastSpace).trim();
  const value = trimmed.slice(lastSpace).trim();
  if (!label) return { label: trimmed, value: null };
  if (/^[\u0966-\u096F0-9.,/\-()]+$/.test(value)) return { label, value };
  return { label: trimmed, value: null };
}

function SpannedTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  type Cell = { value: string; rowspan: number };
  const grid: (Cell | null)[][] = rows.map((r) => {
    const padded: (Cell | null)[] = r.map((c) => ({ value: c ?? "", rowspan: 1 }));
    while (padded.length < colCount) padded.push({ value: "", rowspan: 1 });
    return padded;
  });
  for (let c = 0; c < colCount; c++) {
    let anchorRow = -1;
    for (let r = 0; r < grid.length; r++) {
      const cell = grid[r][c];
      if (cell === null) continue;
      const isEmpty = !cell.value || cell.value.trim() === "";
      if (!isEmpty) { anchorRow = r; }
      else if (anchorRow >= 0) {
        const anchor = grid[anchorRow][c];
        if (anchor) anchor.rowspan += 1;
        grid[r][c] = null;
      }
    }
  }
  if (colCount > 0) {
    let sectionAnchorRow = -1;
    for (let r = 0; r < grid.length; r++) {
      const cell = grid[r][0];
      if (cell === null) continue;
      if (isSectionAnchorLabel(cell.value)) {
        sectionAnchorRow = r;
      } else if (sectionAnchorRow >= 0) {
        const anchor = grid[sectionAnchorRow][0];
        if (anchor) {
          const sub = (cell.value ?? "").trim();
          if (sub.length > 0) anchor.value = anchor.value ? `${anchor.value}\n${sub}` : sub;
          anchor.rowspan += 1;
        }
        grid[r][0] = null;
      }
    }
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse border border-border text-xs">
        {headers.length > 0 && (
          <thead>
            <tr className="bg-muted/40">
              {headers.map((h, i) => (
                <th key={i} className="border border-border p-2 text-left font-semibold align-top whitespace-pre-wrap">{h || ""}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {grid.map((row, rIdx) => (
            <tr key={rIdx}>
              {row.map((cell, cIdx) => {
                if (cell === null) return null;
                const hasContent = cell.value !== undefined && cell.value !== null && cell.value.length > 0;
                const lines = (cell.value ?? "").split("\n");
                return (
                  <td key={cIdx} rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined} className="border border-border px-2 py-1.5 align-top break-words">
                    {hasContent ? (
                      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 leading-relaxed">
                        {lines.flatMap((line, lIdx) => {
                          const { label, value } = splitLabelValue(line);
                          if (value === null) return [<div key={`${lIdx}-full`} className="col-span-2 whitespace-pre-wrap">{label.length > 0 ? label : "\u00A0"}</div>];
                          return [
                            <div key={`${lIdx}-label`} className="whitespace-pre-wrap">{label}</div>,
                            <div key={`${lIdx}-value`} className="whitespace-pre-wrap text-right tabular-nums">{value}</div>,
                          ];
                        })}
                      </div>
                    ) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FieldsTable({
  sections,
  rawTables = [],
  textBlocks = [],
  docId,
}: {
  sections: SectionData[];
  rawTables?: RawTable[];
  textBlocks?: string[];
  docId?: DocTypeId;
}) {
  if (!sections.length && !rawTables.length && !textBlocks.length) return null;
  return (
    <div className="mt-3 space-y-4">
      {sections.map((sec) => (
        <div key={sec.title}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{sec.title}</p>
          {sec.fields.filter(f => f.value && f.value !== "—").length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <tbody>
                  {sec.fields.filter(f => f.value && f.value !== "—").map((f) => (
                    <tr key={f.key} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5 text-muted-foreground w-2/5 font-medium">{f.label}</td>
                      <td className="px-3 py-1.5 text-foreground break-words">{f.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sec.tables.map((tbl) => tbl.rows.length > 0 && (
            <div key={tbl.key} className="mt-2">
              <p className="text-xs font-semibold text-muted-foreground mb-1">{tbl.label}</p>
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

      {rawTables.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source document tables</p>
          {rawTables.map((tbl, idx) => (
            <div key={tbl.blockId ?? idx} className="border-l-4 border-l-orange-400 bg-card border border-border rounded-md p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-700 mb-2">Table {idx + 1}</p>
              {docId === "form7" ? (
                <SpannedTable headers={tbl.headers} rows={tbl.rows} />
              ) : (
                <div
                  className="[&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_th]:border [&_th]:border-border [&_th]:bg-muted/40 [&_th]:p-2 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top text-foreground"
                  dangerouslySetInnerHTML={{ __html: tbl.html }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {textBlocks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other text from document</p>
          {textBlocks.map((t, i) => (
            <div key={i} className="border-l-4 border-l-blue-400 bg-card border border-border rounded-md px-3 py-2 text-xs whitespace-pre-wrap break-words text-foreground">
              {t}
            </div>
          ))}
        </div>
      )}
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
    const uploadUrl = `${BASE_URL}/api/extract`;
    const body = new FormData();
    body.append("file", file);
    body.append("document_type", card.id);
    body.append("mode", "accurate");
    console.info(`[AgriAdmin] Uploading "${file.name}" (${Math.round(file.size / 1024)} KB) as document_type=${card.id} to ${uploadUrl}`);
    try {
      const res = await fetch(uploadUrl, { method: "POST", body, redirect: "error" });
      let rawText: string;
      let data: Record<string, unknown> | null = null;
      try {
        rawText = await res.text();
      } catch (readErr) {
        console.error(`[AgriAdmin] Upload: Could not read response body from ${uploadUrl}`, { status: res.status, file: file.name, readErr });
        onStateChange({ ...DEFAULT_STATE, filename: file.name, status: "error", error: "API server is unavailable. Please try again in a moment." });
        return;
      }
      try {
        data = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        console.error(
          `[AgriAdmin] Upload: Response is not JSON (status=${res.status} ${res.statusText})`,
          { file: file.name, rawBody: rawText.substring(0, 500) },
        );
        onStateChange({ ...DEFAULT_STATE, filename: file.name, status: "error", error: "API server is unavailable. Please try again in a moment." });
        return;
      }
      if (!res.ok) {
        const errMsg = (data?.error as string) ?? `Upload failed (${res.status})`;
        console.error(
          `[AgriAdmin] Upload: Non-OK response (${res.status}) from ${uploadUrl}`,
          { file: file.name, data },
        );
        onStateChange({ ...DEFAULT_STATE, filename: file.name, status: "error", error: errMsg });
        return;
      }
      const reqId = data?.request_id as string;
      if (!reqId) {
        console.error(`[AgriAdmin] Upload: Server did not return a request_id`, { data });
        onStateChange({ ...DEFAULT_STATE, filename: file.name, status: "error", error: "Server did not return a request ID." });
        return;
      }
      console.info(`[AgriAdmin] Upload accepted, requestId=${reqId}, starting to poll…`);
      onStateChange((prev: ExtractionState) => ({ ...prev, status: "processing", requestId: reqId }));
      setExpanded(true);
      pollUntilDone(
        reqId,
        (result) => { onStateChange((prev: ExtractionState) => ({ ...prev, ...result })); },
        (msg) => { onStateChange((prev: ExtractionState) => ({ ...prev, status: "error", error: msg })); },
      );
    } catch (err) {
      const isRedirect = err instanceof TypeError && String(err.message).toLowerCase().includes("redirect");
      if (isRedirect) {
        console.error(`[AgriAdmin] Upload: Request was redirected (redirect:'error' mode) — API proxy may be misconfigured`, { file: file.name, err });
        onStateChange({ ...DEFAULT_STATE, filename: file.name, status: "error", error: "API server is unavailable. Please try again in a moment." });
      } else {
        console.error(`[AgriAdmin] Upload: Network error sending to ${uploadUrl}`, { file: file.name, err });
        onStateChange({ ...DEFAULT_STATE, filename: file.name, status: "error", error: err instanceof Error ? err.message : "Network error" });
      }
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
              <FieldsTable
                sections={state.sections}
                rawTables={state.rawTables}
                textBlocks={state.textBlocks}
                docId={card.id}
              />
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
    id: "form7",
    label: "Form 7 — Ownership Register",
    docIds: ["form7"],
    headerColor: "text-emerald-700",
    headerBg: "bg-emerald-50 border-emerald-200",
    subHeaderColor: "text-emerald-600",
    subsections: [
      {
        label: "Location",
        fields: [
          { key: "village", label: "Village (गाव)", placeholder: "Village name" },
          { key: "taluka", label: "Taluka (तालुका)", placeholder: "Taluka name" },
          { key: "district", label: "District (जिल्हा)", placeholder: "District name" },
          { key: "surveyNumber", label: "Survey Number (भूमापन क्रमांक)", placeholder: "e.g. 77/3" },
          { key: "puId", label: "PU-ID", placeholder: "Permanent Unique ID" },
        ],
      },
      {
        label: "Ownership",
        fields: [
          { key: "khateNumber", label: "Khate Number (खाते क्र.)", placeholder: "e.g. 159" },
          { key: "occupantClass", label: "Occupant Class (भोगवटदार वर्ग)", placeholder: "e.g. Class 1" },
          { key: "ownerNames", label: "Owner Name(s) (शेताचे स्वामिनाव)", placeholder: "Full name(s)", span: true },
          { key: "ownerShare", label: "Owner Share / Hissa", placeholder: "e.g. 1/2" },
          { key: "modeOfAcquisition", label: "Mode of Acquisition", placeholder: "e.g. Purchase / Inheritance" },
        ],
      },
      {
        label: "Area & Assessment",
        fields: [
          { key: "land", label: "Total Area (क्षेत्र)", placeholder: "e.g. 2.06.00 H.R." },
          { key: "landRevenue", label: "Land Revenue Assessment (आकार)", placeholder: "Annual tax amount" },
          { key: "collectionCharges", label: "Collection Charges (पो.ख.)", placeholder: "Admin fee" },
          { key: "nonAgriculturalArea", label: "Non-Agricultural Area (अकृषिक क्षेत्र)", placeholder: "Area in non-agri use" },
          { key: "nonCultivatedArea", label: "Non-Cultivated Area (बिन शेती)", placeholder: "Uncultivated land" },
        ],
      },
      {
        label: "Rights & Encumbrances",
        fields: [
          { key: "tenantName", label: "Tenant Name (कुळाचे नाव)", placeholder: "Tenant / kul name" },
          { key: "tenantRent", label: "Tenant Rent (खंड)", placeholder: "Rent amount" },
          { key: "otherRights", label: "Other Rights (इतर अधिकार)", placeholder: "Easements, water rights…", span: true },
          { key: "encumbrances", label: "Encumbrance / Mortgage (बोजा / तारण)", placeholder: "Bank name & loan amount", span: true },
          { key: "boundaryMarks", label: "Boundary & Survey Marks", placeholder: "Boundary notes", span: true },
        ],
      },
      {
        label: "Mutation",
        fields: [
          { key: "lastMutationNumber", label: "Last Mutation No. (शेवटचा फेरफार क्र.)", placeholder: "e.g. 742" },
          { key: "lastMutationDate", label: "Last Mutation Date", placeholder: "Date of last mutation" },
          { key: "pendingMutation", label: "Pending Mutation (प्रलंबित फेरफार)", placeholder: "Yes / No / None" },
        ],
      },
    ],
  },
  {
    id: "form12",
    label: "Form 12 — Crop Inspection Register",
    docIds: ["form12"],
    headerColor: "text-green-700",
    headerBg: "bg-green-50 border-green-200",
    subHeaderColor: "text-green-600",
    subsections: [
      {
        label: "Location",
        fields: [
          { key: "village", label: "Village (गाव)", placeholder: "Village name" },
          { key: "taluka", label: "Taluka (तालुका)", placeholder: "Taluka name" },
          { key: "district", label: "District (जिल्हा)", placeholder: "District name" },
          { key: "surveyNumber", label: "Survey Number (भूमापन क्रमांक)", placeholder: "e.g. 77/3" },
          { key: "khateNumber", label: "Khate Number (खाते क्र.)", placeholder: "e.g. 159" },
        ],
      },
      {
        label: "Crop",
        fields: [
          { key: "crop", label: "Primary Crop (पिकांचे नाव)", placeholder: "e.g. Soybean, Wheat, Cotton", span: true },
        ],
      },
    ],
  },
  {
    id: "form8a",
    label: "Form 8A — Holding Register",
    docIds: ["form8a"],
    headerColor: "text-teal-700",
    headerBg: "bg-teal-50 border-teal-200",
    subHeaderColor: "text-teal-600",
    subsections: [
      {
        label: "Header",
        fields: [
          { key: "village", label: "Village (गाव)", placeholder: "Village name" },
          { key: "taluka", label: "Taluka (तालुका)", placeholder: "Taluka name" },
          { key: "district", label: "District (जिल्हा)", placeholder: "District name" },
          { key: "form8aYear", label: "Year (वर्ष)", placeholder: "e.g. 2016-15" },
          { key: "form8aReportDate", label: "Report Date", placeholder: "e.g. 12/20/2016" },
        ],
      },
      {
        label: "Khatedar",
        fields: [
          { key: "khateNumber", label: "Khate Number (खाते क्र.)", placeholder: "e.g. 159" },
          { key: "khateAccountType", label: "Account Type (खात्याचा प्रकार)", placeholder: "e.g. अविभक्त कुटूंब खाते", span: true },
          { key: "khatedarNames", label: "Khatedar Name(s)", placeholder: "Names as per 8A", span: true },
          { key: "khatedarAddress", label: "Khatedar Address", placeholder: "Address of khatedar", span: true },
        ],
      },
      {
        label: "Totals",
        fields: [
          { key: "land", label: "Total Area (एकूण क्षेत्र)", placeholder: "Total area" },
          { key: "totalAssessment", label: "Total Assessment / Judi (एकूण आकारणी)", placeholder: "Total assessment amount" },
          { key: "totalDamageInherited", label: "Total Damage on Inherited Land (दुमाला)", placeholder: "दुमाला जमिनीवरील नुकसान" },
          { key: "totalZpCess", label: "Total ZP Local Cess (जि.प.)", placeholder: "Zilla Parishad cess total" },
          { key: "totalGpCess", label: "Total GP Local Cess (ग्रा.प.)", placeholder: "Gram Panchayat cess total" },
          { key: "totalRecovery", label: "Total Recovery Amount (वसुलीसाठी)", placeholder: "Recovery total" },
          { key: "grandTotal", label: "Grand Total (एकूण)", placeholder: "Final grand total" },
        ],
      },
    ],
  },
];

const ALL_PROFILE_FIELDS = (() => {
  const seen = new Set<string>();
  return PROFILE_SECTIONS.flatMap(s => s.subsections.flatMap(sub => sub.fields)).filter(f => {
    if (seen.has(f.key)) return false;
    seen.add(f.key);
    return true;
  });
})();

function AllExtractedData({ docStates }: { docStates: Record<DocTypeId, ExtractionState> }) {
  const [open, setOpen] = useState(false);
  const cards = DOC_CARDS.filter(c => {
    const s = docStates[c.id];
    return s.status === "complete" && (s.sections.length > 0 || s.rawTables.length > 0 || s.textBlocks.length > 0);
  });
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
                <FieldsTable
                  sections={state.sections}
                  rawTables={state.rawTables}
                  textBlocks={state.textBlocks}
                  docId={card.id}
                />
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
    const checkApi = async () => {
      const healthUrl = `${BASE_URL}/api/document-types`;
      try {
        const res = await fetch(healthUrl);
        if (res.ok) {
          console.info(`[AgriAdmin] API server reachable at ${healthUrl} (${res.status})`);
        } else {
          console.warn(`[AgriAdmin] API server responded with non-OK status ${res.status} at ${healthUrl}`);
        }
      } catch (err) {
        console.error(`[AgriAdmin] API server is NOT reachable at ${healthUrl} — uploads will fail`, err);
      }
    };
    checkApi();
  }, []);

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
