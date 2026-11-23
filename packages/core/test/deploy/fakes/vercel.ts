/**
 * Fake Vercel: file uploads checked against their SHA-1 digest and size,
 * deployments that refuse files never uploaded (`missing_files`), projects,
 * teams, and a deployment that becomes READY after a poll.
 */
import { createHash, randomUUID } from "node:crypto";
import { startFake, type FakeReply, type FakeServer } from "./common";

export interface VercelDeployment {
  id: string;
  kind: "production" | "preview";
  project: string;
  teamId: string | null;
  files: Map<string, Buffer>;
  body: any;
  polls: number;
  /** vercel.json as Vercel would read it: from the root of the deployment's files. */
  config: Record<string, unknown> | null;
}

export interface FakeVercel extends FakeServer {
  token: string;
  projects: Map<string, { teamId: string | null; deployments: number }>;
  deployments: VercelDeployment[];
  stored: Map<string, Buffer>;
  uploads: number;
}

export interface FakeVercelOptions {
  token?: string;
  teams?: Array<{ id: string; slug: string; name: string }>;
  /** Pretend one stored file expired: the first deployment answers missing_files for it. */
  forgetOnce?: boolean;
  /** The deployment ends in ERROR. */
  failBuild?: boolean;
  port?: number;
}

const err = (status: number, code: string, message: string, extra: object = {}): FakeReply => ({ status, body: { error: { code, message, ...extra } } });

export async function startFakeVercel(options: FakeVercelOptions = {}): Promise<FakeVercel> {
  const token = options.token ?? "vercel-test-token-0123456789abcdef";
  const teams = options.teams ?? [{ id: "team_0123456789abcdef", slug: "studio", name: "Studio" }];
  const stored = new Map<string, Buffer>();
  const projects = new Map<string, { teamId: string | null; deployments: number }>();
  const deployments: VercelDeployment[] = [];
  let forget = Boolean(options.forgetOnce);
  let uploads = 0;

  const server = await startFake(
    async (request) => {
      if (request.bearer !== token) return err(403, "forbidden", "Not authorized", { invalidToken: true });
      const path = request.url.pathname;
      const teamId = request.url.searchParams.get("teamId");

      if (teamId && !teams.some((team) => team.id === teamId)) return err(403, "forbidden", "You don't have access to this team");
      if (request.method === "GET" && path === "/v2/user") return { status: 200, body: { user: { id: "user_1", username: "sam", name: "Sam", defaultTeamId: teams[0]?.id ?? null } } };
      if (request.method === "GET" && path === "/v2/teams") return { status: 200, body: { teams, pagination: { count: teams.length } } };
      const project = /^\/v9\/projects\/([^/]+)$/.exec(path)?.[1];

      if (request.method === "GET" && project) {
        const known = projects.get(decodeURIComponent(project));

        return known && known.teamId === teamId ? { status: 200, body: { id: `prj_${project}`, name: project } } : err(404, "not_found", "Project not found");
      }
      if (request.method === "POST" && path === "/v11/projects") {
        const body = request.json<{ name?: string }>();

        if (!body?.name) return err(400, "bad_request", "name is required");
        if (projects.has(body.name)) return err(409, "conflict", "Project already exists");
        projects.set(body.name, { teamId, deployments: 0 });
        return { status: 200, body: { id: `prj_${body.name}`, name: body.name, accountId: teamId ?? "user_1", alias: [] } };
      }
      if (request.method === "POST" && path === "/v2/files") {
        const digest = String(request.headers["x-vercel-digest"] ?? "");
        const size = Number(request.headers["x-now-size"] ?? request.headers["content-length"]);

        if (!/^[0-9a-f]{40}$/.test(digest)) return err(400, "bad_request", "Digest is not valid");
        if (createHash("sha1").update(request.body).digest("hex") !== digest) return err(400, "bad_request", "Digest is not valid");
        if (size !== request.body.byteLength) return err(400, "bad_request", "File size is not valid");
        stored.set(digest, request.body);
        uploads += 1;
        return { status: 200, body: { urls: [] } };
      }
      if (request.method === "POST" && path === "/v13/deployments") {
        const body = request.json<any>();
        const name = body?.project ?? body?.name;
        const known = projects.get(name);

        if (!known || known.teamId !== teamId) return err(404, "not_found", "Project not found");
        if (!Array.isArray(body.files) || body.files.length === 0) return err(400, "bad_request", "files is required for non-git deployments");
        if (known.deployments === 0 && !body.projectSettings) return err(400, "bad_request", "projectSettings is required for the first deployment");
        if (forget && stored.size > 0) {
          forget = false;
          const first = body.files[0].sha as string;

          stored.delete(first);
        }
        const missing = body.files.filter((file: any) => !stored.has(file.sha)).map((file: any) => file.sha);

        if (missing.length) return err(400, "missing_files", "Missing files", { missing });
        const files = new Map<string, Buffer>();

        for (const file of body.files) {
          if (stored.get(file.sha)!.byteLength !== file.size) return err(400, "bad_request", `size of ${file.file} doesn't match`);
          files.set(file.file, stored.get(file.sha)!);
        }
        const id = `dpl_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
        const kind = body.target === "production" ? "production" : "preview";

        known.deployments += 1;
        const configFile = files.get("vercel.json");
        let config: Record<string, unknown> | null = null;

        if (configFile) {
          try {
            config = JSON.parse(configFile.toString("utf8"));
          } catch {
            return err(400, "invalid_vercel_json", "vercel.json isn't valid JSON");
          }
          // A prebuilt upload has no such folder: Vercel would find nothing to serve.
          if (config && typeof config.outputDirectory === "string" && ![...files.keys()].some((path) => path.startsWith(`${config!.outputDirectory}/`))) {
            return err(400, "missing_output", `The output directory ${config.outputDirectory} wasn't found in the deployment`);
          }
        }
        deployments.push({ id, kind, project: name, teamId, files, body, polls: 0, config });
        return { status: 200, body: { id, url: `${name}-${id.slice(4, 13)}-studio.vercel.app`, readyState: "QUEUED", alias: [] } };
      }
      const deployment = /^\/v13\/deployments\/([^/]+)$/.exec(path)?.[1];

      if (request.method === "GET" && deployment) {
        const found = deployments.find((entry) => entry.id === deployment);

        if (!found) return err(404, "not_found", "Deployment not found");
        found.polls += 1;
        const readyState = found.polls < 2 ? "BUILDING" : options.failBuild ? "ERROR" : "READY";

        return {
          status: 200,
          body: {
            id: found.id,
            url: `${found.project}-${found.id.slice(4, 13)}-studio.vercel.app`,
            readyState,
            alias: readyState === "READY" && found.kind === "production" ? [`${found.project}.vercel.app`, `${found.project}-studio.vercel.app`] : [],
          },
        };
      }
      return err(404, "not_found", `No route for ${request.method} ${path}`);
    },
    (bearer) => (bearer === null ? "none" : bearer === token ? "account" : "other"),
    options.port
  );

  return {
    ...server,
    token,
    projects,
    deployments,
    stored,
    get uploads() {
      return uploads;
    },
  };
}
