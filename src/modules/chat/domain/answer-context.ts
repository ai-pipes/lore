/** Formatting documents for the model and the browser. Pure. */

/**
 * Rewrites image URLs in document content so the browser fetches them from this Lore server:
 * absolute `https://api.libraries.{library_id}/versions/...` URLs become
 * `/static/libraries/{library_id}/versions/...`, and relative `./file.png` paths become
 * `/static/libraries/{library_id}/versions/{version_id}/images/{slug}/file.png`.
 */
export function rewriteImageUrls(content: string, library_id: string, version_id: string, slug: string): string {
  const rewriteSrc = (src: string): string => {
    const absMatch = src.match(/^https?:\/\/[a-z]+\.libraries\.([^/]+)(\/versions\/.+)$/);
    if (absMatch) return `/static/libraries/${absMatch[1]}${absMatch[2]}`;
    if (src.startsWith('./') || src.startsWith('../')) {
      const filename = src.split('/').pop()!;
      return `/static/libraries/${library_id}/versions/${version_id}/images/${slug}/${filename}`;
    }
    return src;
  };
  // Every pattern stops at the next character that could start another match (`<` for a tag,
  // `[` for alt text, `(` for a target), so no two attempts scan the same text and an
  // unterminated `<img ` or `![` cannot make the rewrite quadratic in the length of the document.
  return content
    .replace(/<img\b[^<>]*>/g, (tag: string) =>
      tag.replace(/(\bsrc=")([^"]+)(")/, (_, pre, src, post) => `${pre}${rewriteSrc(src)}${post}`),
    )
    .replace(/(!\[[^[\]]*\]\()([^()]+)(\))/g, (_, pre, src, post) => `${pre}${rewriteSrc(src)}${post}`);
}

/** `library.slug.parts`, dropping a first slug part equal to the library id. */
export function displayNameOf(library_id: string, slug: string): string {
  const slugParts = slug.split('/');
  const dedupedParts = slugParts[0] === library_id ? slugParts.slice(1) : slugParts;
  return [library_id, ...dedupedParts].join('.');
}
