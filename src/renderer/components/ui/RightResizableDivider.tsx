import { RightPaneSizeAtom } from '@renderer/states/right-pane.atom';

interface RightResizableDividerProps {
  className?: string;
}

const RightResizableDivider: React.FC<RightResizableDividerProps> = ({ className = '' }) => {
  const [{ resizing }, { startResize }] = RightPaneSizeAtom.use();
  return (
    <div
      className={`resizable-divider ${className} ${resizing ? 'dragging' : ''}`}
      onMouseDown={startResize}
    >
      <div className="divider-handle" />
    </div>
  );
};

export default RightResizableDivider;
