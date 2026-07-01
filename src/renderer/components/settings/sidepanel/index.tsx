import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Archive,
  BookMarked,
  Cable,
  Camera,
  ChevronLeft,
  Info,
  ShieldCheck,
  Terminal,
  Bot,
  Wrench,
} from 'lucide-react';
import { ScrollArea } from '@/shadcn/scroll-area';
import NavItem from './NavItem';
import { APP_NAME, BRAND_CONFIG } from '@shared/constants/branding';
import { useFeatureFlag } from '../../../lib/featureFlags';
import { LeftNavSizeAtom } from '@renderer/states/left-nav.atom';
import { BACKDROP } from './backdrop';

interface SettingsNavigationProps {
  onBack?: () => void;
}

const SettingsSidepanel: React.FC<SettingsNavigationProps> = ({ onBack }) => {
  const location = useLocation();
  const navigate = useNavigate();


  // Sub-Agent feature controlled by feature flag
  const subAgentEnabled = useFeatureFlag('deskmateFeatureSubAgent');

  const screenshotEnabled = useFeatureFlag('deskmateFeatureScreenshot');

  const { width } = LeftNavSizeAtom.useData();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      // Default: navigate back to agent page
      navigate('/agent');
    }
  };

  const getActiveView = () => {
    const path = location.pathname;
    if (path.includes('/settings/runtime')) return 'runtime';
    if (path.includes('/settings/mcp')) return 'mcp';
    if (path.includes('/settings/tools')) return 'tools';
    if (path.includes('/settings/skills')) return 'skills';
    if (path.includes('/settings/sub-agents')) return 'sub-agents';
    if (path.includes('/settings/screenshot')) return 'screenshot';
    if (path.includes('/settings/about')) return 'about';
    if (path.includes('/settings/provider')) return 'provider';
    if (path.includes('/settings/archived-agents')) return 'archived-agents';
    return 'mcp'; // Default: show mcp
  };

  const activeView = getActiveView();

  return (
    <nav
      className="flex flex-col h-full w-full px-2 relative"
      role="navigation"
      aria-label="Settings navigation"
      data-dbg="settings-sidepanel"
      style={{ width }}
    >
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 -z-10 h-100 w-full flex justify-center items-end">
        {BACKDROP}
      </div>
      <div className="flex items-center h-11 pl-1.5 mt-0.5 mb-1 shrink-0 border-b border-black/5">
        <h2 className="flex-1 text-base font-semibold text-black/80 m-0">
          Settings
        </h2>
      </div>

      <ScrollArea type="scroll" className="flex-1 min-h-0">
        <div className="flex flex-col gap-1 text-sm">
        <NavItem
          icon={<Wrench size={16} />}
          label="Tools"
          isActive={activeView === 'tools'}
          onClick={() => navigate('/settings/tools')}
          ariaLabel="Local Tools"
        />

        <NavItem
          icon={<Cable size={16} />}
          label="MCP"
          isActive={activeView === 'mcp'}
          onClick={() => navigate('/settings/mcp')}
          ariaLabel="External MCP Servers"
        />

        <NavItem
          icon={<ShieldCheck size={16} />}
          label="Provider"
          isActive={activeView === 'provider'}
          onClick={() => navigate('/settings/provider')}
          ariaLabel="AI Provider Accounts"
        />

        <NavItem
          icon={<BookMarked size={16} />}
          label="Skills"
          isActive={activeView === 'skills'}
          onClick={() => navigate('/settings/skills')}
          ariaLabel="Skills Management"
        />

        {subAgentEnabled && (
          <NavItem
            icon={<Bot size={16} />}
            label="Sub-Agents"
            isActive={activeView === 'sub-agents'}
            onClick={() => navigate('/settings/sub-agents')}
            ariaLabel="Sub-Agent Management"
          />
        )}

        <NavItem
          icon={<Terminal size={16} />}
          label="Runtime"
          isActive={activeView === 'runtime'}
          onClick={() => navigate('/settings/runtime')}
          ariaLabel="Runtime Environment"
        />



        {screenshotEnabled && (
          <NavItem
            icon={<Camera size={18} />}
            label="Screenshot"
            isActive={activeView === 'screenshot'}
            onClick={() => navigate('/settings/screenshot')}
            ariaLabel="Screenshot Settings"
          />
        )}

        <NavItem
          icon={<Archive size={16} />}
          label="Archived Agents"
          isActive={activeView === 'archived-agents'}
          onClick={() => navigate('/settings/archived-agents')}
          ariaLabel="Archived Agents"
        />

        <NavItem
          icon={<Info size={16} />}
          label={`About ${BRAND_CONFIG.productName || APP_NAME}`}
          isActive={activeView === 'about'}
          onClick={() => navigate('/settings/about')}
          ariaLabel={`About ${BRAND_CONFIG.productName || APP_NAME}`}
        />
        </div>
      </ScrollArea>

      <div className="py-2 border-t border-black/5">
        <NavItem
          icon={<ChevronLeft size={16} />}
          label="Go back to agent"
          isActive={false}
          onClick={handleBack}
          ariaLabel="Go back to agent"
        />
      </div>
    </nav>
  );
};

export default SettingsSidepanel;