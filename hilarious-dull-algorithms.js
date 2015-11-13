(function(){
"use strict";

if(!window.hilarious) { window.hilarious = {}; }

hilarious.algo = {}

// A "set" here is an object with every key/value pair having
// the 'value' be 'true'. Underscore.js's set operations on arrays
// have poor asymptotic speed.
hilarious.algo.to_set = function(enumerable) {
  var result = {};
  _.each(enumerable, function(member) {
    if(!_.isString(member) && !_.isNumber(member)) {
      throw("Bad type in conversion to set." +
               (_.isBoolean(member) ? " Is it already a set?" : ""));
    }
    result[member] = true;
  });
  return result;
}
hilarious.algo.set_difference = function(minuend, subtrahend) {
  var result = {};
  _.each(minuend, function(member) {
    if(!subtrahend[member]) {
      result[member] = true;
    }
  });
  return result;
}
hilarious.algo.set_sorted = function(set) {
  return _.sortBy(_.keys(set));
}
hilarious.algo.set_size = function(set) {
  return _.size(set);
}

// inspirations from http://stackoverflow.com/q/1916218
// TODO I really only want to get the portion of common
// prefix that consists of complete grapheme clusters
// (see e.g. https://github.com/devongovett/grapheme-breaker )
// - is that worth implementing?
hilarious.algo.common_prefix = function(strings) {
  if(strings.length === 0) {
    return '';
  }
  var highest = _.reduce(strings, function(a, b) { return a > b ? a : b; });
  var lowest  = _.reduce(strings, function(a, b) { return a > b ? b : a; });
  var max_len = Math.min(highest.length, lowest.length);
  var i = 0;
  while(i < max_len && lowest.charAt(i) === highest.charAt(i)) {
    i += 1;
  }
  return lowest.substring(0, i);
}

}());
