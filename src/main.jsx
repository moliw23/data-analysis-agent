import React, { Component } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// 全局错误边界：任何渲染异常显示降级页而非整页白屏
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('UI 渲染错误：', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div className="screen">
          <div className="card error-boundary">
            <div className="card-title">应用出现异常</div>
            <p className="screen-desc">{String(this.state.error.message || this.state.error)}</p>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>回到首页</button>
              <button className="btn btn-ghost" onClick={() => window.location.reload()}>刷新页面</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>)
