interface StarsProps {
  count: number
  compact?: boolean
}

export function Stars({ count, compact = false }: StarsProps) {
  return (
    <span className={compact ? 'stars stars--compact' : 'stars'} aria-label={`${count} 星`}>
      {Array.from({ length: count }, (_, index) => (
        <span className="star-shape" key={index} aria-hidden="true"></span>
      ))}
    </span>
  )
}
