import type { StepKey, StepInfo } from '../types'

interface Props {
  steps: Record<string, StepInfo>
  selected: Set<StepKey>
  onToggle: (step: StepKey) => void
  modelChoices: Record<string, string>
  onModelChange: (step: string, model: string) => void
}

const STEP_ICONS: Record<StepKey, string> = {
  crop: '✂️',
  inpaint: '🖌️',
  spot_removal: '✨',
  scratch_removal: '🩹',
  face_restore: '👤',
  colorize: '🎨',
  upscale: '🔍',
}

export const STEP_ORDER: StepKey[] = ['crop', 'inpaint', 'spot_removal', 'scratch_removal', 'face_restore', 'colorize', 'upscale']

export function StepSelector({ steps, selected, onToggle, modelChoices, onModelChange }: Props) {
  return (
    <div class="space-y-2">
      {STEP_ORDER.map((key) => {
        const step = steps[key]
        if (!step) return null
        const isSelected = selected.has(key)
        const hasModels = step.models && Object.keys(step.models).length > 1
        const currentModel = modelChoices[key] || step.defaultModel || ''
        const currentModelInfo = hasModels && currentModel ? step.models![currentModel] : null

        return (
          <div key={key} class="space-y-0">
            <button
              onClick={() => onToggle(key)}
              class={`
                w-full flex items-center gap-3 px-3 py-2.5 transition-all text-left border
                ${hasModels && isSelected ? 'rounded-t-lg border-b-0' : 'rounded-lg'}
                ${
                  isSelected
                    ? 'border-amber-400/60 bg-amber-400/10 text-amber-100'
                    : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600'
                }
              `}
            >
              <span class="text-lg">{STEP_ICONS[key]}</span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium truncate">{step.name}</p>
                <p class="text-[11px] opacity-50 truncate">
                  {currentModelInfo ? currentModelInfo.name : step.model}
                </p>
              </div>
              <div
                class={`
                  w-4 h-4 rounded border flex-shrink-0
                  flex items-center justify-center text-[10px] font-bold
                  ${
                    isSelected
                      ? 'bg-amber-400 border-amber-400 text-zinc-900'
                      : 'border-zinc-600'
                  }
                `}
              >
                {isSelected && '✓'}
              </div>
            </button>

            {/* Model selector dropdown */}
            {hasModels && isSelected && (
              <div class="border border-t-0 border-amber-400/60 rounded-b-lg bg-amber-400/5 px-3 py-2">
                <select
                  value={currentModel}
                  onChange={(e) => onModelChange(key, (e.target as HTMLSelectElement).value)}
                  onClick={(e) => e.stopPropagation()}
                  class="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 cursor-pointer focus:border-amber-400/60 focus:outline-none"
                >
                  {Object.entries(step.models!).map(([modelKey, modelInfo]) => (
                    <option key={modelKey} value={modelKey}>
                      {modelInfo.name} — {modelInfo.desc}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
