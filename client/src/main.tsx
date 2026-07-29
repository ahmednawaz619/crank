import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Crank } from '@ahmednawaz/crank/react';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crank />
    <App />
  </StrictMode>
);
