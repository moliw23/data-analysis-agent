import React, { useState, useEffect } from 'react'
import { Clock, Play, Trash2, Plus, X, Server, Bell } from 'lucide-react'
import { getSchedules, saveSchedule, deleteSchedule, toggleSchedule, buildCron, FREQ_LABEL, CHANNELS, makeScheduleMeta, getHistory, clearHistory } from './schedule.js'
import { useBackendStatus } from './backend/probe.js'
import { apiGet, apiPost } from './backend/client.js'

const QUESTION_POOL = ['整体趋势如何', '哪个分组表现最好', '占比结构如何', '有无异常值需要关注']

export default function ScheduleView({ hasData, onRun }) {
  const online = useBackendStatus(s => s.status) === 'online'
  const [list, setList] = useState(getSchedules())
  const [history, setHistory] = useState(getHistory())
  useEffect(() => { const t = setInterval(() => setHistory(getHistory()), 15000); return () => clearInterval(t) }, [])
  const [name, setName] = useState('')
  const [freq, setFreq] = useState('daily')
  const [time, setTime] = useState('09:00')
  const [questions, setQuestions] = useState(['整体趋势如何'])
  const [customQ, setCustomQ] = useState('')
  const [channels, setChannels] = useState(['email'])

  function refresh() { setList(getSchedules()) }

  function add() {
    if (!hasData) { alert('请先上传或加载数据，再创建调度（调度会绑定当前数据集）。'); return }
    const meta = makeScheduleMeta(name, null, freq, time, questions, channels)
    saveSchedule(meta)
    setName('')
    refresh()
  }

  function toggle(q) { setQuestions(v => v.includes(q) ? v.filter(x => x !== q) : [...v, q]) }
  function toggleCh(c) { setChannels(v => v.includes(c) ? v.filter(x => x !== c) : [...v, c]) }
  function addCustom() {
    const q = customQ.trim()
    if (!q) return
    if (!questions.includes(q)) setQuestions(v => [...v, q])
    setCustomQ('')
  }
  function removeQ(q) { setQuestions(v => v.filter(x => x !== q)) }

  return (
    <div className="screen">
      {online && <ServerJobs />}
      <div className="card">
        <div className="card-title"><Clock size={16} /> 新建本地试跑调度</div>
        <div className="form-row">
          <label className="form-label">调度名称</label>
          <input className="form-input" value={name} placeholder="例：每周一销售周报" onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">执行频率</label>
          <div className="chip-row">
            {Object.entries(FREQ_LABEL).map(([k, v]) => (
              <span key={k} className={`chip ${freq === k ? 'chip-active' : ''}`} onClick={() => setFreq(k)}>{v}</span>
            ))}
          </div>
        </div>
        <div className="form-row">
          <label className="form-label">执行时间</label>
          <input className="form-input" type="time" value={time} onChange={e => setTime(e.target.value)} style={{ width: 140 }} />
          <span className="cron-preview">cron：{buildCron(freq, time)}</span>
        </div>
        <div className="form-row">
          <label className="form-label">分析问题（可勾选预设，也可自定义）</label>
          <div className="chip-row">
            {QUESTION_POOL.map(q => (
              <span key={q} className={`chip ${questions.includes(q) ? 'chip-active' : ''}`} onClick={() => toggle(q)}>{q}</span>
            ))}
          </div>
          <div className="form-row" style={{ marginTop: 10, marginBottom: 0 }}>
            <input
              className="form-input"
              value={customQ}
              placeholder="输入自定义问题，回车或点 + 加入"
              onChange={e => setCustomQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
              style={{ flex: 1 }}
            />
            <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 40, padding: '0 14px', flexShrink: 0 }} onClick={addCustom}><Plus size={16} /> 添加</button>
          </div>
          {questions.filter(q => !QUESTION_POOL.includes(q)).length > 0 && (
            <div className="chip-row" style={{ marginTop: 8 }}>
              {questions.filter(q => !QUESTION_POOL.includes(q)).map(q => (
                <span key={q} className="chip chip-custom">
                  {q}
                  <X size={14} style={{ marginLeft: 4, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); removeQ(q) }} />
                </span>
              ))}
            </div>
          )}
          <div className="screen-desc" style={{ marginTop: 6 }}>已选 {questions.length} 个问题 · 试跑时每条问题都会用当前引擎真实计算回答</div>
        </div>
        <div className="form-row">
          <label className="form-label">推送通道</label>
          <div className="chip-row">
            {CHANNELS.map(c => (
              <span key={c.key} className={`chip ${channels.includes(c.key) ? 'chip-active' : ''}`} onClick={() => toggleCh(c.key)}>{c.label}</span>
            ))}
          </div>
          <div className="screen-desc" style={{ marginTop: 6 }}>需要关页面照常执行的真实定时任务？用上方「服务端定时任务」——由本地服务 cron 驱动。</div>
        </div>
        <button className="btn btn-primary" onClick={add}><Plus size={18} /> 创建调度</button>
      </div>

      <div className="card">
        <div className="card-title"><Clock size={16} /> 我的本地调度（{list.length}）</div>
        {list.length === 0 && <div className="muted">暂无调度。上方创建后，可「立即试跑」用当前引擎跑一次并生成报告。</div>}
        {list.map(s => (
          <div className="issue" key={s.id}>
            <div className="issue-body">
              <div className="issue-title">{s.name} <span className="cron-preview">{FREQ_LABEL[s.freq]} {s.time} · {s.cron}</span></div>
              <div className="issue-detail">问题：{s.questions.join('、') || '默认全量分析'} ｜ 通道：{s.channels.map(c => (CHANNELS.find(x => x.key === c) || {}).label || c).join('、') || '未选'}</div>
              <div className="issue-fix">本地试跑型调度：配置保存在浏览器，试跑用当前引擎真实计算</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <button className="switch" aria-label="启用开关" data-on={s.enabled ? '1' : '0'} onClick={() => { toggleSchedule(s.id, !s.enabled); refresh() }}><span className="switch-dot" /></button>
              <button className="icon-btn" title="立即试跑" onClick={() => onRun(s)}><Play size={18} /></button>
              <button className="icon-btn" title="删除" onClick={() => { deleteSchedule(s.id); refresh() }}><Trash2 size={18} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title"><Clock size={16} /> 运行历史（{history.length}）</div>
        {history.length === 0 && <div className="muted">暂无运行记录。启用调度后，到点在应用内会自动用当前引擎跑批并存档于此；也可点「立即试跑」生成。</div>}
        {history.map(h => (
          <div className="issue" key={h.id}>
            <div className="issue-body">
              <div className="issue-title">{h.name} <span className="cron-preview" style={{ color: h.status === 'done' ? 'var(--success)' : h.status === 'skipped' ? 'var(--warn)' : 'var(--danger)' }}>{h.status === 'done' ? '已生成' : h.status === 'skipped' ? '跳过' : '失败'}</span></div>
              <div className="issue-detail">{new Date(h.time).toLocaleString('zh-CN')}{h.caliber ? ` ｜ ${h.caliber}` : ''}{h.note ? ` ｜ ${h.note}` : ''}</div>
              {h.answers && h.answers.length > 0 && (
                <div className="issue-fix">{h.answers.slice(0, 3).map(a => `· ${a.q}：${a.a.slice(0, 26)}${a.a.length > 26 ? '…' : ''}`).join('   ')}</div>
              )}
            </div>
            {h.status === 'done' && (
              <button className="icon-btn" title="清除该记录" onClick={() => { clearHistory(); setHistory(getHistory()) }}><Trash2 size={18} /></button>
            )}
          </div>
        ))}
        {history.length > 0 && (
          <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 32, padding: '0 12px', fontSize: 13, marginTop: 8 }} onClick={() => { clearHistory(); setHistory([]) }}><Trash2 size={14} /> 清空历史</button>
        )}
      </div>
    </div>
  )
}

/* ---------------- 服务端真实 cron（AC-22 前端面） ---------------- */

const CRON_PRESETS = { daily: '0 9 * * *', weekly: '0 9 * * 1', monthly: '0 9 1 * *' }

function ServerJobs() {
  const [jobs, setJobs] = useState(null)
  const [openRuns, setOpenRuns] = useState(null)
  const [runs, setRuns] = useState([])
  const [notifs, setNotifs] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [cron, setCron] = useState(CRON_PRESETS.daily)
  const [datasets, setDatasets] = useState([])
  const [dsId, setDsId] = useState('')
  const [sql, setSql] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = () => {
    apiGet('/api/v1/schedules').then(d => setJobs(d.items || [])).catch(() => setJobs([]))
    apiGet('/api/v1/notifications', { timeoutMs: 5000 }).then(d => setNotifs((d.items || []).slice(0, 5))).catch(() => {})
  }
  useEffect(() => {
    refresh()
    apiGet('/api/v1/datasets', { timeoutMs: 5000 }).then(d => setDatasets(d.items || [])).catch(() => {})
  }, [])

  const create = async () => {
    try {
      await apiPost('/api/v1/schedules', {
        name: name || '服务端定时任务', jobType: 'dataset_query',
        datasetId: dsId || null, cron,
        params: sql.trim() ? { sql } : {},
      })
      setMsg(''); setName(''); refresh()
    } catch (e) { setMsg(e.message || '创建失败') }
  }

  const runNow = async (id) => {
    try { await apiPost(`/api/v1/schedules/${id}/run`); refresh() } catch (e) { setMsg(e.message || '执行失败') }
  }

  const toggleJob = async (job) => {
    try {
      await apiPost(`/api/v1/schedules/${job.id}/run`, {}).catch(() => null)
      // 用 PATCH 语义：走通用请求
      const base = (await import('./backend/client.js')).getBackendBase()
      await fetch(`${base}/api/v1/schedules/${job.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !job.enabled }),
      })
      refresh()
    } catch { setMsg('切换失败') }
  }

  const del = async (id) => {
    if (!window.confirm('确认删除该服务端任务？（历史保留）')) return
    try {
      const base = (await import('./backend/client.js')).getBackendBase()
      await fetch(`${base}/api/v1/schedules/${id}`, { method: 'DELETE' })
      refresh()
    } catch { setMsg('删除失败') }
  }

  const loadRuns = async (id) => {
    if (openRuns === id) { setOpenRuns(null); return }
    try {
      const d = await apiGet(`/api/v1/schedules/${id}/runs`)
      setRuns(d.items || []); setOpenRuns(id)
    } catch { setRuns([]); setOpenRuns(id) }
  }

  const markRead = async (id) => {
    try {
      const base = (await import('./backend/client.js')).getBackendBase()
      await fetch(`${base}/api/v1/notifications/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ read: true }),
      })
      refresh()
    } catch { /* ignore */ }
  }

  return (
    <div className="card">
      <div className="card-title"><Server size={16} /> 服务端定时任务（真实 cron · 关页面照常执行）</div>
      {msg && <div className="kv-msg" role="status">{msg}</div>}
      {!showCreate ? (
        <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 36, padding: '0 14px', marginBottom: 8 }} onClick={() => setShowCreate(true)}><Plus size={16} /> 新建服务端任务</button>
      ) : (
        <div className="sj-create">
          <input className="form-input" placeholder="任务名称" value={name} onChange={e => setName(e.target.value)} style={{ flex: 1 }} />
          <input className="form-input" placeholder="cron（5 段，例 0 9 * * *）" value={cron} onChange={e => setCron(e.target.value)} style={{ width: 180 }} />
          <select className="form-input" value={dsId} onChange={e => setDsId(e.target.value)} style={{ width: 200 }}>
            <option value="">选择服务端数据集…</option>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.name}（{d.rowCount} 行）</option>)}
          </select>
          <input className="form-input" placeholder="SQL（留空默认统计行数）" value={sql} onChange={e => setSql(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-primary" style={{ width: 'auto', minHeight: 40 }} onClick={create}>创建</button>
          <button className="btn btn-ghost" style={{ width: 'auto', minHeight: 40 }} onClick={() => setShowCreate(false)}>取消</button>
        </div>
      )}
      {(jobs || []).length === 0 && <div className="muted">暂无服务端任务。创建后由本地服务 APScheduler 真实触发，连续 3 次失败自动暂停并通知。</div>}
      {(jobs || []).map(j => (
        <div className="issue" key={j.id}>
          <div className="issue-body">
            <div className="issue-title">
              {j.name}
              <span className="cron-preview">{j.cron} · 下次 {j.nextRunAt ? new Date(j.nextRunAt).toLocaleString('zh-CN') : '已暂停'}</span>
              {!j.enabled && <span className="mode-badge mode-badge--warn">已暂停</span>}
              {j.lastStatus === 'ok' && <span className="kv-badge kv-badge--ready">上次成功</span>}
              {j.lastStatus === 'failed' && <span className="kv-badge kv-badge--failed">上次失败{ j.consecutiveFailures ? ` ×${j.consecutiveFailures}` : ''}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <button className="switch" aria-label="启用开关" data-on={j.enabled ? '1' : '0'} onClick={() => toggleJob(j)}><span className="switch-dot" /></button>
            <button className="icon-btn" title="立即执行" onClick={() => runNow(j.id)}><Play size={18} /></button>
            <button className="icon-btn" title="运行历史" onClick={() => loadRuns(j.id)}><Clock size={18} /></button>
            <button className="icon-btn" title="删除" onClick={() => del(j.id)}><Trash2 size={18} /></button>
          </div>
        </div>
      ))}
      {openRuns && (
        <div className="sj-runs">
          {(runs.length === 0) && <div className="muted">暂无运行记录</div>}
          {runs.map(r => (
            <div key={r.id} className="issue-detail">
              {r.startedAt && new Date(r.startedAt).toLocaleString('zh-CN')} · {r.trigger}
              {' · '}
              <span style={{ color: r.status === 'ok' ? 'var(--success)' : 'var(--danger)' }}>{r.status === 'ok' ? `成功（${r.durationMs}ms，${(r.result && r.result.rowCount) ?? '-'} 行）` : `失败：${(r.error || '').slice(0, 80)}`}</span>
            </div>
          ))}
        </div>
      )}
      {notifs.length > 0 && (
        <div className="sj-notifs">
          <div className="card-title" style={{ marginTop: 8 }}><Bell size={16} /> 通知（{notifs.length}）</div>
          {notifs.map(n => (
            <div key={n.id} className="issue-detail">
              <span className={`kv-badge ${n.level === 'error' ? 'kv-badge--failed' : 'kv-badge--building'}`}>{n.level}</span>
              {' '}{n.title}
              {!n.read && <button className="mode-link" style={{ marginLeft: 8 }} onClick={() => markRead(n.id)}>标为已读</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
