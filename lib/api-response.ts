export async function readApiResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`The server returned an unexpected response (HTTP ${response.status}). Please retry; if the problem continues, refresh the page.`);
  }

  try {
    return await response.json() as T;
  } catch {
    throw new Error(`The server returned an invalid response (HTTP ${response.status}). Please retry; if the problem continues, refresh the page.`);
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  if (error.name === "TimeoutError") return "The request timed out. Check your connection and try again.";
  if (error.name === "AbortError") return "The request was interrupted. Please try again.";
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return error.message;
}
