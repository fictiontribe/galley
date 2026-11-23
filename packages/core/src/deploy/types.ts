/**
 * The deploy-target contract: one host that can take a folder of built files
 * and serve it at an address. Cloudflare and Vercel are built in; a plugin can
 * add another by implementing this and registering it (see registry.ts).
 */
import type { DeployAccount, DeployKind, DeployProjectCheck, DeployTargetId, DeployTargetInfo, Deployment, SecretName } from "../types";
import type { DeployFile } from "./files";

/** What every call to a host gets. */
export interface DeployContext {
  /** The access key for this host, read from the secrets service just before the call. */
  token: string;
  /** `fetch`, swappable in tests. */
  fetch: typeof fetch;
  /** The host's API origin. Tests and the rehearsal point it at a fake host. */
  apiBase: string;
  signal?: AbortSignal;
}

export interface DeployProgress {
  /** Plain words: "Uploading 37 of 214 files…". */
  detail: string;
  /** 0–1 within the upload step. */
  progress?: number;
}

export interface DeployInput {
  project: string;
  account: string;
  /** Absolute path of the built output folder. */
  dir: string;
  /** Every file to serve, walked and hashed once by the engine. */
  files: DeployFile[];
  kind: DeployKind;
  /** A note shown with the deployment on the host ("Published version 1a2b3c4"). */
  label?: string;
  /** The version it was built from, when known. */
  commit?: string | null;
  /**
   * The folder the site was built in (the temporary worktree for production),
   * for files a host reads from the site rather than from the build output
   * (Vercel's vercel.json).
   */
  siteRoot?: string;
  onProgress: (progress: DeployProgress) => void;
}

export interface DeployOutcome {
  id: string;
  url: string;
  kind: DeployKind;
  createdAt: string;
  /** The project's live address when this deploy revealed or changed it. */
  productionUrl?: string;
}

export interface DeployTarget {
  id: DeployTargetId;
  name: string;
  /** Everything the setup screen shows about this host, except secret status (the engine adds it). */
  info: Omit<DeployTargetInfo, "secrets">;
  /** What the person must provide, for the setup form. */
  credentials: Array<{ secret: SecretName; label: string; help: string; docsUrl: string }>;
  /** Default API origin; overridden in tests and the rehearsal. */
  apiBase: string;
  /** Check the credential works and list where the site can go (accounts / teams). */
  connect(ctx: DeployContext): Promise<{ accounts: DeployAccount[] }>;
  /**
   * Whether `name` can be used in `account`, without creating anything.
   * `ours`: the name is the one this site's deploy settings already name, so
   * a project of that name holding content may be used.
   */
  checkProject(ctx: DeployContext, input: { account: string; name: string; ours?: boolean }): Promise<DeployProjectCheck>;
  /** Create or find the project for this site. Called only once there is something to upload. */
  ensureProject(ctx: DeployContext, input: { account: string; name: string; ours?: boolean }): Promise<{ project: string; productionUrl: string }>;
  /** Upload a built folder and make it reachable. */
  deploy(ctx: DeployContext, input: DeployInput): Promise<DeployOutcome>;
  /** The host's own list of recent deployments, when it can give one. */
  list?(ctx: DeployContext, input: { account: string; project: string }): Promise<Deployment[]>;
}
