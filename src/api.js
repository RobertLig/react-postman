const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const TOKEN_KEY = "wayline.accessToken";
const USER_KEY = "wayline.user";
let refreshPromise;

function resolveRole(claims) {
  const roles = claims.flatMap((claim) => Array.isArray(claim) ? claim : claim ? [claim] : [])
    .map((claim) => typeof claim === "string" ? claim : claim?.authority || claim?.name || "")
    .filter(Boolean);
  const adminRole = roles.find((role) => role.replace(/^ROLE_/i, "").toUpperCase() === "ADMIN");
  return adminRole ? "ADMIN" : roles[0] || "";
}

export function getUserRole(user) {
  if (!user || typeof user !== "object") return "";
  return resolveRole([
    user.role,
    user.roles,
    user.authorities,
    user.groups,
    user.userRole,
    user.user_role,
    user.userType,
  ]);
}

export function getTokenRole(token) {
  if (!token) return "";
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(window.atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return resolveRole([
      claims.groups,
      claims["cognito:groups"],
      claims.roles,
      claims.authorities,
      claims.role,
      claims.userRole,
      claims.user_role,
      claims.userType,
      claims.realm_access?.roles,
    ]);
  } catch {
    return "";
  }
}

function getTokenExpiration(token) {
  if (!token) return null;
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(window.atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function getWebSocketUrl(path) {
  const url = new URL(`${API_URL}${path}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export async function uploadFile(uploadUrl, file) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`File upload failed (${response.status})`);
  }
}

export function getStoredToken() {
  return window.sessionStorage.getItem(TOKEN_KEY) || "";
}

export function saveSession(token, user) {
  window.sessionStorage.setItem(TOKEN_KEY, token);
  if (user) window.sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(USER_KEY);
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const text = await response.text();
      const result = text ? JSON.parse(text) : null;
      if (!response.ok || !result?.token) {
        throw new Error("Session expired. Please sign in again.");
      }
      let user = null;
      const storedUser = window.sessionStorage.getItem(USER_KEY);
      if (storedUser) user = JSON.parse(storedUser);
      saveSession(result.token, user);
      window.dispatchEvent(new CustomEvent("wayline:token-refreshed", { detail: { token: result.token } }));
      return result.token;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function apiRequest(path, { method = "GET", body, token, headers = {} } = {}, retry = true) {
  const expiresAt = getTokenExpiration(token);
  if (token && retry && expiresAt !== null && expiresAt <= Date.now() + 30_000) {
    try {
      token = await refreshAccessToken();
    } catch (error) {
      clearSession();
      window.dispatchEvent(new Event("wayline:session-expired"));
      if (error.message === "Session expired. Please sign in again.") throw error;
      throw new Error("Session expired. Please sign in again.");
    }
  }

  const requestHeaders = {
    Accept: "application/json",
    "Accept-Language": navigator.language || "en",
    ...headers,
  };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: requestHeaders,
    credentials: "include",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let result = null;
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      result = text;
    }
  }
  if (response.status === 401 && token && retry && path !== "/auth/refresh") {
    try {
      const newToken = await refreshAccessToken();
      return apiRequest(path, { method, body, token: newToken, headers }, false);
    } catch (error) {
      clearSession();
      window.dispatchEvent(new Event("wayline:session-expired"));
      if (error.message === "Session expired. Please sign in again.") throw error;
      throw new Error("Session expired. Please sign in again.");
    }
  }
  if (!response.ok) {
    const message =
      typeof result === "string"
        ? result
        : result?.message || result?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return result;
}
