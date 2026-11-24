'use strict';
const object = (properties = {}, required = []) => ({ type: 'object', properties, required });
const text = description => ({ type: 'string', description });

module.exports = { object, text };
