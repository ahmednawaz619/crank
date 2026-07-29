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
      <p style={{ fontSize: '0.9rem', marginTop: '1.25rem', color: '#555' }}>
        Crank panel loads via <code>&lt;Crank /&gt;</code>. Click <strong>Select</strong>, then the hero card.
      </p>
    </main>
  );
}
