// Structured data for search engines (schema.org JSON-LD), from the shop's
// own data: a Product with one Offer per variant, and the breadcrumb trail.
import { absolute, site } from "../site";
import { imageSources } from "./data";
import type { ShopProduct } from "./types";

export function productData(product: ShopProduct, url: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    url: absolute(url),
    image: product.images.map((image) => {
      const src = imageSources(image).src;

      return /^https?:\/\//.test(src) ? src : absolute(src);
    }),
    brand: { "@type": "Brand", name: product.vendor || site.name },
    ...(product.productType ? { category: product.productType } : {}),
    offers: product.variants.map((variant) => ({
      "@type": "Offer",
      name: variant.title,
      ...(variant.sku ? { sku: variant.sku } : {}),
      price: variant.price.amount,
      priceCurrency: variant.price.currencyCode,
      availability: variant.availableForSale ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      url: absolute(url),
    })),
  };
}

export function breadcrumbData(items: Array<{ label: string; href: string }>): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.label, item: absolute(item.href) })),
  };
}
