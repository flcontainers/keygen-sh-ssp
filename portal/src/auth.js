import Keycloak from '../node_modules/keycloak-js/lib/keycloak.js';

let initOptions = {
  url: process.env.KEYCLOAK_URL,
  realm: process.env.KEYCLOAK_REALM,
  clientId: process.env.KEYCLOAK_ID,
  onLoad: 'login-required', // check-sso | login-required
  KeycloakResponseType: 'code'
};

let kc = new Keycloak(initOptions);

let userEmail = null;
let userName = null;

async function checkSSOAuthentication() {
  try {
    const auth = await kc.init({
      onLoad: initOptions.onLoad,
      KeycloakResponseType: 'code',
      silentCheckSsoRedirectUri: window.location.origin + "/silent-check-sso.html",
      checkLoginIframe: false,
      pkceMethod: 'S256'
    });

    if (!auth) {
      window.location.reload();
      return false;
    } else {
      console.info("SSO Authentication: Successful");

      // Retrieve the user's email from the token
      if (kc.tokenParsed && kc.tokenParsed.email && kc.tokenParsed.given_name) {
        userEmail = kc.tokenParsed.email;
        userName = kc.tokenParsed.given_name;
        //console.log(kc.tokenParsed);
        console.log("User Email:", userEmail);
        console.log("User Name:", userName);
      } else {
        console.warn("Email not found in token.");
      }

      kc.onTokenExpired = () => {
        console.log('SSO Authentication: Failed (token expired)');
      };

      return true;
    }
  } catch (error) {
    console.error("Authenticated Failed", error);
    return false;
  }
}

// Export the function and the user email
export { checkSSOAuthentication, userEmail, userName };
