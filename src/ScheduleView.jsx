import React, { useState, useEffect } from 'react'
import { Clock, Play, Trash2, Plus, X } from 'lucide-react'
import { getSchedules, saveSchedule, deleteSchedule, toggleSchedule, buildCron, FREQ_LABEL, CHANNELS, makeScheduleMeta, getHistory, clearHistory } from './schedule.js'

const QUESTION_POOL = ['整体趋势如何', '哪个分组表现最好', '占比结构如何', '有无异常值需要关注']

export default function ScheduleView({ hasData, onRun }) {
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
      <div className="card">
        <div className="card-title"><Clock size={16} /> 新建定时调度</div>
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
          <div className="screen-desc" style={{ marginTop: 6 }}>推送通道为占位配置——真实推送待部署形态锁定后接入（自动跑批 + 送达）。</div>
        </div>
        <button className="btn btn-primary" onClick={add}><Plus size={18} /> 创建调度</button>
      </div>

      <div className="card">
        <div className="card-title"><Clock size={16} /> 我的调度（{list.length}）</div>
        {list.length === 0 && <div className="muted">暂无调度。上方创建后，可「立即试跑」用当前引擎跑一次并生成报告。</div>}
        {list.map(s => (
          <div className="issue" key={s.id}>
            <div className="issue-body">
              <div className="issue-title">{s.name} <span className="cron-preview">{FREQ_LABEL[s.freq]} {s.time} · {s.cron}</span></div>
              <div className="issue-detail">问题：{s.questions.join('、') || '默认全量分析'} ｜ 通道：{s.channels.map(c => (CHANNELS.find(x => x.key === c) || {}).label || c).join('、') || '未选'}</div>
              <div className="issue-fix">演示模式：配置已保存在本地，真实定时执行待部署后接入</div>
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
              <div className="issue-title">{h.name} <span className="cron-preview" style={{ color: h.status === 'done' ? '#3a9d5d' : h.status === 'skipped' ? '#C98A2B' : '#C0564B' }}>{h.status === 'done' ? '已生成' : h.status === 'skipped' ? '跳过' : '失败'}</span></div>
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
