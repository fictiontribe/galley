export function parsePublishAt(value: unknown): number | null;
export function isPublished(entryOrData: unknown, now?: Date): boolean;
export function filterPublished<T>(entries: readonly T[], now?: Date): T[];
