export default function App() {
  return (
    <main style={{ maxWidth: '42rem', margin: '0 auto', padding: '3rem 1.25rem', fontFamily: 'system-ui, sans-serif' }}>
      <div
        id="hero"
        style={{
          background: '#fff',
          border: '1px solid #d8d8d8',
          borderRadius: '12px',
          padding: '1.5rem'
        }}
      >
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.75rem' }}>Utilize our robust platform today</h1>
        <p style={{ margin: '0 0 1rem', color: '#555' }}>Seamless fleet insights for every operator.</p>
        <button
          type="button"
          style={{
            border: 0,
            background: '#0f766e',
            color: '#fff',
            padding: '0.55rem 0.95rem',
            borderRadius: '8px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Get started
        </button>
      </div>
      <p style={{ fontSize: '0.9rem', marginTop: '1.25rem', color: '#555', lineHeight: 1.5 }}>
        <strong>Get started</strong> above is sample copy only — it does not open Crank.
        Use the floating <strong>Crank</strong> button (Glean logo, bottom-right): click it, then click this
        card’s border (not required to hit Get started). Companion must be running (
        <code>npx crank start</code>).
      </p>
    </main>
  );
}
