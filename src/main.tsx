import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/michroma';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
