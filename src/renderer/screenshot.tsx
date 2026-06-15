import { createRoot } from 'react-dom/client';

// Import styles
import './styles/globals.css';


// Import the main screenshot component
import { App } from './screenshot/index';
import { log } from '@/log';
import { installGlobalErrorHandlers } from '@/log/installGlobalHandlers';
const logger = log.child({ mod: 'Screenshot' });

installGlobalErrorHandlers();

// Render the app
const container = document.getElementById('root');
if (container) {
  logger.debug({ msg: "📸 [SCREENSHOT] Root element found, creating React root" });
  const root = createRoot(container);
  root.render(<App />);
} else {
  logger.error({ msg: "📸 [SCREENSHOT] Failed to find root element" });
}
