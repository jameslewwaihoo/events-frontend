const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

export function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = {
    Accept: "application/json",
    ...(options.headers || {}),
  };

  return fetch(url, { ...options, headers });
}
