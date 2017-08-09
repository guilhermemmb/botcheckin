'use strict';

const _ = require('lodash');

function extractCookies(input) {
	var result = {};

	_.each(input, function (element) {
		let str = [];

		if(_.isString(element)) {
			str = element.split(', ');
		}

		for (var i = 0; i < str.length; i++) {
			var cur = str[i].split(';');
			for(var y = 0; y < cur.length; y++) {
				var el = cur[y].split('=');
				result[el[0]] = cur[y];
			}
		}
	});

	return result;
};


module.exports = extractCookies;