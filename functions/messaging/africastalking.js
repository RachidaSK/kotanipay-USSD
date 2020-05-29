'use strict';
const validate  = require('validate.js');
const _         = require('lodash');

const Common    = require('./common');

const SMS       = require('./sms');
// const USSD      = require('./ussd');
// const Airtime   = require('./airtime');


function AfricasTalking(options) {

    this.options = _.cloneDeep(options);

    validate.validators.isString = function(value, options, key, attributes) {
        if (validate.isEmpty(value) || validate.isString(value)) { // String or null & undefined
            return null;
        } else {
            return "must be a string";
        }
    };

    const constraints = {
        format: {
            inclusion: ['json', 'xml']
        },
        username: {
            presence: true,
            isString: true
        },
        apiKey: {
            presence: true,
            isString: true
        }
    };

    const error = validate(this.options, constraints);
    if (error) {
        throw error;
    }

    switch (this.options.format) {
        case "xml":
            this.options.format = "application/xml";
            break;
        case "json": // Get json by default
        default:
            this.options.format = "application/json";
    }

    var isSandbox = this.options.username.toLowerCase() === 'sandbox';
    if (isSandbox) {
        Common.enableSandbox();
    }
    this.SMS     = new SMS(this.options);
}

module.exports = function (options) {
    return new AfricasTalking(options);
};
