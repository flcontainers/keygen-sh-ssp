const express = require('express');
const axios = require('axios');
const router = express.Router();
const { logAdminAction } = require('../utils/logger');
const cache = require('../utils/cache');

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
    const roles = req.oidc.user?.[process.env.OIDC_ROLES_PROPERTY || 'roles'] || [];

    req.user = {
        email: user.email,
        roles: roles
    };
    console.log('User attached to request:', req.user);
    logAdminAction(user.email, 'USER_LOGIN_INFO', {
        info: 'User logged in'
    });
    next();
}

function isAdmin(req) {
    const roles = req.oidc.user?.[process.env.OIDC_ROLES_PROPERTY || 'roles'] || [];
    return roles.includes('Administrator');
}

// Middleware to check admin permissions
function checkAdmin(req, res, next) {
    const user = req.oidc.user;

    console.log('Checking admin permissions...');

    if (isAdmin(req)) {
        console.log('User is admin');
        logAdminAction(user.email, 'USER_ADMIN_CHECK', {
            valid: true
        });
        next();
    } else {
        console.log('User is not admin');
        logAdminAction(user.email, 'USER_ADMIN_CHECK', {
            valid: false
        });
        res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
}

async function fetchUserLicenses(userEmail) {
    let licenses = [];
    let pageNumber = 1;
    let hasMoreLicenses = true;

    while (hasMoreLicenses) {
        const response = await axios.get(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses?page%5Bsize%5D=100&page%5Bnumber%5D=${pageNumber}&user=${userEmail}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                },
            }
        );

        if (response.status !== 200) {
            console.error('[License Service] Error fetching licenses:', response.status);
            throw Object.assign(new Error('Failed to fetch licenses'), { status: response.status });
        }

        const data = response.data;

        if (!data || !data.data || data.data.length === 0) {
            hasMoreLicenses = false;
        } else {
            licenses = licenses.concat(data.data.map(license => ({
                id: license.id,
                name: license.attributes.name,
                key: license.attributes.key,
                expiry: license.attributes.expiry,
                status: license.attributes.status,
            })));
            pageNumber++;
        }
    }

    return licenses;
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
        const allLicenses = await cache.getOrSet('licenses:admin:all', LICENSES_TTL_MS, async () => {
            let licenses = [];
            let pageNumber = 1;
            let hasMoreLicenses = true;

            while (hasMoreLicenses) {
                const response = await axios.get(
                    `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses?page%5Bsize%5D=100&page%5Bnumber%5D=${pageNumber}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                            'Accept': 'application/vnd.api+json',
                        },
                    }
                );

                if (response.status !== 200) {
                    console.error('[License Service] Error fetching licenses:', response.status);
                    throw Object.assign(new Error('Failed to fetch licenses'), { status: response.status });
                }

                const data = response.data;

                if (!data || !data.data || data.data.length === 0) {
                    hasMoreLicenses = false;
                } else {
                    licenses = licenses.concat(data.data.map(license => ({
                        id: license.id,
                        name: license.attributes.name,
                        key: license.attributes.key,
                        expiry: license.attributes.expiry,
                        status: license.attributes.status,
                        ownerId: license.relationships?.owner?.data?.id || 'unknown'
                    })));
                    pageNumber++;
                }
            }

            return licenses;
        });

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
            const response = await axios.get(
                `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses/${licenseId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                        'Accept': 'application/vnd.api+json',
                    },
                }
            );

            if (response.status !== 200) {
                console.error('[License Service] Error fetching license details:', response.status);
                throw Object.assign(new Error('Failed to fetch license details'), { status: response.status });
            }

            const data = response.data;

            return {
                id: data.data.id,
                name: data.data.attributes.name,
                key: data.data.attributes.key,
                expiry: data.data.attributes.expiry,
                status: data.data.attributes.status,
                // Add any other relevant fields you want to expose
            };
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

        const machines = await cache.getOrSet(`machines:license:${licenseId}`, MACHINES_TTL_MS, async () => {
            const response = await axios.get(
                `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses/${licenseId}/machines`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                        'Accept': 'application/vnd.api+json',
                    },
                }
            );

            if (response.status !== 200) {
                console.error('[License Service] Error fetching machines:', response.status);
                throw Object.assign(new Error('Failed to fetch machines'), { status: response.status });
            }

            return response.data.data.map(machine => ({
                id: machine.id,
                name: machine.attributes.name,
                ip: machine.attributes.ip,
                fingerprint: machine.attributes.fingerprint,
                status: machine.attributes.status
            }));
        });

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
        const response = await axios.delete(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses/${licenseId}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                },
            }
        );

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
        const allGroups = await cache.getOrSet('groups:admin:all', GROUPS_TTL_MS, async () => {
            let groups = [];
            let pageNumber = 1;
            let hasMoreGroups = true;

            while (hasMoreGroups) {
                const response = await axios.get(
                    `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/groups?page%5Bsize%5D=100&page%5Bnumber%5D=${pageNumber}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                            'Accept': 'application/vnd.api+json',
                        },
                    }
                );

                if (response.status !== 200) {
                    console.error('[License Service] Error fetching groups:', response.status);
                    throw Object.assign(new Error('Failed to fetch groups'), { status: response.status });
                }

                const data = response.data;

                if (!data || !data.data || data.data.length === 0) {
                    hasMoreGroups = false;
                } else {
                    groups = groups.concat(data.data.map(group => ({
                        id: group.id,
                        name: group.attributes.name,
                    })));
                    pageNumber++;
                }
            }

            return groups;
        });

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
        const allPolicies = await cache.getOrSet('policies:admin:all', POLICIES_TTL_MS, async () => {
            let policies = [];
            let pageNumber = 1;
            let hasMorePolicies = true;

            while (hasMorePolicies) {
                const response = await axios.get(
                    `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/policies?page%5Bsize%5D=100&page%5Bnumber%5D=${pageNumber}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                            'Accept': 'application/vnd.api+json',
                        },
                    }
                );

                if (response.status !== 200) {
                    console.error('[License Service] Error fetching policies:', response.status);
                    throw Object.assign(new Error('Failed to fetch policies'), { status: response.status });
                }

                const data = response.data;

                if (!data || !data.data || data.data.length === 0) {
                    hasMorePolicies = false;
                } else {
                    policies = policies.concat(data.data.map(policy => ({
                        id: policy.id,
                        name: policy.attributes.name,
                    })));
                    pageNumber++;
                }
            }

            return policies;
        });

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
        const allUsers = await cache.getOrSet('users:admin:all', USERS_TTL_MS, async () => {
            let users = [];
            let pageNumber = 1;
            let hasMoreUsers = true;

            while (hasMoreUsers) {
                const response = await axios.get(
                    `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/users?page%5Bsize%5D=100&page%5Bnumber%5D=${pageNumber}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                            'Accept': 'application/vnd.api+json',
                        },
                    }
                );

                if (response.status !== 200) {
                    console.error('[License Service] Error fetching users:', response.status);
                    throw Object.assign(new Error('Failed to fetch users'), { status: response.status });
                }

                const data = response.data;

                if (!data || !data.data || data.data.length === 0) {
                    hasMoreUsers = false;
                } else {
                    users = users.concat(data.data.map(user => ({
                        id: user.id,
                        firstName: user.attributes.firstName,
                    })));
                    pageNumber++;
                }
            }

            return users;
        });

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
        const response = await axios.post(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses`,
            licenseData,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                    'Content-Type': 'application/vnd.api+json',
                },
            }
        );

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
 
    console.log('[Pre-Request] Attempting user creation with data:', userData);
 
    try {
        const response = await axios.post(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/users`,
            userData,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                    'Content-Type': 'application/vnd.api+json'
                },
                maxRedirects: 0,
                validateStatus: null
            }
        );
        
        console.log('[Response] Status:', response.status);
        logAdminAction(adminEmail, 'CREATE_USER_SUCCESS',
            { firstName, userName, userEmail, userGroup }
        );
        //console.log(`[Request ${requestId}] Completed with status:`, response.status);

        // Append the new user to the cached admin list using Keygen's own response,
        // rather than dropping the cache and forcing a full re-fetch.
        const createdUser = response.data?.data;
        if (response.status >= 200 && response.status < 300 && createdUser) {
            cache.update('users:admin:all', list => [...list, {
                id: createdUser.id,
                firstName: createdUser.attributes.firstName,
            }]);
        }

        res.json({ success: true, user: response.data });
 
    } catch (error) {
        console.log(`[Request ${requestId}] Failed with error:`, error.response?.status);
        logAdminAction(adminEmail, 'CREATE_USER_ERROR', 
            { firstName, userName, userEmail, userGroup, error: error.message }
        );
        console.error('[Error Details]', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            headers: error.response?.headers
        });
        res.status(error.response?.status || 500).json({
            error: error.response?.data?.errors || 'Internal server error'
        });
    }
 });

// Fetch machines associated with a license key
router.post('/fetchMachines', attachUser, async (req, res) => {
    const { licenseId } = req.body;
    console.log('[Backend] Path: /fetchMachines, Checked License ID:', licenseId);

    try {
        await assertLicenseAccess(req, licenseId);

        const machines = await cache.getOrSet(`machines:license:${licenseId}`, MACHINES_TTL_MS, async () => {
            // Fetch machines associated with the license key
            const machinesResponse = await axios.get(
                `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/machines?limit=100&license=${licenseId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                        'Accept': 'application/vnd.api+json',
                    },
                }
            );

            if (machinesResponse.status !== 200) {
                console.error('[Backend] Error fetching machines:', machinesResponse.status);
                throw Object.assign(new Error('License check error'), { status: 404 });
            }

            const machinesData = machinesResponse.data;

            if (machinesData.errors) {
                throw Object.assign(new Error('Machines fetch error'), { apiErrors: machinesData.errors });
            }

            if (machinesData.data.length === 0) {
                throw Object.assign(new Error('Machine not found'), {
                    apiErrors: [{ title: 'Machine not found', detail: 'No machines found associated with the provided license key.' }]
                });
            }

            // Extract the necessary attributes from the machines
            return machinesData.data.map(machine => ({
                id: machine.id,
                name: machine.attributes.name,
                ip: machine.attributes.ip,
                fingerprint: machine.attributes.fingerprint,
            }));
        });

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
            errors: [{ title: 'Server Error', detail: error.message }],
        });
    }
});

async function getMachineLicenseId(machineId) {
    const response = await axios.get(
        `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/machines/${machineId}`,
        {
            headers: {
                'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                'Accept': 'application/vnd.api+json',
            },
        }
    );

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

        const response = await axios.delete(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/machines/${machineId}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                },
            }
        );

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
        const response = await axios.delete(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/users/${userId}`,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                },
            }
        );

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
        const response = await axios.post(
            `${process.env.KEYGEN_URL}/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses/${licenseId}/actions/renew`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${process.env.KEYGEN_TOKEN}`,
                    'Accept': 'application/vnd.api+json',
                },
            }
        );

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
            cache.set(`licenses:detail:${licenseId}`, {
                id: renewed.id,
                name: renewed.attributes.name,
                key: renewed.attributes.key,
                expiry: renewed.attributes.expiry,
                status: renewed.attributes.status,
            }, LICENSES_TTL_MS);
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
