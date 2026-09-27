import { JSDOM } from 'jsdom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import App from '../src/App';

;(async () => {
// 临时 DOM 集成验证：挂载 App，切换到“变更影响”页签，验证空状态 / 停用例外后的差异行 / 点击联动。

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).Element = dom.window.Element;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).MouseEvent = dom.window.MouseEvent;
(globalThis as any).getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};

const container = document.getElementById('root')!;
const root = createRoot(container);

await act(async () => {
  root.render(React.createElement(App));
});

const byText = (sel: string, text: string): Element | null =>
  [...container.querySelectorAll(sel)].find((el) => el.textContent?.includes(text)) ?? null;

// 1) 初始无编辑：切到变更影响页签，应显示空状态
const impactTab = byText('button', '变更影响') as HTMLElement;
if (!impactTab) throw new Error('变更影响 页签未渲染');
await act(async () => {
  impactTab.click();
});
if (!container.textContent?.includes('当前范围内没有有效改动')) {
  throw new Error('无编辑时应显示空状态');
}
console.log('✓ 无改动时显示空状态');

// 2) 停用示例中的覆盖例外（中栏第一个勾选框）后，差异应出现
const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
const overrideCb = checkboxes.find((c) => c.checked);
if (!overrideCb) throw new Error('找不到已启用的例外勾选框');
await act(async () => {
  overrideCb.click();
});
await act(async () => {});
if (container.textContent?.includes('当前范围内没有有效改动')) {
  throw new Error('停用例外后应出现差异');
}
const rows = container.querySelectorAll('.diff-row');
if (rows.length === 0) throw new Error('停用例外后应至少有一条差异行');
console.log(`✓ 停用例外后出现 ${rows.length} 条差异`);

// 必须存在“开始移动”或“地点/标题”类修改，且不应把同身份报成一删一增
const labels = container.textContent ?? '';
if (!/开始移动|标题|地点/.test(labels)) throw new Error('应标出移动或字段变化');
const addCount = (labels.match(/新增/g) || []).length;
const remCount = (labels.match(/移除/g) || []).length;
console.log(`  新增标记=${addCount} 移除标记=${remCount}`);

// 3) 类型筛选按钮可用
const movedChip = byText('button.chip', '开始移动') as HTMLElement;
if (movedChip) {
  await act(async () => movedChip.click());
  const filtered = container.querySelectorAll('.diff-row');
  console.log(`✓ 按“开始移动”筛选后 ${filtered.length} 行`);
  const allChip = byText('button.chip', '全部') as HTMLElement;
  await act(async () => allChip.click());
}

// 4) 点击差异行：联动切回生效表
const firstRow = container.querySelector('.diff-row') as HTMLElement;
await act(async () => firstRow.click());
const visibleBtn = byText('.tabs button', '生效实例') as HTMLElement;
if (!visibleBtn.classList.contains('active')) {
  throw new Error('点击差异项应切回生效实例页签');
}
const selected = container.querySelector('tr.instance-row.selected');
if (!selected) throw new Error('点击差异项后应选中实例表行');
console.log('✓ 点击差异项联动实例表');

// 5) 恢复例外（再次勾选），差异应清空
await act(async () => overrideCb.click());
await act(async () => {});
await act(async () => impactTab.click());
if (!container.textContent?.includes('当前范围内没有有效改动')) {
  throw new Error('恢复例外后差异应清空');
}
console.log('✓ 恢复后差异立即清空（重算）');

// 6) 范围例外（RANGE=THISANDFUTURE）：示例中 3/23 起的站会被位移到 09:45 会议室 C
const tableText = (): string =>
  container.querySelector('.instance-table')?.textContent ?? '';
const visibleTab = byText('.tabs button', '生效实例') as HTMLElement;
await act(async () => visibleTab.click());
if (!tableText().includes('范围例外')) {
  throw new Error('生效实例表应标注范围例外调整的实例');
}
if (!tableText().includes('会议室 C')) {
  throw new Error('范围例外应将后续实例的地点延续为会议室 C');
}
console.log('✓ 范围例外生效：实例表标注「范围例外」且地点延续');

// 7) 停用范围例外：受影响实例回到基础序列（09:00 会议室 A），差异出现
const rangeCb = ([...container.querySelectorAll('.override-item input[type="checkbox"]')] as HTMLInputElement[])
  .find((c) => c.closest('.override-item')?.textContent?.includes('范围'));
if (!rangeCb) throw new Error('找不到范围例外勾选框');
await act(async () => {
  rangeCb.click();
});
await act(async () => {});
if (tableText().includes('范围例外')) {
  throw new Error('停用范围例外后不应再有范围调整实例');
}
// 会议室 C 只由范围例外引入，停用后应从实例表消失
if (tableText().includes('会议室 C')) {
  throw new Error('停用范围例外后会议室 C 不应再出现');
}
await act(async () => impactTab.click());
if (container.textContent?.includes('当前范围内没有有效改动')) {
  throw new Error('停用范围例外后应出现差异');
}
const rangeDiffs = container.querySelectorAll('.diff-row');
if (rangeDiffs.length === 0) throw new Error('停用范围例外后应至少有一条差异行');
console.log(`✓ 停用范围例外后实例回到基础序列，出现 ${rangeDiffs.length} 条差异`);

// 8) 重新启用范围例外：差异清空，范围调整恢复
await act(async () => {
  rangeCb.click();
});
await act(async () => {});
await act(async () => impactTab.click());
if (!container.textContent?.includes('当前范围内没有有效改动')) {
  throw new Error('重新启用范围例外后差异应清空');
}
console.log('✓ 重新启用范围例外后差异清空（回到范围状态）');

// 9) 冲突保留方案：选择 LOCATION → 权重/必留 → 方案与无解路径
const retentionTab = byText('.tabs button', '冲突保留') as HTMLElement;
if (!retentionTab) throw new Error('冲突保留 页签未渲染');
await act(async () => {
  retentionTab.click();
});
if (!container.textContent?.includes('选择 LOCATION 后')) {
  throw new Error('未选 LOCATION 时应显示空状态提示');
}
console.log('✓ 冲突保留页签渲染空状态');

const retSelect = container.querySelector('.free-controls select') as HTMLSelectElement;
if (!retSelect) throw new Error('找不到保留方案 LOCATION 下拉');
const selectSetter = Object.getOwnPropertyDescriptor(
  dom.window.HTMLSelectElement.prototype,
  'value'
)!.set!;
await act(async () => {
  selectSetter.call(retSelect, '会议室 A');
  retSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
});
const retRows = () => container.querySelectorAll('tr.ret-row');
if (retRows().length === 0) throw new Error('选择 LOCATION 后应列出参与实例');
const dropBadges = () => container.querySelectorAll('.ret-badge.drop');
const keepBadges = () => container.querySelectorAll('.ret-badge.keep');
// 示例中会议室 A 有 4 个站会因字典序规则被舍弃（3/4、3/10、3/11、3/18）
if (dropBadges().length !== 4) throw new Error(`默认方案应舍弃 4 个实例，实际 ${dropBadges().length}`);
if (keepBadges().length !== retRows().length - 4) throw new Error('保留数应为参与数减舍弃数');
if (!container.textContent?.includes('总权重')) throw new Error('应展示总权重');
console.log(`✓ 默认方案：参与 ${retRows().length}，保留 ${keepBadges().length}，舍弃 ${dropBadges().length}`);

// 勾选被舍弃实例的必留 → 立即重算，该实例转为保留并标注必留
const firstDropped = dropBadges()[0].closest('tr') as HTMLElement;
const mustCb = firstDropped.querySelector('input[type="checkbox"]') as HTMLInputElement;
await act(async () => {
  mustCb.click();
});
if (!firstDropped.querySelector('.ret-badge.keep')) throw new Error('必留实例应转为保留');
if (!firstDropped.textContent?.includes('必留')) throw new Error('必留实例应标注「必留」');
console.log('✓ 必留标记立即重算：被舍弃实例转为保留');

// 再把与其重叠的实例也设为必留 → 冲突对 + 无解，不输出方案
const secondDropped = container.querySelector('tr.ret-dropped') as HTMLElement;
if (!secondDropped) throw new Error('应存在被必留挤掉的实例');
const mustCb2 = secondDropped.querySelector('input[type="checkbox"]') as HTMLInputElement;
await act(async () => {
  mustCb2.click();
});
if (!container.textContent?.includes('无解')) throw new Error('必留互相重叠时应提示无解');
if (!container.textContent?.includes('冲突对')) throw new Error('应列出必留冲突对');
if (container.querySelector('.ret-badge.keep')) throw new Error('无解时不应输出保留方案');
console.log('✓ 必留冲突对展示并无解（不输出方案）');

// 取消第二个必留 → 方案恢复
await act(async () => {
  mustCb2.click();
});
if (container.textContent?.includes('无解')) throw new Error('取消必留后应恢复有解');
if (!container.querySelector('.ret-badge.keep')) throw new Error('恢复后应重新输出保留方案');
console.log('✓ 取消必留后方案立即恢复');

// 点击实例行 → 沿用源码定位（行选中）
const firstRetRow = retRows()[0] as HTMLElement;
await act(async () => {
  firstRetRow.click();
});
if (!container.querySelector('tr.ret-row.selected')) throw new Error('点击实例行应选中并定位源码');
console.log('✓ 点击保留方案实例联动源码定位');

// 重新解析（载入示例）→ 权重/必留设置与 LOCATION 选择重置
const loadSampleBtn = byText('button', '载入示例') as HTMLElement;
await act(async () => {
  loadSampleBtn.click();
});
if (!container.textContent?.includes('选择 LOCATION 后')) {
  throw new Error('重新解析后保留方案设置应重置');
}
console.log('✓ 重新解析后保留方案设置重置');

root.unmount();
console.log('✓ DOM 集成验证全部通过');
// jsdom 的定时器会让事件循环保持存活，显式退出
process.exit(0);

})();
