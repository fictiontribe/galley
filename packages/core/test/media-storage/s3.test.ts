import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createS3Client, md5Hex, S3Error, S3NetworkError, type S3Client } from "../../src/media-storage/s3";
import { startFakeS3, type FakeS3 } from "./fakes/s3";

let fake: FakeS3;
const KEY = { accessKeyId: "AKIAFAKEFULL0000", secretAccessKey: "full-secret-0123456789abcdefghijklmnop" };

function client(overrides: Partial<Parameters<typeof createS3Client>[0]> = {}): S3Client {
  return createS3Client({ endpoint: fake.endpoint, region: "eu-west-1", bucket: "media", credentials: KEY, pathStyle: true, ...overrides });
}

async function failureOf(work: Promise<unknown>): Promise<S3Error> {
  try {
    await work;
  } catch (error) {
    if (error instanceof S3Error) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

beforeAll(async () => {
  fake = await startFakeS3({ pageSize: 2 });
  fake.addBucket("media", { region: "eu-west-1" });
  fake.addBucket("other", { region: "eu-west-1" });
  fake.addKey({ id: KEY.accessKeyId, secret: KEY.secretAccessKey, buckets: { media: ["read", "write", "list", "delete"] } });
  fake.addKey({ id: "AKIAFAKEREAD0000", secret: "read-secret-0123456789abcdefghijklmn", buckets: { media: ["read", "list"] } });
});
afterAll(() => fake.close());

describe("names with . or .. parts", () => {
  it("are never sent: a URL would resolve them into another object's name", async () => {
    const s3 = client();

    for (const key of ["a/../b.txt", "./b.txt", "a/./b.txt", "..", ""]) {
      await expect(s3.getObject(key), key).rejects.toMatchObject({ code: "InvalidObjectName" });
      await expect(s3.deleteObject(key), key).rejects.toMatchObject({ code: "InvalidObjectName" });
    }
    expect(fake.log.some((entry) => entry.path.includes(".."))).toBe(false);
  });
});

describe("the S3 client against the stand-in", () => {
  it("puts, reads back, heads, lists with paging and deletes", async () => {
    const s3 = client();
    const body = new TextEncoder().encode("hello bucket");

    await s3.headBucket();
    const { etag } = await s3.putObject("images/a b+c/ü.txt", body, { contentType: "text/plain", cacheControl: "public, max-age=31536000, immutable", metadata: { width: "10" } });
    expect(etag).toBe(md5Hex(body));
    const got = await s3.getObject("images/a b+c/ü.txt");
    expect(Buffer.from(got!.body).toString()).toBe("hello bucket");
    expect(got!.metadata.width).toBe("10");
    const head = await s3.headObject("images/a b+c/ü.txt");
    expect(head).toMatchObject({ size: 12, contentType: "text/plain", cacheControl: "public, max-age=31536000, immutable", metadata: { width: "10" } });
    for (const name of ["images/1.txt", "images/2.txt", "images/3.txt", "other/4.txt"]) await s3.putObject(name, body);
    const all = await s3.listAll("images/");
    expect(all.map((object) => object.key)).toEqual(["images/1.txt", "images/2.txt", "images/3.txt", "images/a b+c/ü.txt"]);
    // Two per page on the stand-in: the client followed the continuation tokens.
    expect(fake.log.filter((entry) => entry.method === "GET" && entry.path === "/media").length).toBeGreaterThanOrEqual(2);
    await s3.deleteObject("images/1.txt");
    expect(await s3.headObject("images/1.txt")).toBeNull();
    expect(await s3.getObject("images/1.txt")).toBeNull();
  });

  it("never overwrites with ifAbsent", async () => {
    const s3 = client();

    await s3.putObject("once.txt", new Uint8Array([1]), { ifAbsent: true });
    expect((await failureOf(s3.putObject("once.txt", new Uint8Array([2]), { ifAbsent: true }))).code).toBe("PreconditionFailed");
  });

  it("reads the services' error codes", async () => {
    expect((await failureOf(client({ credentials: { accessKeyId: "AKIANOSUCHKEY000", secretAccessKey: "x".repeat(40) } }).listPage({}))).code).toBe("InvalidAccessKeyId");
    expect((await failureOf(client({ credentials: { ...KEY, secretAccessKey: "wrong-secret-0123456789abcdefghijk" } }).listPage({}))).code).toBe("SignatureDoesNotMatch");
    expect((await failureOf(client({ bucket: "missing" }).listPage({}))).code).toBe("NoSuchBucket");
    expect((await failureOf(client({ bucket: "missing" }).headBucket())).status).toBe(404);
    expect((await failureOf(client({ bucket: "other" }).putObject("x", new Uint8Array([1])))).code).toBe("AccessDenied");
    const reader = client({ credentials: { accessKeyId: "AKIAFAKEREAD0000", secretAccessKey: "read-secret-0123456789abcdefghijklmn" } });
    expect((await failureOf(reader.putObject("x", new Uint8Array([1])))).code).toBe("AccessDenied");
  });

  it("names the right region when the region is wrong", async () => {
    const wrong = client({ region: "us-east-1" });
    const listed = await failureOf(wrong.listPage({}));

    expect(listed.code).toBe("AuthorizationHeaderMalformed");
    expect(listed.region).toBe("eu-west-1");
    const head = await failureOf(wrong.headBucket());
    expect(head.code).toBe("PermanentRedirect");
    expect(head.region).toBe("eu-west-1");
  });

  it("signs again with the server's time when this computer's clock is off", async () => {
    fake.clockOffsetMs = 2 * 60 * 60_000;
    try {
      const before = fake.log.length;

      await client().headObject("once.txt");
      const codes = fake.log.slice(before).map((entry) => entry.code ?? entry.status);
      expect(codes).toEqual(["RequestTimeTooSkewed", 200]);
    } finally {
      fake.clockOffsetMs = 0;
    }
  });

  it("says when the endpoint can't be reached", async () => {
    await expect(client({ endpoint: "http://127.0.0.1:9" }).headBucket()).rejects.toBeInstanceOf(S3NetworkError);
  });

  it("addresses a bucket virtual-hosted: the bucket in the host, the key as the path", async () => {
    const seen: string[] = [];
    const s3 = createS3Client({
      endpoint: "https://s3.eu-west-1.amazonaws.com",
      region: "eu-west-1",
      bucket: "media",
      credentials: KEY,
      pathStyle: false,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
        const verdict = fake.verify({ method: init?.method ?? "GET", url, headers, body: Buffer.from((init?.body as Uint8Array | undefined) ?? new Uint8Array()) });

        seen.push(url.toString());
        return new Response(null, { status: verdict ? verdict.status : 200, headers: { etag: '"abc"' } });
      },
    });

    await s3.putObject("images/coat.webp", new Uint8Array([1, 2, 3]));
    expect(seen[0]).toBe("https://media.s3.eu-west-1.amazonaws.com/images/coat.webp");
  });
});
