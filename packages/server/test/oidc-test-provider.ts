/**
 * An OpenID Connect provider that runs inside the tests: real discovery,
 * real keys, real signatures, a token endpoint that checks PKCE — and a
 * switch for doing each thing wrong. Only what the editor's sign-in uses.
 */
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign, constants, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Alg = "RS256" | "PS256" | "ES256" | "EdDSA";

interface Key {
  kid: string;
  alg: Alg;
  privateKey: KeyObject;
  publicJwk: Record<string, unknown>;
}

function makeKey(kid: string, alg: Alg): Key {
  const pair =
    alg === "ES256" ? generateKeyPairSync("ec", { namedCurve: "P-256" }) : alg === "EdDSA" ? generateKeyPairSync("ed25519") : generateKeyPairSync("rsa", { modulusLength: 2048 });

  return { kid, alg, privateKey: pair.privateKey, publicJwk: { ...(pair.publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid, use: "sig", alg } };
}

const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/** A JWS in compact form, signed as `header.alg` says (or not at all for `none`). */
export function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, key: KeyObject | Buffer | null): string {
  const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
  const data = Buffer.from(input);
  const alg = header.alg;
  let signature: Buffer;

  if (alg === "none") signature = Buffer.alloc(0);
  else if (alg === "HS256") signature = createHmac("sha256", key as Buffer).update(data).digest();
  else if (alg === "RS256") signature = sign("sha256", data, key as KeyObject);
  else if (alg === "PS256") signature = sign("sha256", data, { key: key as KeyObject, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
  else if (alg === "ES256") signature = sign("sha256", data, { key: key as KeyObject, dsaEncoding: "ieee-p1363" });
  else signature = sign(null, data, key as KeyObject);
  return `${input}.${b64(signature)}`;
}

/** Who signs in at the provider: their claims. */
export interface ProviderUser {
  sub: string;
  name?: unknown;
  email?: unknown;
  email_verified?: unknown;
  [claim: string]: unknown;
}

/** Each switch does one thing wrong. */
export interface Wrongs {
  // discovery
  noS256?: boolean;
  issuerInDocument?: string;
  discoveryStatus?: number;
  discoveryRedirect?: boolean;
  discoveryBytes?: number;
  issParameterSupported?: boolean;
  // the authorization answer
  omitIss?: boolean;
  wrongIss?: string;
  error?: { error: string; description?: string };
  // the token endpoint
  ignorePkce?: boolean;
  tokenStatus?: number;
  tokenBytes?: number;
  /** The token endpoint refuses the code with this error, and a description that repeats the code. */
  tokenError?: string;
  // the ID token: its header, its claims, how it is signed
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  dropClaims?: string[];
  /** Sign with this key id from `extraKeys` (published or not). */
  signWith?: string;
  /** HS256 with the published key's own text as the secret. */
  hmacWithPublicKey?: boolean;
  noneAlg?: boolean;
}

export interface TestProvider {
  issuer: string;
  /** The issuer as GALLEY_OIDC_ISSUER should say it. */
  url: string;
  user: ProviderUser;
  wrong: Wrongs;
  /** Keys made besides the main one; `published` ones are in the JWKS. */
  extraKeys: Map<string, Key & { published: boolean; publicJwkOverride?: Record<string, unknown> }>;
  /** Codes handed out, by code: what the authorization request asked for. */
  codes: Map<string, { challenge: string | null; nonce: string; redirectUri: string; clientId: string; used: boolean }>;
  /** Requests the provider was asked, in order: `GET /authorize`, `POST /token`, … */
  asked: string[];
  /** The Authorization header the token endpoint was sent last. */
  lastTokenAuth: string | null;
  addKey(kid: string, alg: Alg, options?: { published?: boolean; jwk?: Record<string, unknown> }): void;
  /** The provider's answer to an authorization URL: the callback address it sends the browser to. */
  authorize(url: string): Promise<string>;
  close(): Promise<void>;
}

/** Starts the provider on this computer. `alg` is the main key's. */
export async function startTestProvider(options: { alg?: Alg; clientId?: string; clientSecret?: string } = {}): Promise<TestProvider> {
  const main = makeKey("main", options.alg ?? "RS256");
  const clientId = options.clientId ?? "galley-test-client";
  let server!: Server;

  await new Promise<void>((resolve) => {
    server = createServer((req, res) => void handle(req, res));
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const provider: TestProvider = {
    issuer: url,
    url,
    user: { sub: "subject-1", name: "Pat Provider", email: "pat@example.com", email_verified: true, galley_role: "editor" },
    wrong: {},
    extraKeys: new Map(),
    codes: new Map(),
    asked: [],
    lastTokenAuth: null,
    addKey(kid, alg, keyOptions = {}) {
      const key = makeKey(kid, alg);

      provider.extraKeys.set(kid, { ...key, published: keyOptions.published ?? true, ...(keyOptions.jwk ? { publicJwkOverride: { ...key.publicJwk, ...keyOptions.jwk } } : {}) });
    },
    async authorize(address) {
      const answer = await fetch(address, { redirect: "manual" });

      if (answer.status !== 302) throw new Error(`the test provider answered ${answer.status}`);
      return answer.headers.get("location")!;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };

  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    const text = typeof body === "string" ? body : JSON.stringify(body);

    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(text);
  }

  async function bodyOf(req: IncomingMessage): Promise<URLSearchParams> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) chunks.push(chunk as Buffer);
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  }

  function idToken(code: { nonce: string; clientId: string }): string {
    const { wrong } = provider;
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = { iss: provider.issuer, aud: code.clientId, iat: now, exp: now + 300, nonce: code.nonce, ...provider.user, ...(wrong.claims ?? {}) };

    for (const name of wrong.dropClaims ?? []) delete claims[name];
    const extra = wrong.signWith ? provider.extraKeys.get(wrong.signWith)! : null;
    const key = extra ?? main;

    if (wrong.noneAlg) return signJwt({ alg: "none", typ: "JWT" }, claims, null);
    if (wrong.hmacWithPublicKey) return signJwt({ alg: "HS256", kid: main.kid }, claims, Buffer.from(JSON.stringify(main.publicJwk)));
    return signJwt({ alg: key.alg, kid: key.kid, typ: "JWT", ...(wrong.header ?? {}) }, claims, key.privateKey);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const at = new URL(req.url ?? "/", url);
    const { wrong } = provider;

    provider.asked.push(`${req.method} ${at.pathname}`);
    if (at.pathname === "/.well-known/openid-configuration") {
      if (wrong.discoveryRedirect) return send(res, 302, "", { location: `${url}/elsewhere` });
      if (wrong.discoveryStatus) return send(res, wrong.discoveryStatus, { error: "server_error" });
      const document: Record<string, unknown> = {
        issuer: wrong.issuerInDocument ?? provider.issuer,
        authorization_endpoint: `${url}/authorize`,
        token_endpoint: `${url}/token`,
        jwks_uri: `${url}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256", "PS256", "ES256", "EdDSA"],
        ...(wrong.noS256 ? {} : { code_challenge_methods_supported: ["S256"] }),
        ...(wrong.issParameterSupported ? { authorization_response_iss_parameter_supported: true } : {}),
      };

      if (wrong.discoveryBytes) document.padding = "x".repeat(wrong.discoveryBytes);
      return send(res, 200, document);
    }
    if (at.pathname === "/jwks") {
      const keys = [main.publicJwk, ...[...provider.extraKeys.values()].filter((key) => key.published).map((key) => key.publicJwkOverride ?? key.publicJwk)];

      return send(res, 200, { keys });
    }
    if (at.pathname === "/authorize") {
      const q = at.searchParams;
      const redirectUri = q.get("redirect_uri") ?? "";
      const back = new URL(redirectUri);

      if (wrong.error) {
        back.searchParams.set("error", wrong.error.error);
        if (wrong.error.description) back.searchParams.set("error_description", wrong.error.description);
      } else {
        const code = randomBytes(16).toString("base64url");

        provider.codes.set(code, { challenge: q.get("code_challenge"), nonce: q.get("nonce") ?? "", redirectUri, clientId: q.get("client_id") ?? "", used: false });
        back.searchParams.set("code", code);
      }
      back.searchParams.set("state", q.get("state") ?? "");
      if (!wrong.omitIss) back.searchParams.set("iss", wrong.wrongIss ?? provider.issuer);
      res.writeHead(302, { location: back.href });
      res.end();
      return;
    }
    if (at.pathname === "/token" && req.method === "POST") {
      const body = await bodyOf(req);

      provider.lastTokenAuth = req.headers.authorization ?? null;
      if (wrong.tokenStatus) return send(res, wrong.tokenStatus, { error: "server_error" });
      if (wrong.tokenError) return send(res, 400, { error: wrong.tokenError, error_description: `The code ${body.get("code")} can't be used.` });
      const code = provider.codes.get(body.get("code") ?? "");

      if (!code || code.used) return send(res, 400, { error: "invalid_grant" });
      code.used = true;
      if (body.get("redirect_uri") !== code.redirectUri) return send(res, 400, { error: "invalid_grant" });
      if (options.clientSecret) {
        // RFC 6749 2.3.1: each part was form-encoded before Basic; a provider decodes before it compares.
        const decode = (text: string) => decodeURIComponent(text.replace(/\+/g, " "));
        const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? "")?.[1];
        const [id = "", secret = ""] = basic ? Buffer.from(basic, "base64").toString("utf8").split(":") : [];

        if (decode(id) !== clientId || decode(secret) !== options.clientSecret) return send(res, 401, { error: "invalid_client" });
      }
      // A provider that checks PKCE refuses a verifier that doesn't match; one that ignores it takes anything.
      if (!wrong.ignorePkce && code.challenge !== createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url")) return send(res, 400, { error: "invalid_grant" });
      const answer: Record<string, unknown> = { access_token: randomBytes(16).toString("base64url"), token_type: "Bearer", expires_in: 300, id_token: idToken(code) };

      if (wrong.tokenBytes) {
        // Streamed in pieces, so a reader that only checks the size after reading would read it all.
        res.writeHead(200, { "content-type": "application/json" });
        const piece = "x".repeat(8 * 1024);

        res.write(`{"padding":"`);
        for (let sent = 0; sent < wrong.tokenBytes; sent += piece.length) res.write(piece);
        res.end(`","access_token":"a","token_type":"Bearer","id_token":"${answer.id_token}"}`);
        return;
      }
      return send(res, 200, answer);
    }
    send(res, 404, { error: "not_found" });
  }

  return provider;
}
