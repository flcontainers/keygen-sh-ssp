import React from 'react';
import { createRoot } from 'react-dom/client';
import LicenseActivationPortal from './keygen-ssp';
import { checkSSOAuthentication } from './auth';
import './index.css';

const root = createRoot(document.getElementById('app-root'));

checkSSOAuthentication().then((isAuthenticated) => {
  if (isAuthenticated) {
    if (root != null) {
      root.render(<LicenseActivationPortal />);
    }
  } else {
    if (root != null) {
      root.render(<p>SSO Authenticated Failed</p>);
    }
  }
});