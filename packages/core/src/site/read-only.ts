/**
 * Makes a piece of plain data read-only, all the way down.
 *
 * The site service keeps one model of the site and reads its own rules from
 * it: what content mode may write, how it publishes, how the preview is
 * run. It hands that same object to everyone who asks (a route, the
 * assistant, a plugin, an adapter's hooks), so anyone who changed what they
 * were given would change those rules for everyone until the model was next
 * loaded. Frozen, a change is an error where it is made (in strict code;
 * loose code's change is silently dropped), never a quiet change of the
 * rules.
 *
 * Plain objects and arrays are frozen. Anything with behaviour of its own (a
 * class instance, a function) is left as it is.
 */
export function readOnly<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  const proto = Object.getPrototypeOf(value) as unknown;

  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return value;
  for (const item of Object.values(value)) readOnly(item, seen);
  return Object.freeze(value);
}
