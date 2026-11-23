// Smaller copies of the demo catalogue's photographs, for srcset: every
// picture the catalogue names gets a 640-pixel-wide WebP beside the
// original, in public/images/_sizes/. A store's own photographs don't need
// this — the store's image service makes sizes on request.
//
//   npm run sizes
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";

const catalogue = JSON.parse(readFileSync("src/data/shop/catalogue.json", "utf8"));
const urls = new Set();

for (const product of catalogue.products) for (const image of product.images ?? []) urls.add(image.url);
for (const collection of catalogue.collections ?? []) if (collection.image) urls.add(collection.image.url);
let made = 0;

for (const url of urls) {
  if (!url.startsWith("/images/")) continue;
  const source = join("public", url);
  const target = join("public", url.replace(/^\/images\//, "/images/_sizes/").replace(/\.(webp|jpe?g|png)$/, "-640.webp"));

  if (!existsSync(source)) {
    console.warn(`missing: ${source}`);
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  await sharp(source).resize({ width: 640 }).webp({ quality: 72 }).toFile(target);
  made++;
}
console.log(`${made} smaller copies in public/images/_sizes/`);
