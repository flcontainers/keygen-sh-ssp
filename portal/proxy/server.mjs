//const express = require ('express');
//const cors = require('cors');
//const dotenv = require('dotenv');
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = 3001;

const allowedDomain = process.env.DOMAIN;
const KEYGEN_URL = process.env.KEYGEN_URL;
const KEYGEN_ACCOUNT_ID = process.env.KEYGEN_ACCOUNT_ID;
const KEYGEN_TOKEN = process.env.KEYGEN_TOKEN;


// Custom middleware to enforce origin checks
const enforceOriginCheck = (req, res, next) => {
  const origin = req.headers.origin;

  if (origin) {
      // Extract the protocol from the request
      const protocol = req.protocol + '://';

      // Construct the allowed origin with the protocol
      const allowedOrigin = protocol + allowedDomain;

      if (origin === allowedOrigin) {
          // Allow the request if the origin matches
          next();
      } else {
          // Block the request if the origin doesn't match
          res.status(403).send('Not allowed');
      }
  } else {
      // Optionally handle requests with no origin header (like curl or Postman)
      res.status(403).send('Not allowed');
  }
};

// Apply the CORS middleware with dynamic origin checking
app.use(cors({
  origin: (origin, callback) => {
      if (origin) {
          const protocol = origin.startsWith('https') ? 'https://' : 'http://';
          const allowedOrigin = protocol + allowedDomain;

          if (origin === allowedOrigin) {
              callback(null, true);
          } else {
              // In production, avoid detailed error messages
              if (app.get('env') === 'production') {
                  callback(null, false); // Just deny the request without an error
              } else {
                  callback(new Error('Not allowed')); // Detailed error for non-production environments
              }
          }
      } else {
          // Allow requests without an origin header (for tools like curl)
          callback(null, true);
      }
  },
  optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
}));

app.use(express.json());
app.use(enforceOriginCheck);

// Error-handling middleware to avoid exposing errors in production
app.use((err, req, res, next) => {
  if (app.get('env') === 'production') {
      res.status(500).send('Server error'); // Generic error message in production
  } else {
      res.status(500).send(err.message); // Detailed error message in development
  }
});

app.post('/validateLicense', (req, res) => {
  const { key, userEmail } = req.body;

  fetch(`${KEYGEN_URL}/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses?user=${userEmail}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${KEYGEN_TOKEN}`,
      'Accept': 'application/vnd.api+json',
    },
  })
    .then(resLicenses => {
      if (!resLicenses.ok) {
        res.status(404).json({
          errors: [{ title: 'License check error', detail: 'There was an issue checking the machine id.' }],
        });
        return null; // Break the chain
      }
      return resLicenses.json();
    })
    .then(licensesResponse => {
      if (!licensesResponse) return; // Exit if chain is broken
      const { data: licensesData, errors: licensesErrors } = licensesResponse;

      if (licensesErrors) {
        res.json({ errors: licensesErrors });
        return null; // Break the chain
      }

      const matchingLicense = licensesData.find(license => license.attributes.key === key);

      if (!matchingLicense) {
        res.json({
          errors: [{ title: 'License not found', detail: 'The provided license key does not belong to the current user or does not exist.' }],
        });
        return null; // Break the chain
      }

      return fetch(`${KEYGEN_URL}/v1/accounts/${KEYGEN_ACCOUNT_ID}/machines?key=${key}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${KEYGEN_TOKEN}`,
          'Accept': 'application/vnd.api+json',
        },
      });
    })
    .then(machineResponse => {
      if (!machineResponse) return; // Exit if chain is broken

      if (!machineResponse.ok) {
        res.json({
          errors: [{ title: 'License check error', detail: 'There was an issue checking the machine id.' }],
        });
        return null; // Break the chain
      }
      return machineResponse.json();
    })
    .then(machinesResponse => {
      if (!machinesResponse) return; // Exit if chain is broken
      const { data: machinesData, errors: machinesErrors } = machinesResponse;

      if (machinesErrors) {
        res.json({ errors: machinesErrors });
        return null; // Break the chain
      }

      if (machinesData.length === 0) {
        res.json({
          errors: [{ title: 'Machine not found', detail: 'No machines found associated with the provided license key.' }],
        });
        return null; // Break the chain
      }

      // Extract the fingerprint from the first matching machine
      const { attributes: { fingerprint } } = machinesData[0];

      res.json({ fingerprint });
    })
    .catch(error => {
      // Handle any unexpected errors in the entire chain
      res.status(500).json({
        errors: [{ title: 'Server Error', detail: error.message }],
      });
    });
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});