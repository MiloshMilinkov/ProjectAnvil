/** Compare excerpts consistently without changing the quote shown to the user. */
export function normalizeSourceExcerpt(excerpt: string): string {
  return excerpt.replace(/\s+/gu, " ").trim();
}
