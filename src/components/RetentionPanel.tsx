import { useMemo } from 'react';
import type { Instance } from '../ical-engine/types';
import {
  computeRetentionPlan,
  type RetentionItem,
  type RetentionPref,
} from '../ical-engine/retention';
import { collectLocations } from '../ical-engine/free-windows';
import { instanceId } from '../ical-engine/conflicts';
import { formatWall } from '../utils/format';

interface RetentionPanelProps {
  instances: Instance[];
  /** 当前选中的 LOCATION（空串表示未选择） */
  location: string;
  onLocationChange: (loc: string) => void;
  /** 按 uid#recurrenceKey 标识保存的权重 / 必留设置 */
  prefs: Record<string, RetentionPref>;
  onPrefChange: (identity: string, patch: Partial<RetentionPref>) => void;
  onResetPrefs: () => void;
  selectedKey: string | null;
  onSelect: (inst: Instance) => void;
}

export function RetentionPanel({
  instances,
  location,
  onLocationChange,
  prefs,
  onPrefChange,
  onResetPrefs,
  selectedKey,
  onSelect,
}: RetentionPanelProps) {
  const locations = useMemo(() => collectLocations(instances), [instances]);

  // 范围 / 规则 / 例外状态变化 → instances 更新 → 方案立即重算；
  // 权重与必留设置按 uid#recurrenceKey 标识保留，已消失的实例不参与。
  const plan = useMemo(
    () => (location ? computeRetentionPlan(instances, location, prefs) : null),
    [instances, location, prefs]
  );

  // 该地点下不参与计算的零时长实例数（仅提示）
  const skippedZero = useMemo(() => {
    if (!location) return 0;
    const loc = location.trim();
    return instances.filter(
      (i) => i.location.trim() === loc && i.endUtc <= i.startUtc
    ).length;
  }, [instances, location]);

  const noSolution = !!plan && plan.mustConflicts.length > 0;

  const keptSet = useMemo(
    () => new Set((plan && !noSolution ? plan.kept : []).map((k) => k.identity)),
    [plan, noSolution]
  );

  return (
    <>
      <div className="filter-bar free-controls">
        <label>
          LOCATION
          <select value={location} onChange={(e) => onLocationChange(e.target.value)}>
            <option value="">请选择…</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
            {location && !locations.includes(location) && (
              <option value={location}>{location}（当前范围无实例）</option>
            )}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        {plan && !noSolution && (
          <span className="clock">
            保留 <b style={{ color: 'var(--ok)' }}>{plan.kept.length}</b> · 舍弃{' '}
            <b style={{ color: 'var(--excluded)' }}>{plan.dropped.length}</b> · 总权重{' '}
            <b style={{ color: 'var(--text)' }}>{plan.totalWeight}</b>
          </span>
        )}
        <button
          className="ghost"
          onClick={onResetPrefs}
          disabled={Object.keys(prefs).length === 0}
          title="清除全部权重与必留设置（恢复默认权重 1、非必留）"
        >
          重置设置
        </button>
      </div>

      {!location ? (
        <div className="empty-hint diff-empty">
          <div style={{ fontSize: 28, marginBottom: 6 }}>⚖️</div>
          选择 LOCATION 后，为该地点当前范围内的正时长生效实例设置权重与必留，
          计算无重叠且权重总和最大的保留方案
          <div className="clock" style={{ marginTop: 4 }}>
            仅预览，不写回日历；已取消 / 已排除 / 零时长实例不参与
          </div>
        </div>
      ) : plan ? (
        <>
          {noSolution && (
            <div className="free-msg error">
              <div>
                ✕ 必留实例互相重叠，无解——请调整必留标记。冲突对（
                {plan.mustConflicts.length}）：
              </div>
              <ul className="ret-pairs">
                {plan.mustConflicts.map((pair, idx) => (
                  <li key={idx}>
                    <InstanceLink item={pair.a} onSelect={onSelect} />
                    <span className="clock"> ↔ </span>
                    <InstanceLink item={pair.b} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {skippedZero > 0 && (
            <div className="free-msg warn">⚠ {skippedZero} 个零时长实例不参与保留方案</div>
          )}
          {plan.participants.length === 0 ? (
            <div className="empty-hint">该地点在当前范围内没有正时长的生效实例</div>
          ) : (
            <table className="instance-table ret-table">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>开始（声明时区墙钟）</th>
                  <th>事件</th>
                  <th style={{ width: 76 }}>权重</th>
                  <th style={{ width: 48 }}>必留</th>
                  <th style={{ width: 64 }}>方案</th>
                </tr>
              </thead>
              <tbody>
                {plan.participants.map((item) => (
                  <RetentionRow
                    key={item.identity}
                    item={item}
                    noSolution={noSolution}
                    kept={keptSet.has(item.identity)}
                    selected={selectedKey === instanceId(item.inst)}
                    onPrefChange={onPrefChange}
                    onSelect={onSelect}
                  />
                ))}
              </tbody>
            </table>
          )}
          <div className="ret-footer clock">
            方案目标：包含全部必留项的无重叠子集中权重总和最大；同分保留更多实例，
            再按 UID#recurrenceKey 标识取字典序最小列表。仅预览，不修改日历。
          </div>
        </>
      ) : null}
    </>
  );
}

function RetentionRow({
  item,
  noSolution,
  kept,
  selected,
  onPrefChange,
  onSelect,
}: {
  item: RetentionItem;
  noSolution: boolean;
  kept: boolean;
  selected: boolean;
  onPrefChange: (identity: string, patch: Partial<RetentionPref>) => void;
  onSelect: (inst: Instance) => void;
}) {
  const { inst, identity } = item;
  return (
    <tr
      className={[
        'instance-row',
        'ret-row',
        noSolution ? '' : kept ? 'ret-kept' : 'ret-dropped',
        selected ? 'selected' : '',
      ].join(' ')}
      onClick={() => onSelect(inst)}
      title="点击定位 ICS 源码"
    >
      <td className="cell-time">
        {formatWall(inst.startUtc, inst.tzid, inst.isAllDay)}
        {!inst.isAllDay && (
          <>
            <br />
            <span className="clock">至 {formatWall(inst.endUtc, inst.tzid, false)}</span>
          </>
        )}
      </td>
      <td>
        {inst.summary || <em style={{ color: 'var(--excluded)' }}>（无标题）</em>}
        {item.must && (
          <span className="tag range" style={{ marginLeft: 6 }} title="必留：方案必须包含该实例">
            必留
          </span>
        )}
        <br />
        <span className="clock ret-identity">{identity}</span>
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <input
          type="number"
          className="ret-weight"
          min={0}
          step={1}
          value={item.weight}
          title="非负整数权重，默认 1"
          onChange={(e) => {
            const n = Number(e.target.value);
            const weight = !Number.isFinite(n) || n < 0 ? 0 : Math.floor(n);
            onPrefChange(identity, { weight });
          }}
        />
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={item.must}
          title="必留：方案必须包含该实例；必留项互相重叠则无解"
          onChange={(e) => onPrefChange(identity, { must: e.target.checked })}
        />
      </td>
      <td>
        {noSolution ? (
          <span className="clock">—</span>
        ) : kept ? (
          <span className="ret-badge keep">保留</span>
        ) : (
          <span className="ret-badge drop">舍弃</span>
        )}
      </td>
    </tr>
  );
}

function InstanceLink({
  item,
  onSelect,
}: {
  item: RetentionItem;
  onSelect: (inst: Instance) => void;
}) {
  return (
    <a
      style={{ color: 'var(--conflict)', cursor: 'pointer' }}
      title={`${formatWall(item.inst.startUtc, item.inst.tzid, item.inst.isAllDay)} · 点击定位源码`}
      onClick={() => onSelect(item.inst)}
    >
      {item.inst.summary || '（无标题）'}
    </a>
  );
}
