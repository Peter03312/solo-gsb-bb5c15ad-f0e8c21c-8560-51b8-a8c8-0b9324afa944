import type { ConflictError } from '../types';

export default function Conflicts({ conflicts }: { conflicts: ConflictError[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="conflicts" role="alert">
      <h4>⚠️ 操作已拒绝（{conflicts.length} 项冲突，未改动任何内容）</h4>
      <ul>
        {conflicts.map((c, i) => (
          <li key={i}>
            <code className="conflict-code">{c.code}</code> {c.message}
            {c.headings && c.headings.length > 0 && (
              <span className="conflict-pos">
                标题行：
                {c.headings.map((h, j) => (
                  <span key={j} className="pos-chip">
                    {h}
                  </span>
                ))}
              </span>
            )}
            {c.positions && c.positions.length > 0 && (
              <span className="conflict-pos">
                位置：
                {c.positions.map((p, j) => (
                  <span key={j} className="pos-chip">
                    第 {p.line} 行第 {p.column} 列
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
