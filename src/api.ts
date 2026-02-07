import type { Photo, Job, StepInfo, StepKey } from './types'

const BASE = '/api'

export async function uploadPhotos(files: File[]): Promise<Photo[]> {
  const form = new FormData()
  files.forEach((f) => form.append('photos', f))
  const res = await fetch(`${BASE}/photos`, { method: 'POST', body: form })
  return res.json()
}

export async function getPhotos(): Promise<Photo[]> {
  const res = await fetch(`${BASE}/photos`)
  return res.json()
}

export async function deletePhoto(id: string): Promise<void> {
  await fetch(`${BASE}/photos/${id}`, { method: 'DELETE' })
}

export async function deleteAllPhotos(): Promise<void> {
  await fetch(`${BASE}/photos`, { method: 'DELETE' })
}

export async function getSteps(): Promise<Record<string, StepInfo>> {
  const res = await fetch(`${BASE}/steps`)
  return res.json()
}

export async function createJobs(
  photoIds: string[],
  steps: StepKey[],
  options?: Record<string, string>,
  masks?: Record<string, string>,
  cropRects?: Record<string, string>
): Promise<Job[]> {
  const res = await fetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoIds, steps, options, masks, cropRects }),
  })
  return res.json()
}

export async function getJobs(): Promise<Job[]> {
  const res = await fetch(`${BASE}/jobs`)
  return res.json()
}

export async function applyCrop(photoId: string, cropRect: string): Promise<Photo> {
  const res = await fetch(`${BASE}/photos/${photoId}/crop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cropRect }),
  })
  return res.json()
}

export async function autoCrop(photoId: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const res = await fetch(`${BASE}/auto-crop/${photoId}`)
  return res.json()
}

export async function importResult(resultPath: string): Promise<Photo> {
  const res = await fetch(`${BASE}/photos/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resultPath }),
  })
  return res.json()
}

export async function getSettings(): Promise<{ maxConcurrent: number }> {
  const res = await fetch(`${BASE}/settings`)
  return res.json()
}

export async function updateSettings(settings: { maxConcurrent: number }): Promise<{ maxConcurrent: number }> {
  const res = await fetch(`${BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  return res.json()
}

export async function reorderJobs(jobIds: string[]): Promise<void> {
  await fetch(`${BASE}/jobs/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobIds }),
  })
}

export async function submitJobInput(jobId: string, input: { mask?: string; cropRect?: string }): Promise<void> {
  await fetch(`${BASE}/jobs/${jobId}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function skipJobStep(jobId: string): Promise<void> {
  await fetch(`${BASE}/jobs/${jobId}/skip`, { method: 'POST' })
}

export async function jobGoBack(jobId: string): Promise<void> {
  await fetch(`${BASE}/jobs/${jobId}/back`, { method: 'POST' })
}

export async function retryJob(jobId: string, model?: string): Promise<void> {
  await fetch(`${BASE}/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  })
}

export async function skipFailedStep(jobId: string): Promise<void> {
  await fetch(`${BASE}/jobs/${jobId}/skip-failed`, { method: 'POST' })
}

export async function cancelJob(jobId: string): Promise<void> {
  await fetch(`${BASE}/jobs/${jobId}/cancel`, { method: 'POST' })
}

