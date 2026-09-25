import fs from 'fs'
const src = fs.readFileSync('src/App.jsx', 'utf8')

const declared = new Set()
// import { a, b as c } from 'x' ; import X from 'x' ; import X, { a } from 'x'
for (const m of src.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?/g)) {
  if (m[1]) declared.add(m[1])
  if (m[2]) m[2].split(',').forEach(s => {
    const n = s.trim().split(/\s+as\s+/).pop().trim()
    if (n) declared.add(n)
  })
}
for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1])
for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1])
for (const m of src.matchAll(/const\s*\[([^\]]*)\]/g)) m[1].split(',').forEach(s => {
  const n = s.trim().split('=')[0].trim()
  if (n && n !== '') declared.add(n)
})
const builtins = ['useState','useEffect','useRef','useMemo','useCallback','useReducer','useContext','React','Fragment','createContext','console','document','window','Math','JSON','Object','Array','String','Number','Boolean','Date','setTimeout','setInterval','clearTimeout','clearInterval','parseInt','parseFloat','isNaN','require','module','exports','fetch','Promise','Map','Set','Symbol','Proxy','Reflect','globalThis','localStorage','sessionStorage','XMLHttpRequest','Blob','URL','FileReader','Image','navigator','location','alert','confirm','prompt','Infinity','NaN','undefined','__dirname','process','queueMicrotask','structuredClone','performance','requestAnimationFrame','cancelAnimationFrame','ResizeObserver','MutationObserver','IntersectionObserver','customElements','getComputedStyle','matchMedia','import','export']
builtins.forEach(n => declared.add(n))

const refs = new Set()
for (const m of src.matchAll(/=\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) refs.add(m[1])

const undef = [...refs].filter(r => !declared.has(r)).sort()
console.log('=== JSX 中 ={标识符} 但从未声明的（即崩溃源）===')
console.log(undef.length ? undef.join('\n') : '(无)')

// 额外：检查 onXxx 透传右侧是否声明
console.log('\n=== on* 透传引用检查 ===')
const issues = []
for (const m of src.matchAll(/(on[A-Z][A-Za-z]+)=\{([A-Za-z_$][\w$]*)\}/g)) {
  if (!declared.has(m[2])) issues.push(`${m[1]}={${m[2]}}  →  ${m[2]} 未声明`)
}
console.log(issues.length ? issues.join('\n') : '(无)')
