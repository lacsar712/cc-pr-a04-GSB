import { useEffect, useState } from 'react'

const STATUS_TEXT = { pending: '待处理', running: '处理中', done: '已完成' }

function QueueLane({ title, items, nextId, emptyText }) {
  return (
    <section>
      <h3>
        {title}（{items.length}）
      </h3>
      {items.length === 0 ? (
        <p>{emptyText}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>印张</th>
              <th>青</th>
              <th>品</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.id}
                style={row.id === nextId ? { outline: '2px solid #c0392b' } : undefined}
              >
                <td>{row.id}</td>
                <td>{row.sheet}</td>
                <td>{row.cyan_mm}</td>
                <td>{row.magenta_mm}</td>
                <td>{STATUS_TEXT[row.status] || row.status}</td>
                <td>
                  {row.status === 'running'
                    ? '处理中'
                    : row.id === nextId
                      ? '◀ 下一笔领走'
                      : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export default function App() {
  const [username, setUsername] = useState('printer')
  const [password, setPassword] = useState('print123456')
  const [token, setToken] = useState(localStorage.getItem('print_token') || '')
  const [role, setRole] = useState(localStorage.getItem('print_role') || '')
  const [view, setView] = useState('lanes')
  const [rows, setRows] = useState([])
  const [lanes, setLanes] = useState({ urgent: [], normal: [], next: null })
  const [sheet, setSheet] = useState('插页-02')
  const [cyan, setCyan] = useState('0.08')
  const [magenta, setMagenta] = useState('0.02')
  // 勾选只对“下一次投递”生效；任务一旦写入，记号即固定，页面上没有任何改动入口。
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
    const [jobRows, laneData] = await Promise.all([api('/api/jobs'), api('/api/lanes')])
    setRows(jobRows)
    setLanes(laneData)
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
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          sheet,
          cyan_mm: Number(cyan),
          magenta_mm: Number(magenta),
          urgent,
        }),
      })
      // 记号已随这一笔写死，勾选框复位，不影响已投任务。
      setUrgent(false)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  function leave() {
    localStorage.clear()
    setToken('')
    setRole('')
  }

  if (!token) {
    return (
      <main>
        <h1>印刷套准复核台</h1>
        <p>提交后接口只入队。另一进程领走偏差并写结论，页面轮询到结论出现。急件可插到领取顺序前面。</p>
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button onClick={enter}>登录</button>
        <p>printer / print123456 可送复核；checker / check123456 只看</p>
      </main>
    )
  }

  const next = lanes.next
  const nextId = next ? next.id : null

  return (
    <main>
      <h1>印刷套准复核台</h1>
      <button onClick={leave}>退出</button>{' '}
      <span>当前：{role === 'writer' ? '印刷员（可投递）' : '观察账号（只看）'}</span>

      <nav style={{ margin: '12px 0' }}>
        <button onClick={() => setView('lanes')} disabled={view === 'lanes'}>
          急件车道
        </button>{' '}
        <button onClick={() => setView('table')} disabled={view === 'table'}>
          总表
        </button>
      </nav>

      {role === 'writer' && (
        <p>
          <input value={sheet} onChange={(e) => setSheet(e.target.value)} />
          <input value={cyan} onChange={(e) => setCyan(e.target.value)} />
          <input value={magenta} onChange={(e) => setMagenta(e.target.value)} />{' '}
          <label>
            <input
              type="checkbox"
              checked={urgent}
              onChange={(e) => setUrgent(e.target.checked)}
            />
            急件（随本次投递写死，之后不可改）
          </label>{' '}
          <button onClick={send}>送复核</button>
        </p>
      )}
      {error && <p>{error}</p>}

      {view === 'lanes' ? (
        <>
          <p>
            领取规则：先消化急件待处理，再碰普通待处理；同档按编号从小到大。{' '}
            <strong>
              下一笔将被领走：
              {next
                ? `#${next.id} ${next.sheet}（${next.urgent ? '急件' : '普通'}）`
                : '排队已清空'}
            </strong>
          </p>
          <QueueLane
            title="⚡ 急件队"
            items={lanes.urgent}
            nextId={nextId}
            emptyText="暂无急件"
          />
          <QueueLane
            title="普通队"
            items={lanes.normal}
            nextId={nextId}
            emptyText="暂无普通任务"
          />
        </>
      ) : (
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>印张</th>
              <th>青</th>
              <th>品</th>
              <th>状态</th>
              <th>结论</th>
              <th>急件</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.sheet}</td>
                <td>{row.cyan_mm}</td>
                <td>{row.magenta_mm}</td>
                <td>{STATUS_TEXT[row.status] || row.status}</td>
                <td>{row.verdict || '等待'}</td>
                {/* 记号只读：任何账号在此都只能看，不能勾改 */}
                <td>{row.urgent ? '⚡ 急件' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
