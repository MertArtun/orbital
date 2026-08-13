export async function jsonFetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = (await response.json()) as T;
  if (!response.ok) {
    const message =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed with ${response.status}.`;
    throw new Error(message);
  }
  return body;
}
