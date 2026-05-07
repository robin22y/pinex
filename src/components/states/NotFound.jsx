import { Link } from 'react-router-dom'
import { C } from '../../styles/tokens'

export default function NotFound() {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: C.border, background: C.surface }}>
      <p className="text-sm leading-6" style={{ color: C.text }}>
        This stock isn&apos;t in our database yet.
        <br />
        We cover 1,500+ NSE companies.
        <br />
        Want us to add it? Let us know.
      </p>
      <Link to="/" className="mt-3 inline-block text-sm" style={{ color: C.blue }}>
        Go to Home
      </Link>
    </div>
  )
}
