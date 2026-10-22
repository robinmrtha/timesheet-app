import { NOT_SETUP_MESSAGE } from "../../shared/access.js";
import { NO_ACCESS_MESSAGE } from "../../shared/permissions.js";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let onUnauthorized = () => {};
let onNotSetup = () => {};
let onNoAccess = () => {};

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export function setNotSetupHandler(handler) {
  onNotSetup = handler;
}

export function setNoAccessHandler(handler) {
  onNoAccess = handler;
}

function withBase(path) {
  const base = String(import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${base}${path}`;
}

export async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(withBase(path), {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Network error. Check your connection and try again.", 0);
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: "Unexpected response from the server" };
    }
  }

  if (response.status === 401) {
    onUnauthorized();
    throw new ApiError(data?.error || "Sign in required", 401);
  }
  if (response.status === 403 && data?.error === NOT_SETUP_MESSAGE) {
    onNotSetup();
    throw new ApiError(data.error, 403);
  }
  if (response.status === 403 && data?.error === NO_ACCESS_MESSAGE) {
    onNoAccess();
    throw new ApiError(data.error, 403);
  }
  if (!response.ok) {
    throw new ApiError(data?.error || "Request failed", response.status);
  }
  return data;
}

export function withQuery(path, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
