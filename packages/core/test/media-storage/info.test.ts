import { describe, expect, it } from "vitest";
import { keyPolicy, normalizePrefix, normalizeStorageConfig, publicPolicy, publicUrlOf, settingsProblems } from "../../src/media-storage/info";

const R2 = { connector: "r2", account: "0123456789abcdef0123456789abcdef", bucket: "lowfield-media", publicUrl: "https://media.example.com" };
const S3 = { connector: "s3", region: "eu-west-1", bucket: "lowfield-media", publicUrl: "https://lowfield-media.s3.eu-west-1.amazonaws.com", prefix: "lowfield" };

describe("settings checks", () => {
  it("accepts good R2 and S3 settings", () => {
    expect(settingsProblems(R2)).toEqual([]);
    expect(settingsProblems(S3)).toEqual([]);
  });

  it("names the field for each problem", () => {
    expect(settingsProblems({ ...R2, account: "nope", bucket: "-bad-" }).map((p) => p.field)).toEqual(["account", "bucket"]);
    expect(settingsProblems({ ...S3, region: "Europe (Ireland)" }).map((p) => p.field)).toEqual(["region"]);
    expect(settingsProblems({ ...S3, bucket: "with.dots" })[0]?.message).toMatch(/dots can't be reached over https/);
    expect(settingsProblems({ ...R2, prefix: "../up" }).map((p) => p.field)).toEqual(["prefix"]);
  });

  it("wants https, except on this computer", () => {
    expect(settingsProblems({ ...R2, publicUrl: "http://media.example.com" })[0]?.field).toBe("publicUrl");
    expect(settingsProblems({ ...R2, publicUrl: "http://127.0.0.1:9000/public" })).toEqual([]);
    expect(settingsProblems({ ...R2, publicUrl: "https://media.example.com/?a=1" })[0]?.message).toMatch(/\? or #/);
    expect(settingsProblems({ ...R2, endpoint: "http://r2.example.com" })[0]?.field).toBe("endpoint");
  });

  it("normalises the folder and the address", () => {
    expect(normalizePrefix("/lowfield/")).toBe("lowfield/");
    expect(normalizePrefix("")).toBe("");
    expect(normalizeStorageConfig({ ...R2, publicUrl: "https://media.example.com/", prefix: "a/b", account: R2.account.toUpperCase() })).toEqual({
      ...R2,
      prefix: "a/b/",
    });
  });

  it("encodes each part of a key in a public address", () => {
    expect(publicUrlOf("https://media.example.com/", "lowfield/my photo.jpg")).toBe("https://media.example.com/lowfield/my%20photo.jpg");
  });
});

describe("S3 policies", () => {
  it("limits listing to the site's folder with a prefix condition", () => {
    const policy = JSON.parse(keyPolicy(S3));

    expect(policy.Statement[0]).toEqual({
      Sid: "ListTheSiteFolder",
      Effect: "Allow",
      Action: "s3:ListBucket",
      Resource: "arn:aws:s3:::lowfield-media",
      Condition: { StringLike: { "s3:prefix": ["lowfield/*"] } },
    });
    expect(policy.Statement[1].Resource).toBe("arn:aws:s3:::lowfield-media/lowfield/*");
    expect(policy.Statement[1].Action).toEqual(["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]);
  });

  it("covers the whole bucket when there is no folder", () => {
    const policy = JSON.parse(keyPolicy({ bucket: "b-1" }));

    expect(policy.Statement[0].Condition).toBeUndefined();
    expect(policy.Statement[1].Resource).toBe("arn:aws:s3:::b-1/*");
  });

  it("makes only the site's folder public", () => {
    expect(JSON.parse(publicPolicy(S3)).Statement[0].Resource).toEqual(["arn:aws:s3:::lowfield-media/lowfield/*"]);
  });
});
