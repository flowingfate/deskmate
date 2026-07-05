import { RightPaneSizeAtom } from '@renderer/states/right-pane.atom';
import { cn } from '@/lib/utilities/utils';

interface RightResizableDividerProps {
  className?: string;
}

const RightResizableDivider: React.FC<RightResizableDividerProps> = ({ className = '' }) => {
  const [{ resizing }, { startResize }] = RightPaneSizeAtom.use();
  return (
    <div
      className={cn(
        'group w-1 rounded-sm overflow-hidden cursor-col-resize relative shrink-0 select-none bg-transparent hover:bg-black/30',
        resizing && 'bg-black/30',
        className,
      )}
      onMouseDown={startResize}
    >
      <div
        className={cn(
          'absolute inset-0 bg-transparent transition-all duration-200 group-hover:bg-black/50',
          resizing && 'bg-black/50',
        )}
      />
    </div>
  );
};

export default RightResizableDivider;
