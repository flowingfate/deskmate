import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom';
import { Settings, BookMarked, Loader2, Zap, Hand, Ban } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Badge } from '@/shadcn/badge';
import { ScrollArea } from '@/shadcn/scroll-area';
import { cn } from '@/lib/utilities/utils';

import { TabComponentProps } from './types';
import { useSkills } from '../../userData/userDataProvider';
import ListSearchBox from '../../ui/ListSearchBox';
import type { SkillTier, SkillBindings } from '@shared/types/profileTypes';

/**
 * AgentSkillsTab - Agent Skills 三档配置
 *
 * 每个 skill 有三种启用档位（互斥），真值是 `agent.skills`（`SkillBindings` 映射）：
 *  - `live`：元数据始终合并进 system prompt。map 值 `'live'`。
 *  - `lazy`：默认不进 system prompt；用户在输入框用 `[@skill://<name>]` 显式引用后，模型可按提示读取。
 *  - `off`：不在 map 中，LLM 无法通过 `skill://` 读取或执行。
 *
 * 布局风格与 AgentMcpServersTab / AgentToolsTab 对齐。
 */

type DisplayTier = SkillTier | 'off';

interface TierOption {
  tier: DisplayTier;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  activeClass: string;
}

const TIER_OPTIONS: TierOption[] = [
  { tier: 'live', label: 'Live', icon: Zap, activeClass: 'bg-sc-primary text-sc-primary-foreground' },
  { tier: 'lazy', label: 'Lazy', icon: Hand, activeClass: 'bg-amber-500 text-white' },
  { tier: 'off', label: 'Off', icon: Ban, activeClass: 'bg-sc-muted-foreground/80 text-sc-background' },
];

/** SkillBindings 映射 → 每个已装 skill 的显示档位（不在 map 中 ⇒ off）。 */
function deriveTierMap(
  skillNames: string[],
  bindings: SkillBindings | undefined,
): Map<string, DisplayTier> {
  const map = new Map<string, DisplayTier>();
  for (const name of skillNames) {
    map.set(name, bindings?.[name] ?? 'off');
  }
  return map;
}

/** 显示档位 Map → SkillBindings 映射（仅 live/lazy 入 map，off 剔除）。 */
function tierMapToBindings(map: Map<string, DisplayTier>): SkillBindings {
  const bindings: SkillBindings = {};
  for (const [name, tier] of map) {
    if (tier === 'live' || tier === 'lazy') bindings[name] = tier;
  }
  return bindings;
}

const AgentSkillsTab: React.FC<TabComponentProps> = ({
  agentData,
  onDataChange,
  cachedData,
  readOnly = false,
}) => {
  const { skills: globalSkills, isLoading } = useSkills();
  const navigate = useNavigate();

  const skillNames = useMemo(() => (globalSkills ?? []).map((s) => s.name), [globalSkills]);

  // 每个 skill 的当前显示档位（含 off）。
  const [tierMap, setTierMap] = useState<Map<string, DisplayTier>>(new Map());
  const [initialTierMap, setInitialTierMap] = useState<Map<string, DisplayTier>>(new Map());
  const [isInitialized, setIsInitialized] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // hydrate：base 来自 agentData（真值 SkillBindings），cachedData（tab 编辑缓存）优先。
  useEffect(() => {
    if (!agentData?.id || skillNames.length === 0) return;

    const base = deriveTierMap(skillNames, agentData.skills);
    const current = cachedData?.skills !== undefined
      ? deriveTierMap(skillNames, cachedData.skills)
      : base;

    setTierMap(current);
    if (!isInitialized) {
      setInitialTierMap(base);
      setIsInitialized(true);
    }
  }, [agentData?.id, agentData?.skills, cachedData?.skills, skillNames, isInitialized]);

  const hasChanges = useMemo(() => {
    if (tierMap.size !== initialTierMap.size) return true;
    for (const [name, tier] of tierMap) {
      if ((initialTierMap.get(name) ?? 'off') !== tier) return true;
    }
    return false;
  }, [tierMap, initialTierMap]);

  // 变更时通知父组件（携带 SkillBindings 映射）。
  const lastNotifiedRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!isInitialized || !onDataChange) return;
    const skills = tierMapToBindings(tierMap);
    const key = JSON.stringify(skills);
    if (lastNotifiedRef.current !== key) {
      lastNotifiedRef.current = key;
      onDataChange('skills', { skills }, hasChanges);
    }
  }, [tierMap, hasChanges, isInitialized, onDataChange]);

  const handleSetTier = useCallback((skillName: string, tier: DisplayTier) => {
    if (readOnly) return;
    setTierMap((prev) => {
      const next = new Map(prev);
      next.set(skillName, tier);
      return next;
    });
  }, [readOnly]);

  // 统计：只算实际存在的 skill。
  const { liveCount, lazyCount } = useMemo(() => {
    let a = 0;
    let d = 0;
    for (const name of skillNames) {
      const tier = tierMap.get(name);
      if (tier === 'live') a += 1;
      else if (tier === 'lazy') d += 1;
    }
    return { liveCount: a, lazyCount: d };
  }, [tierMap, skillNames]);

  const totalCount = skillNames.length;

  const handleManageSkills = useCallback(() => {
    navigate('/settings/skills');
  }, [navigate]);

  const handleManageSkill = useCallback(
    (skillName: string) => {
      navigate(`/settings/skills?selected=${encodeURIComponent(skillName)}`);
    },
    [navigate],
  );

  const filteredSkills = (globalSkills ?? []).filter(
    (skill) => !searchQuery || skill.name.includes(searchQuery),
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-b border-sc-border">
        <div className="flex items-center gap-2 text-sm text-sc-foreground">
          <span className="text-sc-muted-foreground">{totalCount} skills</span>
          {liveCount > 0 && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Zap size={11} /> {liveCount} live
            </Badge>
          )}
          {lazyCount > 0 && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Hand size={11} /> {lazyCount} lazy
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleManageSkills}
          title="Manage available skills"
        >
          Manage Available Skills
        </Button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-sc-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading skills...
        </div>
      ) : globalSkills && globalSkills.length > 0 ? (
        <div className="flex flex-1 flex-col gap-2 min-h-0 p-2 pt-0">
          <ListSearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search skills..."
          />
          <ScrollArea className="min-h-0 flex-1">
            <ul className="flex flex-col gap-1.5">
              {filteredSkills.map((skill) => {
                const tier = tierMap.get(skill.name) ?? 'off';
                return (
                  <li key={skill.name}>
                    <div
                      className={cn(
                        'group flex w-full items-center gap-3 rounded-lg border border-sc-border px-2.5 py-2',
                        tier !== 'off' ? 'bg-sc-accent/40' : 'bg-transparent',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-lg',
                          tier === 'live'
                            ? 'bg-sc-primary text-sc-primary-foreground'
                            : tier === 'lazy'
                              ? 'bg-amber-500 text-white'
                              : 'bg-sc-muted text-sc-muted-foreground',
                        )}
                      >
                        <BookMarked size={15} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                          className={cn(
                            'truncate text-sm text-sc-foreground',
                            tier !== 'off' ? 'font-semibold' : 'font-medium',
                          )}
                        >
                          {skill.name}
                        </span>
                        {skill.version && (
                          <span className="text-xs text-sc-muted-foreground">v{skill.version}</span>
                        )}
                      </div>

                      {/* Tri-state segmented control */}
                      <div
                        role="radiogroup"
                        aria-label={`Enablement for ${skill.name}`}
                        className="flex shrink-0 items-center gap-0.5 rounded-md bg-sc-muted/60 p-0.5"
                      >
                        {TIER_OPTIONS.map((opt) => {
                          const Icon = opt.icon;
                          const active = tier === opt.tier;
                          return (
                            <button
                              key={opt.tier}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              disabled={readOnly}
                              title={opt.label}
                              onClick={() => handleSetTier(skill.name, opt.tier)}
                              className={cn(
                                'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                                'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sc-ring',
                                readOnly && 'cursor-default opacity-70',
                                active
                                  ? opt.activeClass
                                  : 'text-sc-muted-foreground hover:text-sc-foreground',
                              )}
                            >
                              <Icon size={12} />
                              <span className="hidden sm:inline">{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleManageSkill(skill.name);
                        }}
                        title="Manage skill"
                      >
                        <Settings size={15} strokeWidth={1.5} />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-sc-muted text-sc-muted-foreground">
            <BookMarked className="size-6" />
          </span>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-sc-foreground">No skills available to select</p>
            <p className="text-sm text-sc-muted-foreground">Add a skill first, then assign it here.</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleManageSkills}>
            Manage Available Skills
          </Button>
        </div>
      )}
    </div>
  );
};

export default AgentSkillsTab
