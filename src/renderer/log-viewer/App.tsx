import { TooltipProvider } from '@/shadcn/tooltip';
import { SideNav } from './components/SideNav';
import { LogsView } from './views/LogsView';
import { TracesView } from './views/TracesView';
import { PlaceholderView } from './views/PlaceholderView';
import { findView, VIEWS, type ViewId } from './views';
import { currentViewAtom, traceFocusAtom } from './states/view.atom';

const PLACEHOLDER_COPY: Record<Exclude<ViewId, 'logs' | 'traces'>, string> = {
  errors: 'Grouped error feed with frequency, latest occurrence, and one-click trace drill-down.',
  stats: 'Throughput, error rate, top components, by-level histograms.',
  saved: 'Pin frequent queries here for one-click recall across sessions.',
};

export function App() {
  const current = currentViewAtom.useData();

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full bg-white text-slate-900">
        <SideNav />
        {renderView(current)}
      </div>
    </TooltipProvider>
  );
}

function renderView(id: ViewId) {
  if (id === 'logs') return <LogsViewBridge />;
  if (id === 'traces') return <TracesViewBridge />;
  const def = findView(id);
  const Icon = def.icon;
  return (
    <PlaceholderView
      title={def.label}
      icon={Icon}
      description={PLACEHOLDER_COPY[id as Exclude<ViewId, 'logs' | 'traces'>]}
    />
  );
}

function LogsViewBridge() {
  const { openTrace } = traceFocusAtom.useChange();
  return <LogsView onOpenTrace={openTrace} />;
}

function TracesViewBridge() {
  const [traceFocus, { consume }] = traceFocusAtom.use();
  return <TracesView initialTraceId={traceFocus} onConsumeInitial={consume} />;
}
