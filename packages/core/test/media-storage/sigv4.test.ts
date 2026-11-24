/**
 * The signer against AWS's published Signature Version 4 examples:
 *
 *  - the SigV4 test suite (aws-sig-v4-test-suite: get-vanilla, post-vanilla,
 *    get-vanilla-query-order-key-case, get-vanilla-empty-query-key,
 *    post-x-www-form-urlencoded), credentials AKIDEXAMPLE, 2015-08-30;
 *  - the Amazon S3 API Reference's "Signature Calculations for the
 *    Authorization Header: Transferring Payload in a Single Chunk" examples
 *    (GET Object, PUT Object, GET Bucket Lifecycle, GET Bucket list),
 *    credentials AKIAIOSFODNN7EXAMPLE, 2013-05-24;
 *  - a derived signing key (service "iam", 2015-08-30).
 *
 * Checked on 24 November 2026:
 *  - the five suite signatures against the suite's `.authz` files as
 *    mirrored in botocore (github.com/boto/botocore, develop branch,
 *    tests/unit/auth/aws4_testsuite/<name>/<name>.authz): all five match;
 *  - the four S3 signatures against the page itself,
 *    docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
 *    ("Examples: Signature Calculations"): all four match.
 * The derived signing key could not be found on a current AWS page (the
 * General Reference page it came from is gone); it is reproduced from memory
 * and recomputed independently here. The suite cases exercise the same
 * derivation with the same secret and date, so they cover it either way.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_SHA256, encodeKey, sha256Hex, signRequest, signingKey } from "../../src/media-storage/sigv4";

const SUITE = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
const SUITE_DATE = new Date("2015-08-30T12:36:00Z");
const S3 = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
const S3_DATE = new Date("2013-05-24T00:00:00Z");

function suite(method: string, path: string, extra: Record<string, string> = {}, body = "") {
  return signRequest({
    method,
    url: new URL(`https://example.amazonaws.com${path}`),
    headers: { host: "example.amazonaws.com", ...extra },
    payloadHash: sha256Hex(body),
    region: "us-east-1",
    service: "service",
    credentials: SUITE,
    date: SUITE_DATE,
  });
}

function s3(method: string, path: string, headers: Record<string, string>, body = "") {
  const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;

  return signRequest({
    method,
    url: new URL(`https://examplebucket.s3.amazonaws.com${path}`),
    headers: { "x-amz-content-sha256": payloadHash, ...headers },
    payloadHash,
    region: "us-east-1",
    service: "s3",
    credentials: S3,
    date: S3_DATE,
  });
}

describe("SigV4 test suite", () => {
  it("get-vanilla", () => {
    const signed = suite("GET", "/");

    expect(signed.canonicalRequest).toBe(["GET", "/", "", "host:example.amazonaws.com", "x-amz-date:20150830T123600Z", "", "host;x-amz-date", EMPTY_SHA256].join("\n"));
    expect(signed.signature).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
    expect(signed.headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
    );
  });

  it("post-vanilla", () => {
    expect(suite("POST", "/").signature).toBe("5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b");
  });

  it("get-vanilla-query-order-key-case (parameters sorted)", () => {
    expect(suite("GET", "/?Param2=value2&Param1=value1").signature).toBe("b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500");
  });

  it("get-vanilla-empty-query-key", () => {
    expect(suite("GET", "/?Param1=value1").signature).toBe("a67d582fa61cc504c4bae71f336f98b97f1ea3c7a6bfe1b6e45aec72011b9aeb");
  });

  it("post-x-www-form-urlencoded (a signed body)", () => {
    expect(suite("POST", "/", { "content-type": "application/x-www-form-urlencoded" }, "Param1=value1").signature).toBe(
      "ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a"
    );
  });
});

describe("Amazon S3 API Reference examples", () => {
  it("GET Object with a Range header", () => {
    expect(s3("GET", "/test.txt", { range: "bytes=0-9" }).signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("PUT Object: a key encoded once, extra x-amz header, a signed payload", () => {
    const signed = s3(
      "PUT",
      `/${encodeKey("test$file.text")}`,
      { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      "Welcome to Amazon S3."
    );

    expect(signed.canonicalRequest.split("\n")[1]).toBe("/test%24file.text");
    expect(signed.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  it("GET Bucket Lifecycle: a query parameter without a value", () => {
    expect(s3("GET", "/?lifecycle", {}).signature).toBe("fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
  });

  it("GET Bucket (list objects)", () => {
    expect(s3("GET", "/?max-keys=2&prefix=J", {}).signature).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
});

describe("signing key", () => {
  it("derives the key for service iam, 2015-08-30 (reproduced from memory; see the header)", () => {
    expect(signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20150830", "us-east-1", "iam").toString("hex")).toBe(
      "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9"
    );
  });
});
