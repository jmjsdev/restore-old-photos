import { useRef } from 'preact/hooks'

interface Props {
  onFiles: (files: File[]) => void
}

export function Dropzone({ onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => inputRef.current?.click()

  const handleChange = (e: Event) => {
    const input = e.target as HTMLInputElement
    const files = Array.from(input.files || [])
    if (files.length) onFiles(files)
    input.value = ''
  }

  return (
    <div
      onClick={handleClick}
      class="border-2 border-dashed rounded-lg h-20 flex flex-col items-center justify-center cursor-pointer transition-colors duration-200 border-zinc-700 hover:border-zinc-500 bg-zinc-900/50"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        onChange={handleChange}
      />
      <p class="text-zinc-400 text-sm">Cliquez pour ajouter des photos</p>
      <p class="text-zinc-600 text-[10px] mt-1">JPG, PNG, WebP, TIFF, BMP</p>
    </div>
  )
}
