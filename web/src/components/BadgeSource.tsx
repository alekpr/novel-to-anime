interface Props { label: string; type?: 'original' | 'generated' | 'inferred' }

const styles = {
  original: 'bg-gray-100 text-gray-600',
  generated: 'bg-purple-100 text-purple-700',
  inferred: 'bg-yellow-100 text-yellow-700',
}
const labels = { original: 'ต้นฉบับ', generated: 'AI แต่งเพิ่ม', inferred: 'เดาโดย AI' }

export function BadgeSource({ label, type = 'original' }: Props) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${styles[type]}`}>
      {labels[type] ?? label}
    </span>
  )
}
