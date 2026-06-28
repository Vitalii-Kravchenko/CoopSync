function App(): React.JSX.Element {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        margin: 0,
        color: '#e8e8e8',
        background: '#1e1e2e'
      }}
    >
      <h1 style={{ margin: 0, fontSize: 42 }}>CoopSync ☁️</h1>
      <p style={{ opacity: 0.8 }}>Синхронізатор кооп-сейвів через GitHub</p>
      <p style={{ color: '#a6e3a1' }}>Каркас працює ✅</p>
    </main>
  )
}

export default App
