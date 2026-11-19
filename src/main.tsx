import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import SavedWorkspace from './components/SavedWorkspace.tsx';
import './styles.css';
import './workspace.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  window.location.pathname === '/workspace'
    ? <SavedWorkspace />
    : <App />
);
