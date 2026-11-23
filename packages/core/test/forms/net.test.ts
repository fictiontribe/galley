import { describe, expect, it } from "vitest";
import { createGuardedFetch, isPublicAddress, OutboundRefused, type ResolvedAddress, type Transport } from "../../src/forms/net";

/** A resolver with a fixed table, and a transport that records where it would connect. */
function harness(table: Record<string, string[]>, answers: Array<{ status: number; headers?: Record<string, string>; body?: string }> = [{ status: 200, body: "{}" }]) {
  const connections: Array<{ url: string; pinned: ResolvedAddress | null; method: string }> = [];
  const resolved: string[] = [];
  const transport: Transport = async (url, init, pinned) => {
    connections.push({ url: url.toString(), pinned, method: init.method ?? "GET" });
    const answer = answers[Math.min(connections.length - 1, answers.length - 1)]!;

    return { status: answer.status, headers: answer.headers ?? {}, body: answer.body ?? "" };
  };
  const fetcher = createGuardedFetch({
    resolve: async (host) => {
      resolved.push(host);
      const list = table[host];

      if (!list) throw new Error("ENOTFOUND");
      return list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }) as ResolvedAddress);
    },
    transport,
  });

  return { fetcher, connections, resolved };
}

describe("isPublicAddress", () => {
  it.each([
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.20.0.1", false],
    ["192.168.1.10", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["::1", false],
    ["fe80::1", false],
    ["fd00::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:7f00:1", false],
    ["::ffff:10.0.0.1", false],
    ["93.184.216.34", true],
    ["104.16.0.1", true],
    ["2606:4700::6810:1", true],
    ["not-an-ip", false],
  ])("%s → %s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});

describe("createGuardedFetch — the SSRF guards", () => {
  it("refuses http:// unless allowed", async () => {
    const { fetcher, connections } = harness({ "go.example.com": ["93.184.216.34"] });

    await expect(fetcher("http://go.example.com/x")).rejects.toThrow(/Only secure/);
    expect(connections).toHaveLength(0);
    await fetcher("http://go.example.com/x", {}, { allowHttp: true });
    expect(connections).toHaveLength(1);
  });

  it("refuses user names, other hosts and non-default ports", async () => {
    const { fetcher, connections } = harness({ "forms.hsforms.com": ["104.16.0.1"], "evil.example": ["93.184.216.34"] });
    const allowHost = (host: string) => host === "forms.hsforms.com";

    await expect(fetcher("https://user:pw@forms.hsforms.com/")).rejects.toThrow(/user name or password/);
    await expect(fetcher("https://evil.example/", {}, { allowHost })).rejects.toThrow(/isn't an address this provider uses/);
    await expect(fetcher("https://forms.hsforms.com.evil.example/", {}, { allowHost })).rejects.toThrow(OutboundRefused);
    await expect(fetcher("https://forms.hsforms.com:8443/", {}, { allowHost, defaultPortOnly: true })).rejects.toThrow(/port/);
    expect(connections).toHaveLength(0);
  });

  it("resolves first and refuses private, loopback and link-local answers — before connecting", async () => {
    const { fetcher, connections, resolved } = harness({
      "internal.example.com": ["10.0.0.5"],
      "metadata.example.com": ["169.254.169.254"],
      "mixed.example.com": ["93.184.216.34", "127.0.0.1"],
      "v6.example.com": ["::1"],
    });

    for (const host of ["internal.example.com", "metadata.example.com", "mixed.example.com", "v6.example.com"]) {
      await expect(fetcher(`https://${host}/index.php/form/getForm`)).rejects.toThrow(/private or local network/);
    }
    await expect(fetcher("https://127.0.0.1/")).rejects.toThrow(/private or local network/);
    await expect(fetcher("https://[::ffff:127.0.0.1]/")).rejects.toThrow(/private or local network/);
    await expect(fetcher("https://nowhere.example.com/")).rejects.toThrow(/couldn't be found/);
    expect(resolved).toContain("internal.example.com");
    expect(connections).toHaveLength(0);
  });

  it("connects to exactly the address it checked (no second DNS answer)", async () => {
    const { fetcher, connections } = harness({ "go.example.com": ["93.184.216.34"] });

    await fetcher("https://go.example.com/index.php/form/getForm?form=1");
    expect(connections[0]!.pinned).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("allows private addresses only when told to (local-mode webhooks)", async () => {
    const { fetcher, connections } = harness({ localhost: ["127.0.0.1"] });

    await fetcher("http://localhost:4545/hook", { method: "POST", body: "{}" }, { allowHttp: true, allowPrivate: true });
    expect(connections).toHaveLength(1);
  });

  it("follows a redirect only on the same host, and checks it again", async () => {
    const same = harness({ "go.example.com": ["93.184.216.34"] }, [{ status: 302, headers: { location: "/elsewhere" } }, { status: 200, body: "ok" }]);

    expect((await same.fetcher("https://go.example.com/a")).body).toBe("ok");
    expect(same.connections.map((item) => item.url)).toEqual(["https://go.example.com/a", "https://go.example.com/elsewhere"]);
    const other = harness({ "go.example.com": ["93.184.216.34"] }, [{ status: 301, headers: { location: "https://169.254.169.254/latest/meta-data" } }]);

    await expect(other.fetcher("https://go.example.com/a")).rejects.toThrow(/redirected to another site/);
    expect(other.connections).toHaveLength(1);
    const loop = harness({ "go.example.com": ["93.184.216.34"] }, [{ status: 302, headers: { location: "/again" } }]);

    await expect(loop.fetcher("https://go.example.com/a", {}, { maxRedirects: 2 })).rejects.toThrow(/kept redirecting/);
  });
});

describe("nodeTransport limits", () => {
  it("gives up on a slow server and on an oversized answer", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((request, response) => {
      if (request.url === "/slow") return void setTimeout(() => response.end("late"), 2000);
      response.end("x".repeat(5000));
    });

    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    const port = (server.address() as { port: number }).port;
    const fetcher = createGuardedFetch();

    try {
      await expect(fetcher(`http://127.0.0.1:${port}/slow`, {}, { allowHttp: true, allowPrivate: true, timeoutMs: 200 })).rejects.toThrow(/took too long/);
      await expect(fetcher(`http://127.0.0.1:${port}/big`, {}, { allowHttp: true, allowPrivate: true, maxBytes: 1000 })).rejects.toThrow(/larger than expected/);
      expect((await fetcher(`http://127.0.0.1:${port}/big`, {}, { allowHttp: true, allowPrivate: true })).body).toHaveLength(5000);
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  });
});
