'use strict';

const BASE_DOMAIN = "africastalking.com";
const BASE_SANDBOX_DOMAIN = "sandbox." + BASE_DOMAIN;

const initUrls = function (sandbox) {

    const baseDomain = sandbox ? BASE_SANDBOX_DOMAIN : BASE_DOMAIN;
    const baseUrl = "https://api." + baseDomain + "/version1";

    exports.BASE_URL = baseUrl;

    exports.CHECKOUT_TOKEN_URL = "https://api." + baseDomain + "/checkout/token/create";

    exports.AUTH_TOKEN_URL = "https://api." + baseDomain + "/auth-token/generate";

    exports.USER_URL = baseUrl + "/user";

    exports.SMS_URL  = baseUrl + "/messaging";
};

initUrls(false);

exports.enableSandbox = function () {
    initUrls(true);
};
