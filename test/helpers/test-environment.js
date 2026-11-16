'use strict';
// A stand-in "test" licence environment for the unit tests. The package knows the live
// environment only (see src/licence/config.js); a test that needs a second environment registers
// this one. This file is not part of the package.
//
// The two product ids below are the products of the payment provider's test environment (they
// only work against that environment and are never used by the package). Nothing in src/ names
// a test product.

const config = require('../../src/licence/config');

const TEST_ENVIRONMENT = Object.freeze({
  api: 'https://test.dodopayments.com',
  checkoutBase: 'https://test.checkout.dodopayments.com/buy/',
  products: Object.freeze({ personal: 'pdt_0Ns19sl5vz87CnhS3h8UL', business: 'pdt_0Ns19z2nP3liY0trp6mAh' })
});

/** Registers the stand-in environment in the config module of the current process. */
function register() { config.registerTestEnvironment(TEST_ENVIRONMENT); }

module.exports = { register: register, TEST_ENVIRONMENT: TEST_ENVIRONMENT };
