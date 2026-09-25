# 03 · UI/UX 设计规范与设计系统

> 项目：数据分析 Agent（`data-analysis-agent`）
> 阶段：Phase 1 · 设计系统冻结版
> 负责人：颜好看（UI/UX 设计师）
> 关联产出：`src/design-tokens.css` · `src/design-tokens.json`
> 技术栈（架构师锁定）：React 18.3 + Vite 5 · 纯 CSS 变量 · lucide-react 0.400

---

## 0. 执行摘要

改造前界面「看起来不高级」的根因不是配色或排版审美问题，而是**工程缺陷**：

| 缺陷 | 数量 | 后果 |
|---|---|---|
| `rgba` 函数调用**缺少左括号**（参数被一个多出的右括号提前闭合），分布在 **17 行** | **20 处声明** | 声明被浏览器静默丢弃：拖拽态底色、关联横幅底、自定义 chip、数据集选中态、筛选卡片边框、筛选 chip、图表查看钮、工具箱 tab 激活态、推荐项选中态、清洗步骤条、图表表格表头/斑马纹、冻结列阴影 —— **全部失效** |
| 内联样式以函数形式引用了从未定义的 `--radius` 变量 | **8 处** | 工具箱 tab、下拉框、清洗步骤、筛选维度卡片圆角全部塌成 0 |
| `--font-display: "Inter"` 已声明但从未 `@import`，且 `body` 根本没引用该变量 | 1 处 | 字体声明是装饰性的；实际直出系统默认字体 |
| 组件内联硬编码色值 | **72 处**（styles.css 41 / EChart.jsx 18 / ChartToolbox.jsx 10 / ScheduleView.jsx 3） | `#FBF9FF`（表格偶数行）是带紫调的底色残留；`#d35400` 在 ChartToolbox 里出现 10 次 |
| `:focus-visible` 规则 | **0 条** | 键盘用户完全看不到焦点位置（WCAG 2.4.7 失败） |
| `U+270E`（铅笔符号）当功能图标 | 1 处 | `TemplateLibrary.jsx:238` 的「重命名」按钮 —— **P0 违规，必须改为 lucide `Pencil`** |

设计系统本身不是目的。**把令牌收敛到一处、把 27 处静默失效的声明修好、把焦点态补齐**，界面就会立刻从「拼装感」变成「有工程纪律的工具」。这是本次设计的真实工作量所在。

---

## 1. 设计方向声明

### 一句话定调

**把界面做成一支校准过的仪器：中性灰阶承载信息，单一墨绿标记状态，1px 边框划清层级，密度本身就是专业感。**

不是「简洁」，不是「现代」——是**可审计**。用户在这个界面里做的是核对数字，任何一处装饰都在消耗他们核对数字的注意力。

### 三条设计原则（每条都有落点，不是口号）

#### 原则一：信息优先级用**字重与明度**表达，不用颜色和容器

- **落点 1**：一屏内 `--accent` 的可见使用 **≤ 2 处**。其余全部靠 `--fg` / `--muted` / `--meta` 三档文本色 + `400 / 510 / 590` 三档字重建立层级。
- **落点 2**：卡片不改背景色分层。`--surface` 与 `--bg` 只差一档明度，层级靠 `1px solid var(--border)` 划界。
- **落点 3**：严重度（高/中/低/提示）必须**同时**有颜色 + 文字标签。禁止只靠色点传达含义（`sev-high` 这种纯色条必须配文字）。
- **落点 4**：状态色只用于状态。`--danger` 不用于「删除」以外的场景，`--accent` 不用于装饰性图标。

#### 原则二：密度是功能，不是妥协

- **落点 1**：数据表行高 **36px**、表头 **40px**、单元格字号 **13px**。相比改造前的松散间距，一屏可见行数提升约 35%。
- **落点 2**：正文基准 **15px**（不是 16px）。这是 Linear 的实际取值，也是高密度工具的密度前提。表格与控件 13–14px。
- **落点 3**：节区间距 `20px`（改造前 `24px`），卡片内边距 `16px`，卡片间距 `12px`。移动端统一 `16px`。
- **落点 4**：密度不得牺牲触控。**所有可点目标 ≥ 40×40px**（用户硬性偏好）。桌面表格内联按钮允许 32px 视觉高度，但必须用 `::before` 扩出 40px 命中区。

#### 原则三：动效只用于**确认状态**，不用于表演

- **落点 1**：默认动效 `160ms` + `cubic-bezier(0.25, 0.46, 0.45, 0.94)`。上限 `320ms`。
- **落点 2**：**全项目禁用回弹缓动**（控制点 `0.68 / -0.55 / 0.265 / 1.55` 的过冲曲线）。工具里弹一下，读作玩具。
- **落点 3**：禁止装饰性入场动画。不做 Hero 逐字浮现、不做滚动视差、不做持续脉冲。唯一允许的持续动画是加载指示器。
- **落点 4**：必须实现 `prefers-reduced-motion`（已写入 `design-tokens.css`）。

---

## 2. 对标品牌分析

### 2.1 Linear（主参照）

**借鉴什么**

| 特征 | 具体取值 | 我们怎么用 |
|---|---|---|
| 单一强调色，极度克制 | `#5E6AD2` 仅用于焦点/选中/稀有强调 | 我们用墨绿 `#15795B`。每屏 ≤2 处 |
| 1px hairline 分层 | `rgba(255,255,255,0.05)` / `0.08` | 浅色用 `--border: #E5E3DF`，暗色用 `#2A2D31` |
| 圆角克制 | 卡片 8–12px，胶囊按钮 | 卡片 `--radius-md 8px` / 大卡 `--radius-lg 12px`，**硬上限 12px** |
| 中间字重 | Inter 400 / 510 / 590 | 完整继承，`--weight-read/emphasize/announce` |
| 极短动效 | 100–250ms，读作"瞬时" | 默认 160ms |
| 字号 15px 正文 | `text-regular 15px/24px` | 直接采用 15px 基准 |
| 深色靠亮度递进 | `#08090a → #0f1011 → #191a1b → #28282c` | 暗色面 `#0F1011 → #17181A → #1F2124`，不靠阴影 |

**不借鉴什么**

- **不采用其靛蓝 `#5E6AD2`**。搜索结果显示大量 AI 产物都收敛到蓝紫带；保留墨绿是差异化资产。
- **不做 dark-only**。本产品要导出报告、要办公场景，必须浅色优先、暗色等价。
- **不做营销站式的巨型 Hero**（Linear 官网 64px 标题 + 大产品截图）。这是工具内部界面，首屏直接上工作台。
- **不做 `FIG 0.x` 等距线稿插画**。装饰元素在数据核对场景是噪音。
- **不做 grain 噪点纹理**。`background-image` 噪点在大面积表格上会干扰数字读取。

### 2.2 Vercel / Geist（次参照）

**借鉴什么**

- **shadow-as-border** 手法：用 `0 0 0 1px var(--border)` 代替 border，避免 1px 边框与圆角的像素锯齿。用于浮层与浮钮。
- **Material 分层编码**：半径与阴影绑定为「层级角色」——base 6px / menu 12px / modal 12px / fullscreen 16px。我们把它映射成 `--elev-1..4` + `radius` 组合，禁止在一个元素上叠两层阴影。
- **灰度阶梯式中性色**：Vercel 用 HSL `0 0% L` 严格等步长。这一步我们部分采用（见 §3.1 的暖度说明）。
- **等宽字体做「工程感」标签**：`Geist Mono` + UPPERCASE + `tnum`。我们用于：SQL 代码、cron 表达式、列类型标注、行数计数。
- **空态用「图标 + 描述 + 一个动作」三件套**，不用插画。

**不借鉴什么**

- **不采用纯黑 `#000` 药丸按钮**。本产品主 CTA 用墨绿，不用黑白反差（黑白药丸是 Vercel 品牌签名，借来会像抄袭）。
- **不做 80–120px 的超大节区间距**。那是营销页的"什么都不用证明"姿态；数据工具需要一屏塞进更多信息。
- **不做渐变背景 + 顶部圆角截图**等官网手法。
- **不做 ASCII 三角 logo / 光谱渐变**等品牌资产。

### 2.3 Metabase · Grafana · PostHog —— 数据类工具的表格与筛选器（领域参照）

**借鉴什么**

| 来源 | 借鉴点 | 我们的落地 |
|---|---|---|
| Grafana Table | **冻结列 + 冻结表头**双方向 sticky，用微阴影表达"浮在数据之上" | `.dp-th-rownum` 双向 sticky + `2px 0 0 var(--accent-line)` 阴影（修复后） |
| Grafana | **单元格对齐规则**：文本左对齐、**数值/百分比右对齐** | `.dp-cell` 按列类型加 `.num` 类，`text-align: right` + `tabular-nums` |
| Grafana | **单元格高度可切三档**（Small/Medium/Large） | 提供 `--row-h-table` 令牌，预留 32 / 36 / 44 三档 |
| PostHog / Metabase | **筛选器即 chip，且 active 状态高对比** | 修复后 `.filter-val.on` = 实心 accent 底 + 白字，未选中 = 1px 边框，二态差异极大 |
| Metabase | **图表卡片常驻口径说明**（数据可信度） | 已有 `.chart-tip-wrap` 气泡，改为 `--elev-3` + `--radius-md`，去掉 `pointer-events:none` 导致的键盘不可达 |
| NN/g Data Tables | 冻结表头 + 轻边框 + **斑马纹**三者共同维持"我在哪一行" | 斑马纹底色改为 `--border-soft`（`#EEEDEA`），**去掉现有 `#FBF9FF` 紫调** |
| Andrew Coyle | **1px 线分隔优于斑马纹**（大表用线、小表用斑马） | 默认走线分隔（`border-bottom: 1px solid var(--border)`），斑马纹仅在行数 > 50 时启用 |

**不借鉴什么**

- **不采用 Grafana 的暗色监控大屏美学**。那是 7×24 值守场景，本产品是单次分析会话。
- **不做可拖拽的仪表盘自由布局**。可拖拽 = 不可预测 = 用户每次打开布局都不同，与"可审计"原则冲突。
- **不做 PostHog 式的饱和多彩图表**。图表配色限制为墨绿同色系 4 阶 + 中性灰，不使用彩虹色板。

---

## 3. 完整设计系统

### 3.1 色板

#### 中性色阶（11 阶）

微暖中性，色相 ≈ 90°，**OKLCH 彩度 C ≤ 0.006**。

> **关于"奶油底"风险的说明（重要）**：带暖感的中性背景有沦为「AI 奶油/米色底」的风险。该风险的感知门槛是 OKLCH `C ≥ 0.010`（典型奶油色如 `#FAF7F0` 的 C ≈ 0.012）。本阶所有取值 **C ≤ 0.006**，且最亮的 `--n-50` 的 OKLCH L ≈ 0.981（已超出奶油带的 0.84–0.97 区间）。因此在屏幕上读作**中性灰**，不是纸张色。品牌温度由墨绿强调色承担，不由背景色承担。

| 阶 | 浅色 | 暗色 | 用途 |
|---|---|---|---|
| n-0 | `#FFFFFF` | `#FFFFFF` | 卡片/浮层纯白底 |
| n-50 | `#FAFAF9` | `#F2F3F5` | 页面底 `--bg`（暗色下即最亮文本） |
| n-100 | `#F4F4F2` | `#DDE0E4` | 二级表面、hover 填充 |
| n-150 | `#EEEDEA` | `#C4C8CE` | 内部分隔线、斑马纹 |
| n-200 | `#E5E3DF` | `#A9ADB4` | **默认边框 `--border`** |
| n-300 | `#D3D0CA` | `#83878E` | 强边框、输入框（暗色下为 `#383C41`） |
| n-400 | `#A6A39C` | `#6A6E75` | placeholder、禁用前景（**禁止作正文**） |
| n-500 | `#6F6C65` | `#8B8F96` | **次级文本 `--muted`**（对 bg 5.1:1 / 5.9:1 AA 通过） |
| n-600 | `#57544E` | `#7C8087` | **三级文本 `--meta`**：时间戳、计数、口径 |
| n-700 | `#3D3B36` | `#383C41` | 深色标题、代码前景（暗色下为边框） |
| n-800 | `#282621` | `#2A2D31` | 反色按钮底（暗色下为边框） |
| n-900 | `#1B1B19` | `#1F2124` | **主文本 `--fg`** |
| n-1000 | `#101010` | `#08090A` | 最深：遮罩底、代码块 |

#### 强调色 —— 墨绿单色阶

| 阶 | 浅色 | 暗色 |
|---|---|---|
| a-50 | `#F0F7F4` | `#0D1F1A` |
| a-100 | `#DDEDE7` | `#12332A` |
| a-200 | `#B8DACD` | `#1B4B3D` |
| a-300 | `#8CC3B0` | `#276855` |
| a-400 | `#57A88F` | `#338A70` |
| a-500 | `#23836A` | `#3DA384` |
| **a-600** | **`#15795B`** ← 浅色 anchor | **`#46B494`** ← 暗色 anchor |
| a-700 | `#0F6449` | `#6BC5AA` |
| a-800 | `#0C5039` | `#97D7C2` |
| a-900 | `#0A3E2D` | `#C4E8DD` |

##### 裁决：`--accent: #15795B` 墨绿 —— **保留**，重新标定明度阶梯

**保留的四条理由（可验证，非主观）：**

1. **对比度已达标，没有技术上的替换理由。** 实测 `#15795B` 在 `#FAFAF9` 上对比度 **5.13:1**（AA 正文要求 4.5:1）；白字压在 `#15795B` 上 **5.36:1**（AA 要求 4.5:1）。双项通过。很多 AI 生成的界面之所以换色，是因为原色对比度不达标——我们不在这个处境。
2. **它是真实的差异化资产。** 调研结论明确：AI 产物的强调色高度收敛于 **蓝紫带**（Tailwind `bg-indigo-500` 污染训练语料所致）。墨绿在数据工具品类里几乎不出现（Metabase 蓝、Grafana 橙、PostHog 蓝紫）。换掉它就等于主动向 AI 均值靠拢。
3. **它是语义正确的。** 墨绿在中文语境里同时承载「通过 / 健康 / 数据正常」，与数据质量评分、校验通过、成功导出等高频状态天然同构。换成蓝色会与「信息提示」语义打架。
4. **它满足用户的硬性审美偏好。** 用户长期偏好：低饱和度、安静、专业。`#15795B` 的 OKLCH 彩度约 0.10，属于低饱和档；蓝紫强调色（C ≈ 0.18–0.20）会明显更"吵"。

**但必须做的三处修正：**

1. **新增完整 11 阶色阶**（改造前只有 4 个零散值：`--accent` / `--accent-strong` / `--accent-soft` / `--accent-on`）。缺色阶的直接后果是——改造前 20 处失效声明里，绝大部分都在用 `rgba(28, 124, 99, …)` 手写墨绿透明度。有了 `--accent-soft` / `--accent-line` / `--accent-wash` 三档语义化透明色后，这类手写彻底消失。
2. **暗色锚点保留 `#46B494`**，实测对 `#0F1011` 底对比度 **7.45:1**、`#0E1A16` 压字对比度 **6.97:1**，均大幅超标。唯一调整是让它严格归属 a-600 阶，与浅色形成镜像。
3. **`--accent-strong` 拆解为 a-700 / a-800**，用于 pressed / 深色按下态，不再是一个独立的孤立变量。

##### 严格约束

- **每屏 `--accent` 可见使用 ≤ 2 处。** 落到本产品：主 CTA 一处 + 当前选中态一处。图例、图标、链接不额外着色，一律走 `--muted` / `--fg`。
- 语义色只用于状态。`--success` / `--warn` / `--danger` / `--info` 各带 `-bg` / `-bd` 两档，构成完整的「前景 + 底 + 边框」三元组（改造前只有前景色，导致徽标底色必须手写 `rgba`，正是失效声明的来源之一）。

#### 语义色三元组

| 语义 | 浅色 fg / bg / bd | 暗色 fg / bg / bd |
|---|---|---|
| success | `#1F7A4D` / `#EDF7F1` / `#BEE0CC` | `#5FB98A` / `#10251A` / `#26523A` |
| warn | `#96631A` / `#FBF3E4` / `#EBD5A8` | `#D9A24B` / `#2A2110` / `#584323` |
| danger | `#B23A31` / `#FBEFEE` / `#EFC8C4` | `#E07A70` / `#2B1614` / `#5A2E29` |
| info | `#1F5E8C` / `#EDF3F8` / `#C2D8E8` | `#6FA8D4` / `#11202C` / `#294761` |

> 改造前的 `--ok: #2E7D5B` / `--warn: #B07A1E` / `--bad: #B4453A` 全部替换。旧的 `--ok` 与 `--accent` 色相太近（都是绿），导致「成功」和「品牌强调」在界面上无法区分 —— 这是语义色的根本性错误。

#### 色彩配比（硬约束）

```
中性色 70–90%  ████████████████████░░
强调色  5–10%  ██░░░░░░░░░░░░░░░░░░░░
语义色  0–5%   █░░░░░░░░░░░░░░░░░░░░░
效果色   <1%   ░░░░░░░░░░░░░░░░░░░░░░
```

---

### 3.2 字号阶梯

| 档位 | 字号 | 行高 | 字重 | 字距 | 用途 |
|---|---|---|---|---|---|
| `--text-2xs` | 11px | 1.45 | 510 | +0.01em | 徽标、图表辅助计数、表格行号 |
| `--text-xs` | 12px | 1.35 | 510 | +0.01em | 图例、辅助说明、tag、口径说明 |
| `--text-sm` | 13px | 1.55 | 400 | 0 | **表格单元格**、次级文本、小按钮 |
| `--text-md` | 14px | 1.55 | 400 | 0 | 控件标签、导航项、菜单项、输入框 |
| `--text-base` | **15px** | 1.65 | 400 | 0 | **正文基准**（`body` 使用此档） |
| `--text-lg` | 18px | 1.3 | 590 | −0.01em | 卡片标题、区块标题 |
| `--text-xl` | 22px | 1.25 | 590 | −0.02em | 视图标题（`--text-2xl` 仅在首屏/报告出现） |
| `--text-2xl` | 28px | 1.2 | 590 | −0.02em | 报告主标题、首屏工作台标题 |

**字重三档制**

| 令牌 | 值 | 用途 |
|---|---|---|
| `--weight-read` | 400 | 正文、描述、表格数据 |
| `--weight-emphasize` | 510 | 小标题、需强调的正文、标签 |
| `--weight-announce` | 590 | 区块标题、CTA、视图标题 |
| `--weight-display` | 680 | 仅大数字（质量评分、KPI） |

> **禁止使用 700/800。** 改造前的 `.quality-score` 用了 `font-weight: 700`、`.sidebar-brand-text` 用了 700 —— 这两处在 15px 以下的小字号场景会显得笨重，全部降到 590。Inter 的中间字重（510/590）是它相对系统字体的核心优势，用 700 等于浪费了字体。

**字距规则（中英文分治）**

这是最容易被忽略、也最影响"工艺感"的一项：

| 场景 | 字距 | 理由 |
|---|---|---|
| **中文正文（任何字号）** | **`0`** | 汉字是方块字，字面本身有固定节奏。任何负字距都会让字挤在一起，任何正字距都会让词断裂。**中文禁止使用负字距** —— 改造前 `.screen-title` 的 `letter-spacing: -0.015em` 作用于中文标题，是错误的 |
| 拉丁/数字正文（14–18px） | `0` | 无衬线体在正文尺寸已充分设计 |
| 拉丁小字（11–13px） | `+0.01em` | 小尺寸下笔画间距被压缩，需补呼吸 |
| **全大写拉丁标签** | **`+0.06em`（下限）** | 大写字母天然紧凑，不加字距会糊成一团。这是硬性要求 |
| 标题（≥18px） | `-0.01em` | 仅作用于拉丁字符，中文由 `:lang(zh)` 或字号判断豁免 |
| 展示级（≥22px） | `-0.02em` | 同上 |

**数字专项**

- 所有数据表格、统计数字、计数、评分 **必须** `font-variant-numeric: tabular-nums`（`--numeric-feature`）。等宽数字保证列对齐，这是数据工具的基本功。改造前的 `.tnum` 类只用在两处，需全面铺开。
- 数据数字统一使用 `--font-mono` 或开启 `tnum` 的 Inter，**不得混用**。
- 千分位统一走 `toLocaleString('zh-CN')`（改造前部分位置遗漏，如 `.quality-score`、图表表格）。

---

### 3.3 间距系统（严格 4px 网格）

| 令牌 | 值 | 典型用途 |
|---|---|---|
| `--space-1` | 4px | 图标与文字间距、徽标内边距 |
| `--space-2` | 8px | 按钮内 gap、chip 间距、行内元素间距 |
| `--space-3` | 12px | **卡片之间间距**、表单行间距 |
| `--space-4` | 16px | **卡片内边距**、移动端页面边距 |
| `--space-5` | 20px | **节区间距**（`--section-y`）、桌面页面边距 |
| `--space-6` | 24px | 大区块分隔、模态内边距 |
| `--space-8` | 32px | 视图顶部留白 |
| `--space-10` | 40px | 空态垂直留白 |
| `--space-12` | 48px | 极端分隔（极少用） |
| `--space-16` | 64px | 报告页留白 |
| `--space-20` | 80px | 仅打印/报告 |

**禁止值**：`5 6 7 9 13 15 18 22 30` 等非 4 倍数。改造前存在 `gap: 10px`（`.topbar`、`.form-row`、`.chart-head` 等 20+ 处）、`padding: 14px`、`gap: 6px` —— **全部归位到 8px 或 12px**。

**替代方案对应表**（供前端批量替换）：

| 改造前 | 改为 | 场景 |
|---|---|---|
| `gap: 10px` | `gap: var(--space-2)` (8px) | 按钮内 gap、图标列表 |
| `gap: 10px` (卡片网格) | `gap: var(--space-3)` (12px) | `.dataset-grid` |
| `padding: 14px` | `padding: var(--space-4)` (16px) | 卡片、面板 |
| `gap: 6px` | `gap: var(--space-2)` (8px) | chip 内 gap |
| `padding: 9px 10px` | `padding: var(--space-2) var(--space-3)` | `.nav-item` |
| `margin-bottom: 14px` | `margin-bottom: var(--space-3)` | `.form-row` |

---

### 3.4 圆角系统

| 令牌 | 值 | 用途 |
|---|---|---|
| `--radius-xs` | 4px | 徽标、checkbox、行内小标签、代码块 |
| `--radius-sm` | 6px | **按钮、输入框、chip、下拉框**（改造前是 10px，过大） |
| `--radius-md` | 8px | **卡片、面板、浮层条目**（改造前是 14px，过大） |
| `--radius-lg` | 12px | 大卡片、模态、浮层、图表容器 —— **硬上限** |
| `--radius-pill` | 9999px | **仅限**：开关、计数徽标、状态点、头像 |

**硬约束**

- **卡片圆角上限 12px。** 改造前 `.card` = 14px、`.toolbox` = 16px、`.upload-zone` = 14px。**≥24px 是 AI 模板感的第一识别特征**，14–16px 已在嫌疑区。
- **禁止全站统一大圆角。** 改造前所有元素都在 10–14px 区间，导致层级消失、界面读起来扁平。现在通过 4/6/8/12 四档拉开差异。
- `--radius-pill` 不用于按钮。改造前的 `.fab`、`.toast`、`.seg`、`.chat-input` 全是药丸形 —— 药丸按钮在工具类界面读作消费品。`.fab` 改为 `--radius-lg`（12px），`.chat-input` 改为 `--radius-sm`（6px），`.seg` 保留 pill（分段选择器本来就该是胶囊）。

---

### 3.5 边框与阴影规范

#### 边框

| 令牌 | 值 | 用途 |
|---|---|---|
| `--border-width` | **恒 1px** | 所有边框、分隔线 |
| `--focus-width` | 2px | 焦点环 |

**硬约束**

- **禁止 `border-left` / `border-right` > 1px 的彩色强调条。** 社区共识：这是「AI 生成 UI 最易识别的单个签名」。改造前无此问题，**新增组件不得引入**。
- **单侧描边优先级低于全描边。** 卡片用 `1px solid var(--border)` 全包，不用左边框高亮。
- 边框层级：`--border-soft`（同容器内行分隔）< `--border`（容器边界）< `--border-strong`（可交互控件）。

#### 阴影 —— Linear 式分层

**核心原则：分层靠 1px 边框 + 极轻阴影，不靠大阴影。**

| 令牌 | 浅色 | 用途 |
|---|---|---|
| `--elev-flat` | `none` | 页面级容器 |
| `--elev-ring` | `0 0 0 1px var(--border)` | shadow-as-border 手法 |
| `--elev-1` | `0 1px 2px rgb(0 0 0/.04)` | 静置卡片（改造前用 `0 1px 2px + 0 2px 8px` 双层，过重） |
| `--elev-2` | `+ 0 2px 6px rgb(0 0 0/.05)` | 卡片 hover、可拖拽态 |
| `--elev-3` | `0 4px 12px rgb(0 0 0/.07)` | 备注气泡、下拉、popover |
| `--elev-4` | `0 12px 32px rgb(0 0 0/.12)` | 模态、bottom sheet |

**硬约束**

- **禁止同一元素同时出现 `1px solid` 边框 + `blur ≥ 16px` 阴影**（幽灵卡片反模式）。改造前 `.chart-tip-bubble` 是 `1px border + 0 6px 20px`，`.toolbox` 是 `0 -8px 40px` —— 均需收敛。
- **暗色模式靠亮度递进，不靠阴影加深。** 面层级：`#0F1011`（bg）→ `#17181A`（surface）→ `#1F2124`（surface-2）。暗色下阴影仅作辅助，不承担主要分层职责。

---

### 3.6 图标规范

| 项 | 规范 |
|---|---|
| **图标库** | **lucide-react 0.400**（架构师已锁定，全项目统一，禁止混用其它库或手写 SVG） |
| 尺寸档位 | **14px**（内联于 12–13px 文本旁）· **16px**（行内、表格、标签）· **18px**（导航项、按钮内）· **20px**（顶栏、主按钮）· **24px**（独立图标、空态） |
| 描边 | **统一 `strokeWidth={1.5}`**；仅 14px 档用 `1.75` 补偿细线在小尺寸下的视觉衰减 |
| 颜色 | 继承 `currentColor`。默认 `--muted`；激活态 `--accent`；禁止给图标单独指定十六进制 |
| 对齐 | 图标与文字基线对齐用 `vertical-align: -0.125em`，**禁止魔法数字**（改造前有 `verticalAlign: -2` 共 12 处） |

#### 禁止 emoji 作为功能图标

**已发现的违规：**

| 文件 | 行 | 内容 | 修复 |
|---|---|---|---|
| `src/TemplateLibrary.jsx` | 238 | `U+270E`（铅笔符号）当「重命名」按钮图标 | 改为 `<Pencil size={14} strokeWidth={1.5} />`（lucide） |

**检测正则**（门禁使用）：
```
[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}]
```
扫描确认：`src/` 下除上述 1 处外无其它 emoji。**修复后必须为 0 处。**

#### 语义 → lucide 组件对照表（供前端直接取用）

| 语义 | lucide 组件 |
|---|---|
| 概览 / 首页 | `Home` |
| 上传 / 接入数据 | `Upload` |
| 数据分析 / 看板 | `BarChart3` |
| 数据质量 / 风险 | `AlertTriangle` |
| 定时调度 | `Clock` |
| 模型接入 / 设置 | `Settings` |
| 数据预览 / 表格 | `Table2` |
| 多表关联 | `GitCompare` |
| 数据清洗 | `Eraser` |
| 分析工具箱 | `Wand2` / `Sparkles` |
| 模板库 | `BookmarkPlus` |
| 导出报告 | `FileText` |
| 问数据 / 对话 | `MessageCircle` |
| 下载 | `Download` |
| 关闭 | `X` |
| 返回 | `ArrowLeft` |
| 展开 / 折叠 | `ChevronDown` / `ChevronRight` |
| **重命名**（替换 U+270E） | **`Pencil`** |
| 删除 | `Trash2` |
| 撤销 / 回退 | `RotateCcw` |
| 复选 | `Check` |
| 口径说明 | `HelpCircle` |
| 图表详情 | `Maximize2` |
| 主题切换 | `Sun` / `Moon` |
| 筛选 | `Filter` |
| 成功 | `CheckCircle2` |
| 示例数据 | `Database` |

> `Sparkles` 在改造前被用于「实质化分析建议」和「分析工具箱」。`Sparkles` 是 AI 产品的过度使用图标（与 emoji 同质的"魔法感"），**限用于「分析建议」语义，且不得配 `--accent` 着色**。

---

### 3.7 动效规范

#### 时长档位

| 令牌 | 值 | 场景 |
|---|---|---|
| `--dur-instant` | 80ms | 按钮按压反馈 |
| `--dur-fast` | 120ms | hover 变色、chip 选中、焦点环出现 |
| `--dur-base` | **160ms** | **默认**：状态确认、tab 切换、开关 |
| `--dur-slow` | 240ms | 下拉展开、toast 进出、抽屉滑入 |
| `--dur-slower` | 320ms | 模态出现（**上限**） |

**禁止超过 400ms。**

#### 缓动曲线 —— 只允许 3 条

```css
--ease-out:      cubic-bezier(0.16, 1, 0.3, 1);         /* 进场、展开 */
--ease-standard: cubic-bezier(0.25, 0.46, 0.45, 0.94);  /* 默认 */
--ease-in-out:   cubic-bezier(0.4, 0, 0.2, 1);          /* 位移、抽屉 */
```

#### 禁止的动效

| 禁止项 | 原因 |
|---|---|
| **回弹缓动**（控制点 `0.68 / -0.55 / 0.265 / 1.55`） | 过冲曲线在工具类产品中读作玩具感。全项目禁用，包括按钮、开关、弹窗 |
| 任何 overshoot / spring 曲线 | 同上 |
| 用 `ease-in` 做状态变化 | 起手慢，感觉迟钝。状态变化必须 `ease-out` 或 `ease-standard` |
| 动画 `width` / `height` / `top` / `left` | 触发 layout，掉帧。**只允许动画 `transform` / `opacity` / `background-color` / `border-color` / `box-shadow`** |
| 装饰性入场动画 | 禁止 Hero 逐字浮现、滚动视差、卡片依次淡入、持续脉冲/浮动 |
| 超过 400ms 的动效 | 工具场景下读作卡顿 |
| 无 `prefers-reduced-motion` 降级 | WCAG 2.3.3 强制 |

#### 现有需修正的动效

| 位置 | 现状 | 修正 |
|---|---|---|
| `.stream-indeterminate` | `animation: stream-slide 1.2s ease-in-out infinite` | 保留（加载指示器是唯一允许的持续动画），改为 `--ease-in-out`，周期降到 1.4s |
| `.mini-spinner` / `.spinner` | `ds-spin .8s linear` | 保留，`.9s linear` 更沉稳 |
| `.stream-bar-fill` | `transition: width .2s ease` | **违反"不动画 width"**。改用 `transform: scaleX()` + `transform-origin: left` |
| `.switch` / `.switch-dot` | `transition: left .15s` | **违反"不动画 left"**。改用 `transform: translateX()` |
| 全站 `transition: all .12s ease`（`.seg-item`、`.filter-val`） | `transition: all` 会误动画 layout 属性 | 改为显式列举：`transition: background-color var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast)` |

---

### 3.8 层级与 z-index 契约

改造前 z-index 使用裸数字：`20`（topbar）、`20`（气泡）、`5`（下载钮）、`2`（resizer）、`3`（表头行号）、`1`（行号列）、`30`（fab）、`40`（chat）、`60`（toast / toolbox-mask）。存在**实际冲突**：`.topbar` 与 `.chart-tip-bubble` 同为 `20`，气泡在滚动时可能被顶栏遮挡；`.toast`（60）高于工具箱遮罩（60）同级，toast 可能被遮罩压住。

**新契约（必须引用令牌，禁止裸数字）：**

| 令牌 | 值 | 使用者 |
|---|---|---|
| `--z-base` | 0 | 普通内容 |
| `--z-row` | 1 | 表格冻结行号列 `.dp-rownum` |
| `--z-col` | 2 | 表格冻结表头 `.dp-th` |
| `--z-corner` | 3 | 表头 × 行号交叉单元格 `.dp-th-rownum` |
| `--z-float` | 20 | 图表下载钮、备注气泡、图表查看钮 |
| `--z-sticky` | 100 | 顶栏 `.topbar`、侧栏 `.sidebar` |
| `--z-fab` | 200 | 追问浮钮 `.fab` |
| `--z-drawer` | 300 | 聊天面板 `.chat-panel` |
| `--z-modal` | 400 | 工具箱 / 模板库 / 清洗面板 + 遮罩 `.toolbox-mask` |
| `--z-toast` | 500 | Toast（**必须高于遮罩**，修复现冲突） |
| `--z-tooltip` | 600 | Tooltip（永远最上） |

---

### 3.9 响应式断点

**保留现有 `1023px` / `767px`，并把 `767px` 收紧到 `639px`。**

| 断点 | 宽度 | 布局 |
|---|---|---|
| `--bp-phone` | ≤ 639px | 单列；侧栏收为 68px 图标轨；按钮全宽；表格横向滚动 + 冻结首列；图表卡片单列 |
| `--bp-tablet` | 640–1023px | 侧栏 68px 图标轨；图表画廊 2 列；页面边距 16px |
| `--bp-desktop` | 1024–1279px | 完整 232px 侧栏；图表画廊 3 列；页面边距 20px |
| `--bp-wide` | ≥ 1280px | 容器封顶 `1280px` 居中 |

**为什么把 767 收紧到 639**：768–1023px 区间（iPad 竖屏 768px、iPad mini 744px）用 2 列图表画廊完全放得下，而现有断点让 iPad 竖屏掉进移动端布局（`width: 100%` 按钮、底部大留白），浪费了大量屏幕。

**移动端专项**

- 触摸目标 ≥ **40×40px**（`--control-h-lg`）。移动端 `.btn` 用 `--control-h-xl`（48px）。
- 底部安全区：`padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom))`。
- 模态在移动端从底部滑入（bottom sheet），桌面居中；`.toolbox` 已有此逻辑，改为 `transform: translateY()` 动效。
- **禁止横向滚动**：`html, body { overflow-x: hidden }` 需配合 `.dp-body { overflow-x: auto }` 的表格局部滚动。

---

### 3.10 无障碍

| 项 | 要求 | 现状 |
|---|---|---|
| **对比度** | 正文 ≥ 4.5:1；大字（≥18px 或 ≥14px 粗体）≥ 3:1；UI 组件边界 ≥ 3:1。标准 WCAG 2.1 AA | 新色板全部通过（`--muted` 浅色 5.1:1 / 暗色 5.9:1） |
| **焦点可见环** | 全项目 **0 条** `:focus-visible` → **已补齐**。统一 `2px` 实色 + `2px` 半透明外环，`outline-offset: 2px` | 缺失 → 已补齐（写入 `design-tokens.css`） |
| **键盘可达** | 所有交互元素可 Tab 到达；`Esc` 关闭模态/浮层；模态内 `Tab` 循环（focus trap） | 缺失。现状：`.chip`、`.filter-val`、`.tabs` 用 `<span onClick>`，**完全不可聚焦** → 必须改为 `<button type="button">` |
| **触控热区** | ≥ 40×40px（用户硬性偏好；WCAG 2.5.5 建议 44px） | 缺失。现状 `.chart-dl` 30×30、`.icon-btn` 局部 28×28 → 全部提到 40 |
| **不依赖颜色** | 严重度/置信度/状态必须同时有文字或形状 | 缺失。现状 `.sev-high/medium/low` 是纯色条，无文字 → 必须加文字标签 |
| **reduced-motion** | 必须降级 | 合格。已写入令牌层 |
| **表单标签** | 可见 `<label>`，禁止仅用 placeholder 当标签 | 部分。现状 API/DB 表单用 `placeholder` 当标签 → 补 `<label>` |
| **图片/图表** | 图表容器需 `role="img"` + `aria-label` 概述 | 部分。`EChart.jsx` 的容器 `div` 无 `aria-label` → 补上 `option.series[].name` 概述 |
| **语义化表格** | 数据表用 `<table><th scope>` | 缺失。现状 `DataPreview.jsx` 用 `div` + `grid` 模拟表格 → 补 `role="grid"` / `role="row"` / `role="gridcell"` + `aria-rowcount` |
| **跳过导航** | 提供 skip link | 部分。建议新增 `<a href="#main" class="skip-link">跳到主内容</a>` |

---

## 4. 页面级设计提示词

> 每个视图给出「应该长什么样」的可执行描述。9 个视图 + 3 个浮层。

### 4.1 概览 `Home`（路由 `home`）

**布局**：单列，最大宽度 `--container-max`。自上而下 4 段。

1. **标题行**（不居中，左对齐）：`--text-2xl`（28px）标题「数据分析工作台」+ 一行 `--text-base` 描述。描述文案必须具体：*「上传数据，得到敢签字的结论——每个数字可回溯到计算。」*（现有文案已达标，保留）。**右侧不放装饰图形**，放一个 40×40 的模型状态按钮：已接入显示 `Zap`（`--accent`），未接入显示 `ZapOff`（`--muted`），`title` 说明。
2. **动作行**：主 CTA「上传 / 接入数据」（`--accent` 实心，`--control-h-lg`，`Upload` 图标）+ 两个 ghost 按钮「示例数据」（`Database`）+「定时调度」（`Clock`）。三个按钮左对齐，`gap: var(--space-3)`。**禁止居中**。
3. **能力清单卡片**：标题用 `CheckCircle2` + 「能做什么」。「能做什么」这个说法比「核心功能」「产品能力」都好，因为它是**用户视角的问句**，保留。内部是 7 行 `.cap-item`：40×40 图标容器（`--surface-sunken` 底 + `--border` 边 + `--accent` 图标） + 标题（510 字重）+ 一行说明（`--muted`，13px）。**7 行是认知负荷上限**（≤4 项/组的规则在列表场景放宽到 7，因为每项都是一行文字，可扫读）。若未来超 7 项，改为 2 列网格。
4. **无底部留白**，`--space-8` 收尾。

**关键状态**：
- 无数据时：概览页**不显示**空态引导卡片（本页本身就是入口，不需要再套一层空态）。
- 模型未接入：`ZapOff` 按钮 + `--warn` 色小徽标「规则引擎」，不用红色（不是错误）。

**禁止**：居中 Hero、抽象 3D 图形、渐变背景、大标题 + 副标题 + 居中 CTA 的三段式。

---

### 4.2 上传 / 接入 `Upload`（路由 `upload`）

**布局**：顶部标签栏（5 个 tab，不是侧栏），下面是当前 tab 的内容。

1. **Tab 栏**：`文件 / 日志 / API / 数据库 / 多表关联`。用 `--radius-sm` 的 chip 组，**左对齐**，选中态 = `--accent-soft` 底 + `--accent` 文字 + `--weight-announce`。图标 14px 内联。
2. **文件 tab**：
   - **拖放区**：`--radius-lg`（12px），`1px dashed var(--border)`，`padding: var(--space-8)`。内部 56×56 图标容器（`--surface-sunken` 底，`--radius-md`）+ 「点击选择文件」（510）+ 「或将文件拖拽到此处」（`--muted`，13px）。**拖拽激活态**：`border-color: --accent` + `background: --accent-wash` + `border-style: solid`（三处变化同时发生，因为单一变化在拖拽场景下太弱）。← 当前此态的 `background` 因 `rgba` 破损而失效，修复后是本页最关键的一处视觉反馈。
   - **流式解析进度条**：卡片形式。上行左「正在流式解析（Web Worker 不卡界面）…「文件名」」右「已解析 N 行 / 共 M 行」。下行进度条 `--radius-pill`，填充 `--accent`，高度 8px。**不确定态**用 `--accent-line` 的滑动指示。完成态：`CheckCircle2` + `--success` 文字「解析完成」。取消按钮为 ghost，右对齐。
   - **格式标签行**：`CSV / Excel / JSON / TXT` 四个 `.tag`，**居中**（此处居中是对的，它是装饰性的格式声明，不属于动作区）。`--text-xs`，`--radius-pill`，`--surface-sunken` 底。
   - **数据集工作台**（见 4.12）。
3. **数据库 tab**：单个卡片，内部是**纵向表单**。每行结构：`label`（固定 90px 宽，左对齐，`--muted`，510）+ 控件（`flex: 1`）。字段：数据库类型（select）、代理地址、主机/端口（两个 input，`flex: 2` / `flex: 1`）、库名、账号/密码（两个 input）、SQL（textarea，`--font-mono`，min-height 70px）。底部按钮行：ghost「连接测试」+ primary「导入并分析」，**左对齐，不撑满**。表单下方是说明段落（`--text-xs`，`--muted`），说明本地代理的安全边界——**这段文案是本产品信任感的来源，不要删**。
   - **连接结果反馈**：紧贴按钮行下方，`--success` 或 `--danger` 色，**不要放到页面顶部**（错误必须靠近产生它的字段/动作）。
4. **多表关联 tab**：先显示主表信息条 `.main-card`（`--surface-sunken` 底，`Database` 图标 + 文件名 + 行列数 + 「撤销关联」ghost）。然后是维度表拖放区（同上样式，`GitCompare` 图标）。匹配后显示 `.join-preview`：`CheckCircle2` + 「自动匹配：**主键** ↔ **子键**，预计匹配 N/M 行（X%）」。匹配率 < 30% 时追加 `--warn` 文字提示「匹配率偏低，可换一组关联键或改「左连接」」。然后是两个 select（主表键 / 维度表键）+ 候选键 chips + 合并字段多选 chips + 连接方式 chips + 主 CTA「合并并分析」（全宽）。
   - **无匹配时**：CTA 变为禁用状态，文案改为「关联键无匹配，请调整」，并在其上方插入 `--danger` 提示。**禁止只禁用不解释**。

**关键状态**：默认 / 拖拽激活 / 解析中（进度条）/ 解析完成 / 解析失败（`--danger-bg` 条 + 文件名 + 原因 + 「重试」）/ 空工作台（「尚未导入数据集。导入 ≥2 个数据集后会自动检测关联键，支持联合分析。」）。

---

### 4.3 数据预览 `PreviewView`（路由 `preview`）

**布局**：高度 `calc(100vh - var(--topbar-h) - var(--space-8))`，纵向 flex，上方工具条固定、下方表格填充。

1. **工具条**（单行，`gap: var(--space-3)`，允许换行）：
   - 左：ghost「返回工作台」（`ArrowLeft`，`--control-h-lg`）
   - 中：文件名（`--weight-announce`，14px，超长省略号 + `title`）+ 下方 `--meta` 色 12px「N 行 × M 列」（`toLocaleString`）
   - 右：ghost「导出 Excel」（`FileSpreadsheet`）+ ghost「导出 CSV」（`Sheet`）+ primary「开始分析」（`BarChart2`）。三个按钮 `--control-h-lg`。
2. **表格容器**：`--radius-lg`、`1px solid var(--border)`、`--elev-1`、`overflow: hidden`。
   - **表头**：高 `--row-h-header`（40px），`--surface-sunken` 底，13px / 510 字重 / `--fg`，右分隔 `1px solid var(--border)`，可拖动列宽（`.dp-resizer`，hover 显示 `--accent-line` 竖条，宽 5px）。
   - **行号列**：sticky left，宽 56px，`--surface-sunken` 底，`--muted` 色，12px，**居中对齐**（数字列居中）。右侧 `2px` 阴影 `--accent-soft` 表达"浮在数据之上"。表头行号单元格双向 sticky，`--z-corner`。
   - **数据行**：高 `--row-h-table`（36px），13px，`padding: 0 var(--space-2)`。
     - **文本列左对齐；数值列右对齐 + tabular-nums**（当前全部左对齐，是"表格不专业"的主因之一）。
     - 分隔：`border-bottom: 1px solid var(--border-soft)`。**行数 ≤ 50 时不用斑马纹**；> 50 时斑马纹用 `--n-150`（**必须去掉现有的 `#FBF9FF` 紫调**）。
   - **hover 行**：整行 `background: var(--surface-sunken)`，150ms。这是"我在哪一行"的唯一线索，必须存在。
   - **多表联合来源条**：表头上方一行，12px `--muted`，「数据来源：」+ 各来源 chip（`--radius-pill`，11px，白底 1px 边框）。
3. **虚拟滚动**：保留现有 `.dp-row { position: absolute }` 实现。

**关键状态**：加载中（骨架屏，非 spinner —— 表格结构已知，用灰色占位块更好）/ 有数据 / 空表（「该数据集仅存元数据，暂无数据可预览。请重新导入文件后再试。」+ 「重新导入」按钮）/ 超大表（> 50 万行提示分页或采样）。

---

### 4.4 分析看板 `Dashboard`（路由 `dashboard`）（核心视图）

**VISUAL_DENSITY = 8（驾驶舱模式）**：紧凑 padding，少用卡片盒子，多用 1px 线分隔。

**布局**：单列纵向流，节区之间靠「标题 + 内容」的节奏分隔，**不靠卡片堆叠**。

1. **联合/关联提示条**（条件渲染）：`--accent-wash` 底 + `--accent` 左边框 **不加**（禁止侧边强调条）→ 改为 `1px solid var(--accent-line)` 全包 + `--radius-md`。内部构成为横向 flex：`--accent` 实心 pill 徽标（`Layers` + 「联合分析中」）+ 说明文字（13px）+ ghost「返回工作台」+ ghost「撤销联合」。
2. **数据质量条**：横向 flex，`gap: var(--space-4)`。
   - 56×56 圆形评分：`--radius-pill`，`border: 3px solid var(--accent)`，内部 18px / 590 `--accent` 数字。**改为 2px 边框**（3px 过重），且数字必须 `tabular-nums`。
   - 中部：标题「数据质量评分」（18px / 590）+ 副文案「检出 N 项问题，建议先核查」/「数据干净」（13px `--muted`）。
   - 右侧：ghost「查看」（`AlertTriangle`）。
3. **分析结论与建议** —— 本页最重要的一块。
   - 标题行：`Sparkles`（**不着色，继承 `--muted`**）+ 「分析结论与建议」+ 两个小徽标：引擎来源（`--meta` 底 pill，「引擎生成 · 数字经引擎真实计算」）+ 条件徽标「采样统计」（`--warn-bg`/`--warn`/`--warn-bd`）。
   - 列表：每项 `.insight`，**用 `border-top: 1px solid var(--border-soft)` 分隔，不用卡片**。左侧 28×28 图标容器（`--surface-sunken` 底，`--radius-xs`，`--accent` 图标）。右侧：结论正文（15px `--fg`）+ 口径说明（12px `--meta`，`margin-top: 2px`）。
   - **每一条结论都必须带口径说明**。这是本产品的信任基石。
4. **导出当前数据集** 卡片：标题「导出当前数据集（N 行 × M 列）」+ 两个 ghost 按钮。**这一块可以降级为一行文字 + 两个文字按钮**，不需要独立卡片（密度 8 时应减少容器）。
5. **交互式筛选**：
   - 标题「交互式筛选（点击数值下钻，多维度联动所有图表）」+ `Filter` 图标。
   - 已选：`.filter-chip` 行 —— `--accent-soft` 底 + `1px solid var(--accent-line)` + `--radius-pill`，12px，内部「**维度名**」（`--accent` 590）`: 值1、值2` + `×` 移除按钮（40×40 命中区，`--muted`，hover `--danger`）。右侧 ghost「重置全部」。
   - 未选：一行 `--muted` 说明「未筛选，展示全部数据。点击下方维度数值即可下钻联动；也可在图表上点击类目下钻。」
   - 维度网格：`grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`，`gap: var(--space-3)`。每个维度块：`--surface-sunken` 底 + 1px 边框 + `--radius-md`。维度名（12px，`--accent`，590）+ 值 chips。
   - **值 chip 二态必须差异极大**：未选中 = `--surface` 底 + 1px `--border` + `--fg`；选中（`.on`）= **`--accent` 实心底 + `--accent-on` 白字**。← 修复后才有实心底，这是筛选功能的可用性关键。
6. **图表画廊**：
   - 节区标题行（不是卡片）：`BarChart2` + 「图表画廊」+ 条件徽标。
   - 网格：`repeat(3, 1fr)`（桌面）/ `repeat(2, 1fr)`（平板）/ `1fr`（手机），`gap: var(--space-3)`。
   - **图表卡片**：`--surface` 底 + 1px `--border` + `--radius-md`（**不是 14px**）+ `padding: var(--space-3)` + `--elev-flat`（静置无阴影）。hover 时 `border-color: --border-strong` + `--elev-1`，160ms。
   - **卡片头部**：标题（14px / 590，可省略）+ 来源徽标（`--meta` 底 11px pill）+ 口径 `HelpCircle` 图标（14px，`--muted`，hover `--accent`，`tabIndex={0}`，`aria-label="查看口径说明"`）+ `Maximize2` 查看详情钮（40×40）。
   - **图表本体**：高度按类型自适应 —— 折线/柱状 240px，热力图/散点/地图 420px，移动端 180px。
   - **口径气泡**：`--surface` 底 + 1px `--border` + `--radius-md` + `--elev-3`，max-width 320px，12px，`--leading-relaxed`。**必须去掉 `pointer-events: none`**，否则键盘用户无法选中其中的文字。展开用 `opacity` + `translateY(-4px→0)`，160ms。
   - **图表附带表格**（同环比 / 相关性矩阵）：标题行「共 N 行」+ 两个导出小按钮。表格 12px，表头 `--surface-sunken` 底 + `--fg` 590（**去掉现有的 `rgba(28,124,99,.10)` 墨绿底 + 墨绿字** —— 表头不该用强调色，改为中性），首列 sticky + 590 字重，斑马纹 `--n-150`。
7. **底部操作行**：8 个按钮。**这是认知负荷重灾区**（2 主 + 2 次的上限被严重突破）。
   - 改为：**1 个 primary「问数据」** + 3 个常用 ghost（多表关联 / 分析工具箱 / 数据清洗）+ **1 个「更多」下拉菜单**收纳剩余 4 项（模板库 / 导出报告 / 定时调度 / 回退清洗）。
   - 若产品坚持全平铺，则必须在视觉上分组：`gap` 用 `--space-2` 组内、`--space-5` 组间，并用 1px 竖线分隔组。

**关键状态**：有数据 / 无图表（「当前数据集未检测到可绘制图表，试试分析工具箱手动生成」+ 「打开工具箱」）/ 筛选后零结果（「当前筛选条件下没有数据」+ 「重置筛选」）/ 采样统计中（`--warn` 徽标 + tooltip 说明采样口径）。

---

### 4.5 图表详情 `ChartDetail`（路由 `chart`）

**布局**：单列，宽 `--container-max`。

1. **主卡片**：标题 = 图表标题（18px / 590）+ `BarChart2` 图标。图表高度：热力图/散点 460px，其它 360px（移动端 380 / 300）。带可下载浮钮（**40×40**，`--surface` 底 + 1px 边框 + `--radius-sm`，`--elev-2`）。
2. **口径说明卡片**：标题 = `ListChecks` + 「口径说明」。正文 13px `--muted`、`--leading-relaxed`。**这是本页存在的核心理由** —— 详情页的价值就是"这个数字怎么算出来的"，所以口径卡片必须完整、不能被折叠。
3. **返回按钮**：ghost「返回看板」（`ArrowLeft`），左对齐。
4. **不加**：不加面包屑（侧栏已表明位置）、不加分享按钮（无此功能）、不加"相关图表推荐"。

---

### 4.6 数据质量诊断 `Quality`（路由 `quality`）

**布局**：单列。

1. **评分条**：同看板的质量条，但文案更详细：「综合评分」+「基于缺失、重复、类型、异常加权计算」。
2. **问题清单卡片**：
   - 标题：`AlertTriangle` + 「问题清单（N 项问题 · M 项提示）」。
   - 每项 `.issue`：`border-top` 分隔（无卡片）。
     - **左：严重度标记**。注意：现有实现是 8px 宽的纯色条 `--danger`/`--warn`/`--accent`，**违反"不依赖颜色传达含义"**。改为：8px 圆点（`--radius-pill`）+ 文字标签（`高` / `中` / `低` / `提示`）用同色系 `-bg`/`-bd`/前景三件套的 pill 徽标。
     - 中：问题标题（14px / 510）「`列名` · 问题类型」+ 详情（13px `--muted`）+ 建议（13px，`--accent`，前缀「建议：」）。
     - 右：「一键修复」（ghost + `Wand2`，`--control-h-md`）—— 仅在 `suggestFixSteps` 有返回值时出现，垂直居中。
   - **零问题态**：**不要只显示一行灰字**。改为：`CheckCircle2`（24px，`--success`）+ 「未检出明显问题」（15px / 510）+ 「数据质量良好，可以放心进入分析」+ 「返回看板」ghost 按钮。居中对齐。
3. **不加**：不加环形图/饼图可视化（问题数量少，数字比图更清楚）。

---

### 4.7 分析报告 `Report`（路由 `report`）

**布局**：单列。顶部一行说明 + 下方 iframe 占满剩余高度。

1. **说明行**：`FileText` + 「报告预览（右上角可导出 PDF / Word / HTML）」+ 右侧**格式化的实时状态**（导出中 / 已完成）。
2. **iframe**：`--radius-lg` + 1px 边框 + 白底，高度 `80vh`（移动端 70vh）。
3. **顶栏导出按钮**：6 个 40×40 icon-btn（PDF / Word / PPTX / Excel / CSV / HTML）。注意：**6 个无文字图标按钮违反"无标签图标按钮"规则**。改为：保留 2 个常用（PDF `Printer` / HTML `Download`）为图标按钮，其余 4 个收进「更多导出」下拉，下拉项**带文字标签**。所有 icon-btn 补 `aria-label`。
4. **打印样式**：`@media print` 隐藏顶栏 / 侧栏 / fab / toast / 所有 `.btn`，iframe 去边框、高度自适应。**同时必须强制浅色主题**（`--bg: #FFFFFF; --fg: #1B1B19`），否则暗色主题下导出 PDF 会得到黑底白字。

---

### 4.8 定时调度 `ScheduleView`（路由 `schedule`，懒加载）

**布局**：单列，宽 ≤ 720px（表单内容为主，不需要全宽）。

1. **说明卡片**：`Clock` + 「定时调度」+ 一行说明调度在浏览器内运行的前提（应用需保持打开，或说明后端推送通道状态）。
2. **调度列表**：每项一行，`border-top` 分隔。左侧 `--weight-announce` 名称 + `--meta` 色 12px 的 cron 表达式（**`--font-mono`**）+ 人类可读描述「每周一 09:00」。右侧：开关（44×26）+ 编辑/删除 icon-btn。
3. **新建/编辑表单**：分 3 组（**每组 ≤ 4 个字段**，符合工作记忆规则）：
   - 组 1 调度名称 + 数据源
   - 组 2 频率（chip 组：每天 / 每周 / 每月 / 自定义）+ 时间（time input）+ 星期（条件显示）
   - 组 3 输出配置（是否生成报告 / 是否通知）
   - cron 实时预览：`--font-mono` 12px，`--muted`，紧贴频率控件下方。
4. **必填校验**：字段级错误，红边框 + 字段下方 12px `--danger` 文字。**禁止用 `alert()`**（现有实现大量使用 `alert`，需全部替换为 inline 提示或 toast）。
5. **推送通道未接入时的开关态**：开关**不应禁用后无解释**。改为可点击 + 弹 toast「推送通道待部署后接入，当前仅生成报告不推送」，或开关旁常驻 `--info` 徽标「待接入」。

---

### 4.9 模型接入 `SettingsPanel`（路由 `settings`）

**布局**：单列，宽 ≤ 720px。三段卡片。

1. **界面主题**：分段选择器（`浅色 / 暗色 / 跟随系统`），`role="radiogroup"` + `role="radio"` + `aria-checked`（现有实现已达标，保留）。下方说明「暗色模式仅切换视觉层，不重跑分析；偏好自动保存。」
2. **接入分析模型**：4 个表单行（Base URL / API Key / 模型名 / 永久保存 checkbox）。
   - 注意：**现有实现用 `placeholder` 当标签**（如 `placeholder="https://api.openai.com 或其他兼容网关"`）。必须补可见 `<label>`：Base URL、API Key、模型名。placeholder 只留格式示例（`sk-…`）。
   - API Key 字段：`type="password"` + 右侧「显示/隐藏」切换按钮（`Eye`/`EyeOff`，40×40）。
   - 底部按钮行：primary「保存」（`CheckCircle2`）+ ghost「测试连接」+ ghost「清空」（`Trash2`，危险动作需二次确认）。
   - **测试连接结果**：紧贴按钮行下方。成功 = `--success` + `CheckCircle2`；失败 = `--danger` + 具体错误 + 「重试」按钮。**禁止 `alert()`**。
3. **使用说明与边界**：3 条 `.insight` 行。这段文案（模型只做三件事、Key 仅存本机、失败自动降级）是产品的信任声明，**逐字保留**，只调整排版。

---

### 4.10 浮层：分析工具箱 `ChartToolbox`

**形态**：桌面居中模态 / 移动端 bottom sheet。宽 `min(720px, 100%)`（**注意：改造前 `.toolbox` 是 560px，而 `.toolbox-wide` 是 720px，但工具箱本身宽度 560px 装不下 10 个 tab**）。高 `max-height: 86vh`，内部滚动。

1. **头部**：`Sparkles` + 「分析工具箱」（18px / 590）+ 右侧 40×40 `X` 关闭钮。**禁止**用 `card-title` 类（语义不符）。
2. **Tab 栏**：10 个 tab。注意：**10 个 flat tab 严重超出认知负荷上限**。必须分两组：
   - **推荐组**（默认）：`图表推荐`（`Wand2`）
   - **手动组**：时间趋势 / Top N 排行 / 同环比 / 相关性 / 透视表 / 列分析 / 预测 / 异常检测 / 地图
   - 实现：推荐组单独一个大的 primary 区块置顶；手动组用 `grid-template-columns: repeat(auto-fill, minmax(120px, 1fr))` 的两行 chip 网格，而非单行平铺。
   - 激活态：`--accent-soft` 底 + `--accent` 文字 + `--weight-announce`（修复后生效）。
3. **图表推荐模式**：
   - 头部行：左「根据数据集特征匹配到 **N** 张推荐图表」；右 primary「全部加入画廊（N 张）」（全选态）/「加入选中的 N 张」/ 无选中时禁用。
   - 列表：每项横向 flex，`--surface-sunken` 底 + 1px 边框 + `--radius-md`，`padding: var(--space-2) var(--space-3)`，`cursor: pointer`。
     - 左：18×18 复选方块（`--radius-xs`，选中 = `--accent` 底 + 白色 `Check` 12px）
     - 中：推荐标题（13px / 590）+ 推荐理由（11px `--muted`，`--leading-normal`）
     - 右：ghost「加入」（11px，`--control-h-sm`）
     - **选中态**：`border-color: --accent` + `background: --accent-wash`（修复后生效）
   - 零推荐：`--surface-sunken` + 1px dashed 的提示块「未识别到合适的图表模式。请检查数据集是否包含数值列/分类列/时间列，或手动选择其他 tab。」+ 「切换手动模式」按钮。
4. **手动表单**：每项一行（标签 13px `--muted` 在上，控件在下，**纵向堆叠**，因为表单宽 720px 足够，横排会挤压）。控件统一 `--control-h-lg`，`--radius-sm`，`--surface-sunken` 底。
   - **缺失能力提示**：现有实现用内联 `style={{color:'#d35400'}}`（10 处硬编码橙）。改为 `--warn` + 一个 `.tag` 「无可用度量列」，或用 `--warn` 文字的 `<em>`。
   - 参数提示（`.toolbox-note`）：`--surface-sunken` 底 + 1px dashed `--border` + `--radius-xs`，12px `--muted`，`--leading-relaxed`。
5. **底部**：primary「生成图表」（全宽，`--control-h-xl`）。**「生成图表」按钮必须固定在底部不随内容滚动**（现有实现在滚动后按钮会移出视口）。

---

### 4.11 浮层：分析模板库 `TemplateLibrary`

**形态**：同工具箱，宽 `min(680px, 100%)`。

1. **头部**：`BookmarkPlus` + 「模板库」+ 关闭钮。
2. **提示条**：`--surface-sunken` + `--radius-sm` + 12px `--muted`，说明模板保存了什么（图表配置 + 筛选条件 + 字段映射）。
3. **保存当前为模板**：表单行 —— `--muted` 标签「模板名称」+ input（`flex: 1`）+ primary「保存」。若当前有 0 张图表，按钮禁用 + 提示「当前看板没有图表可保存为模板」。
4. **模板列表**：每项 `--surface-sunken` 底 + `--radius-md` + `padding: var(--space-3)`，`max-height: 40vh` 内部滚动。
   - 左：模板标题（14px / 590）+ 副信息（11px `--meta`：图表数 / 创建时间 / 来源数据集）+ schema 摘要（11px `--muted`，单行省略）
   - 右：操作区 —— ghost「应用」+ icon-btn「重命名」（**`Pencil`，替换违规的 U+270E**）+ icon-btn「删除」（`Trash2`，需二次确认）
   - 重命名内联态：input 替换标题，`Enter` 提交、`Esc` 取消（现有实现已达标）
5. **空态**：`BookmarkPlus`（24px `--muted`）+ 「还没有保存的模板」+ 「把常用的图表组合存下来，下次一键复用」+ primary「保存当前看板为模板」。

---

### 4.12 浮层：数据清洗面板 `CleanPanel`

**形态**：同工具箱，宽 `min(720px, 100%)`（`toolbox-wide`）。

**流程式四段布局**（配置 → 步骤 → 预览 → 应用）：

1. **头部**：`Eraser` + 「数据清洗」+ 关闭钮。下方一行 `--meta`：「操作仅在当前会话的新表上生效，不改源文件与本地存储；应用后可从历史回退。」← 这段文案非常重要（数据安全声明），保留。
2. **① 操作配置行**：横向 flex，`flex-wrap`，`gap: var(--space-2)`。按操作类型动态显示控件：
   - 类型 select（填充缺失值 / 去除首尾空白 / 删除重复行 / 处理异常值）——**这是关键控件，宽度 ≥ 160px**
   - 列 select（`dedupe` 时不显示）
   - 策略 select（仅 fill：均值/中位数/众数/固定值）
   - 固定值 input（仅 fill + const）
   - 方法 select + 动作 select（仅 outliers）
   - ghost「添加」（`Wand2`）
   - 所有控件 `--control-h-lg`，`--radius-sm`。
3. **② 操作序列**：每步一行 —— `--accent-wash` 底 + 1px `--accent-line` + `--radius-sm` + `padding: var(--space-2) var(--space-3)`，13px。内容「填充缺失 · `列名` · 均值」。右侧 40×40 `X` 移除钮。**这个区块当前完全透明**（因为 `rgba` 破损），修复后是"清洗是一个有序列的过程"的关键视觉表达。
4. **③ 影响预览**：
   - 标题 `Check` + 「影响预览（抽样前 20 行）」
   - 统计条：`--surface-sunken` + 1px dashed + `--radius-sm`，「抽样 20 行 → 处理后 18 行；抽样内 N 个单元格发生变化。将删除 2 行。」
   - **前后对比双栏**：`grid-template-columns: 1fr 1fr`，`gap: var(--space-3)`。左栏标题「清洗前」、右栏「清洗后」（12px `--muted`）。每行 5 列小格，`--surface-sunken` 底 + 1px 边框 + `--radius-xs`，12px，单行省略 + `title`。
   - **改动单元格高亮**：「清洗后」栏中发生变化的单元格用 `--success-bg` / `--success-bd` 底 —— 这是整个面板最有价值的信息（用户要看清洗改了什么），**必须实现**。
   - 移动端：双栏改为上下堆叠（前后对比在此尺寸下不可读）。
5. **④ 底部**：ghost「取消」+ primary「应用并重新分析」（`RotateCcw`）。危险动作（删行）在应用前若涉及删除行，追加一行 `--warn` 提示「本次将删除 N 行数据，可通过「回退清洗」恢复」。

---

### 4.13 组件：追问面板 `ChatPanel`

**形态**：桌面 = 右侧固定抽屉 380px；移动端 = 底部 sheet，`max-height: 70vh`，`--radius-lg` 只圆上两角。

- 宽度 `380px`，`--z-drawer`，`--elev-4`，`--radius-lg`。
- 头部：「围绕这份数据提问」+ 40×40 关闭钮。
- 消息区：`.chat-msg` max-width 85%。用户消息 = `--accent` 底 + `--accent-on` 文字，右上角小圆角；机器人 = `--surface-sunken` 底 + 1px 边框。
- **SQL 展示块**：`--surface-sunken` + `--radius-sm`。头行「生成的 SQL（仅 SELECT，结果由内存引擎执行）」+ 「复制」小按钮（**`--control-h-sm`，文字可见，不用图标**）。代码 11px `--font-mono`，`overflow-x: auto`。
- **结果表格**：`max-height: 220px` 内部滚动，`--radius-sm`，12px，表头 sticky `--surface-sunken`。
- 建议问句 chips：`chip` 样式，横向换行，点击即发送。
- 输入行：input（`--radius-sm`，**不是 pill**，`--control-h-lg`）+ 发送按钮（40×40，`Share2` 或 `ArrowUp`）。
- **必须有的状态**：空对话（「试试下面的问题，答案由真实统计支撑。」）/ 发送中（用户气泡右侧三点加载）/ 错误（`--danger` 气泡 + 「重试」）/ 超长消息（换行 + 不撑破容器）。

---

## 5. 组件状态清单

> 每个组件的 **7 态**：default / hover / active / focus / disabled / loading / empty。

### 5.1 按钮 `.btn`

| 状态 | Primary | Secondary (ghost) | Ghost（无边框） |
|---|---|---|---|
| **default** | 底 `--accent`，字 `--accent-on`，1px `--accent`，`--radius-sm`，`--control-h-lg`，`padding: 0 var(--space-4)`，14px / 590，gap 8px | 底 `--surface`，字 `--fg`，1px `--border` | 字 `--muted`，无底无边 |
| **hover** | 底 `--accent-700`，160ms | 底 `--surface-sunken`，边框 `--border-strong` | 字 `--fg`，底 `--surface-sunken` |
| **active** | 底 `--accent-800`，`transform: scale(0.98)`，80ms | 底 `--n-150` | 同 hover + `scale(0.98)` |
| **focus-visible** | `--focus-ring`，`outline-offset: 2px` | 同左 | 同左 |
| **disabled** | `opacity: 0.45`，`cursor: not-allowed`，**不接收 hover**，`aria-disabled="true"` | 同左 | 同左 |
| **loading** | `--accent-500` 底 + 前置 spinner 14px + 文案替换为进行中（「抓取中…」「执行中…」），**宽度锁定不跳动**，`aria-busy="true"` | 同左 | 同左 |
| **empty** | 不适用（按钮无空态） | — | — |

**补充规则**：改造前 `.btn` 无 `:hover`、无 `:disabled` 视觉、`min-height: 48px`。全部修正。移动端 `.btn { width: 100% }` 保留（大热区），桌面端由 `.btn-row-group` 控制为 `width: auto`。

### 5.2 输入框 `.form-input` / `.chat-input`

| 状态 | 规范 |
|---|---|
| **default** | 底 `--surface`，1px `--border-strong`，`--radius-sm`，`--control-h-lg`，`padding: 0 var(--space-3)`，14px，placeholder `--n-400` |
| **hover** | 边框 `--n-400`（**轻微**，输入框 hover 不该抢眼） |
| **active (聚焦)** | 边框 `--accent` + `--focus-ring`（**双重视觉**，不能只靠 2px 外环） |
| **focus-visible** | 同 active |
| **disabled** | 底 `--surface-sunken`，字 `--n-400`，`cursor: not-allowed` |
| **error** | 边框 `--danger` + `--focus-ring-danger`，下方 12px `--danger` 错误文字（带 `AlertTriangle` 14px 图标），`aria-invalid="true"` + `aria-describedby` |
| **success** | 边框 `--success` + 右侧 16px `CheckCircle2` `--success`（用于「连接测试成功」类场景） |
| **loading** | 右侧 16px spinner，`aria-busy="true"` |
| **empty** | 不适用；但**必填字段必须有可见 `<label>`**，禁止仅 placeholder |

### 5.3 卡片 `.card`

| 状态 | 规范 |
|---|---|
| **default** | 底 `--surface`，1px `--border`，`--radius-md`（8px，**不是 14px**），`padding: var(--space-4)`，`--elev-flat` |
| **hover**（可点击卡片） | 边框 `--border-strong`，`--elev-1`，160ms。**非可点击卡片不加 hover** |
| **active** | `--elev-flat` + 边框 `--accent-line`（可点击卡片按压反馈） |
| **focus-visible** | `--focus-ring`（卡片若可点击必须是 `<button>` 或 `role="button"` + `tabIndex=0`） |
| **disabled** | `opacity: 0.5`，内部所有交互元素 `pointer-events: none` |
| **loading** | 骨架屏替换内容：`--surface-sunken` 灰块，尺寸与原内容一致（避免 CLS），配 `1.4s` 微光扫描（`--ease-in-out`，`transform: translateX`） |
| **empty** | 卡片内：24px `--muted` 图标（`--radius-md` 容器）+ 15px/510 标题 + 13px `--muted` 说明 + 一个 primary/ghost 动作。**三件套缺一不可** |

### 5.4 表格行 `.dp-row` / `.dp-cell`

| 状态 | 规范 |
|---|---|
| **default** | 高 36px，13px，`--surface` 底，`border-bottom: 1px solid var(--border-soft)`，`padding: 0 var(--space-2)`。文本左对齐，数值右对齐 |
| **hover** | 整行 `--surface-sunken` 底，`--dur-fast`。**必须存在**（"我在哪一行"的唯一线索） |
| **selected** | `--accent-wash` 底 + 左侧 1px `--accent` 内嵌线（`box-shadow: inset 2px 0 0 var(--accent)`，**不是边框**） |
| **focus-visible** | 行内 `--focus-ring`（虚拟表格需 `role="row"` + `tabIndex=0`） |
| **disabled** | 不适用 |
| **loading** | 骨架行：等宽灰块按列宽排布，保持 36px 行高 |
| **empty** | 表格区域中央：`Table2` 24px `--muted` + 「该数据集仅存元数据，暂无数据可预览」+ 「重新导入」按钮。**表头保留**（让用户知道会有什么列） |
| **斑马纹** | 仅当行数 > 50 时启用，底色 `--n-150`。**禁止 `#FBF9FF` 紫调** |
| **冻结列** | sticky，`--surface-sunken` 底（**必须不透明**），右侧 `box-shadow: 2px 0 0 var(--accent-line)` |

### 5.5 标签 / 筛选 chip `.tag` / `.filter-val` / `.chip`

| 状态 | 规范 |
|---|---|
| **default** | 底 `--surface-sunken`，1px `--border`，`--radius-pill`（tag/chip）或 `--radius-sm`（可选 chip），12px，`--muted`，`padding: 2px var(--space-2)` |
| **hover** | 边框 `--border-strong`，字 `--fg` |
| **active (选中)** | **实心 `--accent` 底 + `--accent-on` 字 + `--weight-announce`** ← 二态差异必须极大 |
| **focus-visible** | `--focus-ring` + `outline-offset: 2px` |
| **disabled** | `opacity: 0.45` |
| **loading** | chip 内 12px spinner 替换文字 |
| **empty** | 不适用 |
| **可移除态** | 内部 `×` 按钮必须是 40×40 命中区（视觉 16px），hover `--danger`，`aria-label="移除筛选：维度名"` |

### 5.6 徽标 `.badge-*` / `.ds-badge` / `.conf-badge`

| 状态 | 规范 |
|---|---|
| **default** | 11px / 510，`--radius-pill`，`padding: 1px var(--space-2)`，`white-space: nowrap` |
| **语义分档** | 统一使用「前景 / 底 / 边框」三元组：`--success`/`--success-bg`/`--success-bd`；`--warn`…；`--danger`…；`--info`…；中性 = `--meta`/`--surface-sunken`/`--border` |
| **hover** | 无 hover（徽标不可交互）。若徽标带 `title` 显示完整内容，光标 `cursor: help` |
| **focus-visible** | 仅当徽标可交互（如可点开说明）时；`tabIndex=0` + `--focus-ring` |
| **disabled** | 不适用 |
| **loading** | `mini-spinner` 12px + 文字「正在恢复…」（现有实现已达标） |
| **empty** | 不渲染（徽标不该出现空态；无内容 = 不显示） |
| **硬约束** | **禁止只用颜色区分**。置信度徽标「高置信度」已带文字（合格）；严重度必须补文字（缺失） |

### 5.7 开关 `.switch`

| 状态 | 规范 |
|---|---|
| **default (off)** | 44×26，`--radius-pill`，底 `--n-200`，1px `--border-strong`，圆点 20px 白 + `--elev-1`，`translateX(0)` |
| **hover** | 底 `--n-300` |
| **active (on)** | 底 `--accent`，圆点 `translateX(18px)`，`transition: transform var(--dur-base) var(--ease-standard)` ← **必须用 transform，禁止动画 `left`** |
| **focus-visible** | `--focus-ring` + `outline-offset: 2px` |
| **disabled** | `opacity: 0.45`，`cursor: not-allowed`，`aria-disabled="true"` |
| **loading** | 圆点替换为 12px spinner，开关不可点击（用于"保存中"） |
| **empty** | 不适用 |
| **无障碍** | 必须 `role="switch"` + `aria-checked="true|false"` + `aria-label`。改造前用 `data-on="1"` + `<span>` 实现，**不可键盘操作** → 改为 `<button role="switch">` |

---

## 6. 现存缺陷修复清单（Phase 2 前端任务）

> 按优先级排列。前 3 项是"看起来不高级"的直接技术原因。

> **门禁配置警示（重要）**：第 1 项若用宽松正则 `rgba\([^()]*\),` 扫描，会得到 **22 次命中**，其中 **2 次是误报** —— `styles.css:21` 与 `:709` 的 `--shadow-raised` 是 `0 1px 2px rgba(...), 0 2px 8px rgba(...)` 形式的**双层阴影**，那里的 `),` 是多层阴影的合法分隔符。真实缺陷是 **20 处**。请使用精确模式 `rgba\([^()]*\),[[:space:]]*0?\.[0-9]+\)`（要求右括号逗号后紧跟一个小数再闭合当前声明），实测命中 **20 处 / 17 行**，零误报。

| # | 缺陷 | 位置 | 修复 |
|---|---|---|---|
| **1** | `rgba(...)` 少左括号 | `styles.css` L113, 126, 242(×2), 243, 364, 437, 444, 461, 583, 611, 633(×2), 653, 655, 659, 663(×2), 684, 688 —— **共 20 处声明** | 全部改为 `var(--accent-soft)` / `var(--accent-line)` / `var(--accent-wash)` 引用 |
| **2** | 以函数形式引用了未定义的 `--radius` | `styles.css` L580, 587, 627, 634, 639, 656, 673 —— **8 处** | 改为 `var(--radius-sm)` 或 `var(--radius-md)` |
| **3** | `--font-display: "Inter"` 未加载且 `body` 未引用 | `styles.css` L23, L32 | 删除这两处，由 `design-tokens.css` 的 `@import` + `body { font-family: var(--font-body) }` 接管 |
| **4** | 无 `:focus-visible` | 全项目 0 条 | 已在 `design-tokens.css` 提供全局默认 + 各组件显式环 |
| **5** | `U+270E` 铅笔符号当功能图标 | `TemplateLibrary.jsx:238` | 改为 `<Pencil size={14} strokeWidth={1.5} />` |
| **6** | 硬编码色值 | `styles.css` 41 处 / `EChart.jsx` 18 处 / `ChartToolbox.jsx` 10 处 / `ScheduleView.jsx` 3 处 | 全部改为 `var(--token)`。重点：`#FBF9FF`（表格偶数行，**带紫调**）、`#9AA0A6`（`.sev-info`）、`#8a5a00`/`#FFF4DE`/`#F0D9A8`（`.badge-sample`）、`#E0524C`（`.filter-x:hover`）、`#d35400`（ChartToolbox ×10）、EChart 的 `#ECEAE3`/`#9C978D`/`#7A756E`/`#27272A`/`#A1A1AA`/`#1F1B28`/`#EAF3F0`/`#9CC9BB`/`#5DA894`/`#15795B` |
| **7** | `alert()` 当错误提示 | `ChartToolbox.jsx`(9 处)、`CleanPanel.jsx`(3 处)、`Views.jsx`(4 处)、`App.jsx`(1 处) | 全部替换为 inline 错误或 `showToast` |
| **8** | 不可聚焦的交互元素 | `.chip`、`.filter-val`、`.toolbox-tab` 等用 `<span onClick>` / `<span>` | 改为 `<button type="button">`，补 `aria-*` |
| **9** | 触控热区不足 | `.chart-dl` 30×30、`.icon-btn` 局部 28×28、`.filter-x` 视觉极小 | 提到 40×40（`.chart-dl` 允许视觉 32，命中区 40） |
| **10** | 图表容器无 `aria-label` | `EChart.jsx` 两处容器 `div` | 补 `role="img"` + `aria-label`（概述 series 名称与数据点数量） |
| **11** | 数据表缺语义化 | `DataPreview.jsx` 用 `div` + `grid` | 补 `role="grid"` / `row` / `columnheader` / `gridcell` + `aria-rowcount` / `aria-colcount` |
| **12** | 严重度只用颜色 | `Views.jsx` Quality 的 `.sev` 色条 | 补文字徽标（高/中/低/提示） |
| **13** | 底部 8 个平铺按钮 | `Views.jsx` Dashboard 底部 `.btn-row` | 改为 1 primary + 3 ghost + 「更多」下拉 |
| **14** | 顶栏 6 个无标签图标按钮 | `App.jsx` L229-238 | 保留 2 个 + 「更多导出」下拉（下拉项带文字）+ 全部补 `aria-label` |
| **15** | 非 4px 网格间距 | `styles.css` 20+ 处（`gap: 10px`、`padding: 14px`、`gap: 6px`） | 按 §3.3 对应表归位 |
| **16** | 圆角过大 | `.card` 14px、`.toolbox` 16px、`.upload-zone` 14px、`.btn` 10px | 按 §3.4 改为 8/12/12/6 |
| **17** | 动画 `width` / `left` | `.stream-bar-fill`(width)、`.switch`(left) | 改 `transform: scaleX()` / `translateX()` |
| **18** | `transition: all` | `.seg-item`、`.filter-val` | 改为显式属性列举 |
| **19** | z-index 裸数字且冲突 | `.topbar` 与 `.chart-tip-bubble` 同为 20；`.toast` 与 `.toolbox-mask` 同为 60 | 按 §3.8 契约重映射 |
| **20** | `.chart-tip-bubble { pointer-events: none }` | `styles.css` L169 | 移除，否则气泡内文字不可选中/不可访问 |
| **21** | 表单无可见 `<label>` | `Views.jsx` SettingsPanel、Upload 的 API tab | 补 `<label>`，placeholder 只留格式示例 |
| **22** | 打印未强制浅色 | `styles.css` `@media print` | 补 `--bg`/`--fg` 覆盖，避免暗色导出黑底 PDF |
| **23** | 数值列未右对齐、未开 `tnum` | `DataPreview.jsx`、`EChart.jsx` ChartTable | 数值列 `text-align: right` + `font-variant-numeric: tabular-nums` |
| **24** | `.btn { min-height: 48px }` 破坏桌面密度 | `styles.css` L64 | 桌面 `--control-h-lg`（40px），移动端才升 48px |
| **25** | **旧令牌块不删 → 新令牌静默失效**（本轮新增，优先级等同 1–3） | `styles.css` L1–25 与 L692–710 定义 10 个与新令牌同名的键（`--accent` `--accent-soft` `--accent-on` `--bg` `--surface` `--fg` `--muted` `--border` `--border-strong` `--warn`），级联后加载者胜出，会覆盖 `design-tokens.css` | **必须与缺陷 2 同一次提交删除这两个块**；`design-tokens.css` 必须放在 `styles.css` 之后 import（详见 §7 第 1 步）。验收：`grep -nE "^\s*--[a-z0-9-]+\s*:" src/styles.css` 输出为空 |
| **26** | `design-tokens.css` 暗色层用字面量重复色阶值（本轮自查发现） | 暗色层 `--fg`/`--muted`/`--meta`/`--border`/`--border-strong`/`--accent`/`--chart-1`/`--chart-2`/`--chart-5` 直接用字面量，而浅色层用 `var()` 引用 —— 同一值两个来源，改色阶不联动 | **已修复**：暗色层改为 `var(--n-*)` / `var(--accent-*)` 引用。复测颜色域重复字面量为 0 |

---

## 7. 交付物与前端接入

### 文件清单

| 文件 | 说明 |
|---|---|
| `docs/03-UIUX.md` | 本文件（设计契约） |
| `src/design-tokens.css` | 设计令牌 CSS（可直接 import） |
| `src/design-tokens.json` | 令牌机器可读版（供门禁比对与 JS/matchMedia 取断点） |

### 前端接入步骤（Phase 2）

**第 1 步（原表述有误，本轮更正）**：`design-tokens.css` 必须在 `styles.css` **之后** import。

```jsx
// src/main.jsx
import './styles.css'          // ① 组件层先加载
import './design-tokens.css'   // ② 令牌层后加载 —— 必须靠后，见下方级联说明
```

> **为什么必须靠后（这是我此前写错的一处，且会静默失效）**
>
> 我原先写的是"令牌层先加载，让旧变量先被覆盖"。**这是反的。** CSS 级联中同特异度的声明**后者胜出**；`:root { }` 与 `[data-theme="dark"] { }` 在选择器层没有额外权重差异，所以**谁后加载谁生效**。
>
> 若令牌层先加载，`styles.css` 里的两个旧令牌块（`L1–25` 与 `L692–710`）会**覆盖掉**新令牌。后果最严重的不是颜色不对，而是**静默** —— 没有报错、没有告警，界面看起来"也还行"，只是新令牌全部没生效。这属于我本轮反复遇到的同一类故障：**失败看起来像通过**。
>
> **受影响的键（新旧都存在、会发生覆盖）共 10 个**：`--accent` `--accent-soft` `--accent-on` `--bg` `--surface` `--fg` `--muted` `--border` `--border-strong` `--warn`。其中 `--warn` 浅色层新旧值不一致（旧 `#B07A1E` vs 新 `#96631A`）。
>
> **两种正确做法（推荐第 2 种）**：
> 1. **临时**：令牌层放最后 import —— 立刻可用，但依赖"顺序"这个隐式约定，容易被后来者无意改回去。
> 2. **推荐（须与 §6 缺陷 2 同一次提交）**：**删掉 `styles.css` 的两个旧令牌块**。删掉后 import 顺序不再影响结果，隐式依赖就消除了。`design-tokens.css` / `.json` 是令牌唯一真相源，`styles.css` 里不应再出现任何 `--xxx: value` 形式的令牌定义。
>
> **验收方式**（已写入附录 A §4.1 脚本 ③）：`grep -nE "^\s*--[a-z0-9-]+\s*:" src/styles.css` 必须输出为空。

**第 2 步**：`index.html` 的 `<head>` 首部加入 `preconnect`（比 CSS `@import` 快约 200ms）：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
```

**第 3 步**：按 §6 清单逐项修复。**建议顺序**：1 → 2 → 3 → 4（基础设施，一次提交）→ 5 → 6（合规）→ 7 → 8（交互可达）→ 9~24（打磨）。

**第 4 步**：修复后运行门禁自检：

```bash
# ① emoji 必须为 0
grep -rPn "[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}]" src/

# ② 破损声明必须为 0
#    必须用精确模式。宽松写法（函数名 + 任意非括号字符 + 右括号逗号）
#    会在 styles.css:21 与 :709 的 --shadow-raised 双层阴影上误报 2 次
#    （那里的逗号是多层阴影的合法分隔符，不是缺陷）。
grep -rEn 'rgba\([^()]*\),[[:space:]]*0?\.[0-9]+\)' src/*.css

# ③ 未定义的 --radius 引用必须为 0
grep -rEn "var\(--radius\)" src/*.css

# ④ 组件内联硬编码 hex 必须为 0（#fff/#000 除外）
grep -rEn "#[0-9a-fA-F]{3,8}\b" src/**/*.jsx

# ⑤ 弹跳缓动必须为 0
grep -rn "0.68, -0.55" src/

# ⑥ 禁用色必须为 0
grep -rEn "#(7C3AED|A855F7|9333EA|EC4899)" src/
```

### 给前端的 5 条关键提醒

1. **`design-tokens.css` 里没有组件样式。** 所有组件规则留在 `styles.css`，只允许 `var(--token)`。**改了令牌不要改组件**，反过来也一样。
2. **不要新增令牌。** 缺什么先找已有档位，确实没有就在 PR 里说明并同步更新 `design-tokens.json`——令牌表和 CSS 必须一致。
3. **禁止 `transition: all`。** 只列举 `background-color` / `border-color` / `color` / `opacity` / `transform` / `box-shadow`。
4. **`--accent` 每屏 ≤ 2 处。** 提交前自问：这一屏除了主 CTA 和选中态，还有没有别的地方被染成墨绿？
5. **40px 是底线。** 任何新增可点元素，若视觉尺寸小于 40px，必须用 `::before { position: absolute; inset: -4px }` 扩命中区。

### 设计意图偏差时的处理

前端在实现中若发现某条规范不可行（例如 36px 行高装不下某类单元格内容），**不要自行改数值**。记录到 PR 描述，由 Team Lead 转设计师复核。令牌是单点真相，绕过它会让下一次改动重新散落回 775 行里。

---

## 8. 附：设计刻度标定

| 参数 | 值 | 本项目的具体含义 |
|---|---|---|
| `DESIGN_VARIANCE` | **3** | 对称、可预测。数据工具里非对称布局会干扰"我在哪一列"的空间记忆。不做分屏 Hero、不做错落网格。 |
| `MOTION_INTENSITY` | **3** | 仅 hover / active / 状态确认。无装饰动画、无入场编排、无持续脉冲（加载指示器除外）。 |
| `VISUAL_DENSITY` | **8** | 驾驶舱模式。少用卡片容器，多用 `border-top` / `divide-y` / 负空间分组。表格行高 36px，控件 40px，节区间距 20px。 |

| 寄存器 | **Product**（设计服务产品） |
|---|---|
| 色彩策略 | 克制：中性 + 单一强调 ≤10% |
| 排版策略 | 无衬线为主，**Dashboard 上严格禁止衬线体** |
| 动效策略 | 功能性为主，160ms 收敛值 |
| 图片策略 | 以数据可视化、图标、UI 元素替代照片。**零插图是设计选择，不是缺失** |

---

# 第二部分 · 增补（后端能力与新增视图）

> **本节性质**：响应架构师 §7.3 / §4 的前端边界同步而追加，**不修改第一部分任何已冻结条目**。
> 冻结基线：`docs/03-UIUX.md` 第 1–8 节 + `src/design-tokens.css` + `src/design-tokens.json`。
> 增补内容：导航结构扩展、2 个全局状态件（后端状态条 / 降级徽标）、4 块设置页新增、4 个新增视图、图标权威清单、新增令牌。

## 9. 图标权威清单（基于实际安装版本实测）

### 9.1 实测环境

| 项 | 值 |
|---|---|
| `node_modules/lucide-react/package.json` 实测版本 | **0.400.0** |
| `package.json` 声明 | `^0.400.0` |
| 类型定义文件 | `node_modules/lucide-react/dist/lucide-react.d.ts`（1,856,977 字符） |
| 校验方法 | 从 `export { ... }` 块提取全部导出名（去重 4,950 个），再与本文件 `declare const` 正式声明集合求差，区分「正式名」与「弃用别名」 |

**结论：架构师点名的 9 个图标全部为正式声明，可直接使用，无需改名。**

| 语义 | 图标名 | 判定 |
|---|---|---|
| 数据库 | `Database` | 正式声明 |
| 知识库 | `BookOpen` | 正式声明 |
| 调度 | `Clock` | 正式声明 |
| 用量统计 | `BarChart3` | 正式声明 |
| 供应商 / 模型 | `Cpu` | 正式声明 |
| 记忆 | `Brain` | 正式声明 |
| 检索 | `Search` | 正式声明 |
| 通知 | `Bell` | 正式声明 |
| 隐私模式 | `ShieldCheck` | 正式声明 |

### 9.2 必须避开的 8 个弃用别名（重要）

0.400 里存在两类名字：**正式名**（在 `declare const` 中声明）与**兼容别名**（仅在 `export { X as Y }` 中出现）。别名来自 lucide 更名，已标记弃用，未来版本会移除。

| 弃用别名 | 0.400 中的正式名 | 现有代码是否在用 |
|---|---|---|
| `AlertTriangle` | **`TriangleAlert`** | 在用（`App.jsx`、`Views.jsx`、`ChartToolbox.jsx`） |
| `CheckCircle2` | **`CircleCheck`** | 在用（`App.jsx`、`Views.jsx`） |
| `Home` | **`House`** | 在用（`App.jsx` 以 `Home as HomeIcon` 引入） |
| `Wand2` | **`WandSparkles`** | 在用（`Views.jsx`、`CleanPanel.jsx`、`ChartToolbox.jsx`） |
| `HelpCircle` | **`CircleHelp`** | 在用（`Views.jsx` 角标口径说明） |
| `XCircle` | **`CircleX`** | 未用 |
| `AlertCircle` | **`CircleAlert`** | 未用 |
| `CheckCircle` | **`CircleCheckBig`** | 未用 |

### 9.3 一个会误导人的命名陷阱

`CheckCircle` 与 `CheckCircle2` 的映射是**反直觉的**：

```
CheckCircle   ->  CircleCheckBig   （粗环 + 粗勾，"Big" 版）
CheckCircle2  ->  CircleCheck      （普通环 + 普通勾，常规版）
```

即后缀 `2` **不是**"更粗的那个"。现有代码里的 `CheckCircle2` 实际渲染的是**常规版**勾选圆环（`CircleCheck`）。
**规范**：新增代码一律使用上表右列的正式名。若设计稿需要"粗勾"（如解析成功、审批通过等强确认场景），显式写 `CircleCheckBig`，不要靠猜后缀。

### 9.4 图表类图标的命名方向与直觉相反（0.400 特有）

lucide 后来把图表图标统一重命名为 `Chart*` 前缀（`ChartColumn`、`ChartPie`、`ChartLine`…），但**这些名字在 0.400 中一个都不存在**。0.400 的正式名是旧式命名：

| 想要 | 0.400 正确写法 | 0.400 中不存在的名字 |
|---|---|---|
| 柱状图 | `BarChart3`（另有 `BarChart`/`BarChart2`/`BarChart4`/`BarChartBig`/`BarChartHorizontal`） | `ChartColumn`、`ChartColumnBig` |
| 饼图 | `PieChart` | `ChartPie` |
| 折线图 | `LineChart` | `ChartLine` |
| 面积图 | `AreaChart` | `ChartArea` |
| 散点图 | `ScatterChart` | — |
| 甘特图 | `GanttChart`（弃用别名 `GanttChartSquare` 对应正式名 `SquareGanttChart`） | — |
| 雷达图 / 波形图 / 关联网络图 | **0.400 无对应图标** | `RadarChart`、`Waveform`、`ChartNetwork` |

> 雷达图、波形图、关联网络图在 0.400 中没有可用图标。若设计需要表达这三类语义，**改用文字标签或复用 `Activity` / `GitGraph` / `Network`**，不要押注不存在的名字。

### 9.5 新增界面的完整图标映射表（全部已实测为正式声明）

**导航（第一部分 6 项 + 新增 4 项）**

| 导航项 | 图标 |
|---|---|
| 概览 | `House` |
| 上传接入 | `Upload` |
| 分析看板 | `BarChart3` |
| 数据质量 | `TriangleAlert` |
| 知识库 | `BookOpen` |
| 会话与记忆 | `Brain` |
| 定时调度 | `Clock` |
| 调度运行历史 | `History` |
| 通知中心 | `Bell` |
| 模型接入 / 设置 | `Settings` |

**全局状态件**

| 语义 | 图标 |
|---|---|
| 后端离线 | `ServerOff` |
| 后端重连中 | `RefreshCw` |
| 网络离线 | `WifiOff` |
| 信号弱 | `SignalLow` |
| 语义检索（正常） | `Search` |
| 关键词检索（降级） | `TriangleAlert` |
| 隐私模式开启 | `ShieldCheck` |
| 记忆不落盘 | `Lock` |

**设置页新增**

| 语义 | 图标 |
|---|---|
| 供应商 | `Cpu` |
| 密钥 | `KeyRound` |
| 掩码显示 / 隐藏 | `Eye` / `EyeOff` |
| 任务路由 | `Route` |
| 路由分支 / 条件 | `GitBranch` / `Waypoints` |
| 用量统计 | `Gauge` |
| 调用成本 | `CircleDollarSign` / `Coins` |
| 调用日志 | `ScrollText` |
| 日志筛选 | `SlidersHorizontal` |
| 参数微调 | `Settings2` |
| 限流 / 熔断 | `Ban` / `CircleSlash` |

**新增视图**

| 语义 | 图标 |
|---|---|
| 知识库文档 | `FileText` |
| 分块 / 切片 | `Blocks` / `Boxes` |
| 文档上传 | `FileUp` |
| 向量库 | `Library` / `FolderOpen` |
| 检索测试 | `Search` |
| 会话列表 | `MessageCircle` |
| 记忆条目 | `MemoryStick` |
| 清空记忆 | `Trash2` |
| 运行历史 | `History` / `Timer` |
| 重跑 | `RotateCcw` |
| 运行成功 / 失败 / 跳过 | `CircleCheck` / `CircleX` / `CircleMinus` |
| 运行中 | `Loader` |
| 通知未读 | `BellDot` |
| 通知已归档 | `Archive` |
| 收件箱 | `Inbox` |
| 相对时间 | `CalendarClock` |
| 查看详情 | `ExternalLink` / `Maximize2` |
| 更多操作 | `Ellipsis`（弃用别名 `MoreHorizontal`） |
| 复制 | `Copy` |
| 新增 | `Plus` |
| 编辑 | `Pencil` |
| 已校验 | `BadgeCheck` |
| 帮助 / 口径 | `CircleHelp` |
| 信息提示 | `Info` |
| 数据源连接 | `Cable` / `Plug` / `Webhook` |
| 外部服务 | `Server` |
| 同步 | `RefreshCw` |
| 分享 | `Share2` |
| 用户 | `UserRound` |
| 退出 | `LogOut` |
| 侧栏折叠 | `PanelLeft` |

### 9.6 图标使用规范补充

- **新增代码只允许使用 §9.5 表内的正式名。** 引入弃用别名视为该文件的 review 退回项。
- 现有 5 个在用别名（`AlertTriangle` / `CheckCircle2` / `Home` / `Wand2` / `HelpCircle`）**不阻塞本轮**：登记为技术债，在触碰对应文件时顺手迁移。理由——它们当前渲染正常，强制全量替换会扩大改动面，与"只做视觉重设计"的改造范围冲突。
- 全部图标统一 `strokeWidth={1.5}`，尺寸走 `--icon-*` 令牌，禁止裸数字。
- "更多操作"类图标按钮的 `aria-label` 必须写明语义（如「更多导出选项」），不能只写"更多"。

---

## 10. 导航结构扩展

### 10.1 问题

新增 4 个视图后，侧栏将从 6 项变为 **10 项**。平铺 10 项超出工作记忆上限（认知负荷规则：≤5 项单组），且当前 `.nav-item` 无分组机制，会让"数据/分析/知识/自动化/系统"五类语义混在一起。

### 10.2 方案：分组侧栏（保留单层，不引入二级折叠）

侧栏结构改为 **5 组 + 组标签**。组标签不参与点击、不进入 tab 序。

| 组 | 导航项 | view key |
|---|---|---|
| **数据** | 概览 | `home` |
| | 上传接入 | `upload` |
| | 数据预览 | `preview`（子视图，不出现在侧栏） |
| **分析** | 分析看板 | `dashboard` |
| | 图表详情 | `chart`（子视图） |
| | 数据质量 | `quality` |
| | 分析报告 | `report`（子视图） |
| **知识** | 知识库 | `kb` **（新增）** |
| | 会话与记忆 | `memory` **（新增）** |
| **自动化** | 定时调度 | `schedule` |
| | 调度运行历史 | `runs` **（新增）** |
| **系统** | 模型接入 | `settings` |
| | 通知中心 | `notifications` **（新增）** |

**建议的 `store.view` 枚举新增值（4 个）**：`kb`、`memory`、`runs`、`notifications`。
命名理由：`runs` 而非 `history` —— `history` 在数据工具语义里极易与"数据变更历史/清洗历史"混淆（项目已有 `cleanHistory`），`runs` 明确指向"调度运行次数"。

**`App.jsx` 的 `activeNav` 映射需同步补 4 条**（`kb`→`kb`，`memory`→`memory`，`runs`→`runs`，`notifications`→`notifications`）。

### 10.3 组标签规范

- 字号 `--text-2xs`（11px），字重 `--weight-emphasize`（510），颜色 `--meta`。
- 字距 `--tracking-caps`（+0.06em）—— 这是全大写拉丁标签的硬性下限；中文组名同样适用（11px 中文需少量正字距补呼吸）。
- **不着色。** 组标签绝不能用 `--accent`，否则侧栏会同时出现多处强调色，直接突破"每屏 ≤2 处"约束。
- 上间距 `--space-4`（16px），下间距 `--space-1`（4px）。
- 组标签本身**不可点击**（`<div>` 而非 `<button>`），不进入 tab 序，避免键盘用户被无效焦点打扰。

### 10.4 导航项与徽标

- `.nav-item` 高度 36px，左侧图标 18px（`--icon-md`），`gap: var(--space-2)`，`padding: 0 var(--space-3)`，`--radius-sm`。
- 激活态：`--accent-soft` 底 + `--accent` 文字 + `--weight-announce`（保持第一部分冻结定义）。
- hover 态：`--surface-sunken` 底 + `--fg` 文字。
- **计数徽标**（新增能力）：右对齐，`--radius-pill`，`--text-2xs`，`min-width: 18px`，`padding: 0 5px`。
  - 通知中心：未读数，用 `--accent` 实心 + `--accent-on` 文字，上限显示 `99+`。**注意**：此处的 accent 占用需计入该屏 ≤2 处预算 —— 侧栏徽标与内容区主 CTA 通常不同屏视觉焦点，可接受。
  - 数据质量：问题数，用 `--warn-bg` / `--warn-bd` / `--warn`（它是提示而非错误）。
  - 计数为 0 时**不显示徽标**（不要显示灰色 0，那是噪音）。
- **窄屏（≤1023px）**：侧栏收为 68px 图标轨后，**组标签必须隐藏**（`display: none`），改为在组之间插入 `1px solid var(--border-soft)` 分隔线 + `--space-2` 上下间距。图标轨里塞 11px 文字组名会把 68px 宽度撑爆。
- **窄屏徽标**：图标轨宽度装不下右侧徽标，改为**图标右上角 6px 圆点**（`position: absolute; top: 6px; right: 6px`），颜色同徽标；有数字则用 `--z-float` 的小号 pill（`min-width: 14px`，字号 10px）覆盖在图标右上角。

---

## 11. 全局状态件一：顶部后端状态条

> **架构约束（强制）**：后端离线时必须可见，**禁止静默降级**。这是降级策略的可见性保证，不是可选的优化项。

### 11.1 位置与层级

- 位于顶栏 `.topbar` **正下方**，横跨内容区（`shell-content`）全宽，**不覆盖侧栏**。
- `position: sticky; top: var(--topbar-h);`，随内容滚动时吸附在顶栏下方。
- 高度 `--statusbar-h`（36px），`z-index: var(--z-statusbar)`（95，**低于顶栏的 100**，避免状态条盖住顶栏）。

### 11.2 视觉规范（关键决策：它不是错误，是降级通知）

| 项 | 规范 |
|---|---|
| 底色 | `--warn-bg` |
| 边线 | 下边 `1px solid var(--warn-bd)` |
| 文字 | `--warn`，`--text-sm`（13px） |
| 图标 | `ServerOff`，`--icon-xs`（14px），`--warn` |
| 内边距 | `0 var(--space-5)`（横向 20px，与页面边距对齐） |

**为什么用 `--warn` 而不是 `--danger`**：应用仍然完全可用（浏览器直连模式照常跑分析）。用红色会把"降级"读成"故障"，制造不必要的焦虑，并且会与真正的错误状态争夺注意力。**红色留给真正的失败。**

**禁止**：不做闪烁、不做脉冲、不做渐变背景。它是一个常驻事实陈述，不是告警灯。

### 11.3 文案与结构

左侧（`gap: var(--space-2)`）：

```
[ServerOff] 本地服务未启动，已切回浏览器直连模式
```

右侧操作区（`margin-left: auto`，`gap: var(--space-2)`）：

- `RefreshCw` + 「重试连接」文字按钮（`--warn` 色，无边框，13px / 510）。
  - **命中区必须 ≥40×40px**：视觉上是一行文字，用 `::before { position: absolute; inset: -10px -8px }` 扩展命中区。
  - 重试中：图标换为旋转的 `RefreshCw`（`--dur-slower` 线性循环），文案改「正在重连…」，按钮 `disabled` + `aria-busy="true"`。
- 可选 `X` 关闭按钮 —— **允许关闭，但关闭后 5 分钟或刷新页面后必须重新出现**。理由：允许用户临时收起以腾出垂直空间，但状态不能在会话内永久消失（否则又变成隐性降级）。

### 11.4 状态机（4 态）

| 状态 | 触发 | 呈现 |
|---|---|---|
| `healthy` | 后端可达 | **状态条不渲染**。健康状态不显示绿色横幅 —— 常驻的绿色条会训练用户忽略该区域，等到真出问题时也看不见。 |
| `offline` | 首次探测失败 | 状态条出现（`--warn`），文案见 §11.3 |
| `reconnecting` | 用户点击重试 / 自动轮询中 | 图标旋转 + 「正在重连…」+ 按钮禁用 |
| `offline_persistent` | 重连连续失败 ≥3 次 | 同上，但文案追加失败原因摘要（如「连接被拒绝」），按钮文案改「再次重试」 |

出现用 `--dur-slow` 的 `height` 展开？**不允许动画 height**。改为：状态条容器始终占位（或使用 `transform: translateY(-100%)` 配合容器 `overflow: hidden` 做滑入）。推荐后者：容器固定 36px 高，内部条用 `transform: translateY(-100%)` → `translateY(0)`，`--dur-slow` + `--ease-out`。

### 11.5 无障碍

- 容器：`role="status"` + `aria-live="polite"`（**不用 `assertive`** —— 降级不是紧急中断，不应打断屏幕阅读器正在朗读的内容）。
- 图标 `aria-hidden="true"`（文字已完整表达）。
- 重试按钮：`aria-label="重试连接本地服务"`。
- 关闭按钮：`aria-label="暂时隐藏服务状态提示"`。

### 11.6 字段清单（请架构师确认）

状态条当前只展示一句话。若后端能提供更多信息，建议按需追加（**全部可选，缺失时不渲染对应片段，绝不显示占位符**）：

| 字段 | 用途 | 展示位置 |
|---|---|---|
| `mode` | `browser-direct` / `local-proxy`，决定文案 | 主文案 |
| `reason` | 失败原因摘要（如 `ECONNREFUSED`） | 仅在 `offline_persistent` 追加，`--font-mono` 11px |
| `retryCount` | 累计重试次数 | 仅在 ≥3 次时追加「已重试 N 次」 |
| `lastReachableAt` | 上次可达时间 | 仅在有值时追加「上次连通：14:32」 |

---

## 12. 全局状态件二：能力降级徽标

> **架构约束（强制）**：RAG 检索降级为关键词检索时必须显示徽标。数据分析场景下，静默降级会让用户误判结论可信度。

### 12.1 核心设计决策：正常态保持安静，只有降级态着色

这是本节最重要的判断。能力徽标会出现在**知识库列表、检索结果、问答气泡、分析报告**等多个位置。如果"语义检索"这个正常态也用 `--accent` 着色，它会：
1. 突破"每屏 ≤2 处 accent"的硬约束；
2. 让降级态失去对比 —— 到处都是彩色徽标时，用户不会注意到哪一个变了。

**因此：正常能力 = 完全中性的徽标；降级能力 = `--warn` 三元组 + 警示图标。** 让"正常"退成背景，是让"异常"被看见的唯一办法。

### 12.2 两档徽标规范

| 档 | 能力 | 底色 | 边框 | 文字色 | 图标 | 文案 |
|---|---|---|---|---|---|---|
| **正常** | 语义检索 | `--surface-sunken` | `--border` | `--meta` | `Search`（14px） | 语义检索 |
| **降级** | 关键词检索 | `--warn-bg` | `--warn-bd` | `--warn` | `TriangleAlert`（14px） | 关键词检索 |

共同规范：`--radius-pill`，`--text-2xs`（11px），`--weight-emphasize`，`padding: 1px var(--space-2)`，`gap: 4px`，`white-space: nowrap`。
**必须带图标** —— 满足"不依赖颜色传达含义"（WCAG 1.4.1）。仅靠底色从灰变黄，色觉障碍用户无法区分。

### 12.3 降级的实质性告知（比徽标更重要）

徽标只是标记。**真正的要求是让用户知道降级如何影响他正在看的结论。**

当满足「检索已降级」且「当前内容依赖检索结果」两个条件时，必须在内容区追加一行说明（不是 tooltip，不是徽标，是**正文级**提示）：

```
[TriangleAlert] 本次回答基于关键词检索，可能遗漏语义相近但用词不同的段落。
```

规范：`--warn` 文字，`--text-xs`（12px），`--leading-relaxed`，左侧 14px `TriangleAlert`，`margin-top: var(--space-2)`。

**必须出现的位置**：
| 位置 | 条件 |
|---|---|
| 问答面板的回答气泡下方 | 该回答调用了检索 |
| 知识库检索结果列表头部 | 检索模式为关键词 |
| 分析报告的相关结论块旁 | 结论引用了检索到的文档 |
| 知识库文档详情抽屉 | 该文档的向量索引缺失/未就绪 |

**不需要出现的位置**：与检索无关的纯统计图表（它们只依赖本地引擎计算）。不要让降级提示污染无关界面。

### 12.4 其他能力徽标（同一套规范，供后续复用）

| 能力 | 正常 | 降级 |
|---|---|---|
| 分析引擎 | `Sparkles` + 中性「模型引擎」 | `Cpu` + 中性「规则引擎」（这是设计内降级，非故障，**不着色**） |
| 后端模式 | 不显示 | `ServerOff` + `--warn`「浏览器直连」（与 §11 状态条呼应，徽标形式用于卡片内） |
| 脱敏状态 | `ShieldCheck` + `--success`「已脱敏」 | `TriangleAlert` + `--danger`「未脱敏」 |
| 隐私模式 | `Lock` + `--success`「记忆不落盘」 | — |
| 采样统计 | `Gauge` + `--warn`「采样统计」（已有 `.badge-sample`，改为走 `--warn` 三元组） |

---

## 13. 设置页新增 4 块

设置在 `settings` 视图内以区块纵向排列（延续第一部分 §4.9 的三段卡片结构，新增第 4–7 段）。每段之间 `--space-5`，区块内 `--space-4`。

### 13.1 区块四：LLM 供应商管理

**结构**：列表（无卡片容器，`border-top` 分隔 —— 密度 8 的驾驶舱模式）。

每行的信息层级：

```
[状态点] 供应商名（14px / 510）                    [设为默认] [测试] [编辑] [删除]
         模型名 · 掩码密钥                          最近测试：成功 2 分钟前
         gpt-4o-mini · sk-••••••••1a2b
```

| 元素 | 规范 |
|---|---|
| 状态点 | 8px 圆点，`--success`（可用）/ `--danger`（不可用）/ `--n-400`（未测试）。**必须同时有状态文字**，不能只靠点 |
| 供应商名 | `--text-md`（14px），`--weight-emphasize` |
| 模型名 | `--font-mono`，`--text-xs`（12px），`--meta` |
| **掩码密钥** | `--font-mono`，`--text-xs`，`--meta`。格式：前 3 位 + `•` 重复 8 个 + 后 4 位（例 `sk-••••••••1a2b`）。**密钥长度 < 12 时全部掩码，不显示任何真实字符** |
| 最近测试 | `--text-2xs`（11px），`--meta` |
| 操作 | ghost 文字按钮，`--control-h-sm`（32px），移动端升 40px。「删除」用 `--danger` 文字色 |
| 默认供应商 | 行首 `--accent` 的 2px 内嵌竖线（`box-shadow: inset 2px 0 0 var(--accent)`），**不用左边框**（禁止 >1px 侧边强调条） |

**安全硬约束（请前端严格遵守）**：
1. **列表视图的 DOM 中不得出现完整密钥。** 掩码必须由后端/存储层返回时即截断，而不是前端拿到明文再替换 —— 后者在 React DevTools 里一眼可见。
2. 只有进入编辑态（`type="password"` + `Eye`/`EyeOff` 切换）才允许显示明文，且切换默认关闭。
3. 编辑态的密钥输入框：autocomplete 关闭，`spellcheck` 关闭，禁止被浏览器表单恢复填充。
4. 删除供应商必须二次确认，若该供应商是默认供应商，确认文案需额外提示「删除后将回落到规则引擎」。

**空态**：`Cpu`（24px，`--muted`）+ 「还没有配置模型供应商」+ 「不配置也可以使用内置规则引擎，但图表规划与结论叙述不会升级」+ primary「添加供应商」。

**测试连接反馈**：就地替换行内的"最近测试"文本（不弹窗、不用 `alert`）。成功 `--success` + `CircleCheck`；失败 `--danger` + `CircleX` + 原因摘要（脱敏）。

### 13.2 区块五：按任务的路由配置

**结构**：每行「任务 → 供应商/模型」的映射。桌面双列（任务名固定 160px + 控件 `flex: 1`），移动端堆叠。

| 任务 | 说明（显示在任务名下方，`--text-2xs` / `--meta`） |
|---|---|
| 图表规划 | 根据数据特征选择图表类型 |
| 意图解析 | 理解用户提问指向哪个字段/维度 |
| 结论叙述 | 把统计结果写成可读结论 |
| Text-to-SQL | 生成查询语句 |

每行控件：供应商 select + 模型 select（**两级联动**：选供应商后模型列表刷新）。右侧可选「高级」（`Settings2` 图标）展开该任务的 `温度` / `最大输出 token` —— 默认折叠（渐进披露，不要在默认视图暴露 8 个参数）。

**降级策略**（每任务一个 select）：`使用默认供应商` / `跳过该任务` / `回落到规则引擎`。

**未配置供应商时的整块态**：区块不隐藏，而是显示说明 + 「先去配置供应商」链接按钮。理由——隐藏会让用户不知道这个功能存在。

### 13.3 区块六：Token 用量统计

**请架构师确认图表类型（我给出设计侧推荐）**：

| 用途 | 推荐 ECharts 类型 | 理由 |
|---|---|---|
| 按时间的 token 趋势 | `line`（平滑关闭，`smooth: false`） | 折线是时间序列的标准解；关闭平滑是因为平滑会对未采样区间做出视觉承诺，而这里没有数据支撑该承诺 |
| 按任务维度拆分消耗 | `bar` + `stack`（堆叠） | 堆叠柱状能同时读出「每日总量」与「任务构成」，比饼图提供更多信息且不受类别数量限制 |
| **不推荐** | `pie` / `doughnut` | 引用第二部分原则：饼图在类别 > 5 时不可读，且无法表达时间维度 |

**页头 KPI 区**（4 个数字，横向排列，`gap: var(--space-6)`）：

```
本月总消耗            输入 token          输出 token           预估成本
1,284,930             892,411            392,519             ¥ 18.42
（15px/510 标签）      （28px/680 mono tabular-nums 数字）
```

- 数字：`--text-2xl`（28px），`--weight-display`（680），`--font-mono`，`font-variant-numeric: tabular-nums`。
- 标签：`--text-sm`（13px），`--muted`。
- **禁止**：渐变数字、数字后面的彩色圆形图标背景、同比增长的绿色箭头（如无真实对比数据则不加）。**这是"虚构指标"反模式的高发位置** —— 没有真实数据支撑的百分比一律不放。
- 环比数据若真实存在，用 `--text-2xs` + `--success`/`--danger` + `TrendingUp`/`TrendingDown`，文案写「较上月 +12.4%」，并配 `title` 说明对比口径。

**时间范围**：`seg` 分段选择器（近 7 天 / 近 30 天 / 本月 / 自定义），复用第一部分已冻结的 `.seg` 样式。

**明细表**：复用 `.dp-*` 表格体系，行高降到 32px（`--control-h-sm`），列：时间 / 任务 / 模型 / 输入 / 输出 / 合计 / 耗时 / 状态。
- 数值列**右对齐 + tabular-nums**（第一部分 §5.4 规范）。
- 表头 sticky。

**空态**：`Gauge`（24px `--muted`）+ 「还没有调用记录」+ 「配置模型并完成一次分析后，这里会显示用量明细」+ ghost「去配置模型」。

**加载态**：KPI 区用等宽灰块骨架（保持 28px 行高，避免 CLS），图表区用 `--surface-sunken` 占位块。

### 13.4 区块七：调用日志列表

与 §13.3 明细表**共用一个表格组件**，差异在列与筛选器（避免两套几乎相同的表格代码）。

| 列 | 内容 |
|---|---|
| 时间 | `--text-xs`，`--meta`。同日显示 `HH:mm:ss`，跨日显示 `MM-DD HH:mm` |
| 任务 | 任务名 |
| 模型 | `--font-mono`，`--text-2xs` |
| 状态 | 语义徽标（见下） |
| 耗时 | 右对齐，`--font-mono`，毫秒 |
| Token | 右对齐，`--font-mono` |
| 操作 | ghost「详情」（`ExternalLink`） |

**状态徽标**（三元组）：
| 状态 | 底色 / 边 / 文字 | 图标 |
|---|---|---|
| 成功 | `--success-bg` / `--success-bd` / `--success` | `CircleCheck` |
| 失败 | `--danger-bg` / `--danger-bd` / `--danger` | `CircleX` |
| 降级 | `--warn-bg` / `--warn-bd` / `--warn` | `TriangleAlert` |
| 进行中 | `--info-bg` / `--info-bd` / `--info` | `Loader`（旋转） |

**筛选栏**（单行，`flex-wrap`）：状态下拉 + 任务下拉 + 时间范围 `seg` + 搜索框（按请求 ID / 关键词）+ ghost「导出 CSV」/「导出 Excel」（复用 `exportTableCSV` / `exportTableXLSX`）。

**行点击 → 详情抽屉**（`--z-drawer`，右侧 480px），**不用居中 Modal**。理由（NN/g）：Modal 会遮挡表格导致用户无法参照相邻记录；侧抽屉保留上下文。
抽屉内容：请求 ID（mono + 复制按钮）/ 任务 / 模型 / 参数（温度、max tokens，只读）/ 耗时分段（排队、首 token、总时长）/ Token 明细 / **脱敏后的**请求摘要与响应摘要（默认折叠，点击展开）/ 错误信息（`--danger`，仅错误摘要，禁止暴露堆栈）。

**安全硬约束**：抽屉内的请求/响应摘要必须脱敏 —— 移除 API Key、Authorization 头、以及识别为 PII 的字段。导出 CSV/Excel 同样走脱敏后的数据，**不得导出原始 payload**。

**失败率统计条**：表格上方一行 `--text-xs` `--meta`：「近 200 次调用成功 194 次（97.0%），失败 4 次，降级 2 次」。数字用 `--font-mono`。

**空态**：`ScrollText` + 「还没有调用日志」+ 「模型被调用后，这里会记录每次请求」。

**无边界的日志列表是性能陷阱**：必须分页（每页 50 条）或虚拟滚动，并在筛选变化时重置到第 1 页。

---

## 14. 新增视图设计

> **架构约束**：4 个新视图**必须各自独立成文件**，不得写入 `Views.jsx`（已 706 行，超 300 行硬规则，ADR-001 登记为技术债）。同理新逻辑不进 `store.js`。

### 14.1 知识库 `kb`

**布局**：单列。**不使用"左侧文档列表 + 右侧详情"的双栏**。

> 决策理由：应用外壳已有 232px 侧栏，再加 280px 列表栏 = 512px 固定 chrome，在 1280px 视口下只剩 768px 给内容，且窄屏下双层侧栏会彻底失效。改用**列表 + 详情抽屉**，与 §13.4 日志详情保持同一套交互模式。

自上而下：

1. **工具栏**：primary「上传文档」（`FileUp`）+ ghost「新建文件夹」+ 搜索框（`Search`，`flex: 1`，max-width 320px）+ 状态下拉（全部 / 已就绪 / 索引中 / 失败）
2. **统计行**（`--text-xs` / `--meta`）：「共 42 篇文档 · 已索引 39 篇 · 1,284 个分块」
3. **文档表格**（复用 `.dp-*`）：列 = 文档名（左，`--weight-emphasize`，超长省略 + `title`）/ 类型 / 大小 / 分块数 / 状态 / 上传时间 / 操作
   - 状态列：`CircleCheck` + `--success`「已就绪」；`Loader` 旋转 + `--info`「索引中（64%）」；`TriangleAlert` + `--danger`「解析失败」
   - 行点击 → 详情抽屉；行内 hover 出现「重新索引」「删除」ghost 按钮
4. **上传区**：无文档时显示 `.upload-zone`（虚线 + 拖拽时 `--accent-wash`）；有文档时上传走工具栏按钮，拖拽仍可用（整表区域作为 drop target）

**详情抽屉**（右侧 480px）：
- 头部：文档名 + 关闭钮
- 元信息区：类型 / 大小 / 分块策略 / 分块数 / 索引用时（mono 数字）
- **能力徽标**：`语义检索`（中性）或 `关键词检索`（`--warn`）—— 该文档的索引状态
- **[重新索引] [删除]** 操作行
- **分块预览列表**：每个分块一张卡（`--surface-sunken` 底 + `--radius-sm` + `padding: var(--space-3)`）
  - 卡头：`#序号`（mono）/ 字符数 / 命中相似度（检索测试时）
  - 卡体：分块文本，`--text-sm`，`--leading-relaxed`，默认最多 6 行，超出显示「展开全文」
  - **检索命中高亮**：命中的分块整体 `--accent-wash` 底 + `1px solid var(--accent-line)`，并在卡头显示相似度分数（mono）。这是整个抽屉最有价值的信息。
- 分块列表超过 50 项时虚拟滚动或分页

**检索测试（同页 tab 切换，不是新视图）**：
- 输入框 + 「检索」按钮
- 结果：命中的分块按相似度降序，每项显示分数 + 来源文档 + 文本片段（命中关键词加粗或 `--accent-wash` 底）
- 顶部显示当前检索模式徽标
- 无命中：「未检索到相关内容」+ 「试试更换关键词，或确认文档已完成索引」+ 若是关键词模式，追加 §12.3 的降级说明

**关键状态**：空（无文档）/ 索引中（进度）/ 解析失败（原因 + 重试）/ 检索无结果 / 检索降级

### 14.2 会话与记忆管理 `memory`

**布局**：单列，两个区块（会话列表 / 记忆条目），各带标题与说明。

#### 区块一：会话列表

- 标题：`MessageCircle` + 「会话」+ 右侧 ghost「清空全部会话」
- 表格（`.dp-*`，行高 36px）：会话标题（`--weight-emphasize`）/ 消息数 / 关联数据集 / 最后活跃 / 操作
  - 操作：ghost「继续对话」（回到看板并打开 ChatPanel）+ icon-btn「重命名」(`Pencil`) + icon-btn「删除」(`Trash2`，二次确认)
- 行点击 → 继续该会话
- 空态：「还没有会话记录」+「在分析看板中点击「问数据」开始第一轮对话」

#### 区块二：记忆条目

- 标题：`MemoryStick` + 「记忆」+ 说明（`--text-xs` / `--meta`）「记忆会在后续提问中作为背景上下文注入」
- 若隐私模式开启：区块头部显示 `ShieldCheck` + `--success` 徽标「隐私模式：记忆不落盘」，且**列表变为只读**（禁用编辑/删除，显示"本次会话结束后自动清除"）
- 列表（`border-top` 分隔，非卡片）：每项 = 记忆内容（`--text-sm`，`--leading-relaxed`，最多 3 行省略）+ 来源会话（`--text-2xs` / `--meta`）+ 创建时间 + 启用开关 + 编辑/删除
- 启用开关：复用第一部分 §5.7 的 `.switch` 规范（`role="switch"` + `aria-checked`）
- **危险操作**：`--danger` ghost「清空全部记忆」→ 二次确认 Modal，要求用户**输入确认词**「清空」（不只是点"确定"）。理由：记忆是累积性资产，误删不可恢复，且这个按钮就在列表旁边容易误触。

**关键状态**：空（无会话 / 无记忆，两个区块各自独立空态）/ 隐私模式只读态 / 保存中（开关 loading）/ 删除确认

### 14.3 调度运行历史 `runs`

**布局**：单列。

1. **统计条**：`Gauge` + 「近 30 天运行 128 次 · 成功 121 · 失败 5 · 跳过 2 · 成功率 94.5%」（数字 `--font-mono`）
2. **筛选栏**：调度名下拉 + 状态下拉（全部/成功/失败/跳过/运行中）+ 时间范围 `seg` + ghost 导出
3. **运行记录表格**（`.dp-*`，行高 36px）：
   | 列 | 说明 |
   |---|---|
   | 开始时间 | `MM-DD HH:mm` |
   | 调度名 | `--weight-emphasize` |
   | 触发方式 | 徽标：「自动」中性 / 「手动」`--info` |
   | 状态 | 四态语义徽标（同 §13.4） |
   | 耗时 | 右对齐 mono |
   | 输出行数 | 右对齐 mono |
   | 操作 | ghost「查看结果」（跳看板）+ ghost「重跑」 |
   - **失败行可展开**：点击行首 `ChevronRight`/`ChevronDown` 展开一行，显示错误原因（`--danger`，脱敏）+ 「重跑」按钮。**不在失败行用整行红底** —— 那是把表格变成警告墙。
   - 「运行中」行：状态徽标 `Loader` 旋转 + 行尾显示进度条（复用 `.stream-bar`）
4. **空态**：`History` + 「还没有运行记录」+ 「配置定时调度后，每次执行都会记录在这里」+ ghost「去配置调度」

**与 `schedule` 视图的关系**：`schedule` 管配置（增删改调度规则），`runs` 管执行结果（只读 + 重跑）。两者用同一套表格组件，避免重复实现。

### 14.4 通知中心 `notifications`

**布局**：单列，**用列表而非表格**（通知是内容型条目，字段不一致，表格的列对齐反而增加阅读成本）。

1. **工具栏**：标题「通知」+ 未读数（`--font-mono`）+ 右侧 ghost「全部标为已读」+ ghost「清空」
2. **类型筛选**：chip 组（全部 / 调度 / 数据质量 / 服务状态 / 用量）—— 复第一部分 chip 规范，选中态实心 `--accent` 底
3. **通知列表**：每项结构
   ```
   [类型图标] 标题（14px / 590）                          相对时间
              正文摘要（13px / --muted，最多 2 行省略）    [操作]
   ```
   - **未读态**：容器 `box-shadow: inset 2px 0 0 var(--accent)` + 标题 `--weight-announce`（590）+ 文字 `--fg`
   - **已读态**：无内嵌线，标题 `--weight-emphasize`（510）+ 文字 `--muted`，整体 `opacity: 0.86`
   - 类型图标（`--icon-md`，装在中性 28px 容器内，**不按类型着色**以维持克制）：
     | 类型 | 图标 | 语义色 |
     |---|---|---|
     | 调度完成 | `CircleCheck` | `--success`（仅图标着色） |
     | 调度失败 | `CircleX` | `--danger` |
     | 数据质量警告 | `TriangleAlert` | `--warn` |
     | 服务状态 | `ServerOff` | `--warn` |
     | 用量阈值 | `Gauge` | `--warn` |
     | 一般信息 | `Info` | `--info` |
   - 相对时间：`--text-2xs` / `--meta`，「3 分钟前」「昨天 14:32」，超过 7 天显示日期
   - 行操作（hover 出现，但**必须也可通过键盘聚焦触发**，否则违反 hover-only 反模式）：ghost「查看」+ icon-btn 标为已读
   - 点击已读项不再改变状态；点击未读项标为已读
4. **分页**：「加载更多」按钮（每页 30 条），不用无限滚动（通知用户常需回到特定时间的一条）
5. **空态**：`Inbox` + 「暂无通知」+ 「调度执行、数据质量问题、服务状态变化会在这里通知你」
6. **侧栏联动**：侧栏「通知中心」项显示未读数徽标（§10.4）

**设计取向说明**：通知**不主动弹窗、不打断当前任务**。它只进列表 + 可选的一条 toast（仅限"调度失败"这类需要即时知晓的事件）。理由——数据分析是需要连续专注的任务，弹窗式通知会破坏工作记忆。

---

## 15. 新增设计令牌（已同步写入两处）

以下令牌已追加到 `src/design-tokens.css` 与 `src/design-tokens.json`，两处必须保持一致。

| 令牌 | 浅色值 | 暗色值 | 用途 |
|---|---|---|---|
| `--z-statusbar` | `95` | `95` | 后端状态条（低于顶栏 100） |
| `--statusbar-h` | `36px` | `36px` | 状态条高度 |
| `--chart-1` | `#15795B` | `#46B494` | 图表主系列（墨绿 anchor） |
| `--chart-2` | `#57A88F` | `#97D7C2` | 图表次系列 |
| `--chart-3` | `#9CC3B4` | `#5F8C7C` | 图表第三系列 |
| `--chart-4` | `#C9D8D1` | `#3A5A50` | 图表第四系列（面积填充） |
| `--chart-5` | `#6F6C65` | `#8B8F96` | 对比系列（中性灰） |
| `--chart-grid` | `--border-soft` | `--border-soft` | 网格线 |
| `--chart-axis` | `--n-400` | `--n-400` | 坐标轴线 |
| `--mask-fill` | `--surface-sunken` | `--surface-sunken` | 骨架屏填充 |
| `--mask-sheen` | `--n-150` | `--n-300` | 骨架屏微光扫描 |

**为什么需要 `--chart-1..5`**：`EChart.jsx` 目前有 18 处硬编码色值（含地图 visualMap 的 `#EAF3F0`/`#9CC9BB`/`#5DA894`/`#15795B`），暗色主题下靠 `applyChartTheme()` 运行时替换。新增用量统计图表时必须走令牌，否则硬编码色值会继续扩散。

**图表配色的硬约束**：全部来自墨绿同色系 + 中性灰，**不使用彩虹色板**。系列数超过 5 时必须合并小组为「其他」，而不是继续加色 —— 超过 5 个系列时任何配色都不可区分。

---

## 16. 主题模式 light / dark / system

### 16.1 `system` 不需要第三套令牌（重要）

`store.js` 的 `theme` 字段有 3 个值，但**设计令牌只有 2 套**：

```
theme = 'light' | 'dark' | 'system'      ← 用户偏好（store.theme）
appliedTheme = 'light' | 'dark'          ← 实际生效（store.appliedTheme）
```

`system` 由 `window.matchMedia('(prefers-color-scheme: dark)')` 在运行时解析为 `light` 或 `dark`，写入 `document.documentElement.dataset.theme`（`App.jsx` 已有此实现）。

**明确禁止**：
- 禁止创建 `[data-theme="system"]` 选择器 —— 它永远不会被命中，是死代码。
- 禁止为 `system` 新增第三套颜色变量 —— 会立刻产生 3 份需要同步维护的色板，必然漂移。
- 新增组件的样式**只能**依赖 `:root` 与 `[data-theme="dark"]` 两层。

### 16.2 新视图必须支持主题切换的三件事

1. **全部颜色走 `var(--token)`。** 暗色下不需要写任何 `[data-theme="dark"]` 覆盖。
2. **ECharts 图表必须响应 `themechange`**。`EChart.jsx` 已通过 `window.addEventListener('themechange', ...)` 重新上色；新增的用量统计图表若独立实现，必须挂同一事件，否则切主题后图表文字会消失（暗色底 + 深色文字）。
3. **图片 / 图标无例外**。所有图标继承 `currentColor`；若必须有位图（如文档缩略图），用 `--surface-sunken` 兜底背景。

### 16.3 主题切换的即时性

`App.jsx` 在 `theme` 变化时同步写入 `data-theme` 并派发 `themechange` 事件。新增视图不得缓存颜色值到 JS 状态中（例如把颜色存进 `useState`），否则切换主题时不会更新。**颜色只在 CSS 层解析。**

---

## 17. 实现落点与文件清单

### 17.1 新增文件（4 个视图 + 3 个共享件）

| 文件 | 内容 | 加载方式 |
|---|---|---|
| `src/KnowledgeBase.jsx` | 知识库视图（列表 + 详情抽屉 + 检索测试） | `React.lazy` |
| `src/MemoryView.jsx` | 会话与记忆管理 | `React.lazy` |
| `src/RunHistory.jsx` | 调度运行历史 | `React.lazy` |
| `src/NotificationCenter.jsx` | 通知中心 | `React.lazy` |
| `src/components/BackendStatusBar.jsx` | 后端状态条（全局状态件） | 静态引入（首屏可见） |
| `src/components/CapabilityBadge.jsx` | 能力降级徽标（含 §12.3 的正文级降级说明） | 静态引入 |
| `src/components/DataGrid.jsx` | 共享表格（`.dp-*` 体系）：用量明细 / 调用日志 / 运行历史 / 知识库文档四处复用 | 静态引入 |

**命名与既有约定一致**：项目已有 `ScheduleView.jsx`、`ChartToolbox.jsx`、`TemplateLibrary.jsx`、`CleanPanel.jsx` 等顶层功能文件，新视图沿用扁平结构，不引入 `src/views/` 新目录（避免出现两套约定）。
**懒加载理由**：3 个新视图都是低频入口（知识库、记忆、运行历史、通知），不应进入首屏包。`ScheduleView.jsx` 已在用 `React.lazy`，属既有模式。
**`DataGrid.jsx` 存在的理由**：4 处表格的列不同但行为完全相同（sticky 表头、数值右对齐、hover 行、空态、分页）。若各自实现，第一部分的表格规范会在 4 个文件里漂移。

### 17.2 需修改的既有文件（保持最小改动）

| 文件 | 改动 | 约束 |
|---|---|---|
| `src/App.jsx` | 新增 4 个视图的渲染分支 + 侧栏新增 4 项与 5 个组标签 + `activeNav` 映射补 4 条 + 挂载 `BackendStatusBar` | 只加不改，不重构既有分支 |
| `src/store.js` | `view` 枚举新增 `kb` / `memory` / `runs` / `notifications` 四个合法值 | 仅加枚举值，不加业务逻辑（ADR-001） |
| `src/styles.css` | 修复第一部分 §6 的 24 项缺陷 + 追加新增类 | 不回写变量，不重命名既有类 |
| `index.html` | `<head>` 首部加 `preconnect` 两行 | 见第一部分 §7 |

**`Views.jsx` 与 `store.js` 均不新增业务逻辑。** `Views.jsx` 只允许删除（当旧代码迁出时），不允许增长。

### 17.3 新增 CSS 类命名（沿用既有前缀风格）

| 前缀 | 用途 |
|---|---|
| `.statusbar*` | 后端状态条 |
| `.cap-badge*` | 能力降级徽标 |
| `.cap-note` | 正文级降级说明（§12.3） |
| `.nav-group` / `.nav-group-label` | 侧栏分组 |
| `.nav-count` | 导航计数徽标 |
| `.kb-*` | 知识库 |
| `.chunk-*` | 分块预览 |
| `.mem-*` | 记忆条目 |
| `.run-*` | 运行历史 |
| `.notice-*` | 通知 |
| `.usage-*` | 用量统计 KPI |
| `.log-*` | 调用日志 |
| `.provider-*` | 供应商行 |
| `.route-row*` | 任务路由行 |

新增类**必须**使用第一部分已冻结的令牌，不得引入新的裸色值或非 4 倍数间距。

### 17.4 本轮不做的事（明确边界）

以下属于"视觉重设计 + 新增视图"以外，本轮不实现，避免范围蔓延：

- 不做知识库的文件夹树（用平铺列表 + 搜索 / 筛选替代）
- 不做用量统计的预算告警配置（只做展示）
- 不做通知的推送通道设置（后端未就绪，界面只做站内列表）
- 不做调度运行历史的对比视图（不做两次运行的 diff）
- 不做供应商的自动故障转移配置（只做手动指定默认供应商）

若 PM 或架构师认为上述任一为必需，请提出来重新评估范围，而不是在实现中临时加入。

---

## 18. 待架构师确认的 3 个问题

1. **后端状态条需要展示哪些字段？** 我按 §11.6 给了 4 个可选字段（`mode` / `reason` / `retryCount` / `lastReachableAt`），设计上全部按"有则显示、无则不渲染"处理。请确认实际可提供的字段集合，以及 `mode` 的枚举值。
2. **用量统计图可用哪些 ECharts 类型？** 我已按 `line`（时间趋势）+ `bar` stacked（任务构成）设计，并明确不推荐 `pie`。请确认现有 `engine.js` 的图表生成能力是否覆盖这两种，以及是否需要新增 option 构造函数。
3. **4 个新视图的 `view` key 命名是否认可？** 我提议 `kb` / `memory` / `runs` / `notifications`（理由见 §10.2，`runs` 而非 `history` 是为避开与 `cleanHistory` 的语义冲突）。这需要同步进 `store.js` 枚举，请确认后我再定稿导航的 `activeNav` 映射表。

---

## 19. 增补部分自检

| 检查项 | 结果 |
|---|---|
| 是否修改第一部分已冻结条目 | 未修改。第 1–8 节逐字保留 |
| 图标名是否全部实测存在 | 是。`lucide-react` 0.400.0，83 个名字逐一校验，新增界面所需 91 个图标 100% 为正式声明 |
| 是否引入 emoji | 无 |
| 是否引入禁用紫粉渐变 | 无 |
| 是否引入硬编码色值 | 无。新增令牌全部落在 `design-tokens.css` / `.json` 两处 |
| 是否引入弹跳缓动 | 无 |
| 新增令牌的间距是否 4 倍数 | 是（`--space-*` 令牌） |
| 新增可点元素 ≥40px | 是。§11.3 的重试按钮、§13 的操作按钮、§14 的行操作均已注明命中区扩展方式 |
| 是否指定了不使用颜色的替代表达 | 是。能力徽标带图标（§12.2）、状态点带文字（§13.1）、状态徽标带图标（§13.4） |
| 是否给了空态 / 加载态 / 错误态 | 是。每个新增视图与区块均含三态 |
| 是否避免虚构指标 | 是。§13.3 明确禁止无来源的百分比与同比箭头 |

---

# 第三部分 · 增补（隐私档位界面）

> **本节性质**：响应 PM 同步的 F0 契约变更（PRD v2.2 §1.2 / §6.1 F0 / §11）。**F0 为 P0 横切项，档位选择器 UI 是 F0 验收的组成部分，不延后到 P1。**
> 依据：`docs/01-PRD.md` §1.2（三档定义与隐私承诺口径）、§6.1 F0（六条验收）、§11（隐私埋点）；`docs/02-架构.md` §6.8（`capabilities` / `settings` 响应体）、§7.4.1（闸门矩阵）、§7.4.3（4030 响应体规范）。
> 本节不修改第一、二部分任何已冻结条目。配套：`docs/03-UIUX-附录A-Token清单.md`。

## 20. 隐私档位（`privacy_mode`）界面设计

### 20.1 三档语义（严格照 PRD，不得改写）

| 档位 | 后端行为 | UI 一句话 |
|---|---|---|
| `strict`（默认） | 只做 LLM 代理 + 会话元数据；**阻断 RAG 的入库与检索**；阻断服务端数据集明细上传与执行 | 不出本机的功能全关 |
| `standard` | 放开 RAG 知识库（入库 + 检索），文档由用户主动选择 | 允许文档出本机（随 prompt） |
| `full` | 在 `standard` 基础上，额外允许数据集明细上传到服务端执行 SQL | 允许明细出本机 |

**核心数据源（UI 显隐的唯一依据）**

```js
// GET /api/v1/meta/capabilities
{ rag, semantic_search, embeddings_available, server_sql, privacy_mode }

// GET /api/v1/settings/privacy-mode
{ privacy_mode,
  effective_grants: { llm_proxy, conversation_persistence, kb_ingest,
                      kb_search, server_sql, external_db_proxy },
  blocked_by_downgrade: { server_datasets, knowledge_bases, kb_documents },
  updated_at }
```

### 20.2 档位指示器（顶栏常驻）

**需求来源**：PRD §6.1 F0 验收⑤要求降级影响必须可见；PRD §6.2「降级可见」要求任何能力降级都要有徽标 + 一句人话 + 恢复路径。

**位置**：顶栏 `.topbar` 右侧，主题切换按钮左侧。常驻，不可关闭。

**结构**：`[ShieldCheck] strict 档` —— 14px 图标 + 13px 文字，`--muted`，无底色无边框，`gap: 4px`。命中区 ≥40×40px。**元素类型为 `<button>`**，不是标签。

#### 决策一：三档不做颜色编码

**不采用**「strict 绿 / standard 黄 / full 红」或任何色彩编码。理由：

1. **颜色会引入价值判断。** `strict` 是**默认档、最私密档**，不是"最差档"。若给 `full` 配绿色，等于在暗示"放松隐私 = 好"；若给 `strict` 配绿色，又会让 `standard`/`full` 的用户觉得自己在"做错事"。**三档是用户对边界的自主选择，不是优劣排序。**
2. 突破"每屏 ≤2 处 `--accent`"约束。顶栏再加一个彩色徽标，会让这一屏的强调色预算失控。
3. 颜色编码会把"档位"变成视觉噪音。用户在 `standard` 下正常工作时，不需要被持续提醒。

**三档表现形式相同，仅文字不同。**

#### 决策二：指示器必须是「解释入口」，不能只是标签

> **PM Q1 约束（原文裁定）**：点它要能看到 ① 当前档位 ② 为什么某些东西不可用 ③ 去哪改。如果它只显示一个档位词、点了跳到设置页却没有解释，那它没解决"用户不知道原因"这个问题。

因此**点击行为不是跳转，而是就地展开解释面板**（§20.2.2）。面板底部才提供"去设置"的动作。理由：用户的疑问是"这是什么 / 我为什么被挡住 / 我该不该改"，**直接跳设置会让他面对一个没有上下文的表单** —— 那是把解释成本转嫁给用户。

**唯一例外**：面板只有在**存在被阻断内容**时才需要展开。三项计数全为 0 时，点击直接跳设置页档位区块（此时没有解释需求，跳转是正确的一步到位）。

#### 决策三：持续状态用中性色，不用警示色

> **PM Q1 约束**：指示器不要用红/黄警示色 —— 档位不是故障。

这条约束推出了一条**全项目适用的语义细分规则**，并**修正了我此前在 §20.6 给出的粗粒度分组**：

| 类别 | 判定 | 配色 | 例 |
|---|---|---|---|
| **持续状态**（用户自己设定的边界在生效） | 不随事件变化，一直在 | **中性**（`--muted` / `--surface-sunken` / `--fg`） | 当前档位、被阻断的 N 项内容、知识库文档锁住 |
| **拦截事件**（用户动作被边界挡住） | 由一次具体操作触发 | `--warn`（三元组） | 4030 拦截提示、后端离线状态条、检索降级徽标、采样统计 |
| **真实失败** | 出错 | `--danger` | 解析失败、连接失败、SQL 错误 |
| **常驻事实陈述** | 与用户动作无关的须知 | `--info` | 数据去向披露、db-proxy 说明 |

**为什么"被阻断的 N 项"归中性而非 `--warn`**：它是用户自己所选档位的**必然结果**，是稳定状态而非异常。用琥珀色持续标记，等于每天告诉用户"你选错了"——这与决策一反对颜色编码是同一个道理。

**那它靠什么被注意到？** 靠**结构差异**而非颜色：在整条只有文字和图标按钮的顶栏里，它是一个带 `Lock` 图标 + 等宽数字的**胶囊徽标**——异常元素本身就构成视觉信号。加上三项叠加：① 下调档位时的确认弹窗已经明确告知过影响面；② 知识库等页面有就地说明条（§20.9）；③ 徽标数字是常驻的，用户每次看顶栏都会经过。**三者互为冗余，无需依赖颜色。**

#### 20.2.1 指示器的 4 种状态

| 状态 | 触发 | 呈现 |
|---|---|---|
| **常规** | `blocked_by_downgrade` 三项计数全为 0 | `[ShieldCheck] strict 档`，`--muted`。点击直接跳设置页档位区块 |
| **有东西被挡** | 任一计数 > 0 | 追加**中性**胶囊徽标：`[Lock] 3 项`。徽标：`--surface-sunken` 底 + `1px solid var(--border)` + `--fg` 文字 + 11px + `--font-mono` + `tabular-nums`。**不用 `--warn`。** 点击展开解释面板（§20.2.2） |
| **后端离线** | `/health` 探测失败 | 指示器替换为 `--warn` 的 `[ServerOff] 直连模式`。**此处保留 `--warn` 是刻意的**：后端离线是需要用户采取动作的问题（去启动服务），属"拦截事件/故障"类，非"用户设定"类。与 §11 状态条分工：状态条讲原因与重试，指示器讲当前能力边界 |
| **能力未就绪** | `rag=false`（chromadb 未装） | 指示器不变；知识库入口按架构 §10.1 隐藏，并在设置页显示安装指引 |

#### 20.2.2 解释面板（点击展开）

**形态**：锚定在指示器下方的 Popover（`--z-tooltip`，`--elev-3`，`--radius-md`，宽 `min(360px, calc(100vw - 32px))`，`padding: var(--space-4)`）。桌面锚右下角，移动端改为底部 sheet。

**必须包含三要素**（对应 PM Q1 约束的 ①②③）：

```
┌────────────────────────────────────────────┐
│ [ShieldCheck] 当前档位：strict              │   ← ① 当前档位
│                                             │
│ 以下内容因档位受限，当前不可访问：           │   ← ② 为什么不可用
│ [Lock] 服务端数据集      3 个                │
│ [Lock] 知识库            1 个                │
│ [Lock] 知识库文档       47 篇                │
│                                             │
│ 内容没有被删除，调整档位后即可恢复访问。      │
│                                             │
│ [去设置里调整档位]        [了解三档区别]      │   ← ③ 去哪改
└────────────────────────────────────────────┘
```

| 元素 | 规范 |
|---|---|
| 标题行 | `ShieldCheck` 16px + 「当前档位：strict」，13px / 590 / `--fg`。档位 id 用 `--font-mono` |
| 计数列表 | 每行 `[Lock]` 14px `--muted` + 名称 13px `--fg` + 计数右对齐 `--font-mono` + `tabular-nums`。**计数为 0 的项不列出** |
| 复位说明 | 12px / `--muted` / `--leading-relaxed`。**必现**：「内容没有被删除，调整档位后即可恢复访问。」 |
| 主操作 | `[去设置里调整档位]` primary 文字按钮，跳 `settings` 档位区块并**高亮该区块** |
| 次操作 | `[了解三档区别]` ghost，展开 §20.9 的说明面板 |
| 计数全为 0 时 | 列表区替换为一行中性说明「当前没有因档位受限的内容。」 |

**交互细节**：
- `Esc` 关闭；点击面板外关闭；`Tab` 循环限于面板内（focus trap）
- 展开/收起用 `opacity` + `translateY(-4px → 0)`，`--dur-fast`（120ms）。**不动画 height**
- 若某项计数 > 0 且 `blocked_by_downgrade` 语义为"相对当前档位"（**待架构师确认，见 §20.16**），徽标常驻；若语义为事件增量，则徽标仅在切档后一个会话内显示 —— 两种语义下的面板内容相同，只是常驻性不同

#### 20.2.3 为什么不用 hover tooltip 而用点击面板

我此前设计的是 `hover` 触发的 tooltip。改为**点击面板**，三个理由：

1. **触屏没有 hover。** 移动端用户永远看不到 tooltip 内容，而顶栏在移动端同样常驻 —— 等于对一类用户静默隐藏了关键信息。
2. **tooltip 装不下**。PM 要求的三要素（档位 + 明细计数 + 复位说明 + 两个动作）在 tooltip 的尺寸约束下会被压成一句干瘪的话，失去"解释"功能。
3. **键盘可达**。`<button>` + `aria-expanded` 面板可用键盘完整操作；hover tooltip 对键盘用户要求额外的 `focus` 触发逻辑，且焦点离开即消失，无法阅读其中的链接。

无障碍：按钮 `aria-expanded` + `aria-controls`；面板 `role="dialog"` + `aria-label="档位限制说明"`。
### 20.3 档位选择器（设置页）

**位置**：`settings` 视图，作为**第一个区块**（在「界面主题」之前）。理由：隐私边界是产品的第一承诺，排在最前面与 PRD §1.2 的优先级一致。

**形态**：3 张**单选卡片**（`role="radiogroup"` + `role="radio"` + `aria-checked`），纵向排列。
**为何不用分段选择器（`.seg`）**：每档都需要一段说明文字来解释"允许什么出本机"，分段控件的宽度装不下。档位选择是有认知成本的决策，值得占用纵向空间。

每张卡片结构：

```
┌─────────────────────────────────────────────────────────┐
│ ( ) strict                                    当前档位   │   ← 标题行
│     不出本机的功能全关                                    │
│     阻断：知识库入库与检索、服务端数据集上传与服务端 SQL   │
│     [ShieldCheck] 唯一出本机的通道：LLM 调用             │   ← 数据去向
└─────────────────────────────────────────────────────────┘
```

| 元素 | 规范 |
|---|---|
| 卡片容器 | `1px solid var(--border)`，`--radius-md`，`padding: var(--space-4)`，`--surface` 底 |
| hover（未选中） | 边框 `--border-strong`，`--elev-1`，160ms |
| **选中态** | 边框 `--accent` + `--accent-wash` 底 + 左侧 `box-shadow: inset 2px 0 0 var(--accent)`。**单选点**：18px 圆环，选中填充 `--accent` + 白色 10px 圆点 |
| focus-visible | `--focus-ring`，`outline-offset: 2px` |
| 禁用（当前档位为最高时） | 不适用 —— **三档永远可切换**，不做禁用 |
| 标题 | 14px / 590 / `--fg`，档位 id 用 `--font-mono`（它是配置值，不是文案） |
| 副标题（一句话语义） | 13px / `--meta` |
| 「阻断」行 | 12px / `--muted`，前缀 `TriangleAlert` 14px `--muted`。**只列被阻断的能力，不列已允许的** —— 减少每卡的信息量 |
| 「数据去向」行 | 12px / `--info`，前缀 `ShieldCheck` 14px `--info`。见 20.6 |
| 「当前档位」标记 | 11px / `--meta`，`--surface-sunken` 底 pill（**不着色**，同 20.2 决策一） |

**切换流程**：点击卡片 → 立即进入**切档确认**（20.4），不直接生效。

### 20.4 切档确认（`blocked_by_downgrade` 的具体计数在此呈现）

**需求来源**：PM 第 1 条 —— 降级提示必须给出"具体有几个东西被挡住"，不能是笼统的"部分功能不可用"。理由：用户若以为调回 `strict` 数据就没了，下次不敢再往上调，档位机制会退化成"永远停在 strict"。

**形态**：居中 Modal（`--z-modal`，`--elev-4`，`--radius-lg`，宽 `min(520px, 100%)`）。**必须是 Modal 而非 inline** —— 切档是有后果的决策，需要一次明确确认。

**向上调档（strict → standard → full）**：确认文案为「说明新增什么会出本机 + 确认按钮」。

```
上调到 standard？

新增允许：
  · 知识库文档入库与检索 —— 文档分块文本会随 prompt 发给上游模型
  · 检索命中内容会进入对话上下文

明细数据仍然不出本机；要彻底零外传，请把模型 provider 指向本机 Ollama。

[取消]  [上调到 standard]
```

**向下调档（full → standard → strict）** （本节重点）：

```
降档到 strict？

以下内容将被阻断访问，但**不会被删除**：
  · 服务端数据集    3 个
  · 知识库          1 个
  · 知识库文档     47 篇

调回 standard 或 full 后即可重新访问，数据一直在。
当前正在使用这些内容的定时任务将被暂停。

[取消]  [降档到 strict]
```

**呈现规则（硬要求）**：

1. **必须逐项列出三项计数**，且用 `--font-mono` + `tabular-nums` 右对齐。**禁止**合并成"3 项资源"或"部分内容"。
2. **计数为 0 的项不显示**（不显示「知识库 0 个」，那是噪音）。
3. **三项全为 0 时**，整段替换为一行中性说明：「当前没有受档位影响的内容。」用 `--muted`，不用 `--warn`。
4. **必须出现「不会被删除」**，且用 `--fg` + 590 字重加粗 —— 这是本段最重要的一句话，它决定了用户下次还敢不敢上调。
5. **必须出现「数据一直在」或等义的复位说明**，且写明复原路径（"调回 standard 或 full 后即可重新访问"）。
6. **文案禁止**："部分功能不可用"、"某些内容受限"、"数据将被清理"、"为了您的安全"。见 20.7。
7. **有连带影响时必须说**：若存在引用被阻断资源的定时任务，追加 `--warn` 行「当前正在使用这些内容的定时任务将被暂停」（PRD §6.1 验收⑥与架构 §7.4.2 ② 类闸门均涉及）。

**按钮**：`[取消]` ghost + `[降档到 strict]` primary。**primary 不用 `--danger`** —— 降档不是破坏性操作（不删数据），红色会造成"删东西"的误读。

**提交时**：`PUT /api/v1/settings/privacy-mode`，带 `X-Local-Confirm: true`。提交中按钮进入 loading（宽度锁定不跳动，`aria-busy`）。

**成功后**：不关闭弹窗直接刷新 —— 而是**在同一弹窗内切换到结果态**，显示从 `from` 到 `to` 的确认 + 「已按新档位更新，N 项内容已阻断」+ 一个「知道了」按钮。理由：用户刚做完一个有后果的决定，需要一次明确的完成确认，而不是弹窗突然消失。
成功后必须同步：`capabilities` 重新拉取（防漂移，见 20.5）、顶栏指示器刷新、受影响视图的空/禁用态立即生效。

**失败**：就地显示 `--danger` 错误 + 原因 + 「重试」。不关闭弹窗。

### 20.5 capability → UI 入口 映射表（防漂移的唯一依据）

> **架构硬约束（PRD §6.1 验收②）**：禁止出现「UI 显示可用、点下去返 4030」或「能力其实可用但入口被藏」的**双向漂移**。因此本表是前端显隐逻辑的**唯一依据**，不得由组件自行推断。

| UI 入口 | 依赖字段 | `strict` | `standard` | `full` |
|---|---|---|---|---|
| 模型调用（AI 网关） | `effective_grants.llm_proxy` | 可用 | 可用 | 可用 |
| 会话与记忆 | `effective_grants.conversation_persistence` | 可用 | 可用 | 可用 |
| **知识库 · 建库** | `effective_grants.kb_ingest` | **阻断 4030** | 可用 | 可用 |
| **知识库 · 上传文档** | `effective_grants.kb_ingest` | **阻断 4030** | 可用 | 可用 |
| **知识库 · 重新处理 / 重建索引** | `effective_grants.kb_ingest` | **阻断 4030** | 可用 | 可用 |
| **知识库 · 检索（含检索测试）** | `effective_grants.kb_search` | **阻断 4030** | 可用 | 可用 |
| **数据集 · 上传到本地服务** | `effective_grants.server_sql` | **阻断 4030** | **阻断 4030** | 可用 |
| **数据集 · 服务端 SQL 执行** | `effective_grants.server_sql` | **阻断 4030** | **阻断 4030** | 可用 |
| **调度任务 · 引用知识库或服务端数据集** | 依被引用资源而定 | **阻断 4030** | 部分 | 可用 |
| 外部数据库代理 | `effective_grants.external_db_proxy` | 可用 | 可用 | 可用 |
| 知识库整体入口 | `capabilities.rag` | 视 `rag` | 视 `rag` | 视 `rag` |
| 语义检索 / 关键词降级徽标 | `capabilities.semantic_search` | 视值 | 视值 | 视值 |

**两条独立的显隐规则（必须区分，否则会做成漂移）**

| 原因 | 判定字段 | UI 处理 | 理由 |
|---|---|---|---|
| **功能未安装** | `capabilities.rag === false` | **入口隐藏** + 设置页显示 `requirements-rag.txt` 安装指引 | 功能确实不存在，显示入口是空承诺（架构 §10.1 已定） |
| **档位受限** | `effective_grants.kb_ingest === false`（但 `rag === true`） | **入口可见 + 禁用态 + 解锁路径** | 功能存在，只是当前边界不允许。隐藏会让用户以为功能不存在，且违反"禁止入口被藏"的反向漂移 |

**这是本节最容易做错的一处。** 两者外观必须不同：未安装 → 不出现；档位受限 → 出现但禁用 + 说明。

**实现要求**：`components/CapabilityBadge.jsx` 与各视图的显隐判断应统一读一个 `useCapabilities()`（架构 §6.8 已规划 `src/backend/capabilities.js` 导出），**禁止在组件内各自判断 `privacy_mode === 'strict'`**。这也与 PRD §9 的 CI 门禁一致（`grep -rn "privacy_mode ==" app/` 命中 ≤1 处）。

### 20.6 数据去向披露（常驻，`--info` 语义）

**需求来源**：PRD §1.2 承诺 3 ——「上传前必须在 UI 明示『文档分块会随 prompt 发给上游模型』，不得只写在文档里」；PM 第 4 条 —— db-proxy 说明为**要求而非建议**。

**语义分组规则（本节确立，全项目适用；`--warn` 的边界已于 §20.2 决策三按 PM Q1 约束收紧）**

| 语义色 | 含义 | 触发条件 | 例 |
|---|---|---|---|
| **中性** | **持续状态**：用户自己设定的边界在生效，稳定不变 | 常驻 | 当前档位、被阻断的 N 项内容、知识库文档锁住态 |
| `--warn` | **拦截事件 / 降级**：需要你注意并可能采取动作 | 动作或状态跃迁触发 | 4030 拦截提示、后端离线状态条、检索降级徽标、采样统计 |
| `--info` | **常驻事实陈述**：不是问题，是须知 | 一直显示 | 数据去向披露、db-proxy 说明、隐私模式说明 |
| `--danger` | **真实失败** | 出错时 | 解析失败、连接失败、SQL 语法错误 |
| `--success` | 达成/就绪 | 成功时 | 索引完成、测试通过 |
| `--accent` | 主 CTA + 当前选中态 | — | ≤2 处/屏 |

**中性 与 `--warn` 的判据（易混，务必分清）**：

| 问 | 归中性 | 归 `--warn` |
|---|---|---|
| 这个东西会自己变化吗？ | 不会，它是我选的档位的静态结果 | 会，它由一次动作或状态跃迁产生 |
| 用户需要"立刻做点什么"吗？ | 不需要。想改就改，不改也一直在正常用 | 需要。不处理就有一个动作失败，或有个事实不知道 |
| 例 | 「当前 strict 档」「47 篇文档被挡」「文档行锁住」 | 「你刚才的上传被 strict 挡住了」「后端离线了」 |

> 为何披露用 `--info` 而非中性灰：它是隐私边界表述完整性的**组成部分**，需要被读到。用中性灰会被视觉忽略；用 `--warn` 又会让用户以为出了问题。`--info` 是"请留意，但一切正常"的正确语义。
>
> 为何"被挡住的东西"用中性而非 `--warn`：它是用户所选档位的**必然结果**，是稳定状态而非异常。用琥珀色持续标记等于每天告诉用户"你选错了"（完整论证见 §20.2 决策三）。

#### 20.6.1 知识库上传前的强制披露

出现在两处，**缺一不可**：

**① 上传区下方常驻**（`--info` 三元组，12px，`--leading-relaxed`）：

```
[ShieldCheck] 上传的文档会被切分成块，检索命中时随 prompt 发给上游模型。
这是本产品唯一默认会把内容送出本机的通道，由你主动发起。
```

**② 上传确认弹窗内**（点击"上传文档"后，**文件选择之前**）：

```
上传这份文档？

文档将被切分并建立索引。今后检索命中时，命中的分块文本
会随 prompt 发送给你配置的上游模型。

[取消]  [我知道了，选择文件]      [不再提示]  ← 复选框，非按钮
```

`strict` 档下该弹窗不出现，而是直接进入 20.8 的阻断提示（因为档位不允许，先解释边界）。

#### 20.6.2 数据库代理路径说明（PM 第 4 条，强制）

`POST /db-proxy/query` 与 `/test` 三档全放行。**必须**在数据库 tab 的表单下方常驻显示：

```
[Info] 此路径不经过本服务存储，但会连接你指定的数据库。
```

- 图标 `Info`（14px），`--info` 文字，12px，`--info-bg` 底 + `--info-bd` 边框 + `--radius-sm`，`padding: var(--space-2) var(--space-3)`。
- **不得改动这句话的语义。** PM 明确此为要求，属隐私边界表述完整性的一部分。
- 位置：紧贴「导入并分析」按钮下方（不是页面最底部）—— 说明必须靠近它约束的动作。
- **禁止**把它做成 tooltip 或折叠项。

### 20.7 文案规则与禁用表述

**硬性禁止（来自 PRD §1.2 与 §9 风险表）**

| 禁止表述 | 原因 |
|---|---|
| **「数据不出本机」** | 引入 LLM 那一刻起就不严格成立 —— LLM 调用本身就是数据出本机。PRD §1.2 明确「任何下游文档不得回退为『数据不出本机』这类绝对化说法」 |
| 「零外传」「完全本地」「绝对安全」 | 同上，绝对化 |
| 「部分功能不可用」「某些内容受限」 | PM 第 1 条明令禁止：必须给具体计数 |
| 「数据将被清理」「将被移除」 | 与「降级不删数据」事实相反，会造成恐惧 |
| 「为了您的安全」 | 空洞的辩解式表述，且暗示用户的选择不安全 |

**推荐表述（必须包含的三件事）**

1. **出本机的确切边界**：不是"你的数据"，而是"文档分块文本会随 prompt 发给上游模型"。
2. **谁主动发起**："由你主动发起"。
3. **彻底零外传的路径**（PRD §1.2 与 §9 均要求产品内明确告知）：

```
[ShieldCheck] 要彻底零外传，可把模型 provider 的 baseURL 指向本机 Ollama
（含 nomic-embed-text 做本地嵌入）。设置 → 供应商管理。
```

这条出现在：档位选择器区块下方（常驻），以及向上调档确认弹窗内（20.4）。**不能让用户自己猜。**

**兜底规则**：任何涉及数据流向的新文案，写完后对照 PRD §1.2 的三条承诺逐条检查 —— 若某句话无法对应到某条承诺，就不该出现。

### 20.8 4030 拦截提示（「解释 + 出路」形态）

**需求来源**：PM 第 3 条；架构 §7.4.3 第 3 条「4030 响应必须带可执行指引，而不只是拒绝」。

**响应体契约（架构已定义）**

```json
{ "code": 4030,
  "data": { "current_mode": "strict",
            "required_modes": ["standard"],
            "setting_path": "/api/v1/settings/privacy-mode" },
  "message": "当前为 strict 档，..." }
```

**4030 与 4010 的处理必须分开**（架构 §6.8 明确）：

| 错误码 | 含义 | 前端行为 |
|---|---|---|
| `4010` | 忘了带确认头 | 补 `X-Local-Confirm` 后**自动重试一次** |
| `4030` | 当前档位不允许 | **禁止自动重试**（补头也没用）。渲染切档引导 |
| `4090` | 数据集本身没上服务端 | 引导用户先执行"上传到本地服务" |

#### 20.8.1 视觉规范：不是红色报错

**使用 `--warn` 三元组，不用 `--danger`。** 理由见 20.6 的语义分组：档位阻断是"你设定的边界在生效"，**不是系统故障**。红色通报警样式会让用户以为系统坏了、去重装或找客服，而实际只需去设置里调一档。

| 项 | 规范 |
|---|---|
| 容器 | `--warn-bg` 底 + `1px solid var(--warn-bd)` + `--radius-md` + `padding: var(--space-4)` |
| 图标 | `ShieldCheck`（**不是** `TriangleAlert`）18px `--warn`。用盾牌表达"这是你设定的边界"，而非"出错了" |
| 标题 | 14px / 590 / `--fg`：「strict 档下不可用」 |
| 正文 | 13px / `--muted` / `--leading-relaxed`，一句话说明为什么 |
| 出路 | primary 文字按钮「去设置里调整到 standard」+ ghost「了解档位区别」 |
| 关闭 | 允许关闭（用户可能只是想确认一下） |

#### 20.8.2 三处呈现位置（按被拦截的时机）

**① 入口级（点之前就知道）** —— 首选，最省用户成本。
被阻断的按钮渲染为**禁用态 + 行内提示**，而不是"可点击、点了报错"：

```
[上传文档]  ← disabled（opacity .45，cursor not-allowed）
strict 档下不可用，调整档位后可用          [了解如何解锁]
```

只有 `capabilities` 已知的情况下才这么做。**若 `capabilities` 声明可用但接口返 4030，说明后端有漂移缺陷** —— 此时前端按 20.8.3 处理并上报。

**② 动作级（点之后被拦）** —— 用于无法预判的情况（如调度任务引用资源的二次校验）。

Inline 卡片就地插在动作发生处（**不在页面顶部**）：

```
[ShieldCheck] strict 档下不可用
该操作需要把内容发送到服务端。当前档位不允许。
[去设置里调整到 standard]  [了解档位区别]
```

**③ 全局兜底** —— 若 4030 来自页面加载时的某个请求，用 toast：`--warn-bg` 底、`--warn` 文字、`--warn-bd` 边框、`--elev-3`、`--radius-md`，右对齐一个「查看」链接。**禁止用红色 toast。禁止自动重试。**

#### 20.8.3 防漂移的兜底要求

若前端收到 4030 但 `capabilities` 声明该能力可用，则：

1. 按 20.8.2 ② 呈现（用户不能白点一次什么都没有）。
2. **立即重新拉取 `capabilities`** 并刷新显隐（把漂移自愈）。
3. 在控制台输出明确的诊断信息，便于测试复现 —— 这是 PRD §6.1 验收②要抓的双向漂移。

### 20.9 知识库的三种"不可用"状态（PM 第 2 条）

**需求来源**：PM 明令 —— 不能显示成"知识库是空的"（那是骗用户），也不能显示成报错。

| 状态 | 判定 | 列表呈现 | 说明行 |
|---|---|---|---|
| **A. 未安装** | `capabilities.rag === false` | 视图入口整体隐藏 | 设置页显示 `requirements-rag.txt` 安装指引 |
| **B. 档位受限**（本轮新增） | `rag === true` 且 `effective_grants.kb_ingest === false`，且后端返回了文档计数 | **文档照常列出，但整行禁用态** | 列表顶部一行**中性**说明 + 「了解如何解锁」 |
| **C. 索引未就绪** | 文档存在但 `vector` 子系统未就绪 | 文档列出，状态列显示「索引中」/「未索引」 | 单行 `--info` 说明 |

#### 状态 B 的详细规范（本节重点）

**列表顶部的说明条**（不是整页 Error 态）：

```
[ShieldCheck] strict 档下知识库不可用
这里仍列出你的 47 篇文档 —— 它们没有被删除，只是当前档位下不可访问。
检索、上传与重建索引都已暂停。
[调整档位到 standard]  [了解档位区别]
```

- 容器：**`--surface-sunken` 底 + `1px solid var(--border)` + `--radius-md`**，`padding: var(--space-3) var(--space-4)`
- 图标：`ShieldCheck` 18px `--fg`（不是 `TriangleAlert`，也不是 `--warn`）
- 标题 14px/590 `--fg`，正文 13px/`--muted`
- **关键措辞：「仍列出」「没有被删除」「只是当前档位下不可访问」** —— 三句都必须在。PM 第 1 条的同一逻辑：不能让用户以为数据没了。
- **配色说明**：此处**刻意用中性**而非 `--warn`。理由见 §20.2 决策三 —— 这是"用户自己设定的边界在生效"的持续状态，不是异常。"可见"由**结构**承担：它是表格上方唯一一条带图标的整宽说明条 + 标题含"不可用"三字 + 下方每行都有 `Lock` 图标，三者已足够。**若用琥珀色持续标记，就等于每天告诉用户"你选错了档位"。**

**文档行的禁用态**：

| 元素 | 规范 |
|---|---|
| 整行 | `opacity: 0.55`；**不加删除线**（不暗示内容有问题） |
| 行首图标 | 文档类型图标改为 `Lock` 14px `--n-400`（表达"锁住"而非"损坏"） |
| 文档名 | `--muted`（非 `--fg`），仍在原位置，**不隐藏** |
| 状态列 | `[ShieldCheck] 档位受限` —— **中性**三元组徽标（`--surface-sunken` / `--border` / `--meta`）。替换原来的「已就绪/索引中」 |
| 分块数 / 大小 / 上传时间 | 照常显示。**保留信息**，因为它证明内容还在 |
| 行操作 | 「预览」**有条件地**保持可用，见下方边界条件；「重新索引」「删除」禁用并带 `title` 说明原因 |
| 行 hover | **不显示 hover 高亮**（禁用行不应有交互反馈） |
| 行点击 | 仍可打开详情抽屉 —— **抽屉内可看分块，但隐藏检索测试 tab**（检索被阻断） |

##### 「预览」的边界条件（PM 补充裁定，必须遵守）

> **PM 原文**：若预览路径涉及 LLM 调用或重新嵌入（即构成外传），该部分必须一并禁用 —— **别让"预览"成为外传的侧门**。

我把"预览"拆成两类，逐类给判定：

| 预览能力 | 是否外传 | `strict` 下 | 依据 |
|---|---|---|---|
| 查看已落盘的原文与分块文本（纯本地渲染） | 否 | **可用** | 内容已在本地 `data/uploads/`，不经过模型 |
| 查看分块边界、字数、元数据 | 否 | **可用** | 纯本地计算 |
| **生成摘要 / 摘要预览** | **是**（调 LLM） | **禁用** | 构成外传 |
| **重新分块预览 / 重新嵌入预览** | **是**（调 embedding） | **禁用** | 构成外传 |
| **相似分块推荐 / 相关文档** | **是**（向量检索） | **禁用** | 属检索，与 `kb_search` 同档位 |
| 高亮检索命中片段 | 是（需先检索） | **禁用** | 检索被阻断 |

**实现要求（防止侧门）**：
1. 禁用项**必须显式说明原因**，不能静默消失：`title="strict 档下需要调用模型，已暂停"`；若该功能在抽屉里成组出现，改用一行中性说明条「部分预览功能需要调用模型，strict 档下已暂停」，而不是让几个按钮凭空不见。
2. **后端必须同样拦截** —— 前端隐藏不是安全边界。若"生成摘要"有独立端点，它需按 `kb_search` / `kb_ingest` 同档位阻断并返 4030。**这一条需架构师确认端点归属**（见 §20.16 待确认项）。
3. 判定原则一句话：**凡"预览"要经过模型或向量库，就不是预览，是检索/入库的另一种入口，必须同档位阻断。**

> **为何纯本地预览保留**：`strict` 阻断的是**入库与检索**（内容出本机），而文档原文与分块已在本地落盘。允许纯本地预览符合档位语义，也让用户能确认"东西还在"。**不要一律禁用，那是过度封锁**；但也**不要一律放开，那会开出一个外传侧门**。分界线就是"是否经过模型或向量库"。

**「了解如何解锁」的落点**：打开一个说明面板（不是跳转设置页），内容包括三档对比表 + 「当前：strict」标记 + 直达设置页档位区块的按钮。理由：用户的疑问是"这是什么/我该不该改"，直接跳设置会让他面对一个没有上下文的表单。

**empty 与 B 状态必须分开**：状态 B 下**禁止显示"还没有文档"空态**。空态判定必须基于**实际文档数**，不是"当前档位下可检索的文档数"。这是 PM 第 2 条的直接要求。

### 20.10 「上传到本地服务」二次确认（PRD §6.1 验收⑥）

`full` 档下，用户对某数据集执行"上传到本地服务"（`storageMode: local → server`）时：

**必须**经二次确认弹窗，且**必须**携带 `X-Local-Confirm: true`。

```
上传明细到本地服务？

这个数据集的 12,847 行明细将写入服务端数据库，
之后可在服务端直接执行 SQL（查询更快，不占用浏览器内存）。

明细一旦上传，会保存在服务端。你随时可以删除该副本，
本机原始文件不受影响。

[取消]  [上传明细]
```

- Modal 形态，`--elev-4`，宽 `min(520px, 100%)`
- **用 `--warn` 而非 `--danger`**：这是用户主动选择的功能，不是危险操作。但它是**不可逆的数据流向改变**，因此需要 `--warn` 的注意力等级。
- 必须写明：**行数**（具体数字）、写入位置、**可撤销方式**（"随时可以删除该副本"）、**本机文件不受影响**
- 成功后：数据集的 `storageMode` 徽标由 `local` 变为 `server`（`--info` 三元组，文字「服务端」），并追加一行 `--warn` 说明「明细已上传到服务端」——**留痕，便于日后自查**
- `strict` / `standard` 档下该按钮不出现，替换为 20.8.2 ① 的禁用态

### 20.11 「出本机内容」标记（PRD §6.1 验收⑥，本轮判定依据已更换）

> 要求：被标记的内容必须真的出过本机，**便于用户日后自查**。

#### 20.11.1 判定依据：`egress_at`（不是 `ingested_mode`）

**PRD v2.5 已把判定依据从 `ingested_mode` 改为 `egress_at`。原判定是错的，且错的方向最危险** —— 它会让用户**高估**自己的暴露面。

| | 旧判据（已废弃） | 新判据 |
|---|---|---|
| 字段 | `ingested_mode`（入库时的档位） | **`egress_at`**（内容**实际离开本机**的时间，`NULL` = 从未外传） |
| 回答的问题 | "谁授权入库" | "内容到底有没有出去" |
| 失效场景 | **provider 不支持 `/v1/embeddings` 时（高概率默认路径），入库降级为关键词模式，分块文本从未发往上游**，但 `ingested_mode='standard'` | — |
| 后果 | **知识库里每一份文档都被标成"已出本机"** —— 系统性误报，用户以为自己全都外传了 | 只有真正外传过的才标记 |

**为什么"永远为真的筛选器"比"没有筛选器"更坏**：一个恒真的筛选器会让用户以为它在工作，从而**放弃人工核对** —— 它破坏的不是功能，而是用户对整套凭据的信任。一个坏掉的标记会连累正确的标记。

同时新增 **`egress_channel`** 解释"**为什么**出本机"：

| 取值 | 含义 |
|---|---|
| `embedding` | 向量化时外传（入库阶段调用了 `/v1/embeddings`） |
| `retrieval` | 检索时被带进 prompt（入库没外传，检索注入时外传） |
| `both` | 两个通道都发生过 |

> **`egress_channel` 不是装饰字段**：没有它，关键词模式下的用户会看到"我明明用的是关键词模式，为什么说这份内容出本机了"，从而**认为我们的标注是错的**。**一个正确的标注被误判成 bug，会反过来侵蚀对整个凭据的信任** —— 这与"恒真筛选器"是同一种信任损耗。

#### 20.11.2 设计落点（三处，缺一不可）

1. **文档行内徽标**：`[Info] 出本机` —— `--info` 三元组，11px，紧随文档名。**仅在 `egress_at` 非空时出现。**
   - **徽标必须能解释通道**：hover / 聚焦显示 `title`，文案按 `egress_channel` 分三种：
     | 通道 | 徽标 tooltip 文案 |
     |---|---|
     | `embedding` | 「建立向量索引时，分块文本已发往上游模型服务」 |
     | `retrieval` | 「检索命中的分块曾随 prompt 发往上游模型服务」 |
     | `both` | 「建立索引与检索注入时，分块文本都曾发往上游模型服务」 |
2. **知识库列表筛选器**：状态下拉新增「**仅看已出本机**」，谓词 `egress_at IS NOT NULL`。
   这是"日后自查"的**核心入口** —— 没有筛选器，"可自查"只是理论上的。同时新增「**仅看未出本机**」筛选（谓词 `egress_at IS NULL`），用于反向确认"我确实没外传什么"。
3. **详情抽屉内**：分两块信息，**不要再混为一谈**：
   - **出本机状态**（若 `egress_at` 非空）：`[Info]` + 「首次出本机：2026-09-14 15:22 · 通道：检索注入」
   - **入库信息**（始终显示）：`ingested_mode` + `ingested_at` ——「入库档位：standard · 2026-09-14 15:10」
   > `ingested_mode` / `ingested_at` **仍要展示，只是不再担任"是否出本机"的判据**。它回答的是另一个问题（谁授权入库），对审计仍有价值。

#### 20.11.3 关键词模式下大量"未标记"是正确行为（文案要求）

**这是本轮最容易做成 bug 的地方。** 关键词模式下没有任何分块外传，因此绝大多数文档 `egress_at` 为 NULL、**不会显示徽标**。用户看到这个结果会怀疑标记失灵。

因此必须在列表侧提供可读的解释，**不能只靠"没显示徽标"沉默地表达**：

- **筛选器旁常驻一行说明**（12px / `--meta`）：「仅在文档内容**实际发往上游服务后**才标记为已出本机。」
- **「仅看已出本机」返回 0 条时**，不是普通空态，而是**解释性空态**：
  ```
  [ShieldCheck] 没有文档曾把内容发往上游服务

  当前检索模式为关键词检索，入库与检索都不经过模型服务，
  因此没有内容离开本机。这是预期的结果。

  [了解检索模式的差异]
  ```
  用中性三元组（不是 `--warn`，这是**好消息**不是问题）。**禁止**用"未检索到结果，试试更换关键词"这类通用空态文案 —— 那会让用户去调筛选条件，而问题不在筛选条件。
- 若同时 `semantic_search=false`（关键词模式），在说明中显式点出该前提，如上。

#### 20.11.4 `retrieval` 是"事后才亮起"的 —— 列表必须支持刷新

**`retrieval` 通道是 `standard` 档下内容外传的主路径**（入库可能没外传，但检索注入时会）。因此徽标**可能在用户看过一次之后才出现**。

**要求**：
- 列表**必须支持手动刷新**（工具条内的 `RefreshCw` 按钮），且刷新后徽标状态即时更新。
- **不得让用户觉得"刚才明明没有"**。做法：当一次刷新带来新增的"已出本机"项时，在列表顶部显示一次性提示条：「本次刷新新增 2 篇文档标记为已出本机」，附「查看」筛到那两篇。提示条 8 秒后自动消失或用户手动关闭。
- 若检索动作由**本应用内的操作**触发（用户在检索测试里执行了一次检索），则**在检索完成后主动重拉一次列表**，不依赖用户手动刷新。
- 徽标出现用 `--dur-base` 的 `opacity` 过渡（160ms），**不做闪烁/脉冲** —— 它是一次状态更新，不是告警。

#### 20.11.5 排序

- 默认按上传时间倒序。
- 「仅看已出本机」筛选态：按 **`egress_at` 倒序**（自查场景关心最近出去的）。
- 「仅看未出本机」筛选态：按上传时间倒序。

#### 20.11.6 与 `blocked_by_downgrade` 的关系（避免混淆）

两个计数**语义完全不同，不可互相推算**，UI 上也不要放在一起：

| 概念 | 含义 | 出处 |
|---|---|---|
| `blocked_by_downgrade.kb_documents` | 因当前档位**不可访问**的文档数（与是否出本机无关） | 档位受限 |
| `egress_at` 非空的文档数 | **曾经把内容发往上游**的文档数（与当前档位无关） | 出本机凭据 |

一篇文档可以"被档位挡着"且"从未出本机"（关键词模式下 `standard` 入库、后降到 `strict`）。**把这两个数混在一起展示，会让用户得出错误结论。**

### 20.12 埋点事件与组件的对应（PRD §11）

PRD §11 的隐私埋点需要组件配合上报。映射如下，前端在对应组件内埋一次即可：

| 事件 | 含字段 | 触发组件 | 触发时机 |
|---|---|---|---|
| `privacy_mode_changed` | `from`, `to` | 档位选择器（`settings` 区块） | `PUT` 成功、结果态渲染后 |
| `privacy_gate_blocked` | 被拦接口 | 4030 处理器（统一拦截层） | 收到 `code=4030` |
| `capability_unavailable_shown` | 能力名、原因（未安装/档位受限） | `CapabilityBadge` 与禁用态入口 | 首次渲染不可用状态时（**同一次会话内同名只报一次**，避免列表滚动刷屏） |
| `retrieval_degraded` | 降级前/后模式 | `CapabilityBadge`（检索徽标） | 语义→关键词降级被展示时 |
| `backend_offline_entered` | — | `BackendStatusBar` | 状态由 `healthy` 进入 `offline` 的边沿（**不是每次轮询**） |

**注意**：`capability_unavailable_shown` 与 `backend_offline_entered` 都是**边沿触发**，不是状态轮询上报 —— 否则一次停机产生数百条重复事件，PRD §11 的"验证降级是否被感知"就失去意义。

### 20.13 令牌使用：零新增（附论证）

档位界面的全部状态需求已逐一核对，**不需要任何新令牌**。详见 `docs/03-UIUX-附录A-Token清单.md` §5.2 的对照表。

**这本身是验收信号**：若一套令牌体系需要为新界面不断加令牌，说明抽象层次错了。档位界面能零新增令牌落地，说明 Phase 1 的令牌划分命中了正确的粒度。

### 20.14 档位变更历史（P1，已裁定但本轮不实现）

> **PM Q2 裁定**：做，但**列 P1，不进 P0**。理由 —— 它不是 F0 六条验收成立的必要条件，而 F0 当前估算 4–5.75 人日在 Effort=2（约 1 周）的上限，再加一块会把它推向 Effort=3，属 P0 内的范围蔓延。已写入 PRD §4.3 的 P1 列表。

**设计目的**：服务 PRD §1.2 承诺 2 的"AI 数据去向**可审计**"。现有设计只有"当前档位 + 当前被阻断计数"，缺"我什么时候从 full 降到了 strict"这类回溯能力。

**三条实现约束（PM 已写进 PRD，设计必须遵守）**

| # | 约束 | 设计含义 |
|---|---|---|
| ① | **只读列表，放在设置页档位区块内，不新起视图** | 作为 `settings` 页 §20.3 档位选择器区块内的**折叠区**（默认收起），标题「档位变更记录」。**不新增 `store.view` 枚举值，不新建 `src/*.jsx` 文件** |
| ② | **仅存本地，不上报服务端、不参与埋点聚合** | 存 `localStorage`（与 `data-agent.theme` 同层）。**不发网络请求**。它是用户的私人审计记录，不是分析数据 |
| ③ | **与埋点 `privacy_mode_changed` 同源但用途不同，不得混用同一份存储** | 埋点事件用于验证产品假设（PM §11"用户是否主动调档"）；变更历史供用户自查。二者**必须两套存储**，禁止用同一份队列 —— 否则用户清空本地历史会连带丢失埋点样本，反之埋点上报也可能把用户私密记录带走 |

**形态**（折叠区，展开后）：

```
档位变更记录                    仅保存在本机 · 共 3 条          [清空记录]
─────────────────────────────────────────────────────────────
2026-09-14 15:22   full  →  strict       4 项内容被阻断
2026-09-12 09:03   standard → full       允许明细上传
2026-09-10 20:41   strict → standard     允许文档入库与检索
```

| 元素 | 规范 |
|---|---|
| 每行 | 时间（`--font-mono` 12px `--meta`）+ 变更（`from → to`，档位 id 用 `--font-mono`）+ 结果摘要 12px `--muted` |
| 降档行 | 摘要写「N 项内容被阻断」，N 取自当时的 `blocked_by_downgrade` 快照 |
| 升档行 | 摘要写「允许明细上传」/「允许文档入库与检索」等，取自 `effective_grants` 的增量 |
| 空态 | 一行中性说明「还没有变更记录。当前档位是初始默认值。」**不用插画、不用引导按钮** |
| 上限 | 保留最近 **50 条**，超出丢弃最旧的（本地存储有配额，且用户自查场景不需要久远记录） |
| 清空 | ghost 按钮 + 二次确认。**清空必须只影响这份本地记录，不动埋点存储**（约束③） |
| 导出 | **不提供**。PM 未列此项，且导出会让"私人记录"变成可外传的数据 —— 与约束②的精神冲突 |

**为何不做成独立视图**：约束① 明确禁止。且从信息架构看，「档位变更」是档位配置的附属信息，独立成视图会产生一个"点进去只有 3 行字"的空页面。

### 20.15 本节自检

| 检查项 | 结果 |
|---|---|
| 三档定义是否照抄 PRD §1.2 未改写 | 是（§20.1） |
| 是否出现「数据不出本机」等禁用表述 | 无。§20.7 单列禁止表，并在三处给出 PRD §1.2 的合规表述 |
| 降级是否给出具体计数而非笼统说明 | 是。§20.4 逐项列出 `blocked_by_downgrade` 三个计数 + 「不会被删除」+ 复原路径 |
| 知识库是否设计了「有文档但不可用」第三态 | 是。§20.9 状态 B，含列表说明条、行禁用态、空态判定修正 |
| 知识库空态是否与「被阻断」态分开判定 | 是。§20.9 结尾：空态基于**实际文档数**，非"可检索文档数" |
| 「预览」是否被拆成"纯本地"与"经过模型"两类 | 是。§20.9 边界条件表，含 6 类逐项判定 + 后端必须同样拦截的要求 |
| 指示器是否为「解释入口」而非纯标签 | 是。§20.2 决策二 + §20.2.2 面板含 ①档位 ②原因 ③去处 三要素 |
| 指示器是否禁用了红/黄警示色 | 是。§20.2 决策三：持续状态用中性，仅"拦截事件"用 `--warn` |
| 是否依赖 hover 承载关键信息 | 否。§20.2.3 从 hover tooltip 改为点击面板（触屏无 hover / 键盘可达 / 尺寸足够） |
| 档位变更历史是否符合 P1 三条约束 | 是。§20.14：只读折叠区不新起视图、仅存本地、与埋点分存 |
| 「出本机」判定依据是否为 `egress_at` 而非 `ingested_mode` | 是。§20.11.1 列出旧判据的失效场景（关键词模式下全库误报）与"恒真筛选器比没有筛选器更坏"的论证 |
| 徽标是否解释了「为什么出本机」 | 是。§20.11.2 按 `egress_channel` 三值给三套 tooltip 文案（embedding / retrieval / both） |
| 关键词模式下大量"未标记"是否有可读解释 | 是。§20.11.3：筛选器旁常驻说明 + 解释性空态（中性色，禁用工单式通用空态文案） |
| `retrieval` 事后亮起是否有防"刚才明明没有"的设计 | 是。§20.11.4：手动刷新 + 本应用内检索完成后主动重拉 + 新增标记提示条 + 不做闪烁 |
| 是否把"被档位挡住"与"曾出本机"两个计数混用 | 否。§20.11.6 明确两者语义不同、不可互推，UI 上不并列展示 |
| 语义键是否只有一个定义来源（F3 新不变量） | 是。附录 A §4.6：颜色域重复字面量为 0（浅色 41 值 / 暗色 46 值均无重复）；`--success`/`--warn`/`--danger`/`--info` 在 styles.css 中定义为 0 |
| 4030 是否做成「解释 + 出路」且非红色报错 | 是。§20.8 用 `--warn` + `ShieldCheck`，含三处呈现位置与防漂移兜底 |
| db-proxy 说明是否为强制常驻 | 是。§20.6.2，含原句逐字保留与位置约束 |
| 是否区分「未安装」与「档位受限」两种隐藏原因 | 是。§20.5，两种外观必须不同 |
| 是否需要新增令牌 | 否。§20.13 附逐项论证 |
| 是否引入 emoji / 紫粉渐变 / 弹跳缓动 / 硬编码色 | 无 |
| 新可点元素是否 ≥40px | 是。档位卡片为整卡可点；指示器、面板按钮、历史区按钮均注明命中区扩展 |
| 是否依赖颜色单独传达含义 | 否。档位不做颜色编码（§20.2 决策一）；阻断态一律带 `Lock` / `ShieldCheck` 图标 + 文字 |

### 20.16 待确认项（依赖他方回复，非设计缺口）

设计已完成，但以下 4 项依赖 PM / 架构师的裁定或契约补齐。**在补齐前，对应验收项应标记为"依赖未满足"，不要让核对者以为是自己漏做。**

| # | 待确认项 | 归属 | 影响 | 当前设计如何应对 |
|---|---|---|---|---|
| 1 | **`blocked_by_downgrade` 语义**：是"相对当前档位"的静态计数，还是"相对上次档位变化"的增量 | 架构师 | 决定顶栏徽标与解释面板是**常驻**还是**仅切档后一个会话内显示** | §20.2.1 已按"相对当前档位"设计（依据 PRD §1.2「在当前档位下不可用」的措辞）。两种语义下面板内容相同，仅常驻性不同，切换成本低 |
| 2 | **文档对象补 `egress_at` + `egress_channel`**（PRD v2.5 已把判据从 `ingested_mode` 换成 `egress_at`） | 架构师（PM 已确认为 PRD 级要求） | 「出本机」徽标、两个筛选器（已出/未出）、详情抽屉的"出本机状态"块、刷新时的新增提示条 —— 共 5 处依赖 | §20.11 已按新判据重写；`ingested_mode` / `ingested_at` 降级为详情抽屉的"入库信息"块，**不再作判据**。**PM 已裁定 F0 验收⑥ 在补齐前标记为"依赖未满足"** |
| 2b | **`egress_at` 是否支持"列表主动刷新后即时反映"** —— 即写入 `egress_at` 的时机是否在检索请求返回前完成（还是异步落库，需二次拉取） | 架构师 | 决定 §20.11.4 的"新增标记提示条"能否准确工作：若 `egress_at` 异步落库，刷新可能拿不到刚发生的那次外传 | 已按"可能延迟"设计：提供手动刷新 + 本应用内检索完成后主动重拉。若确认是同步写入，可简化 |
| 3 | **被阻断的调度任务如何暴露** | 架构师（方案 A：`GET /schedules` 列表项加 `blocked` + `blocked_reason`；方案 B：前端自推） | 影响 §20.4「当前正在使用这些内容的定时任务将被暂停」能否精确列出 | 倾向方案 A（避免前端重复实现档位判定，那正是 PRD §9 要防的漂移） |
| 4 | **"需要调用模型的预览"是否有独立端点、归哪个闸门** | 架构师 | PM 新增约束要求"这类预览必须一并禁用"，但**前端隐藏不是安全边界**，后端必须同档位阻断并返 4030 | §20.9 已按 `kb_search` / `kb_ingest` 同档位假设设计，待架构确认端点归属 |

> **说明**：以上 4 项都是"设计已就位、等契约跟上"，不是设计未完成。列在此处是为了让 F3 / F0 的核对者能区分"漏做"与"依赖未满足"。
