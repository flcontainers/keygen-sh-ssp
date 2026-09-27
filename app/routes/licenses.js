const express = require('express');
const router = express.Router();
const { logAdminAction } = require('../utils/logger');
const cache = require('../utils/cache');
const { keygen, fetchAllPages } = require('../utils/keygen');
const { getRoles, isAdmin } = require('../utils/auth');

// TTLs are a safety net for data changed outside this app (e.g. directly in Keygen);
// writes made through this app patch the affected cache entries directly instead of
// waiting for expiry, so these can be generous without serving stale data on the hot path.
const LICENSES_TTL_MS = 5 * 60 * 1000;
const USERS_TTL_MS = 5 * 60 * 1000;
const GROUPS_TTL_MS = 30 * 60 * 1000;
const POLICIES_TTL_MS = 30 * 60 * 1000;
// Machine state can also change from outside this app (a client SDK activating/checking in
// a machine directly against Keygen), which we have no write-side hook for - keep this one short.
const MACHINES_TTL_MS = 30 * 1000;
// Admin-only lists keep serving their last value for this long after expiry while a
// background refresh runs, so the admin dashboard doesn't block on a full Keygen crawl
// every time a TTL lapses. Not used for per-user licenses: those back access checks.
const ADMIN_LIST_STALE_MS = 30 * 60 * 1000;

function toLicense(license) {
    return {
        id: license.id,
        name: license.attributes.name,
        key: license.attributes.key,
        expiry: license.attributes.expiry,
        status: license.attributes.status,
    };
}

// AxiosError carries the full outgoing request config - including the
// Authorization: Bearer KEYGEN_TOKEN header - as an own enumerable property, so
// logging the raw error object prints our admin token straight into the logs.
// Only ever log this sanitized shape (Keygen's response, not our request).
function safeErrorInfo(error) {
    return {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
    };
}

// Middleware to attach user information to the request
function attachUser(req, res, next) {
    const user = req.oidc.user;
    const roles = getRoles(req);

    // Licenses are matched to users by email, so an email the IdP explicitly flags as
    // unverified must not be trusted. IdPs that omit the claim are unaffected.
    if (user.email_verified === false && !isAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden: email address is not verified' });
    }
    // The email is the Keygen license filter; without one the filter would be dropped
    // and the lookup would match every license in the account.
    if (typeof user.email !== 'string' || user.email.trim() === '') {
        return res.status(403).json({ error: 'Forbidden: no email address on this account' });
    }

    req.user = {
        email: user.email,
        roles: roles
    };
    next();
}

// Middleware to check admin permissions. Only denials are audit-logged; successful
// admin actions are already recorded by the handlers that perform them.
function checkAdmin(req, res, next) {
    if (isAdmin(req)) return next();

    logAdminAction(req.oidc.user.email, 'USER_ADMIN_CHECK', { valid: false });
    res.status(403).json({ error: 'Forbidden: Admin access required' });
}

function fetchUserLicenses(userEmail) {
    if (typeof userEmail !== 'string' || userEmail.trim() === '') {
        return Promise.reject(Object.assign(new Error('Missing user email'), { status: 403 }));
    }
    return fetchAllPages('/licenses', { user: userEmail }, toLicense);
}

// Keygen IDs are UUIDs. Anything else (e.g. "../" segments or query fragments)
// must never reach a URL we build for Keygen.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}

const rejectInvalidId = (req, res, next, value) => {
    if (!isUuid(value)) return res.status(400).json({ error: 'Invalid ID' });
    next();
};
router.param('licenseId', rejectInvalidId);
router.param('machineId', rejectInvalidId);
router.param('userId', rejectInvalidId);

// Both machine routes share this, so they share one cache entry with one shape.
function getLicenseMachines(licenseId) {
    return cache.getOrSet(`machines:license:${licenseId}`, MACHINES_TTL_MS,
        () => fetchAllPages('/machines', { license: licenseId }, machine => ({
            id: machine.id,
            name: machine.attributes.name,
            ip: machine.attributes.ip,
            fingerprint: machine.attributes.fingerprint,
            status: machine.attributes.status
        })));
}

function getUserLicenses(userEmail) {
    return cache.getOrSet(`licenses:user:${userEmail}`, LICENSES_TTL_MS, () => fetchUserLicenses(userEmail));
}

// Admins can reach any license; everyone else only their own - checked against
// Keygen's own user->license filter rather than trusting anything client-supplied.
async function assertLicenseAccess(req, licenseId) {
    if (isAdmin(req)) return;

    const licenses = await getUserLicenses(req.user.email);
    if (!licenses.some(license => license.id === licenseId)) {
        throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
}

// Fetch licenses for a specific user
router.get('/user/licenses', attachUser, async (req, res) => {
    try {
        const allLicenses = await getUserLicenses(req.user.email);
        res.json({ licenses: allLicenses });

    } catch (error) {
        console.error('[License Service] Error:', safeErrorInfo(error));
        res.status(error.status || 500).json({
            error: error.status ? 'Failed to fetch licenses' : 'Internal server error'
        });
    }
});

// Fetch all licenses (admin only)
router.get('/admin/licenses', checkAdmin, attachUser, async (req, res) => {
    try {
        const allLicenses = await cache.getOrSet('licenses:admin:all', LICENSES_TTL_MS,
            () => fetchAllPages('/licenses', {}, license => ({
                ...toLicense(license),
                ownerId: license.relationships?.owner?.data?.id || 'unknown'
            })),
            ADMIN_LIST_STALE_MS);

        res.json({ licenses: allLicenses });

    } catch (error) {
        console.error('[License Service] Error:', safeErrorInfo(error));
        res.status(error.status || 500).json({
            error: error.status ? 'Failed to fetch licenses' : 'Internal server error'
        });
    }
});

// Get specific license details
router.get('/licenses/:licenseId', attachUser, async (req, res) => {
    try {
        const { licenseId } = req.params;
        await assertLicenseAccess(req, licenseId);

        const license = await cache.getOrSet(`licenses:detail:${licenseId}`, LICENSES_TTL_MS, async () => {
            // Fetch specific license details
            const response = await keygen.get(`/licenses/${licenseId}`);

            if (response.status !== 200) {
                console.error('[License Service] Error fetching license details:', response.status);
                throw Object.assign(new Error('Failed to fetch license details'), { status: response.status });
            }

            return toLicense(response.data.data);
        });

        res.json({ license });

    } catch (error) {
        if (error.status === 403) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        console.error('[License Service] Error:', safeErrorInfo(error));
        res.status(error.status || 500).json({
            error: error.status ? 'Failed to fetch license details' : 'Internal server error'
        });
    }
});

// Fetch machines for a specific license
router.get('/licenses/:licenseId/machines', attachUser, async (req, res) => {
    try {
        const { licenseId } = req.params;
        await assertLicenseAccess(req, licenseId);

        const machines = await getLicenseMachines(licenseId);
        res.json({ machines });

    } catch (error) {
        if (error.status === 403) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        console.error('[License Service] Error:', safeErrorInfo(error));
        res.status(error.status || 500).json({
            error: error.status ? 'Failed to fetch machines' : 'Internal server error'
        });
    }
});

// Delete a license (admin only)
router.delete('/admin/licenses/:licenseId', checkAdmin, attachUser, async (req, res) => {
    const { licenseId } = req.params;
    const adminEmail = req.user.email;

    try {
        // Delete the license
        const response = await keygen.delete(`/licenses/${licenseId}`);

        if (response.status !== 204) {
            console.error('[Backend] Error deleting license:', response.status);
            logAdminAction(adminEmail, 'DELETE_LICENSE_FAILED', {
                licenseId,
                statusCode: response.status
            });
            return res.status(response.status).json({
                error: 'Failed to delete license'
            });
        }

        logAdminAction(adminEmail, 'DELETE_LICENSE_SUCCESS', {
            licenseId,
            statusCode: response.status
        });

        // Splice the deleted license out of every cache that might list it, instead of
        // dropping the whole namespace - avoids forcing a full re-fetch on the next view.
        cache.update('licenses:admin:all', list => list.filter(l => l.id !== licenseId));
        cache.updatePrefix('licenses:user:', list => list.filter(l => l.id !== licenseId));
        cache.del(`licenses:detail:${licenseId}`);
        cache.del(`machines:license:${licenseId}`);

        res.json({ success: true });

    } catch (error) {
        console.error('[Backend] Server Error:', safeErrorInfo(error));
        logAdminAction(adminEmail, 'DELETE_LICENSE_ERROR', {
            licenseId,
            error: error.message
        });
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Fetch groups (admin only)
router.get('/admin/groups', checkAdmin, attachUser, async (req, res) => {
    try {
        const allGroups = await cache.getOrSet('groups:admin:all', GROUPS_TTL_MS,
            () => fetchAllPages('/groups', {}, group => ({
                id: group.id,
                name: group.attributes.name,
            })),
            ADMIN_LIST_STALE_MS);

        res.json({ groups: allGroups });

    } catch (error) {
        console.error('[License Service] Error:', safeErrorInfo(error));
        res.status(error.status || 500).json({
            error: error.status ? 'Failed to fetch groups' : 'Internal server error'
        });
    }
});

// Fetch policies (admin only)
router.get('/admin/policies', checkAdmin, attachUser, async (req, res) => {
    try {
        const allPolicies = await cache.getOrSet('policies:admin:all', POLICIES_TTL_MS,
            () => fetchAllPages('/policies', {}, policy => ({
                id: policy.id,
                name: policy.attributes.name,
            })),
            ADMIN_LIST_STALE_MS);

        res.json({ policies: allPolicies });

    } catch (error) {
        console.error('[License Service] Error:', safeErrorInfo(error));
        res.status(error.status || 500).json({
            error: error.status ? 'Failed to fetch policies' : 'Internal server error'
        });
    }
});

// Fetch users (admin only)
router.get('/admin/users', checkAdmin, attachUser, async (req, res) => {
    try {
        const allUsers = await cache.getOrSet('users:admin:all', USERS_TTL_MS,
            () => fetchAllPages('/users', {}, user => ({
                id: user.id,
                firstName: user.attributes.firstName,
            })),
            ADMIN_LIST_STALE_MS);

        res.json({ users: allUsers });

    } catch (error) {
        console.error('[License Service] Error:', safeErrorInfo(error));
        res.status(error.status || 500).json({
            error: error.status ? 'Failed to fetch users' : 'Internal server error'
        });
    }
});

// Create a new license (admin only)
router.post('/admin/licenses', checkAdmin, attachUser, async (req, res) => {
    const { name, policyId, groupId, userId } = req.body;
    const adminEmail = req.user.email;

    if (!name || !policyId || !groupId || !userId) {
        return res.status(400).json({
            error: 'Invalid request body'
        });
    }

    console.log('Received license data:', name, policyId, groupId, userId); // Add this line for debugging

    const licenseData = {
        data: {
            type: 'licenses',
            attributes: {
                name: name
            },
            relationships: {
                policy: {
                    data: {
                        type: 'policies',
                        id: policyId
                    }
                },
                group: {
                    data: {
                        type: 'groups',
                        id: groupId
                    }
                },
                owner: {
                    data: {
                        type: 'users',
                        id: userId
                    }
                }
            }
        }
    };

    //console.log('Sending license data to Keygen:', licenseData); // Add this line for debugging

    try {
        const response = await keygen.post('/licenses', licenseData);

        if (response.status !== 201) {
            console.error('[License Service] Error creating license:', response.status);
            logAdminAction(adminEmail, 'CREATE_LICENSE_FAILED', 
                { name, policyId, groupId, userId }
            );
            return res.status(response.status).json({
                error: 'Failed to create license'
            });
        }

        const createdLicense = response.data;
        logAdminAction(adminEmail, 'CREATE_LICENSE_SUCCESS',
            { name, policyId, groupId, userId }
        );
        //console.log('Created license:', createdLicense); // Add this line for debugging

        // Append the new license to the cached admin list using Keygen's own response,
        // rather than dropping the cache and forcing a full re-fetch.
        cache.update('licenses:admin:all', list => [...list, {
            id: createdLicense.data.id,
            name: createdLicense.data.attributes.name,
            key: createdLicense.data.attributes.key,
            expiry: createdLicense.data.attributes.expiry,
            status: createdLicense.data.attributes.status,
            ownerId: userId
        }]);
        // We only know the owner's Keygen user id here, not their email, so we can't target
        // their `licenses:user:<email>` cache directly - it'll pick this up on its own TTL.

        res.json({ success: true, license: createdLicense });

    } catch (error) {
        console.error('[License Service] Error:', safeErrorInfo(error));
        logAdminAction(adminEmail, 'CREATE_LICENSE_ERROR', 
            { name, policyId, groupId, userId, error: error.message }
        );
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Create a new user (admin only)
let requestCount = 0;

router.post('/admin/createuser', checkAdmin, attachUser, async (req, res) => {
    const requestId = ++requestCount;
 
    const { firstName, userName, userEmail, userpassword, userGroup } = req.body;
    const adminEmail = req.user.email;
 
    if (!firstName || !userName || !userEmail || !userpassword || !userGroup) {
        return res.status(400).json({
            error: 'Missing required fields'
        });
    }
 
    const userData = {
        data: {
            type: 'users',
            attributes: {
                firstName: firstName,
                lastName: userName,
                email: userEmail,
                password: userpassword,
                role: 'user'
            },
            relationships: {
                group: {
                    data: {
                        type: 'groups',
                        id: userGroup
                    }
                }
            }
        }
    };
 
    console.log('[Pre-Request] Attempting user creation for:', userEmail);
 
    try {
        const response = await keygen.post('/users', userData, {
            maxRedirects: 0,
            validateStatus: null
        });
        
        console.log('[Response] Status:', response.status);

        const createdUser = response.data?.data;
        if (response.status < 200 || response.status >= 300 || !createdUser) {
            logAdminAction(adminEmail, 'CREATE_USER_FAILED',
                { firstName, userName, userEmail, userGroup, statusCode: response.status }
            );
            return res.status(response.status >= 400 ? response.status : 502).json({
                error: response.data?.errors || 'Failed to create user'
            });
        }

        logAdminAction(adminEmail, 'CREATE_USER_SUCCESS',
            { firstName, userName, userEmail, userGroup }
        );

        // Append the new user to the cached admin list using Keygen's own response,
        // rather than dropping the cache and forcing a full re-fetch.
        cache.update('users:admin:all', list => [...list, {
            id: createdUser.id,
            firstName: createdUser.attributes.firstName,
        }]);

        // Only what the UI needs - not Keygen's full user document.
        res.json({ success: true, user: { id: createdUser.id } });
 
    } catch (error) {
        console.log(`[Request ${requestId}] Failed with error:`, error.response?.status);
        logAdminAction(adminEmail, 'CREATE_USER_ERROR', 
            { firstName, userName, userEmail, userGroup, error: error.message }
        );
        console.error('[Error Details]', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });
        res.status(error.response?.status || 500).json({
            error: error.response?.data?.errors || 'Internal server error'
        });
    }
 });

// Fetch machines associated with a license key
router.post('/fetchMachines', attachUser, async (req, res) => {
    const { licenseId } = req.body;
    if (!isUuid(licenseId)) {
        return res.status(400).json({ error: 'Invalid ID' });
    }
    console.log('[Backend] Path: /fetchMachines, Checked License ID:', licenseId);

    try {
        await assertLicenseAccess(req, licenseId);

        const machines = await getLicenseMachines(licenseId);
        if (machines.length === 0) {
            return res.json({
                errors: [{ title: 'Machine not found', detail: 'No machines found associated with the provided license key.' }]
            });
        }

        console.log('[Backend] Return OK');
        res.json({ machines });

    } catch (error) {
        if (error.apiErrors) {
            return res.json({ errors: error.apiErrors });
        }
        if (error.status === 403) {
            return res.status(403).json({
                errors: [{ title: 'Forbidden', detail: 'You do not have access to this license.' }],
            });
        }
        if (error.status === 404) {
            return res.status(404).json({
                errors: [{ title: 'License check error', detail: 'There was an issue checking the machine id.' }],
            });
        }
        // Handle any unexpected errors in the entire chain
        console.error('[Backend] Server Error:', safeErrorInfo(error));
        res.status(500).json({
            errors: [{ title: 'Server Error', detail: 'Internal server error' }],
        });
    }
});

async function getMachineLicenseId(machineId) {
    const response = await keygen.get(`/machines/${machineId}`);

    if (response.status !== 200) {
        throw Object.assign(new Error('Failed to fetch machine'), { status: response.status });
    }

    return response.data?.data?.relationships?.license?.data?.id || null;
}

// Deactivate a machine
router.delete('/deactivateMachine/:machineId', attachUser, async (req, res) => {
    const { machineId } = req.params;

    try {
        // Resolve the machine's actual license from Keygen rather than trusting the
        // client-supplied licenseId query param, which is what a caller would forge.
        const licenseId = await getMachineLicenseId(machineId);
        await assertLicenseAccess(req, licenseId);

        const response = await keygen.delete(`/machines/${machineId}`);

        if (response.status !== 204) {
            console.error('[Backend] Error deactivating machine:', response.status);
            return res.status(response.status).json({
                error: 'Failed to deactivate machine'
            });
        }

        cache.update(`machines:license:${licenseId}`, list => list.filter(m => m.id !== machineId));
        res.json({ success: true });

    } catch (error) {
        if (error.status === 403) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        console.error('[Backend] Server Error:', safeErrorInfo(error));
        res.status(error.status && error.status !== 500 ? error.status : 500).json({
            error: 'Internal server error'
        });
    }
});

// Delete a user (admin only)
router.delete('/admin/users/:userId', checkAdmin, attachUser, async (req, res) => {
    const { userId } = req.params;
    const adminEmail = req.user.email;

    try {
        const response = await keygen.delete(`/users/${userId}`);

        if (response.status !== 204) {
            console.error('[Backend] Error deleting user:', response.status);
            logAdminAction(adminEmail, 'DELETE_USER_FAILED', userId);
            return res.status(response.status).json({
                error: 'Failed to delete user'
            });
        }

        // We know exactly which user was removed, so patch the list in place.
        cache.update('users:admin:all', list => list.filter(u => u.id !== userId));
        // Whether Keygen cascade-deletes this user's licenses is uncertain and we don't have
        // their email to target a specific license cache, so fall back to a full clear here -
        // this is a rare admin action, unlike the license read/write paths above.
        cache.del('licenses:*');
        res.json({ success: true });
        logAdminAction(adminEmail, 'DELETE_USER_SUCCESS', userId);

    } catch (error) {
        console.error('[Backend] Server Error:', safeErrorInfo(error));
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Renew a license (admin only)
router.post('/admin/renewlicense/:licenseId', checkAdmin, attachUser, async (req, res) => {
    const { licenseId } = req.params;
    const adminEmail = req.user.email;

    try {
        const response = await keygen.post(`/licenses/${licenseId}/actions/renew`);

        if (response.status !== 200) {
            console.error('[Backend] Error renewing license:', response.status);
            logAdminAction(adminEmail, 'RENEW_LICENSE_FAILED', { licenseId, statusCode: response.status });
            return res.status(response.status).json({ error: 'Failed to renew license' });
        }

        logAdminAction(adminEmail, 'RENEW_LICENSE_SUCCESS', { licenseId, statusCode: response.status });

        // Renew only changes expiry/status, which only the detail cache carries - refresh it
        // directly from Keygen's response instead of dropping every license-related cache.
        const renewed = response.data?.data;
        if (renewed) {
            cache.set(`licenses:detail:${licenseId}`, toLicense(renewed), LICENSES_TTL_MS);
            cache.update('licenses:admin:all', list => list.map(l =>
                l.id === renewed.id
                    ? { ...l, expiry: renewed.attributes.expiry, status: renewed.attributes.status }
                    : l
            ));
        } else {
            cache.del(`licenses:detail:${licenseId}`);
        }

        res.json({ success: true });

    } catch (error) {
        console.error('[Backend] Server Error:', safeErrorInfo(error));
        logAdminAction(adminEmail, 'RENEW_LICENSE_ERROR', { licenseId, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
