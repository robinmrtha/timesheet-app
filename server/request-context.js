import { AsyncLocalStorage } from "node:async_hooks";

// Request-scoped so overlapping Worker requests do not share a hub binding.
const requestContext = new AsyncLocalStorage();

export function runWithHub(hub, fn) {
  return requestContext.run({ hub }, fn);
}

export function currentHub() {
  return requestContext.getStore()?.hub;
}
