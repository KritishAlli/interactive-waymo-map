// The backend runs on Render's free plan, which sleeps after ~15 idle minutes and takes
// 30-60s to wake. Nothing on page load depends on it any more (service areas are bundled,
// geometry and pricing run in the browser); only fare reports go to it.
export const API_URL = import.meta.env.VITE_APP_API_URL || "";

// Fire-and-forget request so a sleeping backend starts waking as soon as the page opens,
// and is usually up by the time someone submits a fare.
export function warmBackend() {
  fetch(`${API_URL}/health`, { cache: "no-store" }).catch(() => {});
}

// Quick check: does /health answer 200 within `ms`? A sleeping backend holds the request
// open while it boots, so a slow answer means it's asleep.
export function isBackendAwake(ms = 1500) {
  return Promise.race([
    fetch(`${API_URL}/health`, { cache: "no-store" }).then((res) => res.ok, () => false),
    new Promise((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

// Poll /health until the backend answers 200. Resolves true when ready, false on timeout.
export async function waitForBackend({ timeoutMs = 90000, intervalMs = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      // network error = still cold starting, keep trying
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
