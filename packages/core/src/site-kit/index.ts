/**
 * site-kit/ — the engine's knowledge of the site kit (`@galleycms/astro`):
 * recognising its files in a site, describing and checking them with the
 * kit's own schema, the forms list, and "Set it up for me".
 */
export { applySiteKit, kitInfo, looksLikeForm, looksLikeScripts, FORMS_DIR, KIT_DIR, KIT_SETTINGS, SCRIPTS_FILE, VENDOR_HEADER } from "./detect";
export { FORM_FIELDS, SCRIPTS_FIELDS } from "./fields";
export { listForms } from "./forms-list";
export { addedFormCode, formCodeRefusal } from "./guard";
export { createSiteKitJobs, type SiteKitJobs } from "./jobs";
export { formSchema, scriptsSchema, FIELD_TYPES } from "./schema";
export { FIRST_SCRIPTS, firstVisibility, VISIBILITY_FILE, isPublicAddress, planSiteKit, runSiteKitSetup, setInboxEndpoint, type PlanOptions, type SetupOutcome, type SetupProgress } from "./setup";
export { loadKitBundle, type KitBundle } from "./source";
export { kitTrail, validateKitFile, type KitCheckContext, type KitKind } from "./validate";
export { isBaseLayout, wireAstroConfig, wireContentConfig, wireLayout, type WiringResult } from "./wiring";
