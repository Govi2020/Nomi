const baseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

// Central boundary for the future FastAPI service. Mock services can be swapped for these calls without changing pages.
export const apiClient = {
  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, { signal })
    if (!response.ok) {
      let message = `Request failed (${response.status})`
      try {
        const error = await response.json() as { detail?: string }
        if (error.detail) message = error.detail
      } catch {
        // Preserve the HTTP status when the backend does not return JSON.
      }
      throw new Error(message)
    }
    return response.json() as Promise<T>
  },
  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) {
      let message = `Request failed (${response.status})`
      try {
        const error = await response.json() as { detail?: string }
        if (error.detail) message = error.detail
      } catch {
        // Preserve the HTTP status when the backend does not return JSON.
      }
      throw new Error(message)
    }
    return response.json() as Promise<T>
  },
  async put<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) {
      let message = `Request failed (${response.status})`
      try {
        const error = await response.json() as { detail?: string }
        if (error.detail) message = error.detail
      } catch {
        // Preserve the HTTP status when the backend does not return JSON.
      }
      throw new Error(message)
    }
    return response.json() as Promise<T>
  },
  async delete<T>(path: string): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, { method: 'DELETE' })
    if (!response.ok) {
      let message = `Request failed (${response.status})`
      try {
        const error = await response.json() as { detail?: string }
        if (error.detail) message = error.detail
      } catch {
        // Preserve the HTTP status when the backend does not return JSON.
      }
      throw new Error(message)
    }
    return response.json() as Promise<T>
  },
}
