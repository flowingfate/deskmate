import { LeftNavSizeAtom } from '@renderer/states/left-nav.atom';
import { cn } from '@/lib/utilities/utils';

interface ResizableDividerProps {
  className?: string;
}

const ResizableDivider: React.FC<ResizableDividerProps> = ({ className = '' }) => {
  const [{ resizing }, { startResize }] = LeftNavSizeAtom.use();
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

export default ResizableDivider;