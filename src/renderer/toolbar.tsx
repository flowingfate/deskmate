import React from 'react';
import { createRoot } from 'react-dom/client';

// Import styles
import './styles/globals.css';
import './styles/ToolBar.scss';

// Import main components
import { ToolBarPage } from './pages/ToolBarPage';


const App: React.FC = () => {
  return <ToolBarPage />;
};

// Render the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
} else {
}