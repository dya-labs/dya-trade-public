/** Reads a property of an untrusted JSON value; undefined unless `value` is a non-array object. */
export function prop(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Reflect.get(value, name) : undefined;
}
