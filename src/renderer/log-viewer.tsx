import { createRoot } from 'react-dom/client';

import './log-viewer/styles.css';
import { App } from './log-viewer/App';
import { WithStore } from '@/atom';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <WithStore>
      <App />
    </WithStore>
  );
}
