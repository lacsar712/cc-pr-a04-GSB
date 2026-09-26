import { useEffect, useMemo, useState } from 'react'

const STATUS_LABEL = { pending: '待处理', running: '复核中', done: '已结论' }

// 领取顺序：先消化急件待处理，再碰普通待处理；同档按编号从小到大
function nextOf(pending) {
  return [...pending].sort((a, b) =>
    a.urgent !== b.urgent ? (a.urgent ? -1 : 1) : a.id - b.id
  )[0]
}

export default function App() {
  const [username, setUsername] = useState('printer')
  const [password, setPassword] = useState('print123456')
  const [token, setToken] = useState(localStorage.getItem('print_token') || '')
  const [role, setRole] = useState(localStorage.getItem('print_role') || '')
  const [rows, setRows] = useState([])
  const [view, setView] = useState('table')
  const [sheet, setSheet] = useState('插页-02')
  const [cyan, setCyan] = useState('0.08')
  const [magenta, setMagenta] = useState('0.02')
  const [urgent, setUrgent] = useState(false)
  const [error, setError] = useState('')

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.detail || '请求失败')
    return data
  }

  async function load() {
    setRows(await api('/api/jobs'))
  }

  useEffect(() => {
    if (!token) return
    load()
    const timer = setInterval(load, 1000)
    return () => clearInterval(timer)
  }, [token])

  async function enter() {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    localStorage.setItem('print_token', data.access_token)
    localStorage.setItem('print_role', data.role)
    setToken(data.access_token)
    setRole(data.role)
  }

  async function send() {
    setError('')
    try {
      // 急件记号随投递写入任务，之后不再随勾选改动
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          sheet,
          cyan_mm: Number(cyan),
          magenta_mm: Number(magenta),
          urgent,
        }),
      })
      setUrgent(false)
    } catch (err) {
      setError(err.message)
    }
  }

  function leave() {
    localStorage.clear()
    setToken('')
    setRole('')
  }

  const pending = useMemo(() => rows.filter((row) => row.status === 'pending'), [rows])
  const urgentQueue = useMemo(
    () => pending.filter((row) => row.urgent).sort((a, b) => a.id - b.id),
    [pending]
  )
  const normalQueue = useMemo(
    () => pending.filter((row) => !row.urgent).sort((a, b) => a.id - b.id),
    [pending]
  )
  const next = nextOf(pending)

  if (!token) {
    return (
      <main>
        <h1>印刷套准复核台</h1>
        <p>提交后接口只入队。另一进程领走偏差并写结论，页面轮询到结论出现。</p>
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button onClick={enter}>登录</button>
        <p>printer / print123456 可送复核；checker / check123456 只看</p>
      </main>
    )
  }

  return (
    <main>
      <h1>印刷套准复核台</h1>
      <button onClick={leave}>退出</button>
      <nav style={{ margin: '12px 0', display: 'flex', gap: 8 }}>
        <button onClick={() => setView('table')} disabled={view === 'table'}>总表</button>
        <button onClick={() => setView('lane')} disabled={view === 'lane'}>急件车道</button>
      </nav>

      {role === 'writer' && (
        <p>
          <input value={sheet} onChange={(e) => setSheet(e.target.value)} />
          <input value={cyan} onChange={(e) => setCyan(e.target.value)} />
          <input value={magenta} onChange={(e) => setMagenta(e.target.value)} />
          <label>
            <input
              type="checkbox"
              checked={urgent}
              onChange={(e) => setUrgent(e.target.checked)}
            />
            急件
          </label>
          <button onClick={send}>送复核</button>
        </p>
      )}
      {error && <p>{error}</p>}

      {view === 'lane' ? (
        <LaneView urgentQueue={urgentQueue} normalQueue={normalQueue} next={next} />
      ) : (
        <table>
          <thead>
            <tr><th>编号</th><th>印张</th><th>青</th><th>品</th><th>急件</th><th>状态</th><th>结论</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.sheet}</td>
                <td>{row.cyan_mm}</td>
                <td>{row.magenta_mm}</td>
                <td>{row.urgent ? '急' : ''}</td>
                <td>{STATUS_LABEL[row.status] || row.status}</td>
                <td>{row.verdict || '等待'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}

function Queue({ title, rows, highlightFirst }) {
  return (
    <section style={{ flex: 1, minWidth: 240 }}>
      <h2>{title}（{rows.length}）</h2>
      {rows.length === 0 ? (
        <p>空</p>
      ) : (
        <ol>
          {rows.map((row, i) => (
            <li key={row.id} style={highlightFirst && i === 0 ? { fontWeight: 'bold' } : undefined}>
              #{row.id} {row.sheet}
              {highlightFirst && i === 0 ? ' ← 下一笔' : ''}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function LaneView({ urgentQueue, normalQueue, next }) {
  return (
    <div>
      <section style={{ marginBottom: 16 }}>
        <h2>下一笔将被领走</h2>
        {next ? (
          <p style={{ fontWeight: 'bold' }}>
            {next.urgent ? '【急件】' : ''}#{next.id} {next.sheet}
          </p>
        ) : (
          <p>待处理队列为空</p>
        )}
      </section>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <Queue title="急件队" rows={urgentQueue} highlightFirst />
        <Queue title="普通队" rows={normalQueue} highlightFirst={!urgentQueue.length} />
      </div>
    </div>
  )
}
