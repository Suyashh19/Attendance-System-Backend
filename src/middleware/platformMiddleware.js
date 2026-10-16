/**
 * platformMiddleware.js
 * Tells web-app requests apart from the mobile app.
 *
 * The web app exists only as a stand-in for iPhone faculty, so it is limited
 * to faculty accounts: students are bound to a phone and must use the app.
 */

const WEB = "web";
const APP = "app";

/**
 * A request counts as web when the client says so, or when it carries an
 * Origin header: browsers send one on cross-site requests, while the React
 * Native app's HTTP calls do not. Leaving `platform` out of a browser
 * request therefore does not get past the check.
 * @param {import("express").Request} req
 * @returns {boolean}
 */
function isWebRequest(req) {
  return req.body?.platform === WEB || !!req.headers?.origin;
}

/**
 * Tokens issued before the platform claim existed have none; those all came
 * from the app, so they are treated as app tokens.
 * @param {{ platform?: string }} decodedToken
 * @returns {boolean}
 */
function isWebToken(decodedToken) {
  return decodedToken?.platform === WEB;
}

/**
 * Web tokens are only ever issued to faculty; anything else is rejected.
 * @param {{ role?: string, platform?: string }} decodedToken
 * @returns {boolean}
 */
function isAllowedToken(decodedToken) {
  return !isWebToken(decodedToken) || decodedToken.role === "faculty";
}

// For routes that only make sense in the app, such as sign-up and moving an account to a new phone
const rejectWeb = (req, res, next) => {
  if (isWebRequest(req) || isWebToken(req.user)) {
    return res.status(403).json({ error: "This is only available in the mobile app" });
  }
  next();
};

module.exports = { WEB, APP, isWebRequest, isWebToken, isAllowedToken, rejectWeb };
