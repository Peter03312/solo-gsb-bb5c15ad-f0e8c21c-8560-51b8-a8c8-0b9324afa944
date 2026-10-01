// 条款摘录引擎自检（不依赖测试框架）：
// 覆盖沿引用链递归收齐、循环引用只收录一次、按原文顺序排列、序言与未引用
// 条款不带入、原字句逐字保留、多起点合并、自引用，以及重复标题 / 缺失定义
// （仅统计所选或可达范围）拒绝，空选择与非法编号校验，只读不写库。

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildExcerpt, normalizeExcerptRequest } from '../src/excerpt';
import { initDB, createDocument, getDocument, getLastHistory } from '../src/db';

let passed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.error(`  ❌ ${name}`);
    throw e;
  }
};

// 条款 1..5，区块间含空行；引用链：2->1、3->2、4->5、5->4（循环）
const text = [
  '技术服务合同',
  '',
  '第一条 总则',
  '本合同依据相关法律订立。',
  '',
  '第二条 定义',
  '术语解释适用第1条。',
  '',
  '第三条 履行',
  '履行中术语按第2条解释。',
  '',
  '第四条 验收',
  '验收后费用见第5条。',
  '',
  '第五条 费用',
  '费用与验收（第4条）一并处理。',
].join('\n');

console.log('excerpt core:');
check('沿引用链递归收齐：选第3条带入第2、1条，不含第4、5条与序言', () => {
  const r = buildExcerpt(text, [3]);
  assert.ok(r.ok);
  assert.deepEqual(r.roots, [3]);
  assert.deepEqual(r.clauses!.map((c) => c.number), [1, 2, 3]);
  assert.ok(!r.text!.includes('技术服务合同'), '序言不带入');
  assert.ok(!r.text!.includes('第四条') && !r.text!.includes('第五条'), '未引用条款不带入');
});

check('结果按原文顺序排列：起点第3条排在第1、2条之后', () => {
  const r = buildExcerpt(text, [3]);
  assert.ok(r.ok);
  const flags = r.clauses!.map((c) => [c.number, c.root]);
  assert.deepEqual(flags, [
    [1, false],
    [2, false],
    [3, true],
  ]);
  // 行范围：第1条区块从第 3 行起，第3条区块含其后的空行（到第 11 行）
  assert.equal(r.clauses![0].headingLine, 3);
  assert.equal(r.clauses![0].startLine, 3);
  assert.equal(r.clauses![2].endLine, 11);
});

check('各区块原字句与编号逐字保留，拼接结果与原文对应区间一致', () => {
  const r = buildExcerpt(text, [3]);
  assert.ok(r.ok);
  const expected = [
    '第一条 总则',
    '本合同依据相关法律订立。',
    '',
    '第二条 定义',
    '术语解释适用第1条。',
    '',
    '第三条 履行',
    '履行中术语按第2条解释。',
    '',
    '',
  ].join('\n');
  assert.equal(r.text, expected);
  // 编号保持原文风格（第一条 / 第1条 均原样出现）
  assert.ok(r.text!.includes('第一条 总则'));
  assert.ok(r.text!.includes('术语解释适用第1条。'));
});

check('循环引用只收录一次：选第4条得第4、5条各一份', () => {
  const r = buildExcerpt(text, [4]);
  assert.ok(r.ok);
  assert.deepEqual(r.clauses!.map((c) => c.number), [4, 5]);
  const expected = [
    '第四条 验收',
    '验收后费用见第5条。',
    '',
    '第五条 费用',
    '费用与验收（第4条）一并处理。',
  ].join('\n');
  assert.equal(r.text, expected);
});

check('多起点合并去重：选第2、3条共收齐第1、2、3条', () => {
  const r = buildExcerpt(text, [3, 2]);
  assert.ok(r.ok);
  assert.deepEqual(r.roots, [2, 3], '起点去重并按编号排序');
  assert.deepEqual(r.clauses!.map((c) => c.number), [1, 2, 3]);
});

check('自引用条款只收录一次', () => {
  const t = ['第1条 甲', '内容。', '第2条 乙', '见第2条自身与第1条。'].join('\n');
  const r = buildExcerpt(t, [2]);
  assert.ok(r.ok);
  assert.deepEqual(r.clauses!.map((c) => c.number), [1, 2]);
});

check('中文数字引用链同样递归（第三条→第二条→第一条）', () => {
  const t = [
    '第一条 甲',
    '内容一。',
    '第二条 乙',
    '适用第一条。',
    '第三条 丙',
    '按第二条执行。',
  ].join('\n');
  const r = buildExcerpt(t, [3]);
  assert.ok(r.ok);
  assert.deepEqual(r.clauses!.map((c) => c.number), [1, 2, 3]);
});

console.log('excerpt conflicts:');
check('空选择 -> EMPTY_SELECTION（请求校验与引擎两层）', () => {
  assert.ok(normalizeExcerptRequest({}).errors.some((e) => e.code === 'EMPTY_SELECTION'));
  assert.ok(
    normalizeExcerptRequest({ numbers: [] }).errors.some((e) => e.code === 'EMPTY_SELECTION'),
  );
  const r = buildExcerpt(text, []);
  assert.ok(!r.ok);
  assert.ok(r.conflicts!.some((c) => c.code === 'EMPTY_SELECTION'));
});

check('非法编号 -> INVALID_NUMBER；重复起点自动去重', () => {
  assert.ok(
    normalizeExcerptRequest({ numbers: ['x'] }).errors.some((e) => e.code === 'INVALID_NUMBER'),
  );
  assert.ok(
    normalizeExcerptRequest({ numbers: [0] }).errors.some((e) => e.code === 'INVALID_NUMBER'),
  );
  const { numbers, errors } = normalizeExcerptRequest({ numbers: [3, '3', 2] });
  assert.equal(errors.length, 0);
  assert.deepEqual(numbers, [3, 2]);
});

check('起点未定义 -> ROOT_NOT_DEFINED', () => {
  const r = buildExcerpt(text, [42]);
  assert.ok(!r.ok);
  const c = r.conflicts!.find((x) => x.code === 'ROOT_NOT_DEFINED');
  assert.ok(c);
  assert.equal(c!.from, 42);
});

check('可达编号有重复标题 -> DUPLICATE_DEFINITION 并标出编号与各处标题行', () => {
  const t = [
    '第一条 甲',
    '内容。',
    '第二条 乙',
    '另见第1条。',
    '第一条 重复',
    '误粘贴。',
  ].join('\n');
  const r = buildExcerpt(t, [2]);
  assert.ok(!r.ok);
  const c = r.conflicts!.find((x) => x.code === 'DUPLICATE_DEFINITION');
  assert.ok(c);
  assert.equal(c!.from, 1);
  assert.deepEqual(c!.positions!.map((p) => p.line), [1, 5]);
  assert.deepEqual(c!.headings, ['第一条 甲', '第一条 重复']);
});

check('不可达的重复标题不影响摘录', () => {
  const t = text + '\n\n第五条 重复\n误粘贴。';
  const r = buildExcerpt(t, [3]);
  assert.ok(r.ok);
  assert.deepEqual(r.clauses!.map((c) => c.number), [1, 2, 3]);
});

check('可达引用指向未定义编号 -> MISSING_DEFINITION 并列出引用位置', () => {
  const t = ['第一条 甲', '内容。', '第二条 乙', '另见第99条。'].join('\n');
  const r = buildExcerpt(t, [2]);
  assert.ok(!r.ok);
  const c = r.conflicts!.find((x) => x.code === 'MISSING_DEFINITION');
  assert.ok(c);
  assert.equal(c!.from, 99);
  assert.equal(c!.positions!.length, 1);
  assert.equal(c!.positions![0].line, 4);
  assert.equal(t.split('\n')[3][c!.positions![0].column - 1], '第');
});

check('摘录范围外的缺失引用不影响摘录', () => {
  // 第5条引用未定义的第99条，但选第3条的可达集只有 1/2/3
  const t = text + '\n\n第六条 附则\n未尽事宜见第99条。';
  const r = buildExcerpt(t, [3]);
  assert.ok(r.ok);
  assert.deepEqual(r.clauses!.map((c) => c.number), [1, 2, 3]);
});

check('序言中的引用不会把序言带入摘录', () => {
  const t = ['鉴于安排见第2条所述，', '', '第一条 甲', '内容。', '第二条 乙', '内容。'].join(
    '\n',
  );
  const r = buildExcerpt(t, [2]);
  assert.ok(r.ok);
  assert.deepEqual(r.clauses!.map((c) => c.number), [2]);
  assert.ok(!r.text!.includes('鉴于'));
});

console.log('excerpt persistence:');
check('只读：生成摘录后文档正文与撤销历史均不变', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excerpt-db-'));
  initDB(path.join(dir, 'test.db'));
  const doc = createDocument('摘录测试合同', text);
  const before = getDocument(doc.id)!;

  const r = buildExcerpt(before.content, [3]);
  assert.ok(r.ok);

  const after = getDocument(doc.id)!;
  assert.equal(after.content, before.content, '正文不变');
  assert.equal(after.updated_at, before.updated_at, '更新时间不变');
  assert.equal(getLastHistory(doc.id), undefined, '不产生撤销历史');
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n摘录测试全部通过：${passed} 项 ✅`);
