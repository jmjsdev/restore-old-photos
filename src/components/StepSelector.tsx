import type { StepKey, StepInfo } from '../types'

interface Props {
  steps: Record<string, StepInfo>
  selected: Set<StepKey>
  onToggle: (step: StepKey) => void
  onToggleAll: () => void
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

export const STEP_ORDER: StepKey[] = [
  'crop',
  'inpaint',
  'spot_removal',
  'scratch_removal',
  'face_restore',
  'colorize',
  'upscale',
]

export function StepSelector({ steps, selected, onToggle, onToggleAll, modelChoices, onModelChange }: Props) {
  const availableSteps = STEP_ORDER.filter((k) => steps[k])
  const allSelected = availableSteps.length > 0 && availableSteps.every((k) => selected.has(k))

  return (
    <div class="space-y-2">
      <button
        onClick={onToggleAll}
        class={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs transition-all ${
          allSelected
            ? 'border-amber-400/40 bg-amber-400/5 text-amber-300'
            : 'border-zinc-800 bg-zinc-900/30 text-zinc-500 hover:border-zinc-600'
        } `}
      >
        <div
          class={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border text-[9px] font-bold ${
            allSelected ? 'border-amber-400 bg-amber-400 text-zinc-900' : 'border-zinc-600'
          } `}
        >
          {allSelected && '✓'}
        </div>
        <span>{allSelected ? 'Tout décocher' : 'Tout cocher'}</span>
      </button>
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
              class={`flex w-full items-center gap-3 border px-3 py-2.5 text-left transition-all ${hasModels && isSelected ? 'rounded-t-lg border-b-0' : 'rounded-lg'} ${
                isSelected
                  ? 'border-amber-400/60 bg-amber-400/10 text-amber-100'
                  : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600'
              } `}
            >
              <span class="text-lg">{STEP_ICONS[key]}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{step.name}</p>
                <p class="truncate text-[11px] opacity-50">{currentModelInfo ? currentModelInfo.name : step.model}</p>
              </div>
              <div
                class={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                  isSelected ? 'border-amber-400 bg-amber-400 text-zinc-900' : 'border-zinc-600'
                } `}
              >
                {isSelected && '✓'}
              </div>
            </button>

            {/* Model selector dropdown */}
            {hasModels && isSelected && (
              <div class="rounded-b-lg border border-t-0 border-amber-400/60 bg-amber-400/5 px-3 py-2">
                <select
                  value={currentModel}
                  onChange={(e) => onModelChange(key, (e.target as HTMLSelectElement).value)}
                  onClick={(e) => e.stopPropagation()}
                  class="w-full cursor-pointer rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-400/60 focus:outline-none"
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
