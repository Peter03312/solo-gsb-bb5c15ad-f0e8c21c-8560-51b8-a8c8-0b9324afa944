// 条款摘录引擎（只读）。
//
// 勾选一个或多个已定义条款作为【摘录起点】，复用 removal.buildGraph 的
// 标题边界与引用图（行首“第X条”为标题，区块内其余出现为引用）：
//   1) 从起点出发沿区块内“第X条”引用递归收齐所有可达条款；
//      visited 集合保证循环引用只收录一次、不会死循环；
//   2) 收录的条款按原文顺序排列，逐字保留各区块原字句与编号直接拼接；
//      序言（首个标题之前）与未被引用到的条款一律不带入；
//   3) 所选或可达编号存在重复标题 → 拒绝并标出冲突编号与各处标题行；
//      可达引用指向未定义编号 → 拒绝并列出全部引用位置；
//      与裁撤不同：文本其余位置的重复/缺失不影响摘录，不做全量拒绝。
//
// 本模块为纯函数：不修改文档正文、不产生撤销历史。

import { buildGraph, type Section } from './removal';
import type { TextPos } from './parser';

// ---------- 请求规范化 ----------

export type ExcerptConflictCode =
  | 'EMPTY_SELECTION'
  | 'INVALID_NUMBER'
  | 'ROOT_NOT_DEFINED'
  | 'DUPLICATE_DEFINITION'
  | 'MISSING_DEFINITION';

export interface ExcerptConflict {
  code: ExcerptConflictCode;
  message: string;
  from?: number;
  positions?: TextPos[];
  /** DUPLICATE_DEFINITION 时给出各处标题行原文 */
  headings?: string[];
}

function positiveInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^[0-9]+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * 解析请求体 { numbers: number[] }。
 * 仅做输入形态校验；语义校验在 buildExcerpt 中完成。
 */
export function normalizeExcerptRequest(raw: { numbers?: unknown }): {
  numbers: number[];
  errors: ExcerptConflict[];
} {
  const errors: ExcerptConflict[] = [];
  const numbers: number[] = [];

  const rawNumbers = Array.isArray(raw.numbers) ? raw.numbers : null;
  if (rawNumbers === null || rawNumbers.length === 0) {
    errors.push({
      code: 'EMPTY_SELECTION',
      message: '请至少勾选一个条款作为摘录起点。',
    });
  } else {
    const seen = new Set<number>();
    rawNumbers.forEach((v, idx) => {
      const n = positiveInt(v);
      if (n === null) {
        errors.push({
          code: 'INVALID_NUMBER',
          message: `摘录起点第 ${idx + 1} 项不是正整数：${JSON.stringify(v)}。`,
        });
      } else if (!seen.has(n)) {
        seen.add(n);
        numbers.push(n);
      }
    });
  }

  return { numbers, errors };
}

// ---------- 摘录结果 ----------

export interface ExcerptClauseDTO {
  number: number;
  /** 标题行去前导空白文本 */
  heading: string;
  headingLine: number;
  /** 区块起止行（1-based，endLine 含） */
  startLine: number;
  endLine: number;
  /** 是否为勾选的摘录起点（false 表示沿引用链带入） */
  root: boolean;
  /** 区块原文（标题行到下一标题行之前，逐字保留） */
  text: string;
}

export interface BuildExcerptResult {
  ok: boolean;
  roots?: number[];
  clauses?: ExcerptClauseDTO[];
  /** 按原文顺序拼接的完整摘录纯文本 */
  text?: string;
  conflicts?: ExcerptConflict[];
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineOfOffset(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * 生成条款摘录（只读）。校验失败时返回全部冲突，不产生任何输出文本。
 */
export function buildExcerpt(text: string, rootNumbers: number[]): BuildExcerptResult {
  const graph = buildGraph(text);
  const lineStarts = lineStartsOf(text);

  const roots = [...new Set(rootNumbers)].sort((a, b) => a - b);
  if (roots.length === 0) {
    return {
      ok: false,
      conflicts: [
        { code: 'EMPTY_SELECTION', message: '请至少勾选一个条款作为摘录起点。' },
      ],
    };
  }

  // 规则 1：起点必须有标题定义（引用不能作为摘录源头）。
  const conflicts: ExcerptConflict[] = [];
  for (const n of roots) {
    if (!graph.defined.has(n)) {
      conflicts.push({
        code: 'ROOT_NOT_DEFINED',
        message: `第${n}条 在文本中没有标题定义，不能作为摘录起点。`,
        from: n,
      });
    }
  }
  if (conflicts.length > 0) return { ok: false, conflicts };

  // ---------- 递归收齐：沿引用边遍历，visited 去重保证循环引用只收录一次 ----------
  const included = new Set<number>();
  const stack = [...roots];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (included.has(n)) continue;
    included.add(n);
    for (const next of graph.edges.get(n) ?? []) {
      if (!included.has(next)) stack.push(next);
    }
  }

  // 规则 2：所选或可达编号存在重复标题 → 区块边界不唯一，拒绝并标出各处标题行。
  const sectionsByNumber = new Map<number, Section[]>();
  for (const s of graph.sections) {
    const list = sectionsByNumber.get(s.number) ?? [];
    list.push(s);
    sectionsByNumber.set(s.number, list);
  }
  for (const n of [...included].sort((a, b) => a - b)) {
    const defs = sectionsByNumber.get(n) ?? [];
    if (defs.length > 1) {
      conflicts.push({
        code: 'DUPLICATE_DEFINITION',
        message: `第${n}条 存在 ${defs.length} 处标题定义（第 ${defs
          .map((d) => d.occ.pos.line)
          .join('、')} 行），无法确定唯一摘录边界，请先处理重复定义。`,
        from: n,
        positions: defs.map((d) => d.occ.pos),
        headings: defs.map((d) => d.heading),
      });
    }
  }

  // 规则 3：收录条款区块内的引用指向未定义编号 → 拒绝并列出全部引用位置。
  const missingByNumber = new Map<number, TextPos[]>();
  for (const r of graph.refs) {
    if (r.owner === null || !included.has(r.owner)) continue;
    if (graph.defined.has(r.occ.number)) continue;
    const list = missingByNumber.get(r.occ.number) ?? [];
    list.push(r.occ.pos);
    missingByNumber.set(r.occ.number, list);
  }
  for (const [number, positions] of [...missingByNumber].sort((a, b) => a[0] - b[0])) {
    conflicts.push({
      code: 'MISSING_DEFINITION',
      message: `第${number}条 被摘录范围内的条款引用但未定义（第 ${positions
        .map((p) => p.line)
        .join('、')} 行），请先补齐定义或调整摘录起点。`,
      from: number,
      positions,
    });
  }

  if (conflicts.length > 0) return { ok: false, conflicts };

  // ---------- 拼接：收录条款按原文顺序，逐字保留各区块 ----------
  const chosen = graph.sections
    .filter((s) => included.has(s.number))
    .sort((a, b) => a.lineStart - b.lineStart);

  const rootSet = new Set(roots);
  const clauses: ExcerptClauseDTO[] = chosen.map((s) => ({
    number: s.number,
    heading: s.heading,
    headingLine: s.occ.pos.line,
    startLine: lineOfOffset(lineStarts, s.lineStart),
    endLine: lineOfOffset(lineStarts, Math.max(s.lineStart, s.end - 1)),
    root: rootSet.has(s.number),
    text: text.slice(s.lineStart, s.end),
  }));

  return {
    ok: true,
    roots,
    clauses,
    text: clauses.map((c) => c.text).join(''),
  };
}
