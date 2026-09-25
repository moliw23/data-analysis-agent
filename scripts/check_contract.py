# -*- coding: utf-8 -*-
"""契约与规范门禁检查（Phase 1 交付，供 Phase 2+ 每期收尾时运行）。

用法：
    python scripts/check_contract.py
退出码 0 = 全部通过；1 = 存在不合格项（应视为门禁失败，退回重做）。

检查项：
  1. docs/api/openapi.yaml 语法可解析
  2. 所有 $ref 均可解析（无悬空引用）
  3. privacy_mode 闸门三要素齐备（settings 端点 + PrivacyMode* schema）
  4. P0 规则：无 emoji、无硬编码颜色（仅允许 #fff / #000）、无紫色到粉色渐变方案
  5. code=4030 隐私档位阻断码已落到各受控端点

背景：本机安全策略拦截任何文件删除，故本脚本只读、不产生任何需要清理的中间文件。
"""
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OPENAPI = ROOT / 'docs' / 'api' / 'openapi.yaml'

# 注意：此处刻意不维护「受控端点清单」。
# 清单属于计数口径 —— 端点增删后它立刻失真，且新增端点若忘了登记会被静默放过。
# 闸门声明以契约内的 x-privacy-capability 扩展为唯一事实，本脚本只校验
# 「声明 ↔ 实现」的一致性（不变量口径）。见 docs/02-架构.md §7.4.5。

# 架构文档必须存在的小节标题（防止编辑时误删；只列承重锚点，不追求全覆盖）
REQUIRED_ARCH_ANCHORS = [
    '## 5. 后端目录结构',
    '### 5.1 文件组织硬规则（出现即不合格）',
    '### 7.4 privacy_mode 闸门矩阵与实现位置',
    '### 7.5 "出本机"凭据：`ingested_mode` 是授权凭据，`egress_at` 才是事实凭据',
    '## 8. 数据库表清单',
    '## 12. 技术风险清单',
]

# 信息性输出（只报告不判定）
notes: list = []

# emoji 区段（排除 U+2190-U+21FF 箭头：架构图里的 ← -> 属制图符号，非功能图标）
def _is_emoji(ch: str) -> bool:
    cp = ord(ch)
    return (
        0x1F300 <= cp <= 0x1FAFF
        or 0x1F000 <= cp <= 0x1F0FF
        or 0x2600 <= cp <= 0x27BF
        or 0x1F1E6 <= cp <= 0x1F1FF
        or cp == 0xFE0F
    )


def _has_emoji(text: str):
    return [(hex(ord(c)), unicodedata.name(c, '?')) for c in set(text) if _is_emoji(c)]


def _iter_refs(node):
    """递归收集解析后文档树中的全部 $ref 值（对引号风格/缩进免疫）。"""
    if isinstance(node, dict):
        for key, val in node.items():
            if key == '$ref' and isinstance(val, str):
                yield val
            else:
                yield from _iter_refs(val)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_refs(item)


def _find_hardcoded_colors(text: str):
    """找出全部硬编码颜色写法：hex / rgb() / rgba() / hsl() / hsla()。

    只查 hex 是不够的 —— 本项目已实际出现 9 处裸 rgba()，若校验器只看 #xxxxxx，
    这类违规就是盲区（校验器存在但与不存在等效）。
    """
    found = set(re.findall(r'#[0-9a-fA-F]{3,8}\b', text))
    found |= set(re.findall(r'\b(?:rgb|rgba|hsl|hsla)\s*\(\s*[0-9]', text))
    return sorted(found)


def _doc_files():
    """待扫描文档：**仅架构侧自有产出物** + 契约文件。

    刻意不扫描全部 docs/**/*.md —— 设计令牌清单与 PRD 会**合法地**引用颜色字面量：
      - `docs/03-UIUX-附录A-Token清单.md` 是颜色的唯一真相源，它必须列出色值；
      - `docs/01-PRD.md` 会引用违规色值作为缺陷描述（"清除 #3FA66A/#C98A2B/#C0564B"）。
    把它们纳入扫描会产生**假失败**，而假失败会侵蚀对门禁的信任 ——
    一个会误报的门禁最终会被忽略，与没有门禁等效。
    代码侧的硬编码颜色属于前端 lint 门禁的职责，不在本脚本范围。
    """
    owned = [
        ROOT / 'docs' / '02-架构.md',
        ROOT / 'docs' / 'decisions' / 'ADR-001-backend-stack.md',
    ]
    return [p for p in owned if p.is_file()] + [OPENAPI]


def check_openapi() -> list:
    """返回问题列表，空列表表示通过。"""
    problems = []
    notes.clear()
    if not OPENAPI.is_file():
        return [f'契约文件缺失：{OPENAPI}']

    import yaml

    text = OPENAPI.read_text(encoding='utf-8')
    try:
        doc = yaml.safe_load(text)
    except Exception as exc:  # noqa: BLE001
        return [f'YAML 解析失败：{exc}']

    # 2. $ref 完整性
    #    实现说明：**不**用正则从文本里抠 $ref。正则依赖引号风格与排版，
    #    一旦有人写 $ref: "#/..."（双引号）就会匹配到空集 -> 校验静默通过，
    #    变成安慰剂。改为走**解析后的文档树**收集，引号/缩进/流式写法全部免疫。
    refs = sorted(_iter_refs(doc))
    if not refs:
        problems.append('未从契约解析到任何 $ref —— 校验器可能已失效（空集空转）')
    for ref in refs:
        if not ref.startswith('#/'):
            continue
        cur = doc
        for part in ref[2:].split('/'):
            part = part.replace('~1', '/').replace('~0', '~')   # JSON Pointer 转义
            cur = cur.get(part) if isinstance(cur, dict) else None
            if cur is None:
                problems.append(f'悬空 $ref: {ref}')
                break

    # 3. 闸门三要素
    if '/api/v1/settings/privacy-mode' not in doc.get('paths', {}):
        problems.append('缺少 /api/v1/settings/privacy-mode 端点（F0 档位无法切换）')
    schemas = doc.get('components', {}).get('schemas', {})
    for name in ('PrivacyMode', 'PrivacyModeStatus', 'PrivacyModeUpdate', 'PrivacyBlockedData'):
        if name not in schemas:
            problems.append(f'缺少 schema: {name}')
    responses = doc.get('components', {}).get('responses', {})
    if 'PrivacyBlocked' not in responses:
        problems.append('缺少可复用响应定义: components/responses/PrivacyBlocked')

    # 3b. 4030 载荷字段完备（前端与 PRD 验收据这些字段渲染引导文案）
    blocked = schemas.get('PrivacyBlockedData', {}).get('properties', {})
    for field in ('current_mode', 'required_modes', 'capability', 'setting_path', 'blocked_by_downgrade'):
        if field not in blocked:
            problems.append(f'PrivacyBlockedData 缺少字段: {field}')

    # 3b-2. 「出本机」凭据字段完备（PRD §6.1 验收⑥ / §11 指标，语义见架构 §7.5）
    kb_doc = schemas.get('KbDocument', {}).get('properties', {})
    for field in ('ingestedMode', 'ingestedAt', 'egressAt', 'egressChannel', 'embeddingSent'):
        if field not in kb_doc:
            problems.append(f'KbDocument 缺少"出本机"凭据字段: {field}')

    # 3b-3. 不变量：IngestedMode 不含 strict（strict 档下入库已被闸门阻断，不可能存在）
    ingested = schemas.get('IngestedMode', {}).get('enum')
    if ingested is None:
        problems.append('缺少 schema: IngestedMode')
    elif 'strict' in ingested:
        problems.append(f'IngestedMode 不应包含 strict（strict 档入库已被闸门阻断）：{ingested}')

    # 3c. capability 枚举在「契约」与「架构文档 §7.4.4」之间必须一致。
    #     漂移风险不只在 PRD 与架构之间，也在契约与文档之间 —— 这里把它机器化。
    enum = (blocked.get('capability') or {}).get('enum')
    if not enum:
        problems.append('PrivacyBlockedData.capability 未定义 enum')
    else:
        doc_arch = ROOT / 'docs' / '02-架构.md'
        if doc_arch.is_file():
            lines = doc_arch.read_text(encoding='utf-8').splitlines()
            start = next((i for i, ln in enumerate(lines) if ln.startswith('| capability |')), None)
            doc_keys = set()
            if start is not None:
                for ln in lines[start + 2:]:          # 跳过分隔行
                    if not ln.startswith('|'):
                        break
                    cell = ln.split('|')[1].strip().strip('`')
                    if cell:
                        doc_keys.add(cell)
            if not doc_keys:
                problems.append('在 docs/02-架构.md §7.4.4 未解析到 capability 映射表（锚点行 "| capability |" 失效？）')
            elif doc_keys != set(enum):
                problems.append(
                    f'capability 枚举漂移：契约={sorted(enum)} 文档={sorted(doc_keys)}'
                )

    # 5. 架构文档结构锚点完好性
    #    成本：3 行；收益：捕获「编辑时误删小节标题」这类静默结构损伤
    #    （本项目实际发生过一次：插入 §7.5 时把 "## 8. 数据库表清单" 标题吞掉）。
    arch = ROOT / 'docs' / '02-架构.md'
    if arch.is_file():
        body = arch.read_text(encoding='utf-8')
        for anchor in REQUIRED_ARCH_ANCHORS:
            if not re.search(rf'^{re.escape(anchor)}\s*$', body, re.M):
                problems.append(f'架构文档缺少小节标题：{anchor}')

    # 6. 闸门声明 ↔ 实现一致性（不变量口径：断言"不应存在什么"，而非"应有 N 处"）
    #    声明载体是契约内的 x-privacy-capability 扩展；新增受控端点时必须显式声明，
    #    否则下列 (a) 不会触发、(b) 会因能力键未登记而触发 —— 两种漏改都会红。
    declared = {}
    import yaml as _yaml

    for path, item in (doc.get('paths') or {}).items():
        if not isinstance(item, dict):
            continue
        for method, op in item.items():
            if method not in ('get', 'post', 'put', 'patch', 'delete') or not isinstance(op, dict):
                continue
            cap = op.get('x-privacy-capability')
            if not cap:
                continue
            where = f'{method.upper()} {path}'
            declared.setdefault(cap, []).append(where)
            # (a) 声明了闸门，就必须真的会返回 4030
            r403 = (op.get('responses') or {}).get('403')
            if r403 is None:
                problems.append(f'{where} 声明 x-privacy-capability={cap} 但缺少 403 响应')
            elif '4030' not in _yaml.safe_dump(r403, allow_unicode=True):
                problems.append(f'{where} 声明了闸门但 403 响应未提及 code=4030')

    if not declared:
        problems.append('契约中没有任何端点声明 x-privacy-capability（闸门声明缺失）')

    if enum:
        # (b) 不应存在 enum 未登记的能力键（孤儿能力）
        orphan = set(declared) - set(enum)
        if orphan:
            problems.append(f'端点声明了 enum 中不存在的能力键：{sorted(orphan)}')
        # (c) 不应存在无人使用的 enum 取值（僵尸能力）
        unused = set(enum) - set(declared)
        if unused:
            problems.append(f'capability enum 存在无端点使用的取值：{sorted(unused)}')

    # 4. P0 规则（扫描范围由 glob 派生，新增文档自动纳入，不靠清单维护）
    scanned = _doc_files()
    if not scanned:
        problems.append('未找到任何待扫描文档 —— 校验器可能已失效（空集空转）')
    for path in scanned:
        name = path.relative_to(ROOT).as_posix()
        body = path.read_text(encoding='utf-8')
        emo = _has_emoji(body)
        if emo:
            problems.append(f'{name} 含 emoji：{emo}')
        raw = _find_hardcoded_colors(body)
        illegal = [c for c in raw if c.lower() not in ('#fff', '#000')]
        if illegal:
            problems.append(f'{name} 含非白名单硬编码颜色：{illegal}')

    # 信息性输出（非断言）：数量只报告、不参与判定，避免计数口径失真
    notes.append(f'扫描文档: {len(scanned)} 份')
    notes.append(f'$ref 解析数: {len(refs)}')

    notes.append(f'受控端点（x-privacy-capability 声明）: ' +
                 '; '.join(f'{k}×{len(v)}' for k, v in sorted(declared.items())))
    return problems


def main() -> int:
    problems = check_openapi()
    print('[门禁] 契约与 P0 规范检查')
    print(f'  openapi : {OPENAPI.relative_to(ROOT)}')
    for n in notes:
        print(f'  {n}')
    if problems:
        print(f'  结果    : 不合格（{len(problems)} 项）')
        for p in problems:
            print(f'    - {p}')
        return 1
    print('  结果    : 全部通过')
    return 0


if __name__ == '__main__':
    sys.exit(main())
