import type { State } from "./store";
import { D1_ENTITY_TABLES } from "./d1-records";
import { StorageUnavailableError } from "./storage-error";

export type RecordVersion = { collection: string; id: string; version: number };
/** Tombstones retain versions across deletion/recreation. Empty id denotes a scan. */
export function dependencies(state: State, versions: RecordVersion[]) {
  const available = new Map<string, number>();
  for (const row of versions) {
    if (typeof row.collection !== "string" || typeof row.id !== "string" || !Number.isSafeInteger(row.version) || row.version < 1) throw new StorageUnavailableError();
    available.set(JSON.stringify([row.collection, row.id]), row.version);
  }
  const reads = new Map<string, RecordVersion>();
  function mark(collection: string, id: string) {
    const key = JSON.stringify([collection, id]);
    reads.set(key, { collection, id, version: available.get(key) ?? 0 });
  }
  const maps = new Map<string, object>();
  const originals = new WeakMap<object, { value: object; collection: string }>();
  mark("metadata", "");
  const tracked = new Proxy(state, {
    getOwnPropertyDescriptor(target, property) {
      if (typeof property === "string" && (property === "requests" || Object.hasOwn(D1_ENTITY_TABLES, property))) mark(property, "");
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    get(target, property, receiver) {
      if (property === "requests") mark("requests", "");
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || !Object.hasOwn(D1_ENTITY_TABLES, property) || !value) return value;
      let map = maps.get(property);
      if (!map) {
        map = new Proxy(value, {
          get(t, id, r) { if (typeof id === "string") mark(property, id); return Reflect.get(t, id, r); },
          has(t, id) { if (typeof id === "string") mark(property, id); return Reflect.has(t, id); },
          getOwnPropertyDescriptor(t, id) { if (typeof id === "string") mark(property, id); return Reflect.getOwnPropertyDescriptor(t, id); },
          ownKeys(t) { mark(property, ""); return Reflect.ownKeys(t); },
          set(t, id, v) { if (typeof id === "string") mark(property, id); return Reflect.set(t, id, v); },
          deleteProperty(t, id) { if (typeof id === "string") mark(property, id); return Reflect.deleteProperty(t, id); },
        });
        maps.set(property, map!);
        originals.set(map!, { value, collection: property });
      }
      return map;
    },
    defineProperty(target, property, descriptor) {
      if (typeof property === "string" && (property === "requests" || Object.hasOwn(D1_ENTITY_TABLES, property))) mark(property, "");
      maps.delete(String(property));
      return Reflect.defineProperty(target, property, descriptor);
    },
    deleteProperty(target, property) {
      if (typeof property === "string" && Object.hasOwn(D1_ENTITY_TABLES, property)) mark(property, "");
      maps.delete(String(property));
      return Reflect.deleteProperty(target, property);
    },
    set(target, property, value) {
      if (typeof property === "string" && (property === "requests" || Object.hasOwn(D1_ENTITY_TABLES, property))) mark(property, "");
      maps.delete(String(property));
      return Reflect.set(target, property, value);
    },
  });
  function unwrap<T>(value: T): T {
    const seen = new WeakMap<object, object>();
    function visit(item: unknown): unknown {
      if (item === tracked) {
        for (const field of Object.keys(D1_ENTITY_TABLES)) mark(field, "");
        mark("requests", "");
        return state;
      }
      if (!item || typeof item !== "object") return item;
      const original = originals.get(item);
      if (original) { mark(original.collection, ""); return original.value; }
      const prototype = Object.getPrototypeOf(item);
      if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return item;
      const previous = seen.get(item);
      if (previous) return previous;
      const copy = Array.isArray(item) ? [] : Object.create(prototype);
      seen.set(item, copy);
      for (const key of Reflect.ownKeys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if ("value" in descriptor) descriptor.value = visit(descriptor.value);
        Object.defineProperty(copy, key, descriptor);
      }
      return copy;
    }
    return visit(value) as T;
  }
  return { state: tracked, mark, unwrap, records: () => [...reads.values()] };
}
