// 冲突保留方案（仅预览，不写回日历）
// 在指定非空 LOCATION 下，取当前生效实例中的正时长实例，
// 基于 UTC 半开区间 [startUtc, endUtc) 求一个无重叠子集：
//   1. 必须包含全部“必留”实例（必留项互相重叠则无解，列出全部冲突对）；
//   2. 在此约束下最大化权重总和（权重为非负整数，默认 1）；
//   3. 同分时优先保留更多实例；
//   4. 再按 uid#recurrenceKey 标识排序，取字典序最小的保留列表。
// 已取消 / 已排除实例不参与（调用方只传入生效实例）；零时长实例不参与。

import type { Instance } from './types';
import { instanceIdentity } from './diff';

/** 单个实例的保留设置（按 uid#recurrenceKey 标识保存） */
export interface RetentionPref {
  /** 非负整数权重，默认 1 */
  weight: number;
  /** 必留标记 */
  must: boolean;
}

export const DEFAULT_RETENTION_PREF: RetentionPref = { weight: 1, must: false };

export interface RetentionItem {
  inst: Instance;
  /** 身份标识：UID#原始 recurrenceKey */
  identity: string;
  weight: number;
  must: boolean;
}

/** 一对互相重叠的必留实例 */
export interface RetentionConflictPair {
  a: RetentionItem;
  b: RetentionItem;
}

export interface RetentionPlan {
  location: string;
  /** 全部参与实例（该地点的正时长生效实例，按开始时间排序） */
  participants: RetentionItem[];
  /** 必留项之间的重叠冲突对；非空则无解，不输出方案 */
  mustConflicts: RetentionConflictPair[];
  /** 方案保留列表（按开始时间排序）；无解时为空 */
  kept: RetentionItem[];
  /** 方案舍弃列表（按开始时间排序）；无解时为空 */
  dropped: RetentionItem[];
  /** 保留列表的权重总和；无解时为 0 */
  totalWeight: number;
}

/** 权重兜底：非有限 / 负数按默认 1 处理，小数向下取整 */
function sanitizeWeight(w: number | undefined): number {
  if (w === undefined || !Number.isFinite(w) || w < 0) return DEFAULT_RETENTION_PREF.weight;
  return Math.floor(w);
}

/** 半开区间重叠：相切（一端终点 = 另一端起点）不算重叠 */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function cmpIdentity(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpItem(a: RetentionItem, b: RetentionItem): number {
  return (
    a.inst.startUtc - b.inst.startUtc ||
    a.inst.endUtc - b.inst.endUtc ||
    cmpIdentity(a.identity, b.identity)
  );
}

interface Interval {
  item: RetentionItem;
  start: number;
  end: number;
}

/** 一个可行方案：先比必留数，再比权重总和，再比实例数，最后比标识列表字典序 */
interface Solution {
  must: number;
  weight: number;
  count: number;
  /** 已排序的标识列表 */
  ids: string[];
  /** 选中的区间下标（按选择顺序） */
  picks: number[];
}

const EMPTY_SOLUTION: Solution = { must: 0, weight: 0, count: 0, ids: [], picks: [] };

/** a 严格优于 b 时返回 true */
function better(a: Solution, b: Solution): boolean {
  if (a.must !== b.must) return a.must > b.must;
  if (a.weight !== b.weight) return a.weight > b.weight;
  if (a.count !== b.count) return a.count > b.count;
  const n = Math.min(a.ids.length, b.ids.length);
  for (let i = 0; i < n; i++) {
    if (a.ids[i] !== b.ids[i]) return a.ids[i] < b.ids[i];
  }
  return a.ids.length < b.ids.length;
}

/** 方案 + 一个区间 → 新方案（标识列表保持有序） */
function extend(sol: Solution, iv: Interval, index: number): Solution {
  const ids = [...sol.ids];
  const at = ids.findIndex((id) => id > iv.item.identity);
  ids.splice(at === -1 ? ids.length : at, 0, iv.item.identity);
  return {
    must: sol.must + (iv.item.must ? 1 : 0),
    weight: sol.weight + iv.item.weight,
    count: sol.count + 1,
    ids,
    picks: [...sol.picks, index],
  };
}

/**
 * 计算指定 LOCATION 的冲突保留方案。
 * @param instances 当前范围内的生效实例（不含已取消 / 已排除）
 * @param location  非空 LOCATION（trim 后精确匹配）
 * @param prefs     按 uid#recurrenceKey 标识保存的权重 / 必留设置；缺省用默认值
 */
export function computeRetentionPlan(
  instances: Instance[],
  location: string,
  prefs: Readonly<Record<string, RetentionPref | undefined>>
): RetentionPlan {
  const loc = location.trim();
  const participants: RetentionItem[] = [];
  for (const inst of instances) {
    if (inst.location.trim() !== loc) continue;
    // 零时长 / 负时长实例不参与
    if (inst.endUtc <= inst.startUtc) continue;
    const identity = instanceIdentity(inst);
    const pref = prefs[identity];
    participants.push({
      inst,
      identity,
      weight: sanitizeWeight(pref?.weight),
      must: pref?.must ?? false,
    });
  }
  participants.sort(cmpItem);

  // 必留项两两检查：存在重叠即无解，列出全部冲突对
  const musts = participants.filter((p) => p.must);
  const mustConflicts: RetentionConflictPair[] = [];
  for (let i = 0; i < musts.length; i++) {
    for (let j = i + 1; j < musts.length; j++) {
      const a = musts[i];
      const b = musts[j];
      if (overlaps(a.inst.startUtc, a.inst.endUtc, b.inst.startUtc, b.inst.endUtc)) {
        mustConflicts.push({ a, b });
      }
    }
  }
  mustConflicts.sort(
    (x, y) => cmpIdentity(x.a.identity, y.a.identity) || cmpIdentity(x.b.identity, y.b.identity)
  );
  if (mustConflicts.length > 0) {
    return { location: loc, participants, mustConflicts, kept: [], dropped: [], totalWeight: 0 };
  }

  // 与任一必留项重叠的非必留实例永远不可选，直接剔除；
  // 之后在必留项全部入选的约束下做带权区间调度（必留数进入目标元组，保证全部选中）。
  const candidates = participants.filter(
    (p) =>
      p.must ||
      !musts.some((m) =>
        overlaps(p.inst.startUtc, p.inst.endUtc, m.inst.startUtc, m.inst.endUtc)
      )
  );
  const intervals: Interval[] = candidates
    .map((item) => ({ item, start: item.inst.startUtc, end: item.inst.endUtc }))
    .sort((a, b) => a.end - b.end || a.start - b.start || cmpIdentity(a.item.identity, b.item.identity));

  const n = intervals.length;
  // prev[i]：与区间 i 不重叠的最右区间下标（终点 <= 区间 i 起点，半开区间相切兼容），无则 -1
  const prev: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = i - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (intervals[mid].end <= intervals[i].start) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    prev[i] = ans;
  }

  // dp[i]：只考虑前 i 个区间（按终点排序）时的最优方案
  const dp: Solution[] = [EMPTY_SOLUTION];
  for (let i = 1; i <= n; i++) {
    const skip = dp[i - 1];
    const take = extend(dp[prev[i - 1] + 1], intervals[i - 1], i - 1);
    dp.push(better(take, skip) ? take : skip);
  }

  const keptSet = new Set(dp[n].picks.map((i) => intervals[i].item.identity));
  const kept = participants.filter((p) => keptSet.has(p.identity));
  const dropped = participants.filter((p) => !keptSet.has(p.identity));
  const totalWeight = kept.reduce((sum, p) => sum + p.weight, 0);

  return { location: loc, participants, mustConflicts, kept, dropped, totalWeight };
}
