import type { Photo } from '../types'

interface Props {
  photos: Photo[]
  selected: Set<string>
  onToggle: (id: string) => void
  onDelete: (id: string) => void
}

export function PhotoGrid({ photos, selected, onToggle, onDelete }: Props) {
  if (!photos.length) return null

  return (
    <div class="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {photos.map((photo) => {
        const isSelected = selected.has(photo.id)
        return (
          <div
            key={photo.id}
            onClick={() => onToggle(photo.id)}
            class={`
              relative group rounded-lg overflow-hidden cursor-pointer
              ring-2 transition-all duration-150
              ${isSelected ? 'ring-amber-400 scale-[1.02]' : 'ring-transparent hover:ring-zinc-600'}
            `}
          >
            <img
              src={(photo as any)._blobUrl || `/uploads/${photo.filename}`}
              alt={photo.originalName}
              class="w-full aspect-square object-cover"
            />
            {/* Selection indicator */}
            <div
              class={`
                absolute top-1.5 left-1.5 w-4 h-4 rounded-full border-2
                flex items-center justify-center text-[9px] font-bold transition-all
                ${
                  isSelected
                    ? 'bg-amber-400 border-amber-400 text-zinc-900'
                    : 'border-white/60 bg-black/40'
                }
              `}
            >
              {isSelected && '✓'}
            </div>
            {/* Delete button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(photo.id)
              }}
              class="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-red-500/80 text-white
                     text-[10px] flex items-center justify-center
                     transition-colors hover:bg-red-500"
            >
              x
            </button>
            {/* Name */}
            <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
              <p class="text-[10px] text-zinc-300 truncate">{photo.originalName}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
