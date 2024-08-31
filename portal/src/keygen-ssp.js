import { useState, useEffect } from 'react';
import { userEmail, userName } from './auth';

/**
 * API client
 */
const KEYGEN_ACCOUNT_ID = process.env.KEYGEN_ACCOUNT_ID;
const KEYGEN_URL = process.env.KEYGEN_URL;
const REQUEST_EMAIL = process.env.REQUEST_EMAIL;

const client = {
  KEYGEN_ACCOUNT_ID,

  async queryAndValidateLicenseKey(key, userEmail) {
    try {
      const response = await fetch('/api/validateLicense', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, userEmail }),
      });
  
      if (!response.ok) {
        const errorData = await response.json();  // Parse the error response
        return {
          data: null,
          errors: errorData.errors || [{ title: 'Server error', detail: 'An unknown error occurred.' }],
        };
      }
  
      const data = await response.json();  // Parse the successful response
  
      if (data.fingerprint) {
        return { fingerprint: data.fingerprint };
      } else if (data.errors) {
        return {
          data: null,
          errors: data.errors,
        };
      }
    } catch (error) {
      console.error('Query and validation failed:', error.message);
      return {
        data: null,
        errors: [{ title: 'Network error', detail: 'Failed to reach the server or process the request.' }],
      };
    }
  },

  async validateLicenseKeyWithKey(key, fingerprint) {
    const res = await fetch(`${KEYGEN_URL}/v1/accounts/${KEYGEN_ACCOUNT_ID}/licenses/actions/validate-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Keygen-Version': '1.2',
      },
      body: JSON.stringify({
        meta: {
          scope: { fingerprint },
          key,
        },
      }),
    })

    const { meta, data, errors } = await res.json()

    return {
      meta,
      data,
      errors,
    }
  },

  async deactivateMachineForLicense(license, id) {
    const res = await fetch(`${KEYGEN_URL}/v1/accounts/${KEYGEN_ACCOUNT_ID}/machines/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `License ${license.attributes.key}`,
        'Accept': 'application/json',
        'Keygen-Version': '1.2',
      },
    })

    if (res.status === 204) {
      return {}
    }

    const { errors } = await res.json()

    return {
      errors,
    }
  },

  async listMachinesForLicense(license) {
    const res = await fetch(`${KEYGEN_URL}/v1/accounts/${KEYGEN_ACCOUNT_ID}/machines`, {
      method: 'GET',
      headers: {
        'Authorization': `License ${license.attributes.key}`,
        'Accept': 'application/json',
      },
    })

    const { data, errors } = await res.json()

    return {
      data,
      errors,
    }
  },
};

/**
 * State management
 */
const createEmitter = () => {
  const subscriptions = new Map();
  return {
    emit: v => subscriptions.forEach(fn => fn(v)),
    subscribe: fn => {
      const key = Symbol();
      const unsubscribe = () => subscriptions.delete(key);

      subscriptions.set(key, fn);

      return unsubscribe;
    },
  };
};

const createStore = init => {
  const emitter = createEmitter();

  let store = null;
  const get = () => store;
  const set = op => (store = op(store), emitter.emit(store));
  store = init(set, get);

  const useStore = () => {
    const [localStore, setLocalStore] = useState(get());

    useEffect(() => emitter.subscribe(setLocalStore), []);

    return localStore;
  };

  return useStore;
};

const useLicensingStore = createStore((set, get) => ({
  fingerprint: null,
  key: null,
  validation: null,
  license: null,
  machines: [],
  errors: [],

  setKey: key => set(state => ({ ...state, key })),

  validateLicenseKeyWithKey: async () => {
    const { key, listMachinesForLicense } = get();
  
    // Step 1: Query the external API to get the fingerprint
    const { fingerprint, errors } = await client.queryAndValidateLicenseKey(key, userEmail);
  
    if (errors) {
      // Check if the error is "Machine not found"
      const machineNotFoundError = errors.find(error => error.title === 'Machine not found');
  
      // If there's an error and it's not "Machine not found", return it
      if (!machineNotFoundError) {
        return set(state => ({ ...state, errors }));
      }
      
      // Log or handle the "Machine not found" error if needed
      console.warn('Machine not found error occurred, continuing...');
    }
  
    // Step 2: Update the store with the fingerprint (if available)
    if (fingerprint) {
      set(state => ({ ...state, fingerprint }));
    }
  
    // Step 3: Proceed with license validation using the fingerprint
    const { meta, data, errors: validationErrors } = await client.validateLicenseKeyWithKey(key, fingerprint);
  
    if (validationErrors) {
      return set(state => ({ ...state, errors: validationErrors }));
    }
  
    set(state => ({ ...state, validation: meta, license: data }));
  
    // List machines for the license if it exists (regardless of validity)
    if (data != null) {
      listMachinesForLicense();
    }
  },  

  deactivateMachineForLicense: async id => {
    const { license, validateLicenseKeyWithKey, listMachinesForLicense } = get();

    const { errors } = await client.deactivateMachineForLicense(license, id);
    if (errors) {
      return set(state => ({ ...state, errors }));
    }

    // Clear errors if deactivation was successful
    set(state => ({ ...state, errors: [] }));

    // Relist machines
    listMachinesForLicense();

    // Revalidate the current license
    validateLicenseKeyWithKey();
  },

  listMachinesForLicense: async () => {
    const { license } = get();

    const { data, errors } = await client.listMachinesForLicense(license);
    if (errors) {
      return set(state => ({ ...state, errors }));
    }

    set(state => ({
      ...state,
      machines: data,
    }));
  },

  clearError: error => {
    const { errors } = get();

    set(state => ({ ...state, errors: errors.filter(e => e !== error) }));
  },

  reset: () => {
    set(state => ({
      ...state,
      key: null,
      validation: null,
      license: null,
      fingerprint: null,
      machines: [],
      errors: [],
    }));
  }
}));

/**
 * Components
 */
const LicenseInfo = ({ showSeats = true }) => {
  const { license, machines, validation, reset } = useLicensingStore();
  const created = license?.attributes?.created?.split('T')?.[0];
  const expiry = license?.attributes?.expiry?.split('T')?.[0];

  const handleRenewClick = () => {
    const subject = encodeURIComponent("License Renewal Request");
    const body = encodeURIComponent(
      `Dear License Team,\n\nI would like to request the renewal of my license.\n\nSSO User Email: ${userEmail}\nLicense Key: ${license?.attributes?.key}\n\nThank you.\n\n${userName}`
    );
    const mailtoUrl = `mailto:${REQUEST_EMAIL}?subject=${subject}&body=${body}`;

    window.location.href = mailtoUrl;
  };

  return (
    <div className='demo-component'>
      <h2>
        <small>{license?.attributes?.name ?? 'License key'}</small>
        {license?.attributes?.key ?? 'N/A'}
        {validation?.valid
         ? <span className='demo-component__tag demo-component__tag--valid'>Valid</span>
         : <span className='demo-component__tag demo-component__tag--invalid'>Invalid</span>}
      </h2>
      <div className='demo-component__table'>
        <table>
          <thead>
            <tr>
              <th>Issued On</th>
              <th>Valid Until</th>
              {showSeats
                ? <th># Seats</th>
                : null}
              <th>License Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {created ?? 'N/A'}
              </td>
              <td>
                {expiry ?? 'N/A'}
              </td>
              {showSeats
                ? <td>
                    <strong>{machines.length}/{license?.attributes?.maxMachines || 0}</strong>
                  </td>
                : null}
              <td>
                {(() => {
                  switch (true) {
                    case validation?.valid:
                      return <code>{validation?.code}</code>;

                    case validation?.code === 'FINGERPRINT_SCOPE_REQUIRED':
                      return <code>FINGERPRINT_SCOPE_REQUIRED (No machines found)</code>;
                    default:
                      return (
                        <>
                          <code>{validation?.code}</code>
                          <span style={{ marginLeft: '5px' }}></span>
                          <button className='demo-component__button demo-component__button--renew-key' type='button' onClick={handleRenewClick}>
                            Renew
                          </button>
                        </>
                      );
                  }
                })()}
              </td>
              <td>
                <button className='demo-component__button demo-component__button--logout' type='button' onClick={reset}>
                  Logout
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

const DeviceActivationInput = ({ name, platform, browser, version, fingerprint, onSubmit }) => {
  return (
    <form onSubmit={e => (e.preventDefault(), onSubmit({ name, platform, browser, version }))}>
      <div className='demo-component__table'>
        <table>
          <thead>
            <tr>
              <th>Device Name</th>
              <th>Fingerprint</th>
              <th>Browser</th>
              <th>Version</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>{name}</strong>
              </td>
              <td>
                <code>{fingerprint}</code>
              </td>
              <td>
                {browser}
              </td>
              <td>
                {version}
              </td>
              <td>
                <button className='demo-component__button demo-component__button--activate' type='submit'>
                  Activate
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </form>
  );
};

const LicenseErrors = () => {
  const { errors, clearError } = useLicensingStore();

  return (
    <div className='demo-component demo-component--alert'>
      <h3>
        <small>Licensing API</small>
        An error has occurred
      </h3>
      <div className='demo-component__table'>
        <table>
          <thead>
            <tr>
              <th>Error Title</th>
              <th>Code</th>
              <th>Message</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {errors.map((error, i) =>
              <tr key={i}>
                <td>
                  {error.title}
                </td>
                <td>
                  <code>{error.code ?? 'N/A'}</code>
                </td>
                <td>
                  {error.source != null
                    ? <><code>{error.source.pointer}</code> </>
                    : null}
                  {error.detail}
                </td>
                <td>
                  <button type='button' onClick={() => clearError(error)}>
                    Clear
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const LicenseManager = () => {
  const { license, fingerprint, machines, deactivateMachineForLicense } = useLicensingStore();

  return (
    <div className='demo-component'>
      <h3>
        <small>Manage devices</small>
        Using {machines.length} of {license.attributes.maxMachines} seat(s)
      </h3>
      <p className='demo-component__info'>
        List of active devices.
      </p>
      <div className='demo-component__table'>
        <table>
          <thead>
            <tr>
              <th>#id</th>
              <th>Device Name</th>
              <th>Platform</th>
              <th>Activated On</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {machines.map(machine =>
              <tr key={machine.id}>
                <td>
                  <code>{machine.id.slice(0, 8)}</code>
                </td>
                <td>
                  {machine.attributes.name}
                  {machine.attributes.fingerprint === fingerprint
                    ? <span className='demo-component__tag demo-component__tag--small'>Current</span>
                    : null}
                </td>
                <td>
                  {Object.keys(machine.attributes.platform).length > 0
                    ? <span>
                        {machine.attributes.platform}
                      </span>
                    : null}
                </td>
                <td>
                  {machine.attributes.created.split('T')[0]}
                </td>
                <td>
                  <button className='demo-component__button demo-component__button--deactivate' type='button' onClick={() => deactivateMachineForLicense(machine.id)}>
                    Deactivate
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const LicenseKeyInput = ({ keyValue, onKeyChange, onSubmit }) => {
  return (
    <form onSubmit={e => (e.preventDefault(), onSubmit())}>
      <input
        type='text'
        placeholder='XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-V3'
        value={keyValue ?? ''}
        onChange={e => onKeyChange(e.target.value)}
        required={true}
      />
      <button type='submit'>
        Continue
      </button>
    </form>
  );
};

const LicenseValidator = () => {
  const { key, validateLicenseKeyWithKey, setKey } = useLicensingStore();
  const validateLicenseKeyAction = validateLicenseKeyWithKey;

  const handleRequestLicense = () => {
    const recipient = process.env.REQUEST_EMAIL;
    const subject = 'Request new license';
    const body = `Hi License team,\n\nI would like to request a new license.\n-- Account information --\nEmail: ${userEmail}\nUsername: ${userName}\n\n-- Personal Details --\nSurname: *\nName: *\nReason for request:\n(Text here *)\n\n\nThank you\n\n${userName}`;

    const mailtoLink = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
  };

  return (
    <><div className='demo-component'>
      <h2>
        <small>Check Activation Status</small>
      </h2>
      <p>Please enter a license key</p>
      <LicenseKeyInput
        keyValue={key}
        onKeyChange={setKey}
        onSubmit={validateLicenseKeyAction} />
      </div>
      <div className='demo-component'>
        <h2>
          <small>New Key Request</small>
        </h2>
        <button className='demo-component__button demo-component__button--new-key' type='button' onClick={handleRequestLicense}>Request License</button>
        <p>
          <small>
            <span>Note:</span><br />
            <code>As part of the request and activation process, the following mandatory information will be stored:</code><br />
            <code>Name, Surname, Email, IP, Machine Name, Machine fingerprint</code>
          </small>
        </p>
      </div>
    </>
  );
};

const LicenseActivationPortal = () => {
  const { license, validation, errors } = useLicensingStore();

  if (errors?.length) {
    return (
      <div className='demo' data-title='Activation Status'>
        <LicenseErrors />
        {errors.some(e => e.code === 'MACHINE_LIMIT_EXCEEDED')
          ? <LicenseManager />
          : null}
      </div>
    );
  }

  if (license == null && validation == null) {
    return (
      <div className='demo' data-title='Activation Status'>
        <LicenseValidator />
      </div>
    );
  }

  if (validation?.valid) {
    return (
      <div className='demo' data-title='Activation Status'>
        <LicenseInfo />
        <LicenseManager />
      </div>
    );
  }

  switch (validation?.code) {
    case 'FINGERPRINT_SCOPE_MISMATCH':
    case 'NO_MACHINES':
    case 'NO_MACHINE':
      return (
        <div className='demo' data-title='Activation Status'>
          <LicenseInfo />
        </div>
      );
    default:
      return (
        <div className='demo' data-title='Activation Status'>
          <LicenseInfo />
          <LicenseManager />
        </div>
      );
  }
};

export default LicenseActivationPortal;
