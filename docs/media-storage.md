# Media storage

How a site keeps its media outside its repository: a bucket (Cloudflare R2,
Amazon S3, any S3-compatible store) for any kind of file. The people-facing
page is `apps/site/src/content/docs/configuration/media-storage.md`; this one
is for whoever works on the code (`packages/core/src/media-storage/`).

Not yet run against the live services: everything is checked against strict
stand-ins (`packages/core/test/media-storage/fakes/`). The rehearsal script is
for that.

## The pieces

| File | What it is |
| --- | --- |
| `sigv4.ts` | AWS Signature Version 4, header form, `node:crypto` only. Checked against the published vectors (its test says which, and when). |
| `s3.ts` | The six S3 calls a library needs over `fetch`: HeadBucket, Put (with `If-None-Match: *`), Get, Head, Delete, ListObjectsV2 with paging. Path-style and virtual-hosted addressing; re-signs once with the server's time when the clock is off; reads the services' error codes and the right region from their answers. No SDK. |
| `store.ts` | The `MediaStore` contract and the routing (`placeFile`). |
| `bucket-store.ts` | A bucket as a store, and the sentences for each refusal. |
| `check.ts` | The real check. |
| `info.ts` | What each connector tells the person (the steps with the providers' own names), the two S3 policies, the settings checks. Pure, type-only imports: the web app's mock loads it. |
| `keys.ts` | The keys: `<home>/state/<siteId>/media/secrets.json`, or the environment. |
| `library.ts` | The site's media record: `<home>/state/<siteId>/media/library.json`. |
| `move.ts` | Moving files there and back, and changing a bucket's address. |
| `service.ts` | The service the server, the CLI and the site service use. |
| `router.ts` | What the site service asks of it (`SiteDeps.media`). |
| `contract.ts` | The HTTP shapes. |

## Stores describe themselves

A store says what it can do (`MediaStoreAbilities`) and the engine routes by
that, never by which service it is:

- `accepts` — MIME types (or `"any"`), the largest file, and for pictures the
  largest side and pixel count;
- `naming` — `"galley"` (the name is exactly what Galley asks for) or
  `"service"` (the service gives an id back);
- `address` — `"key"` (public address + name) or `"variant"` (an address that
  ends in a variant the service resizes to);
- `canList`, `knowsDimensions`.

`placeFile(stores, file)` gives the first store that takes the file, else the
repository, and says why each store before it didn't (an upload tells the
person where each file went). A bucket takes anything the library takes.

Every store keeps the same promises: `put` never replaces a name
(`StoreNameTaken`, and the engine tries `-2`, `-3`… as in the repository);
`keyOf(url)` recognises the store's addresses in every form it serves them,
so "used on", moves and address changes find them; `addressPattern()` is an
extended regular expression valid in both git grep's ERE and JavaScript; no
key appears in an answer, an error or a log (`scrub`).

## Settings and keys

`galley.config.json` holds ids and addresses only (`media.storage`):
`connector`, `bucket`, `account` (R2), `region` (S3), `endpoint`,
`pathStyle`, `prefix`, `publicUrl`. One bucket at most.

The key is the site's own (`<home>/state/<siteId>/media/secrets.json`, 0600,
its own file so it never races the site's other keys), else
`GALLEY_MEDIA_ACCESS_KEY_ID` / `GALLEY_MEDIA_SECRET_ACCESS_KEY`. Connecting
saves the settings and a pasted key only after the check passes, so a key that
fails never replaces one that works. A removed site's media keys go with it.

## The check

`runCheck(store)`: reach → write → read → list → public → delete, with a 1×1
PNG every store takes, stopping at the first failure with the field to change.
The test picture is removed even when a later step fails (and the message says
so if that fails too). The public step loads the picture with no key and, for a
`"key"` store, compares the bytes.

**Why the S3 key's policy has a prefix condition on `s3:ListBucket`.** Listing
is limited to the site's folder (`"Condition": {"StringLike": {"s3:prefix":
["<prefix>*"]}}`), and object actions to `arn:aws:s3:::<bucket>/<prefix>*`.
HeadBucket needs `s3:ListBucket` with no condition, so the reach step is a
one-item ListObjectsV2 of the folder instead — the tighter policy works, and
the stand-in refuses HeadBucket for a folder-limited key the way IAM does.
With no folder, the key covers the bucket.

## Uploads, the library, Proof

`site.saveMedia` and `site.listMedia` go through `SiteDeps.media` (the server
and the single-site engine pass the service), so the app, the assistant, MCP
tools and plugins all put files in the same place.

- A file in a store has `path` `bucket:<key>`, `location: "bucket"`, `key`,
  and `url` its full public address. Its pixel size is kept in the record and
  in the object's metadata (`x-amz-meta-width`/`height`), so it is known
  without downloading; a file found by listing gets its size from a HEAD.
- The store is listed at most once a minute; when it can't be, the library
  shows what the record knew and says so (`storeProblems`).
- Uploads not yet used by a published version are `ChangeSet.storeUploads`
  (Proof's *In the bucket*), each with `used` for the working copy. After a
  publish, the ones the published version uses are marked published.
- The app shows a stored file through `GET …/raw?path=bucket:<key>`, read
  from the bucket by the server, so the app's pages still load nothing from
  other origins (its CSP stays `img-src 'self'`).
- Validation accepts an address inside the bucket's folder as a real file.

## Used on, and deletes

`usage(site, url)` runs `git grep -E` for the store's address pattern on the
working copy and on HEAD (the published version), keeping matches whose
`keyOf` is the file's key. `deleteStored` refuses anything either uses; it is
for good, so it needs the publish level.

## Moving

`planMove` changes nothing; `startMove` runs a `media` job (one per site).

- **To a store**: copy (a name already there with the same size counts as
  done; a different file is reported, never replaced), rewrite references
  (`/images/a.webp` → the full address, keeping `?query`/`#hash`), then remove
  the repository's copies nothing else reaches, unless `keepCopies`. A page
  Galley can't write in content mode keeps its files where they are.
- **To the repository**: download into the media folder (same rule for
  names), rewrite references back. The store keeps its files.
- **A new address**: one stored file must load from it first; then every
  reference is rewritten, and only then is `publicUrl` saved.

All of it is safe to run again.

## Who may

| Route | Level |
| --- | --- |
| `GET /api/media-storage/connectors`, `GET …/media/storage`, `GET …/media/usage` | edit |
| `POST …/media/storage/check`, `PUT …/media/storage`, `DELETE …/media/storage`, `POST …/media/storage/move/plan`, `POST …/media/storage/move` | manage |
| `POST …/media/storage/delete` | publish |

The service checks the same levels itself (`guard`), whoever calls. Uploading
is edit, as before; `DELETE …/media` refuses a store path (deleting from a
store has its own route and level).

## Tests and stand-ins

- `fakes/s3.ts` — a strict S3: its own SigV4 verifier, per-key permissions
  (optionally folder-limited), the real error codes, paging, a public origin.
- `service.test.ts`, `library.test.ts`, `move.test.ts` — the check, uploads,
  Proof, used-on, deletes and moves on a real site checkout.
- `packages/web/mock/media-storage.ts` — the same flows for `dev:mock`.

## Sources

Read on 24 November 2026:

- Cloudflare R2: <https://developers.cloudflare.com/r2/api/tokens/>,
  <https://developers.cloudflare.com/r2/buckets/public-buckets/>,
  <https://developers.cloudflare.com/r2/buckets/create-buckets/>,
  <https://developers.cloudflare.com/r2/get-started/>,
  <https://developers.cloudflare.com/r2/api/s3/api/> (If-None-Match on
  PutObject, ListObjectsV2 parameters, region `auto`).
- Amazon S3 and IAM:
  <https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteAccessPermissionsReqd.html>,
  <https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html>,
  <https://docs.aws.amazon.com/IAM/latest/UserGuide/getting-started-workloads.html>,
  <https://docs.aws.amazon.com/IAM/latest/UserGuide/access-keys-admin-managed.html>,
  <https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_manage-attach-detach.html>.
- The SigV4 test suite as mirrored in botocore:
  <https://github.com/boto/botocore/tree/develop/tests/unit/auth/aws4_testsuite>.
