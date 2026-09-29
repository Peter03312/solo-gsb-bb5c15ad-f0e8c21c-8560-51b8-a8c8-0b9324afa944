import { useMemo, useState } from 'react';
import type { AnalyzeDTO, ConflictError, ExcerptResult } from '../types';

// 条款摘录面板（只读）：
//   - 勾选一个或多个已定义条款作为摘录起点；
//   - 后端沿各区块正文中的“第X条”引用递归收齐，循环引用只收录一次；
//   - 结果按原文顺序逐字拼接，不含序言与未被引用的条款，可一键复制；
//   - 空选择、勾选未定义、重复标题、可达未定义引用均由后端拒绝并在此列出。

export interface ExcerptPanelProps {
  analysis: AnalyzeDTO;
  loading: boolean;
  onGenerate: (numbers: number[]) => Promise<ExcerptResult | null>;
  result: ExcerptResult | null;
  conflicts: ConflictError[];
}

export default function ExcerptPanel({
  analysis,
  loading,
  onGenerate,
  result,
  conflicts,
}: ExcerptPanelProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const dupes = useMemo(
    () => new Set(analysis.issues.filter((i) => i.kind === 'duplicate_definition').map((i) => i.number)),
    [analysis.issues],
  );

  const selectedSorted = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);  const toggle = (n: number) => {
    const next = new Set(selected);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setSelected(next);
    setCopied(false);
  };

  const generate = async () => {
    await onGenerate(selectedSorted);
    setCopied(false);
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.excerptText);
      setCopied(true);
    } catch {
      // 剪贴板不可用（如非安全上下文）时退回选区复制
      const ta = document.getElementById('excerpt-text') as HTMLTextAreaElement | null;
      ta?.select();
      document.execCommand('copy');
      setCopied(true);
    }
  };

  return (
    <section className="card">
      <h3>条款摘录：勾选起点 → 沿引用递归收齐 → 复制纯文本</h3>
      <p className="muted small">
        从勾选条款出发，系统沿各条款正文中的“第X条”引用递归收齐所需条款：循环引用只收录一次，
        结果按<strong>原文顺序</strong>排列并逐字保留字句与编号；<strong>不带入</strong>序言及未被引用的条款。
        整个过程<strong>只读</strong>，不修改正文与撤销历史。
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>摘录</th>
            <th>编号</th>
            <th>标题（所在行）</th>
            <th>行</th>
          </tr>
        </thead>
        <tbody>
          {analysis.definitions.map((d) => (
            <tr key={d.number} className={dupes.has(d.number) ? 'row-dup' : ''}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(d.number)}
                  onChange={() => toggle(d.number)}
                  aria-label={`摘录第${d.number}条`}
                />
              </td>
              <td className="num">第{d.number}条</td>
              <td className="ellipsis">{d.heading}</td>
              <td>{d.headingLine}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row-actions">
        <span className="muted small">
          {selectedSorted.length > 0
            ? `已勾选起点：第 ${selectedSorted.join('、')} 条`
            : '未勾选任何条款'}
        </span>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={generate}
          disabled={loading || selectedSorted.length === 0}
        >
          {loading ? '收集中…' : `生成摘录（已选 ${selectedSorted.length} 条起点）`}
        </button>
      </div>

      {conflicts.length > 0 && (
        <div className="conflicts" role="alert">
          <h4>⚠️ 摘录已拒绝生成（{conflicts.length} 项问题）</h4>
          <ul>
            {conflicts.map((c, i) => (
              <li key={i}>
                <code className="conflict-code">{c.code}</code>
                <span style={{ whiteSpace: 'pre-wrap' }}>{c.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div className="impact-box">
          <h4>
            摘录结果（{result.blockCount} 个条款，起点第 {result.selected.join('、')} 条
            {result.includedNumbers.length !== result.selected.length && (
              <>
                ，递归收齐至第 {result.includedNumbers.join('、')} 条
              </>
            )}
            ）
          </h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>编号</th>
                <th>标题</th>
                <th>原文行范围</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {result.blocks.map((b) => (
                <tr key={b.number}>
                  <td className="num">第{b.number}条</td>
                  <td className="ellipsis">{b.heading}</td>
                  <td className="num">
                    {b.startLine}–{b.endLine}
                  </td>
                  <td>
                    {b.directlySelected ? (
                      <span className="tag tag-warn">勾选起点</span>
                    ) : (
                      <span className="tag tag-ok">引用收齐</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-actions">
            <button type="button" className="btn" onClick={copy}>
              {copied ? '✅ 已复制到剪贴板' : '复制摘录纯文本'}
            </button>
          </div>
          {/* 只读 textarea 兼作无剪贴板权限时的回退选区；同时直观展示可复制文本 */}
          <textarea
            id="excerpt-text"
            className="contract-view"
            readOnly
            rows={Math.min(18, Math.max(6, result.excerptText.split('\n').length))}
            value={result.excerptText}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
    </section>
  );
}
