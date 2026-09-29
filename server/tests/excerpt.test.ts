// 条款摘录引擎自检（不依赖测试框架）：
// 覆盖递归收齐、循环引用去重、原文顺序拼接（不带序言/未引用条款）、
// 起点多条同时勾选、空选择/非正整数、勾选未定义、可达未定义引用、
// 重复标题（所选与可达）拒绝，以及只读不改正文。

import assert from 'node:assert';
import { buildExcerpt, normalizeExcerptRequest } from '../src/excerpt';

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

// 序言 + 条款 1..5；引用链：2->1、3->2、4->5、5->4（循环），第3条另引第1条。
const text = [
  '技术服务合同',
  '序言内容，不应进入任何摘录。',
  '',
  '第一条 总则',
  '本合同依据相关法律订立。',
  '',
  '第二条 定义',
  '术语解释适用第1条。',
  '',
  '第三条 履行',
  '履行中术语按第2条解释，另见第1条。',
  '',
  '第四条 验收',
  '验收后费用见第5条。',
  '',
  '第五条 费用',
  '费用与验收（第4条）一并处理。',
].join('\n');

console.log('excerpt build:');

check('勾选第3条：递归收齐 3、2、1，按原文顺序排列', () => {
  const r = buildExcerpt(text, [3]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.includedNumbers, [1, 2, 3]);
  assert.equal(r.blockCount, 3);
  assert.deepEqual(
    r.blocks!.map((b) => b.directlySelected),
    [false, false, true],
  );
});

check('摘录文本逐字保留各区块字句与编号，不含序言与第4/5条', () => {
  const r = buildExcerpt(text, [3]);
  const t = r.excerptText!;
  assert.ok(!t.includes('技术服务合同'), '不得带序言');
  assert.ok(!t.includes('序言内容'), '不得带序言');
  assert.ok(!t.includes('第四条'), '不得带未引用条款');
  assert.ok(!t.includes('第五条'), '不得带未引用条款');
  assert.ok(t.includes('第一条 总则\n本合同依据相关法律订立。'));
  assert.ok(t.includes('第二条 定义\n术语解释适用第1条。'));
  assert.ok(t.includes('第三条 履行\n履行中术语按第2条解释，另见第1条。'));
  // 三块按原文顺序：第一条在最前
  assert.ok(t.indexOf('第一条') < t.indexOf('第二条'));
  assert.ok(t.indexOf('第二条') < t.indexOf('第三条'));
});

check('区块边界：startLine/endLine 与逐字切片正确', () => {
  const r = buildExcerpt(text, [2]);
  assert.deepEqual(r.includedNumbers, [1, 2]);
  const b2 = r.blocks!.find((b) => b.number === 2)!;
  assert.equal(b2.startLine, 7);
  assert.equal(b2.endLine, 8);
  assert.equal(b2.heading, '第二条 定义');
  assert.equal(b2.text, '第二条 定义\n术语解释适用第1条。\n\n');
});

check('循环引用 4↔5：各收录一次且不死循环', () => {
  const r = buildExcerpt(text, [4]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.includedNumbers, [4, 5]);
  assert.equal(r.blockCount, 2);
  assert.equal(r.excerptText!.split('第四条 验收').length - 1, 1);
  assert.equal(r.excerptText!.split('第五条 费用').length - 1, 1);
});

check('多起点勾选：闭包取并集，按原文顺序输出', () => {
  const r = buildExcerpt(text, [3, 5]);
  assert.deepEqual(r.includedNumbers, [1, 2, 3, 4, 5]);
  assert.deepEqual(
    r.blocks!.map((b) => b.directlySelected),
    [false, false, true, false, true], // 第4条经第5条可达，非直接勾选
  );
});

check('勾选编号去重与规范化（字符串数字也接受）', () => {
  const { selected, errors } = normalizeExcerptRequest({ numbers: ['2', 2, 3] });
  assert.deepEqual(selected, [2, 3]);
  assert.equal(errors.length, 0);
});

check('末条区块 endLine 延伸到文末（无尾换行）', () => {
  const t = ['第一条 甲', '内容一。', '第二条 乙', '内容二。'].join('\n');
  const r = buildExcerpt(t, [1]);
  assert.equal(r.ok, true);
  const b1 = r.blocks![0];
  assert.equal(b1.startLine, 1);
  assert.equal(b1.endLine, 2);
  assert.equal(b1.text, '第一条 甲\n内容一。\n');
});

check('自引用不重复收录', () => {
  const t = ['第一条 甲', '本条（第1条）自引用。'].join('\n');
  const r = buildExcerpt(t, [1]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.includedNumbers, [1]);
  assert.equal(r.excerptText!.split('第一条 甲').length - 1, 1);
});

console.log('excerpt rejections:');

check('空选择：EMPTY_SELECTION', () => {
  const r = buildExcerpt(text, []);
  assert.equal(r.ok, false);
  assert.equal(r.conflicts![0].code, 'EMPTY_SELECTION');
  const { errors } = normalizeExcerptRequest({ numbers: [] });
  assert.equal(errors[0].code, 'EMPTY_SELECTION');
  assert.ok(errors[0].message.includes('至少勾选一个'));
});

check('请求形态：非数组也报 EMPTY_SELECTION', () => {
  const { errors } = normalizeExcerptRequest({});
  assert.equal(errors[0].code, 'EMPTY_SELECTION');
});

check('编号非正整数：INVALID_NUMBER', () => {
  const { selected, errors } = normalizeExcerptRequest({ numbers: [1, 'x', -3, 1.5] });
  assert.deepEqual(selected, [1]);
  assert.equal(errors.length, 3);
  assert.ok(errors.every((e) => e.code === 'INVALID_NUMBER'));
});

check('勾选未定义编号：CLAUSE_NOT_DEFINED', () => {
  const r = buildExcerpt(text, [9]);
  assert.equal(r.ok, false);
  const c = r.conflicts!;
  assert.equal(c.length, 1);
  assert.equal(c[0].code, 'CLAUSE_NOT_DEFINED');
  assert.equal(c[0].number, 9);
});

check('可达引用指向未定义编号：MISSING_REFERENCE 并列出引用位置', () => {
  const t = [
    '第一条 甲',
    '内容一。',
    '',
    '第二条 乙',
    '参见第1条与第8条。',
  ].join('\n');
  const r = buildExcerpt(t, [2]);
  assert.equal(r.ok, false);
  const c = r.conflicts!;
  assert.equal(c.length, 1);
  assert.equal(c[0].code, 'MISSING_REFERENCE');
  assert.equal(c[0].number, 8);
  const refs = c[0].references!;
  assert.equal(refs.length, 1);
  assert.equal(refs[0].pos.line, 5);
  assert.equal(refs[0].ownerNumber, 2);
  assert.equal(refs[0].line, '参见第1条与第8条。');
  // 列号指向“第”字
  assert.equal(t.split('\n')[4][refs[0].pos.column - 1], '第');
});

check('同一未定义编号被多个可达条款引用：聚合全部位置', () => {
  const t = [
    '第一条 甲',
    '见第7条。',
    '',
    '第二条 乙',
    '也见第7条。',
  ].join('\n');
  const r = buildExcerpt(t, [1, 2]);
  assert.equal(r.ok, false);
  const c = r.conflicts!.find((x) => x.code === 'MISSING_REFERENCE' && x.number === 7)!;
  assert.equal(c.references!.length, 2);
  assert.deepEqual(c.references!.map((x) => x.pos.line), [2, 5]);
});

check('未定义引用位于不可达区块：不报错且不带入该区块', () => {
  const t = [
    '第一条 甲',
    '内容一。',
    '',
    '第二条 乙',
    '参见第99条。',
  ].join('\n');
  const r = buildExcerpt(t, [1]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.includedNumbers, [1]);
  assert.ok(!r.excerptText!.includes('第99条'));
});

check('所选编号有重复标题：DUPLICATE_DEFINITION 标出编号与标题行', () => {
  const t = [
    '第一条 甲',
    '内容一。',
    '',
    '第一条 甲（重复）',
    '重复内容。',
    '',
    '第二条 乙',
    '见第1条。',
  ].join('\n');
  const r = buildExcerpt(t, [2]); // 第1条可达
  assert.equal(r.ok, false);
  const c = r.conflicts!;
  assert.equal(c.length, 1);
  assert.equal(c[0].code, 'DUPLICATE_DEFINITION');
  assert.equal(c[0].number, 1);
  assert.deepEqual(c[0].headings!.map((h) => h.line), [1, 4]);
  assert.deepEqual(
    c[0].headings!.map((h) => h.heading),
    ['第一条 甲', '第一条 甲（重复）'],
  );
  assert.ok(c[0].message.includes('第一条 甲（重复）'));
});

check('直接勾选重复标题编号：同样拒绝', () => {
  const t = ['第一条 甲', '内容一。', '第一条 甲又一', '重复。'].join('\n');
  const r = buildExcerpt(t, [1]);
  assert.equal(r.ok, false);
  assert.equal(r.conflicts![0].code, 'DUPLICATE_DEFINITION');
});

check('不可达编号的重复标题不影响摘录', () => {
  const t = [
    '第一条 甲',
    '内容一。',
    '',
    '第三条 丙一',
    '丙。',
    '',
    '第三条 丙二',
    '又一个丙，但无任何人引用。',
  ].join('\n');
  const r = buildExcerpt(t, [1]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.includedNumbers, [1]);
});

check('勾选未定义编号 + 可达未定义引用：两类冲突同时返回', () => {
  const t = ['第一条 甲', '见第8条。'].join('\n');
  const r = buildExcerpt(t, [1, 40]);
  assert.equal(r.ok, false);
  const codes = r.conflicts!.map((c) => c.code).sort();
  assert.deepEqual(codes, ['CLAUSE_NOT_DEFINED', 'MISSING_REFERENCE']);
});

check('中文数字编号同样递归收齐并逐字保留', () => {
  // 行首“第一条”为定义，第二条正文中的“第一条”为引用
  const t = [
    '第一条 甲',
    '内容一。',
    '第二条 乙',
    '适用第一条规定。',
  ].join('\n');
  const r = buildExcerpt(t, [2]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.includedNumbers, [1, 2]);
  assert.ok(r.excerptText!.startsWith('第一条 甲'));
  assert.ok(r.excerptText!.includes('适用第一条规定。'));
});

console.log(`\nexcerpt tests: ${passed} passed`);
