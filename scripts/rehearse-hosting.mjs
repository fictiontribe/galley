#!/usr/bin/env node
// A rehearsal of "Host the editor online" with no real host: starts the fake
// Fly.io Machines API and the fake Cloudflare API (the same strict fakes the
// tests use) on local ports, and prints the environment to start the real app
// with, so the app's "Host the editor online" — and `galley host` — talk to
// them instead of the real services.
//
//   npx tsx scripts/rehearse-hosting.mjs [--fly-port 4541] [--cloudflare-port 4542]
//       [--install-port 4543] [--evidence /tmp/galley-hosting/evidence.json]
//       [--app-home <the app's GALLEY_HOME>]
//
// Then start the app (or `galley host`) with the variables it prints:
//   GALLEY_HOSTING_FLY_API, GALLEY_HOSTING_CLOUDFLARE_API — the fakes;
//   GALLEY_HOSTING_INSTALL_API — where the new install is reached instead of
//     https://<editor address> (the app still names the editor's hostname);
//   FLY_API_TOKEN, CLOUDFLARE_API_TOKEN — the fakes' own made-up keys.
// The fake Cloudflare account has the domain example.com, so use an address
// like cms.example.com. These variables exist for tests and rehearsals only.
//
// The install itself:
//  - by default a small fake install answers on --install-port (it checks the
//    setup code against the hash the fake Fly.io machine was started with, or,
//    for the other hosts, the one in the app's record under --app-home);
//  - with GALLEY_FAKE_LAUNCH set to a JSON array — a command and its
//    arguments, run without a shell, e.g.
//      GALLEY_FAKE_LAUNCH='["node","packages/cli/bin/galley.js","serve"]'
//    — every machine the fake Fly.io creates becomes that real process: it is
//    started with the machine's environment plus GALLEY_HOME (a folder
//    standing in for the machine's disk, kept across restarts and upgrades),
//    HOME inside it, GALLEY_HOST=127.0.0.1 and GALLEY_PORT=<--install-port>,
//    kept running while the machine runs, and stopped when the machine is
//    stopped, updated or destroyed.
//
// Every call the fakes answered is written to --evidence (no keys in it).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { startFakeCloudflareHosting } from "../packages/core/test/hosting/fakes/cloudflare.ts";
import { startFakeFly } from "../packages/core/test/hosting/fakes/fly.ts";
import { startFakeInstall } from "../packages/core/test/hosting/fakes/install.ts";

const { values } = parseArgs({
  options: {
    "fly-port": { type: "string", default: "4541" },
    "cloudflare-port": { type: "string", default: "4542" },
    "install-port": { type: "string", default: "4543" },
    evidence: { type: "string", default: join(tmpdir(), "galley-hosting", "evidence.json") },
    "app-home": { type: "string" },
    editor: { type: "string", default: "cms.example.com" },
  },
});
const installPort = Number(values["install-port"]);
const evidence = resolve(values.evidence);
const disks = join(dirname(evidence), "disks");
const launch = process.env.GALLEY_FAKE_LAUNCH ? JSON.parse(process.env.GALLEY_FAKE_LAUNCH) : null;

if (launch && (!Array.isArray(launch) || launch.length === 0 || launch.some((part) => typeof part !== "string"))) {
  throw new Error('GALLEY_FAKE_LAUNCH must be a JSON array of strings: a command and its arguments, like ["node","packages/cli/bin/galley.js","serve"].');
}
mkdirSync(disks, { recursive: true });

/** Runs the launch command as the machine, until the machine stops. */
function launchMachine(machine) {
  const volume = machine.config.mounts?.[0]?.volume ?? machine.id;
  const home = join(disks, volume);

  mkdirSync(join(home, "home"), { recursive: true });
  const child = spawn(launch[0], launch.slice(1), {
    env: { PATH: process.env.PATH ?? "", ...machine.config.env, GALLEY_HOME: home, HOME: join(home, "home"), GALLEY_HOST: "127.0.0.1", GALLEY_PORT: String(installPort) },
    stdio: "inherit",
  });

  process.stdout.write(`machine ${machine.id} started: ${launch.join(" ")} (disk ${home})\n`);
  child.on("exit", (code, signal) => process.stdout.write(`machine ${machine.id} stopped (${signal ?? code})\n`));
  return {
    stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill("SIGKILL"), 10_000).unref();
    },
  };
}

const fly = await startFakeFly({ port: Number(values["fly-port"]), ...(launch ? { launch: launchMachine } : {}) });
const cloudflare = await startFakeCloudflareHosting({ port: Number(values["cloudflare-port"]) });

/** The setup code's hash the install was given: the fake machine's, or the one in the app's record. */
function expectedHash() {
  for (const app of fly.apps.values()) for (const machine of app.machines.values()) if (machine.state !== "destroyed") return machine.config.env?.GALLEY_SETUP_TOKEN_SHA256;
  const state = values["app-home"] ? join(resolve(values["app-home"]), "state") : null;

  if (state && existsSync(state)) {
    for (const site of readdirSync(state)) {
      const record = join(state, site, "editor.json");

      if (existsSync(record)) return JSON.parse(readFileSync(record, "utf8")).environment?.GALLEY_SETUP_TOKEN_SHA256;
    }
  }
  return null;
}

let install = null;

if (!launch) {
  install = await startFakeInstall({ editor: values.editor, hash: expectedHash, port: installPort });
}

function write() {
  mkdirSync(dirname(evidence), { recursive: true });
  writeFileSync(
    evidence,
    `${JSON.stringify(
      {
        fly: {
          calls: fly.calls,
          apps: [...fly.apps.values()].map((app) => ({ ...app, volumes: [...app.volumes.values()], machines: [...app.machines.values()], certificates: [...app.certificates.values()] })),
        },
        cloudflare: { calls: cloudflare.calls, records: [...cloudflare.records.values()], tunnels: [...cloudflare.tunnels.values()].map(({ token: _token, ...tunnel }) => tunnel) },
        install: install ? { handovers: install.handovers.map((handover) => ({ ...handover, ...(handover.keys ? { keys: Object.keys(handover.keys) } : {}) })), log: install.log } : "launched",
      },
      null,
      2
    )}\n`
  );
}

setInterval(write, 500);
write();
process.stdout.write(
  [
    `fake Fly.io        ${fly.url}`,
    `fake Cloudflare    ${cloudflare.api} (domain example.com, account “Studio account”)`,
    `the install        http://127.0.0.1:${installPort} (${launch ? `launched: ${launch.join(" ")}` : "a fake install"})`,
    `evidence           ${evidence}`,
    "",
    "Start the app (or `galley host`) with:",
    `  GALLEY_HOSTING_FLY_API=${fly.url}`,
    `  GALLEY_HOSTING_CLOUDFLARE_API=${cloudflare.api}`,
    `  GALLEY_HOSTING_INSTALL_API=http://127.0.0.1:${installPort}`,
    `  FLY_API_TOKEN='${fly.token}'`,
    `  CLOUDFLARE_API_TOKEN='${cloudflare.token}'`,
    "",
  ].join("\n")
);
const stop = () => {
  write();
  void Promise.all([fly.close(), cloudflare.close(), install?.close()]).then(() => process.exit(0));
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
