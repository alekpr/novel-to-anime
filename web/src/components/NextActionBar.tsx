interface Props {
  message: string
  onNext?: () => void
  onBack?: () => void
  nextLabel?: string
  backLabel?: string
  nextDisabled?: boolean
}

export function NextActionBar({ message, onNext, onBack, nextLabel = 'ไปต่อ ▶', backLabel = '◀ ย้อนกลับ', nextDisabled }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border-t text-sm">
      <span className="text-blue-800">💡 {message}</span>
      <div className="flex gap-2">
        {onBack && (
          <button onClick={onBack} className="px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50">
            {backLabel}
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            disabled={nextDisabled}
            className="px-4 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  )
}
