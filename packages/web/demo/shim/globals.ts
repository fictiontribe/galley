/**
 * The two Node globals the mock touches, installed before it loads (main.tsx
 * imports the mock only after this). `process.env` is empty — no mock switch
 * is set — and `process.platform` is only read for /api/meta, which the demo
 * answers from the visitor's own computer (demo/server.ts).
 */
import { DemoBuffer } from "./buffer";

const scope = globalThis as unknown as { Buffer?: unknown; process?: { env: Record<string, string | undefined>; platform: string } };
scope.Buffer ??= DemoBuffer;
scope.process ??= { env: {}, platform: "browser" };
