import type { NoteType } from "./types";

// Freeform property names are limited to 80 characters. Reserving a longer
// prefix makes structured columns unambiguous even with imported short IDs.
const structuredPrefix = "structured-note-property:v1:".padEnd(80, ":");

export function structuredPropertyKey(typeId: string, fieldId: string): string {
  return `${structuredPrefix}${typeId}:${fieldId}`;
}

export function storedCollectionColumns(
  value: unknown,
  allowStructured: boolean,
): string[] {
  if (!Array.isArray(value)) return [];
  const maximum = allowStructured ? 400 : 80;
  return [
    ...new Set(
      value.filter(
        (item): item is string =>
          typeof item === "string" && item.length > 0 && item.length <= maximum,
      ),
    ),
  ].slice(0, 50);
}

interface CollectionKeys {
  columns: string[];
  sort: string;
  group: string;
  summaryProperty: string;
}

/** Preserve older selections without allowing an old synthetic key to hide text. */
export function normalizeCollectionKeys<T extends CollectionKeys>(
  preferences: T,
  types: NoteType[],
  freeformProperties: Iterable<string>,
): T {
  const freeform = new Set(freeformProperties);
  const replacements = new Map<string, string>(
    types.flatMap((type) =>
      type.fields.map(
        (field) =>
          [
            `structured:${type.id}:${field.id}`,
            structuredPropertyKey(type.id, field.id),
          ] as const,
      ),
    ),
  );
  const normalize = (key: string) =>
    freeform.has(key) ? key : replacements.get(key) || key;
  const normalizeField = (field: string) =>
    field.startsWith("prop:") ? `prop:${normalize(field.slice(5))}` : field;
  return {
    ...preferences,
    columns: [...new Set(preferences.columns.map(normalize))],
    sort: normalizeField(preferences.sort),
    group: normalizeField(preferences.group),
    summaryProperty: normalize(preferences.summaryProperty),
  };
}

/** A custom type may share a built-in name while remaining a distinct group. */
export function collectionTypeName(
  name: string,
  builtInKinds: string[],
): string {
  return builtInKinds.some(
    (kind) => kind.toLocaleLowerCase() === name.toLocaleLowerCase(),
  )
    ? `${name} (custom)`
    : name;
}
