export default function AlertBanner({ tone = 'neutral', children }) {
  return <div className={`banner banner--${tone}`}>{children}</div>
}

