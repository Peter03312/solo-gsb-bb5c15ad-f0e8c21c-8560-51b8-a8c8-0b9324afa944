// 条款摘录引擎（只读）。
//
// 从勾选的一个或多个条款出发，沿各区块正文中的“第X条”引用递归收齐所需条款，
// 生成可复制的纯文本摘录。全程复用 parser 的定义/引用判定与 removal 的标题边界
// （buildGraph）：区块 = 标题行首 -> 下一标题行首（不含），首个标题之前为序言。
//
// 收录规则：
//   - 起点 = 请求中勾选的编号（必须在正文中有唯一标题定义）；
//   - 沿引用图 owner -> target 递归（BFS）收齐被引条款；
//   - 循环引用按编号去重，每个条款只收录一次；
//   - 结果按区块在原文中的出现顺序排列，逐字拼接各区块切片，
//     因此保留原字句与编号，且不会带入未被引用的条款或序言。
//
// 拒绝规则（不修改文档、不写撤销历史）：
//   1) 空选择 / 编号非正整数；
//   2) 勾选编号在正文中没有标题定义；
//   3) 所选或可达编号存在重复标题（边界不唯一）——标出冲突编号与每处标题行；
//   4) 可达区块正文中引用了未定义编号——列出每处引用位置（行列与上下文）。

import { type TextPos } from './parser';
import { buildGraph, type Section } from './removal';

// ---------- 请求规范化 ----------

export type ExcerptConflictCode =
  | 'EMPTY_SELECTION'
  | 'INVALID_NUMBER'
  | 'CLAUSE_NOT_DEFINED'
  | 'DUPLICATE_DEFINITION'
  | 'MISSING_REFERENCE';

export interface ExcerptRefLocation {
  /** 被引编号（未定义） */
  number: number;
  pos: TextPos;
  /** 引用所在行文本（去前导空白） */
  line: string;
  /** 引用所在条款；序言理论上不可达，仍保留 null 形态 */
  ownerNumber: number | null;
  ownerHeading: string | null;
}

export interface ExcerptConflict {
  code: ExcerptConflictCode;
  message: string;
  number?: number;
  /** 重复标题时的每处定义（编号 + 标题行） */
  headings?: { number: number; heading: string; line: number; pos: TextPos }[];
  /** 缺失引用时的每处引用位置 */
  references?: ExcerptRefLocation[];
  positions?: TextPos[];
}

export interface ExcerptBlockDTO {
  number: number;
  /** 标题行去前导空白文本 */
  heading: string;
  headingLine: number;
  /** 区块覆盖的起止行（含两端） */
  startLine: number;
  endLine: number;
  /** 区块原文切片（逐字保留，含编号） */
  text: string;
  /** 是否为请求中直接勾选的起点（false 表示沿引用递归收入） */
  directlySelected: boolean;
}

export interface ExcerptResult {
  ok: boolean;
  conflicts?: ExcerptConflict[];
  /** 规范化后的勾选编号 */
  selected?: number[];
  /** 实际收录编号（按原文顺序） */
  includedNumbers?: number[];
  blocks?: ExcerptBlockDTO[];
  excerptText?: string;
  blockCount?: number;
}

function positiveInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^[0-9]+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * 解析请求体 { numbers: number[] }，仅做形态校验；语义校验在 buildExcerpt 中完成。
 */
export function normalizeExcerptRequest(raw: { numbers?: unknown }): {
  selected: number[];
  errors: ExcerptConflict[];
} {
  const errors: ExcerptConflict[] = [];
  const selected: number[] = [];

  const rawNumbers = Array.isArray(raw.numbers) ? raw.numbers : null;
  if (rawNumbers === null || rawNumbers.length === 0) {
    errors.push({
      code: 'EMPTY_SELECTION',
      message: '请至少勾选一个条款作为摘录起点（空选择无法生成摘录）。',
    });
    return { selected, errors };
  }

  const seen = new Set<number>();
  rawNumbers.forEach((v, idx) => {
    const n = positiveInt(v);
    if (n === null) {
      errors.push({
        code: 'INVALID_NUMBER',
        message: `摘录编号列表第 ${idx + 1} 项不是正整数：${JSON.stringify(v)}。`,
      });
      return;
    }
    if (!seen.has(n)) {
      seen.add(n);
      selected.push(n);
    }
  });

  return { selected, errors };
}

// ---------- 文本辅助 ----------

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineTextOf(text: string, lineStarts: number[], offset: number): string {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  const from = lineStarts[lo];
  const nl = text.indexOf('\n', from);
  return text.slice(from, nl === -1 ? text.length : nl).replace(/^[ \t　]+/, '');
}

// ---------- 摘录构建 ----------

/**
 * 依据已保存正文与勾选编号生成摘录（只读）：任何语义问题都以 conflicts 返回，
 * 调用方不得在 ok=false 时使用 excerptText。
 */
export function buildExcerpt(text: string, selectedInput: number[]): ExcerptResult {
  const graph = buildGraph(text);
  const lineStarts = lineStartsOf(text);

  const selected = [...new Set(selectedInput)].sort((a, b) => a - b);
  if (selected.length === 0) {
    return {
      ok: false,
      conflicts: [
        { code: 'EMPTY_SELECTION', message: '请至少勾选一个条款作为摘录起点（空选择无法生成摘录）。' },
      ],
    };
  }

  const conflicts: ExcerptConflict[] = [];

  // 规则 1：勾选编号必须有标题定义。
  const undefinedSelected = selected.filter((n) => !graph.defined.has(n));
  for (const n of undefinedSelected) {
    conflicts.push({
      code: 'CLAUSE_NOT_DEFINED',
      number: n,
      message: `勾选的第${n}条在当前合同正文中没有标题定义，不能作为摘录起点。`,
    });
  }

  // 沿引用图从勾选条款出发 BFS 收齐可达编号（边只含已定义目标，循环安全）。
  const closure = new Set<number>();
  const queue: number[] = [];
  for (const n of selected) {
    if (graph.defined.has(n) && !closure.has(n)) {
      closure.add(n);
      queue.push(n);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of graph.edges.get(cur) ?? []) {
      if (!closure.has(next)) {
        closure.add(next);
        queue.push(next);
      }
    }
  }

  // 规则 2：所选或可达编号存在重复标题 → 区块边界不唯一，拒绝。
  const sectionsByNumber = new Map<number, Section[]>();
  for (const s of graph.sections) {
    if (!closure.has(s.number)) continue;
    const list = sectionsByNumber.get(s.number) ?? [];
    list.push(s);
    sectionsByNumber.set(s.number, list);
  }
  for (const n of [...sectionsByNumber.keys()].sort((a, b) => a - b)) {
    const list = sectionsByNumber.get(n)!;
    if (list.length <= 1) continue;
    conflicts.push({
      code: 'DUPLICATE_DEFINITION',
      number: n,
      message:
        `第${n}条 在所选或可达范围内存在 ${list.length} 处标题定义` +
        `（第 ${list.map((s) => s.occ.pos.line).join('、')} 行），摘录边界不唯一，已拒绝生成：\n` +
        list.map((s) => `  · 第 ${s.occ.pos.line} 行：${s.heading}`).join('\n'),
      headings: list.map((s) => ({
        number: n,
        heading: s.heading,
        line: s.occ.pos.line,
        pos: s.occ.pos,
      })),
      positions: list.map((s) => s.occ.pos),
    });
  }

  // 规则 3：可达区块正文中引用了未定义编号 → 列出全部引用位置。
  // 勾选即未定义的编号已在上一条报错，这里不再重复聚合。
  const undefinedSelectedSet = new Set(undefinedSelected);
  const missingByNumber = new Map<number, ExcerptRefLocation[]>();
  for (const r of graph.refs) {
    if (r.owner === null || !closure.has(r.owner)) continue;
    if (graph.defined.has(r.occ.number)) continue;
    if (undefinedSelectedSet.has(r.occ.number)) continue;
    const list = missingByNumber.get(r.occ.number) ?? [];
    list.push({
      number: r.occ.number,
      pos: r.occ.pos,
      line: lineTextOf(text, lineStarts, r.occ.start),
      ownerNumber: r.owner,
      ownerHeading: graph.defined.get(r.owner)?.heading ?? null,
    });
    missingByNumber.set(r.occ.number, list);
  }
  for (const n of [...missingByNumber.keys()].sort((a, b) => a - b)) {
    const refs = missingByNumber.get(n)!;
    refs.sort((a, b) => a.pos.offset - b.pos.offset);
    conflicts.push({
      code: 'MISSING_REFERENCE',
      number: n,
      message:
        `摘录可达条款引用了未定义的第${n}条，引用链不完整，已拒绝生成。` +
        `引用位置（${refs.length} 处）：\n` +
        refs
          .map(
            (r) =>
              `  · 第 ${r.pos.line} 行第 ${r.pos.column} 列` +
              (r.ownerNumber === null ? '（序言）' : `，第${r.ownerNumber}条区块内`) +
              `：${r.line}`,
          )
          .join('\n'),
      references: refs,
      positions: refs.map((r) => r.pos),
    });
  }

  if (conflicts.length > 0) return { ok: false, conflicts, selected };

  // 通过校验：闭包内每个编号恰好一个区块，按原文顺序逐字拼接。
  const lineOfOffset = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const selectedSet = new Set(selected);
  const blocks: ExcerptBlockDTO[] = [];
  for (const s of graph.sections) {
    if (!closure.has(s.number)) continue;
    const slice = text.slice(s.lineStart, s.end);
    // 区块与下一标题之间可能隔着空行：末行取切片内最后一个非空白字符所在行。
    const lastContent = slice.search(/[^\s](?=\s*$)/);
    const lastOffset = lastContent === -1 ? s.lineStart : s.lineStart + lastContent;
    blocks.push({
      number: s.number,
      heading: s.heading,
      headingLine: s.occ.pos.line,
      startLine: s.occ.pos.line,
      endLine: lineOfOffset(lastOffset),
      text: slice,
      directlySelected: selectedSet.has(s.number),
    });
  }

  return {
    ok: true,
    selected,
    includedNumbers: blocks.map((b) => b.number),
    blocks,
    excerptText: blocks.map((b) => b.text).join(''),
    blockCount: blocks.length,
  };
}
