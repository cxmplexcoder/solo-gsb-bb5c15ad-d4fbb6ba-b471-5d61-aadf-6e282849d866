import { JSDOM } from 'jsdom';

;(async () => {
// 临时 DOM 集成验证：挂载 App，切换到“变更影响”页签，验证空状态 / 停用例外后的差异行 / 点击联动。
// 注意：必须先装好 jsdom 全局环境，再动态加载 React——react-dom 在模块初始化时
// 依据 canUseDOM 判定 isInputEventSupported，否则文本/数字输入的 onChange 不响应 input 事件。

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

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react-dom/test-utils');
const { default: App } = await import('../src/App');

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

// 9) 冲突保留方案：选 LOCATION → 出方案；全设必留 → 无解；取消 → 恢复；点击行联动定位
const keepTab = byText('.tabs button', '冲突保留方案') as HTMLElement;
if (!keepTab) throw new Error('冲突保留方案 页签未渲染');
await act(async () => {
  keepTab.click();
});
if (!container.textContent?.includes('选择 LOCATION 后')) {
  throw new Error('未选 LOCATION 时应显示空状态');
}
console.log('✓ 冲突保留方案页签空状态');

const keepSelect = container.querySelector('.free-controls select') as HTMLSelectElement;
if (!keepSelect) throw new Error('找不到 LOCATION 下拉');
const setSelectValue = (el: HTMLSelectElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    (dom.window as any).HTMLSelectElement.prototype,
    'value'
  )!.set!;
  setter.call(el, value);
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};
await act(async () => {
  setSelectValue(keepSelect, '会议室 A');
});
if (!container.textContent?.includes('总权重')) throw new Error('应显示总权重横幅');
if (!container.textContent?.includes('参与实例设置')) throw new Error('应显示参与实例设置表');
const keptRows = container.querySelectorAll('.keep-row.kept');
const discardedRows = container.querySelectorAll('.keep-row.discarded');
if (keptRows.length === 0 || discardedRows.length === 0) {
  throw new Error('会议室 A 应同时存在保留与舍弃实例（示例含同地点冲突）');
}
console.log(`✓ 保留方案已计算：保留 ${keptRows.length} / 舍弃 ${discardedRows.length}`);

// 修改权重（第一个参与实例设为 7）→ 总权重相应增加
const totalWeightOf = (): number => {
  const el = container.querySelector('.keep-banner .keep-total');
  return el ? Number(el.textContent) : Number.NaN;
};
const w0 = totalWeightOf();
const weightInput = container.querySelector('.keep-weight-input') as HTMLInputElement;
if (!weightInput) throw new Error('找不到权重输入框');
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(
    (dom.window as any).HTMLInputElement.prototype,
    'value'
  )!.set!;
  setter.call(weightInput, '7');
  weightInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});
if (totalWeightOf() !== w0 + 6) {
  throw new Error(`权重 1→7 应使总权重 +6（前 ${w0} 后 ${totalWeightOf()}）`);
}
console.log('✓ 权重编辑实时重算（总权重 +6）');

// 全部设为必留 → 必留项互相重叠 → 无解
const mustCbs = () =>
  [...container.querySelectorAll('.keep-table input[type="checkbox"]')] as HTMLInputElement[];
const mustTotal = mustCbs().length;
if (mustTotal === 0) throw new Error('参与实例设置表应有必留勾选框');
for (let i = 0; i < mustTotal; i++) {
  await act(async () => {
    mustCbs()[i].click();
  });
}
if (!container.textContent?.includes('必留项互相重叠，无解')) {
  throw new Error('全部必留（含重叠实例）应判定无解');
}
if (container.querySelectorAll('.keep-pair').length === 0) {
  throw new Error('无解时应列出必留冲突对');
}
if (container.querySelector('.keep-banner')) {
  throw new Error('无解时不应输出方案横幅');
}
console.log(`✓ 必留项互相重叠：列出 ${container.querySelectorAll('.keep-pair').length} 对冲突，未输出方案`);

// 取消全部必留 → 恢复有解
for (let i = 0; i < mustTotal; i++) {
  await act(async () => {
    mustCbs()[i].click();
  });
}
if (!container.textContent?.includes('总权重')) throw new Error('取消必留后应恢复方案输出');
console.log('✓ 取消必留后立即重算恢复方案');

// 点击保留行 → 行选中并联动源码定位（停留在本页签）
await act(async () => {
  (container.querySelector('.keep-row.kept') as HTMLElement).click();
});
if (!container.querySelector('.keep-row.selected')) {
  throw new Error('点击保留行后应高亮选中');
}
if (!keepTab.classList.contains('active')) {
  throw new Error('点击保留行应停留在冲突保留方案页签');
}
console.log('✓ 点击保留行联动源码定位（不切换页签）');

root.unmount();
console.log('✓ DOM 集成验证全部通过');
// jsdom 的定时器会让事件循环保持存活，显式退出
process.exit(0);

})();
