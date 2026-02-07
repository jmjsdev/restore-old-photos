import { useState, useEffect, useRef } from 'preact/hooks'

interface TutorialStep {
  target?: string        // CSS selector to highlight
  title: string
  body: string
  position: 'center' | 'right' | 'left' | 'bottom-right' | 'bottom-left'
  icon: string
}

const STEPS: TutorialStep[] = [
  {
    title: 'Bienvenue !',
    body: 'Ce guide va vous montrer comment restaurer vos vieilles photos en quelques clics.\n\nL\'interface est divisée en 3 colonnes : Photos, Étapes et Jobs.',
    position: 'center',
    icon: '\u{1F4F7}',
  },
  {
    target: '[data-tour="dropzone"]',
    title: '1. Importer vos photos',
    body: 'Glissez-déposez vos photos ici, ou cliquez pour ouvrir l\'explorateur de fichiers.\n\nFormats acceptés : JPG, PNG, WebP, TIFF, BMP.\nJusqu\'à 20 photos simultanément.',
    position: 'right',
    icon: '\u{1F4E5}',
  },
  {
    target: '[data-tour="photo-grid"]',
    title: '2. Sélectionner les photos',
    body: 'Cliquez sur une photo pour la sélectionner (bordure dorée).\n\nVous pouvez en sélectionner plusieurs pour un traitement par lot.\n\nUtilisez "Tout sélectionner" en haut, ou le bouton \u00D7 pour supprimer une photo.',
    position: 'right',
    icon: '\u{1F5BC}',
  },
  {
    target: '[data-tour="steps"]',
    title: '3. Choisir les étapes',
    body: 'Cochez les étapes de restauration à appliquer. Elles s\'exécutent dans l\'ordre du haut vers le bas :\n\n\u2702\uFE0F Recadrage — découper l\'image\n\u{1F9F9} Retouche — effacer des zones manuellement\n\u2728 Nettoyage taches — supprime les taches et impuretés\n\u{1FA79} Rayures — détecte et répare les rayures\n\u{1F464} Visages — restaure les détails des visages\n\u{1F3A8} Colorisation — colore les photos N&B\n\u{1F50D} Upscale — agrandit la résolution x2',
    position: 'right',
    icon: '\u{1F9EA}',
  },
  {
    target: '[data-tour="steps"]',
    title: '4. Variantes de modèles',
    body: 'Certaines étapes proposent plusieurs modèles IA.\n\nQuand vous cochez une telle étape, un menu déroulant apparaît en dessous pour choisir la variante.\n\nChaque modèle a des compromis différents entre vitesse et qualité.',
    position: 'right',
    icon: '\u{1F916}',
  },
  {
    target: '[data-tour="launch"]',
    title: '5. Lancer le traitement',
    body: 'Quand des photos et des étapes sont sélectionnées, le bouton devient doré.\n\nSi vous avez choisi Recadrage ou Retouche manuelle, un éditeur s\'ouvre d\'abord pour chaque photo avant de lancer le job.\n\nNote : ces étapes manuelles sont limitées à 1 photo à la fois.',
    position: 'right',
    icon: '\u{1F680}',
  },
  {
    target: '[data-tour="jobs-header"]',
    title: '6. Suivi des jobs',
    body: 'Les jobs apparaissent dans la colonne de droite, groupés par statut :\n\n\u{1F535} En cours — en haut, avec barre de progression\n\u26AA En attente — au milieu, en file d\'attente\n\u{1F7E2} Terminés / \u{1F534} Erreur — en bas\n\nLes résultats de chaque étape s\'affichent en miniatures. Cliquez dessus pour les voir en grand.',
    position: 'left',
    icon: '\u{1F4CB}',
  },
  {
    target: '[data-tour="concurrency"]',
    title: '7. Jobs en parallèle',
    body: 'Ce curseur contrôle combien de jobs tournent simultanément (1 à 4).\n\nAvec un GPU, vous pouvez généralement en lancer 1 ou 2. Augmentez si vous avez beaucoup de VRAM.\n\nLes jobs en attente démarreront automatiquement quand un slot se libère.',
    position: 'left',
    icon: '\u26A1',
  },
  {
    target: '[data-tour="jobs-list"]',
    title: '8. Réorganiser la file',
    body: 'Les jobs en attente sont réorganisables par glisser-déposer !\n\nAttrapez l\'icône \u2807 à gauche d\'un job en attente et déposez-le à sa nouvelle position.\n\nLe prochain job à se lancer sera toujours celui en haut de la file.',
    position: 'left',
    icon: '\u{1F4CC}',
  },
  {
    target: '[data-tour="jobs-list"]',
    title: '9. Résultats et comparaison',
    body: 'Une fois un job terminé :\n\n\u{1F50D} Cliquez sur une miniature d\'étape pour la voir en plein écran (zoom molette, pan au clic)\n\u{1F4E5} Le bouton "+ Photo" sous chaque miniature réimporte le résultat comme nouvelle photo\n\u2194\uFE0F "Comparer avant/après" ouvre un curseur pour voir la différence\n\u{1F4BE} "Télécharger" sauvegarde le résultat final',
    position: 'left',
    icon: '\u2728',
  },
  {
    target: '[data-tour="auto-download"]',
    title: '10. Téléchargement auto',
    body: 'Cochez cette option pour télécharger automatiquement chaque résultat dès qu\'un job se termine.\n\nPratique pour les traitements par lot !',
    position: 'right',
    icon: '\u{1F4E6}',
  },
  {
    title: 'C\'est parti !',
    body: 'Vous êtes prêt à restaurer vos photos.\n\nCommencez par glisser une photo dans la zone de gauche, puis suivez le flux :\n\nPhotos \u2192 Étapes \u2192 Lancer \u2192 Résultats\n\nBonne restauration !',
    position: 'center',
    icon: '\u{1F389}',
  },
]

interface Props {
  onOpen?: () => void
  onClose: () => void
}

export function Tutorial({ onOpen, onClose }: Props) {
  const [current, setCurrent] = useState(0)

  // Signal parent to inject demo data on mount
  useEffect(() => {
    onOpen?.()
  }, [])
  const [highlight, setHighlight] = useState<DOMRect | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const step = STEPS[current]

  // Find and highlight target element
  useEffect(() => {
    if (!step.target) {
      setHighlight(null)
      return
    }
    const el = document.querySelector(step.target)
    if (el) {
      const rect = el.getBoundingClientRect()
      setHighlight(rect)
    } else {
      setHighlight(null)
    }
  }, [current, step.target])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (current < STEPS.length - 1) setCurrent(current + 1)
        else onClose()
      }
      else if (e.key === 'ArrowLeft' && current > 0) setCurrent(current - 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [current, onClose])

  const isFirst = current === 0
  const isLast = current === STEPS.length - 1

  // Compute panel position
  const panelStyle: Record<string, string> = {}
  if (step.position === 'center' || !highlight) {
    panelStyle.top = '50%'
    panelStyle.left = '50%'
    panelStyle.transform = 'translate(-50%, -50%)'
  } else if (step.position === 'right') {
    panelStyle.top = `${Math.max(80, Math.min(highlight.top, window.innerHeight - 400))}px`
    panelStyle.left = `${highlight.right + 20}px`
  } else if (step.position === 'left') {
    panelStyle.top = `${Math.max(80, Math.min(highlight.top, window.innerHeight - 400))}px`
    panelStyle.right = `${window.innerWidth - highlight.left + 20}px`
  } else if (step.position === 'bottom-right') {
    panelStyle.top = `${highlight.bottom + 16}px`
    panelStyle.left = `${highlight.left}px`
  } else if (step.position === 'bottom-left') {
    panelStyle.top = `${highlight.bottom + 16}px`
    panelStyle.right = `${window.innerWidth - highlight.right}px`
  }

  return (
    <div class="fixed inset-0 z-[100]" onClick={onClose}>
      {/* Overlay — clip out the highlighted area */}
      <svg class="absolute inset-0 w-full h-full" style="pointer-events: none">
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {highlight && (
              <rect
                x={highlight.left - 6}
                y={highlight.top - 6}
                width={highlight.width + 12}
                height={highlight.height + 12}
                rx="10"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%" height="100%"
          fill="rgba(0,0,0,0.7)"
          mask="url(#tour-mask)"
          style="pointer-events: all"
        />
      </svg>

      {/* Highlight border ring */}
      {highlight && (
        <div
          class="absolute border-2 border-amber-400 rounded-xl pointer-events-none"
          style={{
            left: `${highlight.left - 6}px`,
            top: `${highlight.top - 6}px`,
            width: `${highlight.width + 12}px`,
            height: `${highlight.height + 12}px`,
            boxShadow: '0 0 0 4px rgba(245, 158, 11, 0.15), 0 0 30px rgba(245, 158, 11, 0.1)',
          }}
        />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        class="absolute bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl shadow-black/50 p-5 w-[360px] z-10"
        style={panelStyle}
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        {/* Icon + Title */}
        <div class="flex items-center gap-3 mb-3">
          <span class="text-2xl">{step.icon}</span>
          <h3 class="text-base font-semibold text-zinc-100">{step.title}</h3>
        </div>

        {/* Body */}
        <div class="text-[13px] text-zinc-400 leading-relaxed whitespace-pre-line mb-5">
          {step.body}
        </div>

        {/* Progress dots + nav */}
        <div class="flex items-center justify-between">
          {/* Progress dots */}
          <div class="flex gap-1">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                class={`w-2 h-2 rounded-full transition-all ${
                  i === current
                    ? 'bg-amber-400 w-4'
                    : i < current
                      ? 'bg-amber-400/40'
                      : 'bg-zinc-700'
                }`}
              />
            ))}
          </div>

          {/* Nav buttons */}
          <div class="flex gap-2">
            {!isFirst && (
              <button
                onClick={() => setCurrent(current - 1)}
                class="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Précédent
              </button>
            )}
            {isFirst && (
              <button
                onClick={onClose}
                class="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Passer
              </button>
            )}
            <button
              onClick={() => {
                if (isLast) onClose()
                else setCurrent(current + 1)
              }}
              class="text-xs px-4 py-1.5 rounded-lg bg-amber-500 text-zinc-900 font-medium hover:bg-amber-400 transition-colors"
            >
              {isLast ? 'Commencer' : 'Suivant'}
            </button>
          </div>
        </div>

        {/* Keyboard hint */}
        <p class="text-[10px] text-zinc-600 text-center mt-3">
          Clavier : {'\u2190'} {'\u2192'} pour naviguer, Échap pour fermer
        </p>
      </div>
    </div>
  )
}
