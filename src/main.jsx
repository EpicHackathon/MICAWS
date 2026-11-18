import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import SavedWorkspace from './components/SavedWorkspace.jsx';
import './styles.css';
createRoot(document.getElementById('root')).render(window.location.pathname === '/workspace' ? <SavedWorkspace /> : <App />);
import './workspace.css';
