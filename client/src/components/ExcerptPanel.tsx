import { useState } from 'react';
import type { AnalyzeDTO, ExcerptResult } from '../types';

// 条款摘录工作台（只读）：
//   - 勾选一个或多个已定义条款作为摘录起点；
//   - 后端沿所选条款正文中的“第X条”引用递归收齐所需条款（循环引用只收录一次），
//     按原文顺序拼接各区块原字句，不带入序言与未被引用的条款；
//   - 所选或可达编号有重复标题、或可达引用指向未定义编号时，后端拒绝并返回行列位置；
//   - 生成结果可复制；整个过程不修改文档、不产生撤销历史。

export interface ExcerptPanelProps {
  analysis: AnalyzeDTO;
  selected: Set<number>;
  onSelectChange: (next: Set<number>) => void;
  result: ExcerptResult | null;
  loading: boolean;
  onGenerate: () => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 剪贴板 API 不可用（非安全上下文等）时退回到隐藏 textarea
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function ExcerptPanel({
  analysis,
  selected,
  onSelectChange,
  result,
  loading,
  onGenerate,
}: ExcerptPanelProps) {
  const [copied, setCopied] = useState(false);

  const toggle = (n: number) => {
    const next = new Set(selected);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    onSelectChange(next);
  };

  const doCopy = async () => {
    if (!result) return;
    const ok = await copyText(result.text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <section className="card">
      <h3>条款摘录：勾选起点，沿引用递归收齐</h3>
      <p className="muted small">
        勾选一个或多个条款作为摘录起点，系统沿所选条款正文中的“第X条”引用递归收齐所需条款
        （循环引用只收录一次），按原文顺序逐字拼接各区块，不带入序言与未被引用的条款。
        所选或可达编号有重复标题、或可达引用指向未定义编号时会拒绝生成并标出行列位置。
        整个过程<strong>只读</strong>，不会修改文档或撤销历史。
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>起点</th>
            <th>编号</th>
            <th>标题（所在行）</th>
            <th>行</th>
            <th>出现总数</th>
          </tr>
        </thead>
        <tbody>
          {analysis.definitions.map((d) => (
            <tr key={d.number}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(d.number)}
                  onChange={() => toggle(d.number)}
                  aria-label={`以第${d.number}条为摘录起点`}
                />
              </td>
              <td className="num">第{d.number}条</td>
              <td className="ellipsis">{d.heading}</td>
              <td>{d.headingLine}</td>
              <td>{d.occurrenceCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row-actions">
        <div className="spacer" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={onGenerate}
          disabled={loading || selected.size === 0}
          title={selected.size === 0 ? '请至少勾选一个条款作为摘录起点' : ''}
        >
          {loading ? '生成中…' : `生成摘录（已选 ${selected.size} 条）`}
        </button>
      </div>

      {result && (
        <div className="impact-box">
          <h4>
            收录条款（{result.clauseCount}）：起点{' '}
            {result.roots.map((n) => `第${n}条`).join('、')}
          </h4>
          <ul className="chip-list">
            {result.clauses.map((c) => (
              <li key={c.number}>
                <span className="del-chip excerpt-chip">第{c.number}条</span>
                <span className="muted small ellipsis inline">
                  {c.heading}（第 {c.startLine}–{c.endLine} 行）
                </span>
                {c.root ? (
                  <span className="tag tag-warn">摘录起点</span>
                ) : (
                  <span className="tag tag-ok">引用带入</span>
                )}
              </li>
            ))}
          </ul>

          <div className="row-actions">
            <h4 style={{ margin: 0 }}>摘录文本</h4>
            <div className="spacer" />
            <button type="button" className="btn" onClick={doCopy}>
              {copied ? '✅ 已复制' : '📋 复制摘录文本'}
            </button>
          </div>
          <pre className="contract-view">{result.text}</pre>
        </div>
      )}
    </section>
  );
}
