// Role handling for OIDC sessions.
//
// express-openid-connect keeps the login ID token in its session cookie, and req.oidc.user
// is just that token's claims - it is never re-checked against the IdP. On its own that
// means someone removed from the admin role keeps admin rights until their session ends
// (up to 7 days by default). So roles live in the session with a verification timestamp,
// and sessions holding the admin role re-verify them against the IdP (refresh-token grant)
// at most every ROLE_RECHECK_MS. Admin rights are only honoured while that check is fresh.

const ADMIN_ROLE = 'Administrator';
const ROLE_RECHECK_MS = 60 * 1000;

function rolesFrom(claims) {
    const roles = claims?.[process.env.OIDC_ROLES_PROPERTY || 'roles'];
    return Array.isArray(roles) ? roles : [];
}

function getRoles(req) {
    return req.appSession?.roles || rolesFrom(req.oidc.user);
}

function rolesAreFresh(req) {
    const verifiedAt = req.appSession?.rolesVerifiedAt;
    return typeof verifiedAt === 'number' && Date.now() - verifiedAt <= ROLE_RECHECK_MS;
}

// Admin rights require the role *and* a recent confirmation from the IdP. If the IdP
// can't be reached to re-verify, admin access fails closed rather than trusting old claims.
function isAdmin(req) {
    return getRoles(req).includes(ADMIN_ROLE) && rolesAreFresh(req);
}

let warnedNoEmailVerified = false;

// express-openid-connect `afterCallback` hook: stamp the roles from the fresh login.
function afterCallback(req, res, session) {
    // Licenses are matched by email and only an explicit email_verified=false is refused
    // (see attachUser), so an IdP that omits the claim is trusted to own its emails. That's
    // fine while the IdP has no self-registration; flag it so a later change isn't silent.
    if (!warnedNoEmailVerified && req.oidc.idTokenClaims?.email_verified === undefined) {
        warnedNoEmailVerified = true;
        console.warn('[Auth] The IdP sends no email_verified claim: users are matched to licenses by an email the IdP has not confirmed. Do not enable self-registration without email verification on the IdP.');
    }
    return {
        ...session,
        roles: rolesFrom(req.oidc.idTokenClaims),
        rolesVerifiedAt: Date.now(),
    };
}

// The IdP answered and refused the refresh (e.g. invalid_grant: user disabled, session or
// consent revoked), as opposed to being unreachable. Only these end the session.
function isRejection(error) {
    if (error?.name === 'SessionExpiredError') return true;
    return typeof error?.error === 'string' && !(error.status >= 500);
}

function endSession(req, reason) {
    console.warn(`[Auth] Ending session for ${req.oidc.user?.email}: ${reason}`);
    req.appSession = undefined; // clears the cookie; requiresAuth() then sends them to log in
}

// A page fires several requests at once, all carrying the same session cookie. IdPs that
// rotate refresh tokens (e.g. Authentik) revoke a refresh token once it's used, so if each
// request refreshed on its own, all but the first would get invalid_grant and end the session.
// Requests holding the same refresh token therefore share one refresh, and its result is kept
// for REFRESH_SHARE_MS so requests the browser sent before receiving the new cookie get it too.
const REFRESH_SHARE_MS = 30 * 1000;
const refreshes = new Map(); // refresh token -> Promise of the session fields to apply

function refreshSession(req) {
    const refreshToken = req.oidc.refreshToken;
    let shared = refreshes.get(refreshToken);
    if (shared) return shared;

    shared = (async () => {
        const idTokenBefore = req.oidc.idToken;
        await req.oidc.accessToken.refresh();

        // Most IdPs return a new ID token on refresh; if this one didn't, the stored claims
        // are still the login ones, so ask the userinfo endpoint for the current roles instead.
        const roles = req.oidc.idToken !== idTokenBefore
            ? rolesFrom(req.oidc.idTokenClaims)
            : rolesFrom(await req.oidc.fetchUserInfo());

        const { access_token, id_token, refresh_token, token_type, expires_at } = req.appSession;
        return { access_token, id_token, refresh_token, token_type, expires_at, roles, rolesVerifiedAt: Date.now() };
    })();
    refreshes.set(refreshToken, shared);
    // Failures are dropped at once so the next request retries (e.g. once the IdP is back).
    shared.then(
        () => setTimeout(() => refreshes.delete(refreshToken), REFRESH_SHARE_MS).unref(),
        () => refreshes.delete(refreshToken));
    return shared;
}

// Middleware, mounted after auth(). Only sessions that currently hold the admin role are
// re-verified: losing a regular role grants nothing, and gaining admin simply takes a new login.
async function revalidateRoles(req, res, next) {
    if (!req.oidc.isAuthenticated() || !getRoles(req).includes(ADMIN_ROLE) || rolesAreFresh(req)) {
        return next();
    }

    if (!req.oidc.refreshToken) {
        endSession(req, 'admin roles need re-verification but the IdP issued no refresh token (is offline_access allowed for this client?)');
        return next();
    }

    try {
        Object.assign(req.appSession, await refreshSession(req));
    } catch (error) {
        if (isRejection(error)) {
            endSession(req, `IdP rejected the refresh (${error.error || error.name})`);
        } else {
            // IdP unreachable: keep the session but leave the roles unverified, so isAdmin()
            // denies admin access until a later request re-verifies successfully.
            console.error('[Auth] Could not re-verify roles with the IdP:', error.message);
        }
    }
    next();
}

// Route guard for admin pages/routes.
function requireAdmin(req, res, next) {
    if (isAdmin(req)) return next();
    res.status(403).send('Forbidden: You do not have access to this resource.');
}

module.exports = { ADMIN_ROLE, getRoles, isAdmin, afterCallback, revalidateRoles, requireAdmin };
