export interface Photo {
  id: string
  filename: string
  originalName: string
  uploadedAt: string
}

export interface ModelVariant {
  name: string
  desc: string
}

export interface StepInfo {
  name: string
  model: string
  repo: string
  models?: Record<string, ModelVariant>
  defaultModel?: string
}

export type StepKey = 'crop' | 'inpaint' | 'spot_removal' | 'scratch_removal' | 'face_restore' | 'colorize' | 'upscale'

export interface StepResult {
  step: StepKey
  result: string
}

export interface Job {
  id: string
  photoId: string
  photoName: string
  original: string
  steps: StepKey[]
  options?: Record<string, string>
  status: 'pending' | 'processing' | 'waiting_input' | 'completed' | 'failed' | 'cancelled'
  progress: number
  currentStep: StepKey | null
  waitingStep?: StepKey | null
  waitingImage?: string | null
  canGoBack?: boolean
  createdAt: string
  result: string | null
  stepResults?: StepResult[]
  priority?: number
  error?: string | null
  failedStep?: StepKey | null
  failedStepIndex?: number | null
}
