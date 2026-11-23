/**
 * Field mapping: which name each answer is sent under at a destination.
 * Unmapped fields go under their own name. For the CRMs, the usual field
 * names are offered per field (recognised from its id, type and label), and
 * the fields a provider needs to accept a submission are checked.
 */
import type { FormDestination, FormField } from "@galley/core/kit";
import { isLayout } from "./fieldTypes";
import { sentName } from "./names";

export type Role =
  | "email"
  | "firstName"
  | "lastName"
  | "fullName"
  | "company"
  | "phone"
  | "jobTitle"
  | "country"
  | "message"
  | "website"
  | "city"
  | "state"
  | "postcode"
  | "companySize";

const ROLE_WORDS: Array<[Role, RegExp]> = [
  ["email", /\be-?mail\b/],
  ["firstName", /\b(first|given)[ _-]?name\b|\bfirstname\b|\bfname\b/],
  ["lastName", /\b(last|family|sur)[ _-]?name\b|\blastname\b|\blname\b|\bsurname\b/],
  ["companySize", /\b(company|team|organi[sz]ation)[ _-]?size\b|\bemployees\b|\bheadcount\b/],
  ["company", /\bcompany\b|\borgani[sz]ation\b|\bbusiness\b|\bemployer\b/],
  ["phone", /\bphone\b|\bmobile\b|\btel(ephone)?\b/],
  ["jobTitle", /\bjob[ _-]?title\b|\btitle\b|\brole\b|\bposition\b/],
  ["country", /\bcountry\b/],
  ["message", /\bmessage\b|\bcomments?\b|\bquestion\b|\benquiry\b|\binquiry\b|\bdetails\b/],
  ["website", /\bwebsite\b|\burl\b|\bweb[ _-]?address\b/],
  ["city", /\bcity\b|\btown\b/],
  ["state", /\bstate\b|\bregion\b|\bprovince\b|\bcounty\b/],
  ["postcode", /\bzip\b|\bpost[ _-]?code\b|\bpostal\b/],
  ["fullName", /\bname\b/],
];

/** What a field is for, recognised from its type, id and label. */
export function roleOf(field: Pick<FormField, "id" | "type" | "label">): Role | null {
  // Hidden fields carry tracking (the page address, campaign codes), never a person's details.
  if (field.type === "hidden") return null;
  if (field.type === "email") return "email";
  if (field.type === "tel") return "phone";
  if (field.type === "url") return "website";
  const words = `${field.id.replace(/[_-]+/g, " ")} ${field.label ?? ""}`.toLowerCase();
  for (const [role, pattern] of ROLE_WORDS) if (pattern.test(words)) return role;
  return null;
}

type NameTable = Partial<Record<Role, string>>;

/** The providers' usual field names (their documented defaults). */
const USUAL: Record<string, NameTable> = {
  hubspot: { email: "email", firstName: "firstname", lastName: "lastname", company: "company", phone: "phone", jobTitle: "jobtitle", country: "country", message: "message", website: "website", city: "city", state: "state", postcode: "zip", companySize: "numemployees" },
  marketo: { email: "Email", firstName: "FirstName", lastName: "LastName", company: "Company", phone: "Phone", jobTitle: "Title", country: "Country", website: "Website", city: "City", state: "State", postcode: "PostalCode", companySize: "NumberOfEmployees" },
  salesforce: { email: "email", firstName: "first_name", lastName: "last_name", company: "company", phone: "phone", jobTitle: "title", country: "country", message: "description", website: "URL", city: "city", state: "state", postcode: "zip", companySize: "employees" },
  pardot: { email: "email", firstName: "first_name", lastName: "last_name", company: "company", phone: "phone", jobTitle: "job_title", country: "country", message: "comments", website: "website", city: "city", state: "state", postcode: "zip" },
};

/** Fields the provider needs before it accepts a submission. */
const REQUIRED: Record<string, string[]> = {
  hubspot: ["email"],
  marketo: ["Email"],
  salesforce: ["last_name", "company"],
  pardot: ["email"],
};

/** Fixed values people usually send to each provider. */
const CONSTANT_KEYS: Record<string, string[]> = {
  hubspot: ["lifecyclestage", "hs_lead_status"],
  marketo: ["LeadSource", "leadSourceDetail"],
  salesforce: ["lead_source", "Campaign_ID"],
  pardot: ["source", "campaign_id"],
  galley: ["source"],
  webhook: ["source"],
};

/** Whether the provider has usual names worth offering. */
export function hasUsualNames(provider: string): boolean {
  return Boolean(USUAL[provider]);
}

/** The provider's usual name for this field, if it has one. */
export function usualName(provider: string, field: Pick<FormField, "id" | "type" | "label">): string | null {
  const role = roleOf(field);
  return role ? (USUAL[provider]?.[role] ?? null) : null;
}

/** Every usual name the provider has (for a suggestions list). */
export function usualNames(provider: string): string[] {
  return [...new Set(Object.values(USUAL[provider] ?? {}))];
}

export function requiredNames(provider: string): string[] {
  return REQUIRED[provider] ?? [];
}

export function constantSuggestions(provider: string): string[] {
  return CONSTANT_KEYS[provider] ?? [];
}

/** Fields that send an answer (layout items don't). */
export function sendableFields(fields: readonly FormField[]): FormField[] {
  return fields.filter((field) => !isLayout(field));
}

/** The name a field goes under at this destination. */
export function mappedName(destination: Pick<FormDestination, "mapping">, field: FormField): string {
  return destination.mapping?.[field.id] || sentName(field);
}

/** The provider's required names that no field and no fixed value fills. */
export function unmappedRequired(destination: FormDestination, fields: readonly FormField[]): string[] {
  const sent = new Set(sendableFields(fields).map((field) => mappedName(destination, field)));
  for (const key of Object.keys(destination.constants ?? {})) sent.add(key);
  return requiredNames(destination.provider).filter((name) => !sent.has(name));
}

/** Per field, the usual name when it differs from what is sent now — what "Use the usual names" would change. */
export function usualMappingChanges(destination: FormDestination, fields: readonly FormField[]): Array<{ fieldId: string; name: string }> {
  return sendableFields(fields).flatMap((field) => {
    const usual = usualName(destination.provider, field);
    return usual && usual !== mappedName(destination, field) ? [{ fieldId: field.id, name: usual }] : [];
  });
}
