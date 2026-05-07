export function LoadingSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center bg-base">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-border-subtle border-t-blue-accent"
        role="status"
        aria-label="Loading"
      />
    </div>
  )
}
